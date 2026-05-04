/**
 * @interface INativeUiSyncService
 * @description Contract for synchronizing native AniList UI with extension state
 */
export interface INativeUiSyncService {
  /**
   * Initializes the listeners for global events (e.g. PROGRESS_UPDATED)
   */
  init(): void;

  /**
   * Manually triggers a synchronization of progress for a specific media
   * @param mediaId AniList Media ID
   * @param progress New progress value
   * @param status Media status (optional)
   */
  syncProgress(mediaId: number, progress: number, status?: string): void;
}
