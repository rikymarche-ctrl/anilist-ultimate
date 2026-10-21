export const SYNC_PROGRESS_QUERY = `query($mediaId: Int!, $userId: Int!) {
  MediaList(mediaId: $mediaId, userId: $userId) {
    id mediaId userId progress status media { id type episodes chapters title { userPreferred } }
  }
}`;
export const SYNC_NOTES_QUERY = `query($mediaId: Int!, $userId: Int!) {
  MediaList(mediaId: $mediaId, userId: $userId) { id mediaId userId notes }
}`;

export const SYNC_DELETE_ENTRY_QUERY = `query($mediaId: Int!) {
  Media(id:$mediaId) { id mediaListEntry { id mediaId userId } }
}`;
