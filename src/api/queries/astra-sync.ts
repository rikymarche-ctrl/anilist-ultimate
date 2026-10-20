/** Full collection import; identities are selected so the caller can bind every row. */
export const ASTRA_SYNC_COLLECTION = `
  query AstraSyncCollection($userId: Int!, $type: MediaType!, $chunk: Int!, $perChunk: Int!) {
    MediaListCollection(userId: $userId, type: $type, chunk: $chunk, perChunk: $perChunk) {
      user { id }
      hasNextChunk
      lists {
        entries {
          id userId mediaId status score(format: POINT_10) progress notes
          customLists private hiddenFromStatusLists
          startedAt { year month day } completedAt { year month day }
          media {
            id type format countryOfOrigin
            title { romaji english native }
            coverImage { extraLarge large medium }
            genres episodes chapters duration
          }
        }
      }
    }
  }
`;
