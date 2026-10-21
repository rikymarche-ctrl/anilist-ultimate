import { MediaListStatus } from '@/api/AnilistTypes';

/** Only a known total can complete a currently watched/read title. */
export function statusAfterProgress(status: MediaListStatus, progress: number, total?: number | null): MediaListStatus {
  return status === MediaListStatus.CURRENT && Number.isInteger(progress) && progress >= 0
    && typeof total === 'number' && Number.isInteger(total) && total > 0 && progress >= total
    ? MediaListStatus.COMPLETED : status;
}
