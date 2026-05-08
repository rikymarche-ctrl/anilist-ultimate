import { injectable } from 'tsyringe';
import { calendarStore } from '@/modules/calendar/CalendarStore';

/**
 * Global application preferences interface
 */
export interface AppPreferences {
  socialEnabled: boolean;
  socialShowAvatars: boolean;
  enableAstra: boolean;
  enableSocialFeatures: boolean; // Native AniList social
  autoUpdateProgress: boolean;
  compactMode: boolean;
}

/**
 * Service to handle all application preferences while abstracting the underlying storage.
 * Standardizes access to settings across all modules (Astra, Social, Calendar).
 */
@injectable()
export class PreferencesService {
  /**
   * Gets the current global preferences
   */
  public getPreferences(): AppPreferences {
    const state = calendarStore.getState();
    const prefs = state.preferences;
    
    return {
      socialEnabled: !!prefs.socialEnabled,
      socialShowAvatars: !!prefs.socialShowAvatars,
      enableAstra: true, // Feature flag from config usually, but prefs can override
      enableSocialFeatures: !!prefs.socialEnabled,
      autoUpdateProgress: !!prefs.autoUpdateProgress,
      compactMode: !!prefs.compactMode
    };
  }

  /**
   * Subscribes to preference changes.
   * 
   * @param selector Optional function to select a specific part of the preferences
   * @param callback Function called when preferences change
   * @returns Unsubscribe function
   */
  public onChanges(callback: (prefs: AppPreferences) => void): () => void {
    return calendarStore.subscribeToSelector(
      (state: any) => this.mapStateToPrefs(state),
      (curr: AppPreferences) => callback(curr)
    );
  }

  /**
   * Maps the raw store state to the AppPreferences interface.
   * @private
   */
  private mapStateToPrefs(state: any): AppPreferences {
    const prefs = state.preferences;
    return {
      socialEnabled: !!prefs.socialEnabled,
      socialShowAvatars: !!prefs.socialShowAvatars,
      enableAstra: true,
      enableSocialFeatures: !!prefs.socialEnabled,
      autoUpdateProgress: !!prefs.autoUpdateProgress,
      compactMode: !!prefs.compactMode
    };
  }

  /**
   * Shorthand to check if social features are enabled
   */
  public isSocialEnabled(): boolean {
    return this.getPreferences().socialEnabled;
  }
}
