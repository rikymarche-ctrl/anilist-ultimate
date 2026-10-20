import type { AniListActivity } from '@modules/activity/ActivityUtils';

export const feedActivity = (id = 1, userId = 7, mediaId = 10): AniListActivity => ({
  id, type: 'ANIME_LIST', userId, status: 'watched episode', progress: '3', createdAt: 1700000000,
  replyCount: 2, likeCount: 4,
  user: { id: userId, name: `User${userId}`, avatar: { medium: 'https://example.com/avatar.png' } },
  media: { id: mediaId, type: 'ANIME', title: { romaji: 'Title' }, coverImage: { medium: 'https://example.com/cover.png' } },
});
