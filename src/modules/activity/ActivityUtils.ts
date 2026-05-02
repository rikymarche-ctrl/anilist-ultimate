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
 * LIMITATIONS: This function uses regex pattern matching on activity text,
 * which is inherently fragile. AniList does not expose structured metadata
 * (e.g., data-activity-type) on native activity entries, so we cannot use
 * a more reliable method without re-implementing the entire activity rendering
 * (which would cause significant performance overhead).
 *
 * ACCURACY: Estimated 85-90% with improved patterns below.
 *
 * @param text - Activity text content to analyze
 * @returns ActivityFilterType enum value based on detected activity type
 */
export function getActivityType(text: string): ActivityFilterType {
  const lower = text.toLowerCase();

  // CRITICAL: Check progress activities FIRST (more specific and common)
  // This prevents UI elements like "Add to Planning" from false-matching

  // 1. Progress activities - anime
  if (/(watched|watching|rewatched)\s+(episode|ep)/i.test(lower)) return MediaListStatus.WATCHING;
  if (/episode\s*\d+/i.test(lower)) return MediaListStatus.WATCHING;
  if (/\bep\.?\s*\d+/i.test(lower)) return MediaListStatus.WATCHING;

  // 2. Progress activities - manga
  if (/(read|reading|reread)\s+(chapter|ch)/i.test(lower)) return MediaListStatus.READING;
  if (/chapter\s*\d+/i.test(lower)) return MediaListStatus.READING;
  if (/\bch\.?\s*\d+/i.test(lower)) return MediaListStatus.READING;

  // 3. Status changes (check AFTER progress to avoid false matches)
  if (/\bcompleted\b/i.test(lower)) return MediaListStatus.COMPLETED;
  if (/\bplans to (watch|read)\b/i.test(lower)) return MediaListStatus.PLANNING;
  if (/\b(added|moved) to planning\b/i.test(lower)) return MediaListStatus.PLANNING;
  if (/\bdropped\b/i.test(lower)) return MediaListStatus.DROPPED;
  if (/\bpaused\b/i.test(lower)) return MediaListStatus.PAUSED;

  // 4. Text activity fallback
  return 'TEXT';
}
