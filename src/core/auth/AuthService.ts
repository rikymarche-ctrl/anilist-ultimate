import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import type { ILogger } from '@core/interfaces/ILogger';
import type { IEventBus } from '@core/interfaces/IEventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { MSG, type UserCache, type AuthStatusResponse } from '../../shared/messages';
import type { IApiClient } from '@core/interfaces/IApiClient';
import type { AuthTokenService } from './AuthTokenService';
import { parseAuthStatus, parseAuthUserCache } from './AuthMetadata';
import { isRecord } from '@/api/GraphQLResponse';
import { AuthLoginError, identityFailureCode, parseAuthFailureCode, type AuthFailureCode } from './AuthFailure';

@injectable()
export class AuthService {
  private oauthInFlight: Promise<{ success: boolean; error?: string; code?: AuthFailureCode; userId?: number; userName?: string }> | null = null;
  private authEpoch = 0;
  private commandVersion = 0;
  private readonly OAUTH_CONFIG = {
    CLIENT_ID: import.meta.env.VITE_ANILIST_CLIENT_ID || '35100',
    AUTH_URL: 'https://anilist.co/api/v2/oauth/authorize',
  };

  constructor(
    @inject(TOKENS.Logger) private logger: ILogger,
    @inject(TOKENS.EventBus) private eventBus: IEventBus,
    @inject(TOKENS.ApiClient) private api: IApiClient,
    @inject(TOKENS.AuthTokenService) private tokenService: AuthTokenService
  ) {}

  /**
   * Get the automatic redirect URI for this extension
   */
  public getRedirectUri(): string {
    return chrome.identity.getRedirectURL();
  }

  /**
   * Start the OAuth flow via the background service worker
   * (Called from Content Script)
   */
  public async login(): Promise<void> {
    const version = ++this.commandVersion;
    this.logger.info('[AuthService] Requesting login from background script...');
    let failure: AuthFailureCode = 'AUTH_TRANSPORT';
    try {
      const response: unknown = await chrome.runtime.sendMessage({
        type: MSG.AUTH_LOGIN
      });

      this.assertCommandCurrent(version);
      if (!isRecord(response) || response.success !== true) {
        if (isRecord(response)) failure = parseAuthFailureCode(response.code) ?? 'AUTH_UNKNOWN';
        throw new AuthLoginError(failure);
      }
      failure = 'AUTH_REFRESH';
      const owner = parseAuthUserCache({ userId: response.userId,
        userName: response.userName === undefined ? '' : response.userName });
      await this.tokenService.refresh();
      this.assertCommandCurrent(version);
      const status = this.getClientStatus();
      if (!status.authenticated || status.userId !== owner?.userId) throw new Error('Login failed');
      this.logger.success('[AuthService] Login successful');
      this.eventBus.emit(EVENT_TYPES.AUTH_STATE_CHANGED, {
        isAuthenticated: true,
        userId: status.userId,
        timestamp: new Date()
      });
    } catch {
      // Transport/provider errors may contain credentials or user input.
      this.logger.error('[AuthService] Login failed');
      throw new AuthLoginError(failure);
    }
  }

  /**
   * Performs the actual OAuth flow using chrome.identity.
   * (Called ONLY from Background context)
   */
  public performOAuthLogin(): Promise<{ success: boolean; error?: string; code?: AuthFailureCode; userId?: number; userName?: string }> {
    if (this.oauthInFlight) return this.oauthInFlight;
    const task = this.performOAuthFlow().finally(() => { if (this.oauthInFlight === task) this.oauthInFlight = null; });
    this.oauthInFlight = task;
    return task;
  }

