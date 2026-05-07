import { injectable } from 'tsyringe';
import { calendarStore } from '@/modules/calendar/CalendarStore';

export interface AstraPreferences {
  socialEnabled: boolean;
  socialShowAvatars: boolean;
}

/**
 * Service to handle Astra-specific preferences while abstracting the underlying storage.
 * Currently, it bridges with calendarStore to maintain cross-module synchronization.
 */
@injectable()
export class AstraPreferencesService {
  /**
   * Gets the current Astra-relevant preferences
   */
  public getPreferences(): AstraPreferences {
    const { socialEnabled, socialShowAvatars } = calendarStore.getState().preferences;
    return { socialEnabled, socialShowAvatars };
  }

  /**
   * Subscribes to preference changes
   */
  public onChanges(callback: (prefs: AstraPreferences) => void): () => void {
    return calendarStore.subscribeToSelector(
      (state: any) => ({
        socialEnabled: state.preferences.socialEnabled,
        socialShowAvatars: state.preferences.socialShowAvatars,
      }),
      (curr: any) => callback(curr)
    );
  }
}
