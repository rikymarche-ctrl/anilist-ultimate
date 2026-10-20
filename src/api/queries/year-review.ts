/**
 * Astra Wrapped reads the user's own AniList activity feed for a period, then looks up
 * cast, staff and community data for the titles it touched. All values are variables.
 * `createdAt_greater` / `createdAt_lesser` are exclusive bounds in Unix seconds.
 */

const USER = 'id name avatar { medium }';

export const YEAR_ACTIVITY_QUERY = `
  query YearActivity($userId: Int!, $page: Int!, $after: Int!, $before: Int!) {
    Page(page: $page, perPage: 50) {
      pageInfo { hasNextPage }
      activities(userId: $userId, type_in: [ANIME_LIST, MANGA_LIST], createdAt_greater: $after, createdAt_lesser: $before, sort: ID) {
        ... on ListActivity {
          id userId status progress createdAt likeCount replyCount
          likes { ${USER} }
          media { id }
        }
      }
    }
  }
`;

export const YEAR_SOCIAL_QUERY = `
  query YearSocial($userId: Int!, $page: Int!, $after: Int!, $before: Int!) {
    posts: Page(page: $page, perPage: 50) {
      pageInfo { hasNextPage }
      activities(userId: $userId, type: TEXT, createdAt_greater: $after, createdAt_lesser: $before, sort: ID) {
        ... on TextActivity { id userId createdAt likeCount replyCount likes { ${USER} } }
      }
    }
    messages: Page(page: $page, perPage: 50) {
      pageInfo { hasNextPage }
      activities(userId: $userId, type: MESSAGE, createdAt_greater: $after, createdAt_lesser: $before, sort: ID) {
        ... on MessageActivity { id recipientId createdAt messenger { ${USER} } }
      }
    }
    User(id: $userId) {
      id
      statistics { anime { genres(sort: COUNT_DESC) { genre count } } }
    }
  }
`;

export const YEAR_MEDIA_PAGE_SIZE = 25;

/** `mediaListEntry` is the viewer's own entry, so the caller must be the signed-in owner. */
export const YEAR_MEDIA_QUERY = `
  query YearMedia($ids: [Int]) {
    Page(perPage: ${YEAR_MEDIA_PAGE_SIZE}) {
      media(id_in: $ids) {
        id type format episodes chapters duration countryOfOrigin source(version: 3) seasonYear startDate { year }
        title { userPreferred } coverImage { extraLarge large color } genres meanScore popularity
        tags { name rank isMediaSpoiler }
        studios(isMain: true) { nodes { id name } }
        staff(sort: [RELEVANCE, ID], perPage: 10) { edges { role node { id name { userPreferred } image { large } } } }
        characters(sort: [ROLE, RELEVANCE, ID], perPage: 12) {
          edges {
            role
            node { id name { userPreferred } image { large } favourites }
            voiceActors(language: JAPANESE, sort: [RELEVANCE, ID]) { id name { userPreferred } image { large } }
          }
        }
        stats { scoreDistribution { score amount } }
        mediaListEntry { score(format: POINT_10_DECIMAL) status private hiddenFromStatusLists }
      }
    }
  }
`;

export const YEAR_PRIOR_BATCH = 10;

/** Latest list activity before the period for up to YEAR_PRIOR_BATCH titles (aliases m0…m9). */
export function yearPriorQuery(count: number): string {
  if (!Number.isInteger(count) || count < 1 || count > YEAR_PRIOR_BATCH)
    throw new Error('Invalid prior-progress batch');
  const variables = Array.from({ length: count }, (_, index) => `$m${index}: Int!`).join(', ');
  const pages = Array.from(
    { length: count },
    (_, index) => `
    m${index}: Page(perPage: 5) {
      activities(userId: $userId, mediaId: $m${index}, type_in: [ANIME_LIST, MANGA_LIST], createdAt_lesser: $before, sort: ID_DESC) {
        ... on ListActivity { userId status progress media { id } }
      }
    }`
  ).join('');
  return `query YearPrior($userId: Int!, $before: Int!, ${variables}) {${pages}\n}`;
}
