/**
 * @file ActivityUtils.ts
 * @description Type definitions and utility functions for activity feed processing
 *
 * Defines ActivityFilterType (enum-based), AniListActivity interface, and helper
 * functions for text-based activity type detection and time formatting.
 *
 * Uses MediaListStatus enum for type safety and consistency across the codebase.
 *
 * @see ActivityEnhancerModule.ts
 * @see ActivityRenderer.ts
 * @see docs/MODULES.md#3-activity-enhancer-module
 */

import { MediaListStatus } from '@/api/AnilistTypes';

/**
 * Activity filter type for UI filtering.
 * Uses MediaListStatus enum values for media statuses, plus special types for text posts and "show all".
 *
 * MAPPING:
 * - WATCHING → "Watched" filter (anime progress activities)
 * - READING → "Read" filter (manga progress activities)
 * - COMPLETED → "Completed" filter
 * - PLANNING → "Plans" filter
 * - DROPPED → "Dropped" filter
 * - PAUSED → "Paused" filter
 * - TEXT → Text posts (non-media activities)
 * - ALL → Show all activities
 */
export type ActivityFilterType =
  | MediaListStatus.WATCHING
  | MediaListStatus.READING
  | MediaListStatus.COMPLETED
  | MediaListStatus.PLANNING
  | MediaListStatus.DROPPED
  | MediaListStatus.PAUSED
  | 'TEXT'
  | 'ALL';

/**
 * @deprecated Use ActivityFilterType instead. Kept for backward compatibility during migration.
 */
export type ActivityType = ActivityFilterType;

export interface AniListActivity {
  id: number;
  type: string;
  text?: string;
  status?: string;
  progress?: string;
  createdAt: number;
  user: {
    id: number;
    name: string;
    avatar: { medium: string };
  };
  media?: {
    id: number;
    title: { romaji: string };
    coverImage: { medium: string };
    type: string;
  };
  replyCount: number;
  likeCount: number;
  // Added for score support
  mediaList?: {
    score: number;
  };
}

/**
 * Get time ago string
 */
export function getTimeAgo(timestamp: number): string {
  const now = Date.now() / 1000;
  const diff = now - timestamp;

  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} minutes ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)} days ago`;
  return `${Math.floor(diff / 604800)} weeks ago`;
}

/**
 * Get activity type from element text or status.
 * Returns enum-based ActivityFilterType for type safety.
 *
 * @param text - Activity text content to analyze
 * @returns ActivityFilterType enum value based on detected activity type
 */
export function getActivityType(text: string): ActivityFilterType {
  const lower = text.toLowerCase();

  // 1. List status changes (most specific)
  if (/completed/.test(lower)) return MediaListStatus.COMPLETED;
  if (/plans to|planning|plans to watch/.test(lower)) return MediaListStatus.PLANNING;
  if (/dropped/.test(lower)) return MediaListStatus.DROPPED;
  if (/paused/.test(lower)) return MediaListStatus.PAUSED;

  // 2. Anime/Manga watching/reading progress (robust regex to catch "Watched episode", "Watched ep", etc.)
  if (/watched|watching|watch| ep/.test(lower)) {
    return MediaListStatus.WATCHING;
  }
  if (/read|reading| ch/.test(lower)) {
    return MediaListStatus.READING;
  }

  // 3. Default to text activity
  return 'TEXT';
}
