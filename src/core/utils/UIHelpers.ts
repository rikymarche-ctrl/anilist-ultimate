import { MediaListStatus, MediaType } from '@/api/AnilistTypes';

/**
 * Returns a human-readable label for a media status,
 * accounting for the difference between Anime (Watching) and Manga (Reading).
 */
export function getStatusLabel(status: MediaListStatus, type: MediaType | string): string {
  const normalizedType = typeof type === 'string' ? type.toUpperCase() : type;

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
      return normalizedType === 'MANGA' ? 'Reading' : 'Watching';
    
    case MediaListStatus.REPEATING:
      return normalizedType === 'MANGA' ? 'Rereading' : 'Rewatching';
    
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
