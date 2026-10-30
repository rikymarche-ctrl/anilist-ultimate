import { injectable, inject, type Disposable } from 'tsyringe';
import { CalendarStore } from '@/modules/calendar/CalendarStore';
import { TOKENS } from '@core/di/tokens';

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
  openInNewTab: boolean;
}

/**
 * Service to handle all application preferences while abstracting the underlying storage.
 * Standardizes access to settings across all modules (Astra, Social, Calendar).
 */
@injectable()
export class PreferencesService implements Disposable {
  private disposed = false;
  private readonly subscriptions = new Set<() => void>();
  constructor(@inject(TOKENS.CalendarStore) private store: CalendarStore) {}
  /**
   * Gets the current global preferences
   */
  public getPreferences(): AppPreferences {
    return this.mapStateToPrefs(this.store.getState());
  }

  /**
   * Subscribes to preference changes.
   *
   * @param selector Optional function to select a specific part of the preferences
   * @param callback Function called when preferences change
   * @returns Unsubscribe function
   */
  public onChanges(callback: (prefs: AppPreferences) => void): () => void {
    if (this.disposed) return () => {};
    let active = true;
    const unsubscribe = this.store.subscribeToSelector(
      (state) => this.mapStateToPrefs(state),
      (curr: AppPreferences) => {
        if (!this.disposed && active) callback(curr);
      }
    );
    const remove = () => {
      if (!active) return;
      active = false;
      this.subscriptions.delete(remove);
      unsubscribe();
    };
    // A store may call the callback synchronously while subscribing.
    if (this.disposed) remove();
    else this.subscriptions.add(remove);
    return remove;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const remove of this.subscriptions) remove();
  }

  /**
   * Maps the raw store state to the AppPreferences interface.
   * @private
   */
  private mapStateToPrefs(state: ReturnType<CalendarStore['getState']>): AppPreferences {
    const prefs = state.preferences;
    return {
      socialEnabled: !!prefs.socialEnabled,
      socialShowAvatars: !!prefs.socialShowAvatars,
      enableAstra: true,
      enableSocialFeatures: !!prefs.socialEnabled,
      autoUpdateProgress: !!prefs.autoUpdateProgress,
      compactMode: !!prefs.compactMode,
      openInNewTab: !!prefs.openInNewTab,
    };
  }

  /**
   * Shorthand to check if social features are enabled
   */
  public isSocialEnabled(): boolean {
    return this.getPreferences().socialEnabled;
  }
}
