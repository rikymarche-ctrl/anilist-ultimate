/** Full personal anime collection: a start-season filter would lose leftovers. */
export const SEASONAL_WRAPPED_QUERY = `
  query SeasonalWrapped($userId: Int!, $chunk: Int!, $perChunk: Int!) {
    MediaListCollection(userId: $userId, type: ANIME, chunk: $chunk, perChunk: $perChunk) {
      user { id }
      hasNextChunk
      lists { entries {
        id userId mediaId status progress score(format: POINT_10_DECIMAL) private hiddenFromStatusLists
        startedAt { year month day } completedAt { year month day }
        media {
          id type format status title { userPreferred } coverImage { extraLarge large color }
          season seasonYear startDate { year month day } endDate { year month day } genres
        }
      } }
    }
  }
`;