  private async performOAuthFlow(): Promise<{ success: boolean; error?: string; code?: AuthFailureCode; userId?: number; userName?: string }> {
    const epoch = this.authEpoch;
    let previousToken: string | null = null;
    let previousUser: UserCache | null = null;
    let provisionalToken = false;
    let failure: AuthFailureCode = 'AUTH_STORAGE';
    let ownedSession: string | undefined;
    let ownedToken: string | null = null;
    let ownedUserId: number | undefined;
    const current = () => epoch === this.authEpoch && this.tokenService.getToken() === ownedToken
      && this.tokenService.getSessionId?.() === ownedSession && this.tokenService.getUserCache()?.userId === ownedUserId;
    const cancelled = (): never => { failure = 'AUTH_CANCELLED'; throw new AuthLoginError(failure); };
    const commit = async (token: string, owner?: UserCache) => {
      if (!current()) cancelled();
      await this.tokenService.setToken(token, owner, current);
      if (epoch !== this.authEpoch || this.tokenService.getToken() !== token || this.tokenService.getUserCache()?.userId !== owner?.userId) cancelled();
      ownedToken = token; ownedSession = this.tokenService.getSessionId?.(); ownedUserId = owner?.userId;
    };
    try {
      await this.tokenService.ensureInitialized();
      if (epoch !== this.authEpoch) cancelled();
      previousToken = this.tokenService.getToken();
      previousUser = this.tokenService.getUserCache();
      ownedToken = previousToken; ownedSession = this.tokenService.getSessionId?.(); ownedUserId = previousUser?.userId;
      failure = 'AUTH_OPEN';
      const authURL = new URL(this.OAUTH_CONFIG.AUTH_URL);
      const state = crypto.randomUUID();
      const redirect = new URL(this.getRedirectUri());
      authURL.searchParams.set('client_id', this.OAUTH_CONFIG.CLIENT_ID);
      authURL.searchParams.set('response_type', 'token');
      // AniList's implicit grant uses the client's registered redirect URI.
      // Do not override its exact spelling with Chrome's normalized URL.
      authURL.searchParams.set('state', state);

      this.logger.info('[AuthService] Launching OAuth flow...');
      
      let responseURL: string | undefined;
      try {
        responseURL = await chrome.identity.launchWebAuthFlow({ url: authURL.toString(), interactive: true });
      } catch (error) { failure = identityFailureCode(error); throw new AuthLoginError(failure); }

      if (!responseURL) throw new Error('No response URL from OAuth flow');
      if (!current()) cancelled();

      failure = 'AUTH_REDIRECT';
      const url = new URL(responseURL);
      if (url.origin !== redirect.origin || url.pathname !== redirect.pathname) throw new Error('Invalid OAuth redirect');
      const fragment = url.hash.substring(1);
      const params = new URLSearchParams(fragment);
      failure = 'AUTH_STATE';
      if ((params.get('state') ?? url.searchParams.get('state')) !== state) throw new Error('Invalid OAuth state');
      const token = params.get('access_token');

      failure = 'AUTH_TOKEN';
      if (!token) throw new Error('No access token in OAuth response');

      // Set token temporarily to fetch user data
      failure = 'AUTH_STORAGE';
      await commit(token);
      provisionalToken = true;

      // Fetch user details via IApiClient (fully unified!)
      failure = 'AUTH_VIEWER';
      const viewer = await this.api.getCurrentUser();
      if (!current()) cancelled();

      const userCache: UserCache = {
        userId: viewer.id,
        userName: viewer.name,
      };

      // Finalize token storage with user metadata
      failure = 'AUTH_STORAGE';
      await commit(token, userCache);

      this.logger.success('[AuthService] OAuth successful');

      return {
        success: true,
        userId: viewer.id,
        userName: viewer.name,
      };
    } catch {
      if (provisionalToken && current()) {
        try {
          if (previousToken) await this.tokenService.setToken(previousToken, previousUser ?? undefined, current);
          else await this.tokenService.clearToken(current);
        } catch { this.logger.error('[AuthService] Failed to restore authentication after unsuccessful login'); }
      }
      this.logger.error('[AuthService] OAuth flow failed');
      return {
        success: false,
        error: 'OAuth login failed',
        code: failure,
      };
    }
  }

  /**
   * Logout and clear all tokens via background
   * (Called from Content Script)
   */
  public async logout(): Promise<void> {
    const version = ++this.commandVersion;
    this.logger.info('[AuthService] Requesting logout...');
    try {
      const response: unknown = await chrome.runtime.sendMessage({ type: MSG.AUTH_LOGOUT });
      this.assertCommandCurrent(version);
      if (!isRecord(response) || response.success !== true) throw new Error('Logout failed');
      await this.tokenService.refresh();
      this.assertCommandCurrent(version);
      if (this.getClientStatus().authenticated) throw new Error('Logout failed');
      this.logger.info('[AuthService] Logout successful');
      this.eventBus.emit(EVENT_TYPES.AUTH_STATE_CHANGED, {
        isAuthenticated: false,
        timestamp: new Date()
      });
    } catch {
      this.logger.error('[AuthService] Logout failed');
      throw new Error('Logout failed');
    }
  }

  private assertCommandCurrent(version: number): void {
    if (version !== this.commandVersion) throw new Error('Authentication command superseded');
  }

  /** Recheck public state after refresh; command replies never establish an owner. */
  private getClientStatus(): AuthStatusResponse {
    const authenticated: unknown = this.tokenService.hasToken();
    const owner = parseAuthUserCache(this.tokenService.getUserCache());
    if (authenticated === false && owner !== null) throw new Error('Invalid authentication metadata');
    return parseAuthStatus({ authenticated, userId: owner?.userId, userName: owner?.userName,
      sessionId: this.tokenService.getSessionId() });
  }

  /**
   * Performs the actual logout.
   * (Called ONLY from Background context)
   */
  public async performLogout(): Promise<{ success: boolean }> {
    this.authEpoch++;
    this.oauthInFlight = null;
    try {
      await this.tokenService.clearToken();
      this.logger.info('[AuthService] Tokens cleared from background');
      return { success: true };
    } catch {
      this.logger.error('[AuthService] Logout execution failed');
      return { success: false };
    }
  }

  /**
   * Check if the user is currently authenticated
   */
  public async isAuthenticated(): Promise<boolean> {
    const response: unknown = await chrome.runtime.sendMessage({ type: MSG.AUTH_STATUS });
    return parseAuthStatus(response).authenticated;
  }

  /**
   * Gets current auth status metadata.
   * (Called ONLY from Background context)
   */
  public async getStatus(): Promise<AuthStatusResponse> {
    await this.tokenService.ensureInitialized();
    const token = this.tokenService.getToken();
    const userCache = token ? parseAuthUserCache(this.tokenService.getUserCache()) : null;

    if (token && userCache) {
      return parseAuthStatus({
        authenticated: true,
        userId: userCache.userId,
        userName: userCache.userName,
        sessionId: this.tokenService.getSessionId(),
      });
    }

    const sessionId = this.tokenService.getSessionId();
    // The writer's fail-closed RAM fallback uses an empty internal session.
    // Keep that sentinel private; public RPC sessions still require validation.
    return parseAuthStatus({ authenticated: false, sessionId: sessionId === '' ? undefined : sessionId });
  }
}
