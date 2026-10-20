/**
 * @file calendar.ts
 * @description GraphQL query and mutation strings for the Calendar module
 *
 * Contains:
 *   - AIRING_SCHEDULE_QUERY: paginated airing schedule for user's watching list
 *   - USER_ANIME_LIST_QUERY: user's current anime list with progress
 *   - UPDATE_PROGRESS_MUTATION: mark episode as watched (SaveMediaListEntry)
 *   - ANIME_DETAILS_QUERY: single anime details with studio, genre, airing info
 *
 * @see CalendarDataService.ts for query execution
 * @see docs/MODULES.md#1-calendar-module
 */

/**
 * Fetch airing schedule for a user's watching list
 */
export const AIRING_SCHEDULE_QUERY = `
  query AiringSchedule($userId: Int!, $page: Int = 1, $perPage: Int = 50) {
    Page(page: $page, perPage: $perPage) {
      pageInfo {
        total
        currentPage
        lastPage
        hasNextPage
        perPage
      }
      airingSchedules(
        notYetAired: true
        sort: TIME
        mediaId_in: []
      ) {
        id
        airingAt
        episode
        mediaId
        media {
          id
          title {
            romaji
            english
            native
          }
          coverImage {
            large
            medium
            color
          }
          siteUrl
          format
          status
          episodes
          nextAiringEpisode {
            airingAt
            episode
          }
        }
      }
    }
  }
`;

/**
 * Fetch calendar candidates, optionally widening the list for pending status changes.
 */
export const USER_ANIME_LIST_QUERY = `
  query UserAnimeList($userId: Int!, $type: MediaType = ANIME, $chunk: Int!, $perChunk: Int!, $statuses: [MediaListStatus]) {
    MediaListCollection(userId: $userId, type: $type, chunk: $chunk, perChunk: $perChunk, status_in: $statuses) {
      user { id }
      hasNextChunk
      lists {
        entries {
          id
          userId
          mediaId
          progress
          status
          media {
            id
            type
            title {
              romaji
              english
              native
            }
            coverImage {
              large
              medium
            }
            siteUrl
            status
            episodes
            nextAiringEpisode {
              id
              mediaId
              airingAt
              timeUntilAiring
              episode
            }
          }
        }
      }
    }
  }
`;

/** mediaListEntry is scoped to the authenticated viewer and accepts no userId argument. */
export const SEARCH_CALENDAR_ANIME_QUERY = `
  query SearchCalendarAnime($search: String!) {
    Page(page: 1, perPage: 10) {
      media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
        id
        type
        title { romaji english native }
        coverImage { large medium }
        siteUrl
        episodes
        format
        seasonYear
        nextAiringEpisode { airingAt }
        mediaListEntry { id userId mediaId progress status }
      }
    }
  }
`;

/**
 * Update anime progress (mark episode as watched)
 */
export const UPDATE_PROGRESS_MUTATION = `
  mutation UpdateProgress($mediaId: Int!, $progress: Int!) {
    SaveMediaListEntry(mediaId: $mediaId, progress: $progress) {
      id
      mediaId
      progress
      status
      updatedAt
    }
  }
`;

/**
 * Update anime/manga notes
 */
export const UPDATE_NOTES_MUTATION = `
  mutation UpdateNotes($mediaId: Int!, $notes: String!) {
    SaveMediaListEntry(mediaId: $mediaId, notes: $notes) {
      id
      mediaId
      notes
      updatedAt
    }
  }
`;

/**
 * Fetch specific anime details
 */
export const ANIME_DETAILS_QUERY = `
  query AnimeDetails($id: Int!) {
    Media(id: $id, type: ANIME) {
      id
      title {
        romaji
        english
        native
      }
      coverImage {
        large
        medium
        color
      }
      bannerImage
      description
      format
      status
      episodes
      duration
      season
      seasonYear
      averageScore
      genres
      studios {
        nodes {
          name
        }
      }
      siteUrl
      nextAiringEpisode {
        airingAt
        timeUntilAiring
        episode
      }
    }
  }
`;
