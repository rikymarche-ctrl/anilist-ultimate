/**
 * @file IAstraRatingService.ts
 * @description Contract for the business logic of the Astra Rating system.
 * Handles data fetching, AniList synchronization, and local persistence coordination.
 */

import type { AstraWork } from '../AstraInterfaces';
import { MediaWithViewerResponse } from '@/api/AnilistTypes';

/**
 * Data structure returned when fetching initial data for a rating form.
 */
export interface IRatingInitialData {
  media: MediaWithViewerResponse['Media'];
  allCustomLists: string[];
}

/**
 * Interface for the Rating Service.
 * Decouples the UI controllers from API and persistence implementations.
 */
export interface IAstraRatingService {
  /**
   * Fetches necessary data from AniList for a specific work.
   * @param mediaId The AniList media ID.
   */
  fetchInitialData(mediaId: number): Promise<IRatingInitialData | null>;

  /**
   * Saves a work locally and syncs it with AniList.
   * @param work The AstraWork object to persist.
   * @param extra Optional extra fields like progress, scores, etc.
   */
  saveAndSync(work: AstraWork, extra: {
    overallScore: number;
    progress?: number;
    repeat?: number;
    private?: boolean;
    hidden?: boolean;
    notes?: string;
    customLists?: string[];
    startedAt?: any;
    completedAt?: any;
  }): Promise<void>;
}
