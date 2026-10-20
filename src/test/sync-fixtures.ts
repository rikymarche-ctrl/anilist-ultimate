/** Complete synthetic AniList records for queue boundary tests. */
export function syncListEntry(mediaId = 7, userId = 1, progress: number | null = 3) {
  return { id: 1000 + mediaId, mediaId, userId, progress, status: 'CURRENT', notes: 'Original',
    media: { id: mediaId, title: { userPreferred: 'Title' } } };
}
export function syncAcknowledgement(mediaId = 7, userId = 1) {
  return { SaveMediaListEntry: { id: 1000 + mediaId, mediaId, userId } };
}
