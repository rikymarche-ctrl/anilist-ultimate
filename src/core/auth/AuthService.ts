import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import type { ILogger } from '@core/interfaces/ILogger';
import type { IEventBus } from '@core/interfaces/IEventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { MSG, type UserCache } from '../../shared/messages';
import type { IApiClient } from '@core/interfaces/IApiClient';
import type { AuthTokenService } from './AuthTokenService';

@injectable()
export class AuthService {
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
    this.logger.info('[AuthService] Requesting login from background script...');

    try {
      const response = await chrome.runtime.sendMessage({
        type: MSG.AUTH_LOGIN
      });

      if (response && response.success) {
        this.logger.success(`[AuthService] Login successful! Welcome, ${response.userName || 'User'}`);
        
        // Notify the rest of the app
        this.eventBus.emit(EVENT_TYPES.AUTH_STATE_CHANGED, {
          isAuthenticated: true,
          userId: response.userId,
          timestamp: new Date()
        });
      } else {
        throw new Error(response?.error || 'Login failed');
      }
    } catch (error) {
      this.logger.error('[AuthService] Login failed', error);
      throw error;
    }
  }

  /**
   * Performs the actual OAuth flow using chrome.identity.
   * (Called ONLY from Background context)
   */
  public async performOAuthLogin(): Promise<{ success: boolean; error?: string; userId?: number; userName?: string; token?: string }> {
    try {
      const authURL = new URL(this.OAUTH_CONFIG.AUTH_URL);
      authURL.searchParams.set('client_id', this.OAUTH_CONFIG.CLIENT_ID);
      authURL.searchParams.set('response_type', 'token');

      this.logger.info('[AuthService] Launching OAuth flow...');
      
      const responseURL = await chrome.identity.launchWebAuthFlow({
        url: authURL.toString(),
        interactive: true,
      });

      if (!responseURL) throw new Error('No response URL from OAuth flow');

      const url = new URL(responseURL);
      const fragment = url.hash.substring(1);
      const params = new URLSearchParams(fragment);
      const token = params.get('access_token');

      if (!token) throw new Error('No access token in OAuth response');

      // Set token temporarily to fetch user data
      await this.tokenService.setToken(token);

      // Fetch user details via IApiClient (fully unified!)
      const viewer = await this.api.getCurrentUser();

      const userCache: UserCache = {
        userId: viewer.id,
        userName: viewer.name,
      };

      // Finalize token storage with user metadata
      await this.tokenService.setToken(token, userCache);

      this.logger.success(`[AuthService] OAuth successful for user: ${viewer.name}`);

      return {
        success: true,
        token,
        userId: viewer.id,
        userName: viewer.name,
      };
    } catch (error: any) {
      this.logger.error('[AuthService] OAuth flow failed', error);
      return {
        success: false,
        error: error.message || 'Unknown OAuth error',
      };
    }
  }

  /**
   * Logout and clear all tokens via background
   * (Called from Content Script)
   */
  public async logout(): Promise<void> {
    this.logger.info('[AuthService] Requesting logout...');
    const response = await chrome.runtime.sendMessage({ type: MSG.AUTH_LOGOUT });
    
    if (response && response.success) {
      this.logger.info('[AuthService] Logout successful');
      this.eventBus.emit(EVENT_TYPES.AUTH_STATE_CHANGED, {
        isAuthenticated: false,
        timestamp: new Date()
      });
    }
  }

  /**
   * Performs the actual logout.
   * (Called ONLY from Background context)
   */
  public async performLogout(): Promise<{ success: boolean }> {
    try {
      await this.tokenService.clearToken();
      this.logger.info('[AuthService] Tokens cleared from background');
      return { success: true };
    } catch (error) {
      this.logger.error('[AuthService] Logout execution failed', error);
      return { success: false };
    }
  }

  /**
   * Check if the user is currently authenticated
   */
  public async isAuthenticated(): Promise<boolean> {
    const response = await chrome.runtime.sendMessage({ type: MSG.AUTH_STATUS });
    return !!(response && response.authenticated);
  }

  /**
   * Gets current auth status metadata.
   * (Called ONLY from Background context)
   */
  public async getStatus(): Promise<{ authenticated: boolean; token?: string; userId?: number; userName?: string }> {
    await this.tokenService.ensureInitialized();
    const token = this.tokenService.getToken();
    const userCache = this.tokenService.getUserCache();

    if (token && userCache) {
      return {
        authenticated: true,
        token,
        userId: userCache.userId,
        userName: userCache.userName,
      };
    }

    return { authenticated: false };
  }
}
