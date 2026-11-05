const STATS_LIMIT = 50;

/**
 * Both identities and AniList's own per-user aggregates in one request: themes, studios and people
 * would otherwise need several requests per title. Only the requested media type is asked for.
 */
export function profileCompareUsersQuery(media: 'ANIME' | 'MANGA'): string {
  const field = media === 'ANIME' ? 'anime' : 'manga';
  const animeOnly =
    media === 'ANIME'
      ? `studios(limit: ${STATS_LIMIT}, sort: COUNT_DESC) { count studio { id name } }
         voiceActors(limit: ${STATS_LIMIT}, sort: COUNT_DESC) { count voiceActor { id name { full } image { medium } } }`
      : '';
  return `
    fragment CompareStats on UserStatistics {
      count minutesWatched episodesWatched chaptersRead volumesRead
      tags(limit: ${STATS_LIMIT}, sort: COUNT_DESC) { count tag { name isAdult isMediaSpoiler } }
      staff(limit: ${STATS_LIMIT}, sort: COUNT_DESC) { count staff { id name { full } image { medium } } }
      ${animeOnly}
    }
    fragment CompareUser on User { id name avatar { large } statistics { ${field} { ...CompareStats } } }
    query ProfileCompareUsers($name: String!) {
      Viewer { ...CompareUser }
      User(name: $name) { ...CompareUser }
    }
  `;
}

/** One user's list for one media type, one chunk at a time. */
export const PROFILE_COMPARE_LIST_QUERY = `
  query ProfileCompareList($userId: Int!, $type: MediaType!, $chunk: Int!, $perChunk: Int!) {
    MediaListCollection(userId: $userId, type: $type, chunk: $chunk, perChunk: $perChunk) {
      user { id }
      hasNextChunk
      lists { entries {
        mediaId status score(format: POINT_10_DECIMAL) private repeat
        startedAt { year month day } completedAt { year month day }
        media {
          id isAdult status format popularity countryOfOrigin startDate { year }
          title { userPreferred } coverImage { extraLarge large } genres
        }
      } }
    }
  }
`;
