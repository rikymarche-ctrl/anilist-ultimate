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
 * Fetch user's anime list (for progress tracking)
 */
export const USER_ANIME_LIST_QUERY = `
  query UserAnimeList($userId: Int!, $type: MediaType = ANIME, $status: MediaListStatus = CURRENT) {
    MediaListCollection(userId: $userId, type: $type, status: $status) {
      lists {
        entries {
          id
          mediaId
          progress
          status
          score
          repeat
          private
          notes
          updatedAt
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
              timeUntilAiring
              episode
            }
          }
        }
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
