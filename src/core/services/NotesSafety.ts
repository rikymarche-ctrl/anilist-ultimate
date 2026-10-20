/** AniList's SaveMediaListEntry.notes limit. Never truncate either user's text. */
export const MAX_ANILIST_NOTES_LENGTH = 6000;

export function assertNotesLength(notes: string | null): void {
  if (notes !== null && (typeof notes !== 'string' || notes.length > MAX_ANILIST_NOTES_LENGTH)) {
    throw new Error('AniList Notes exceed 6000 characters; local data preserved. Shorten the report before syncing.');
  }
}
