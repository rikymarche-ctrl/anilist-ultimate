import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import type { ILogger } from '@core/interfaces/ILogger';
import type { IEventBus } from '@core/interfaces/IEventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { MSG } from '../../shared/messages';

@injectable()
export class AuthService {
  constructor(
    @inject(TOKENS.Logger) private logger: ILogger,
    @inject(TOKENS.EventBus) private eventBus: IEventBus
  ) {}

  /**
   * Get the automatic redirect URI for this extension
   */
  public getRedirectUri(): string {
    return chrome.identity.getRedirectURL();
  }

  /**
   * Start the OAuth flow via the background service worker
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
   * Logout and clear all tokens via background
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
   * Check if the user is currently authenticated
   */
  public async isAuthenticated(): Promise<boolean> {
    const response = await chrome.runtime.sendMessage({ type: MSG.AUTH_STATUS });
    return !!(response && response.authenticated);
  }
}
