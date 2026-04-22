import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import type { IApiClient } from '@core/interfaces/IApiClient';
import { log } from '@core/logger';

export interface ActivityData {
  status?: string;
  media?: {
    id: number;
    type: 'ANIME' | 'MANGA';
    title: {
      romaji: string;
      english: string | null;
    };
  };
  text?: string;
  message?: string;
}

export interface ActivityDetails {
  text: string;
  mediaId?: number;
  mediaTitle?: string;
  status?: string;
}

@injectable()
export class NotificationFetchService {
  constructor(
    @inject(TOKENS.ApiClient) private apiClient: IApiClient
  ) {}

  /**
   * Extract activity ID from notification element
   */
  public extractActivityId(notification: HTMLElement): number | null {
    // Check if we cached it first
    const dataId = notification.getAttribute('data-activity-id');
    if (dataId) return parseInt(dataId, 10);

    // Collect all links that might point to an activity
    const links = Array.from(notification.querySelectorAll<HTMLAnchorElement>('a[href*="/activity/"]'));
    
    for (const link of links) {
      const href = link.getAttribute('href') || '';
      const match = href.match(/\/activity\/(\d+)/);
      if (match) {
        const id = parseInt(match[1], 10);
        return id;
      }
    }

    return null;
  }

  /**
   * Fetch activity details in batch using GraphQL alias
   */
  public async fetchActivityDetails(activityIds: number[]): Promise<Map<number, ActivityDetails>> {
    if (activityIds.length === 0) return new Map();

    const fields = `
      ... on ListActivity {
        status
        media {
          id
          type
          title {
            romaji
            english
          }
        }
      }
      ... on TextActivity {
        text(asHtml: false)
      }
      ... on MessageActivity {
        message(asHtml: false)
      }
    `;

    const aliases = activityIds.map(id => `a${id}: Activity(id: ${id}) { ${fields} }`);
    const query = `query { ${aliases.join('\n')} }`;

    try {
      const response = await this.apiClient.query<Record<string, ActivityData>>(query, {}, true);
      const results = new Map<number, ActivityDetails>();

      Object.entries(response).forEach(([alias, activity]) => {
        if (!activity) return;
        
        const id = parseInt(alias.substring(1), 10);
        let text = '';
        let mediaId: number | undefined;
        let mediaTitle: string | undefined;
        let status: string | undefined;

        if (activity.text) text = activity.text;
        else if (activity.message) text = activity.message;
        else if (activity.media) {
          mediaId = activity.media.id;
          mediaTitle = activity.media.title.english || activity.media.title.romaji;
          status = activity.status;
          text = `${status} ${mediaTitle}`;
        }

        results.set(id, { text, mediaId, mediaTitle, status });
      });

      return results;
    } catch (error) {
      log.error('[NotificationFetch] Failed to fetch activity details', error);
      return new Map();
    }
  }
}
