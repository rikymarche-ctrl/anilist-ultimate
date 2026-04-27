/**
 * @file ActivityUtils.ts
 * @description Type definitions and utility functions for activity feed processing
 *
 * Defines ActivityType union, AniListActivity interface, and helper
 * functions for text-based activity type detection and time formatting.
 *
 * @see ActivityEnhancerModule.ts
 * @see ActivityRenderer.ts
 * @see docs/MODULES.md#3-activity-enhancer-module
 */

export type ActivityType = 'watched' | 'read' | 'completed' | 'plans' | 'dropped' | 'paused' | 'text' | 'all';

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
 * Get activity type from element text or status
 */
export function getActivityType(text: string): ActivityType {
  const lower = text.toLowerCase();
  if (lower.includes('watched') || lower.includes('watch') || lower.includes(' ep')) return 'watched';
  if (lower.includes('read') || lower.includes('reading') || lower.includes(' ch')) return 'read';
  if (lower.includes('completed')) return 'completed';
  if (lower.includes('plans') || lower.includes('planning')) return 'plans';
  if (lower.includes('dropped')) return 'dropped';
  if (lower.includes('paused')) return 'paused';
  return 'text';
}
