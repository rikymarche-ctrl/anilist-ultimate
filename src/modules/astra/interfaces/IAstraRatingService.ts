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
   * Fetches data for a media entry (notes, score, etc).
   */
  getMediaRatingData(mediaId: number): Promise<IRatingInitialData | null>;

  /**
   * Alias for getMediaRatingData for backward compatibility.
   */
  fetchInitialData(mediaId: number): Promise<IRatingInitialData | null>;

  /**
   * Increments or sets progress for a media entry.
   */
  updateProgress(mediaId: number, progress?: number): Promise<{ mediaId: number; progress: number; title: string }>;

  /**
   * Saves work locally and pushes to AniList.
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
    skipSync?: boolean;
  }): Promise<void>;
}
