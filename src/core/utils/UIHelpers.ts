import { MediaListStatus, MediaType } from '@/api/AnilistTypes';

/**
 * Returns a human-readable label for a media status,
 * accounting for written media (Manga and Light Novels) using Reading labels.
 */
export function getStatusLabel(status: MediaListStatus, type: MediaType | string): string {
  const normalizedType = typeof type === 'string' ? type.toUpperCase() : type;
  const isWrittenMedia = normalizedType === 'MANGA' || normalizedType === 'NOVEL';

  switch (status) {
    case MediaListStatus.WATCHING:
      return 'Watching';
    case MediaListStatus.READING:
      return 'Reading';
    case MediaListStatus.REWATCHING:
      return 'Rewatching';
    case MediaListStatus.REREADING:
      return 'Rereading';

    case MediaListStatus.CURRENT:
      return isWrittenMedia ? 'Reading' : 'Watching';
    
    case MediaListStatus.REPEATING:
      return isWrittenMedia ? 'Rereading' : 'Rewatching';
    
    case MediaListStatus.PLANNING:
      return 'Planning';
    
    case MediaListStatus.COMPLETED:
      return 'Completed';
    
    case MediaListStatus.PAUSED:
      return 'Paused';
    
    case MediaListStatus.DROPPED:
      return 'Dropped';
    
    default:
      // Fallback for custom or unknown statuses
      return (status as string).charAt(0).toUpperCase() + (status as string).slice(1).toLowerCase();
  }
}
