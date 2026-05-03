/**
 * @file AstraRatingState.ts
 * @description Encapsulates AstraWork state with automatic change tracking (dirty checking).
 */

import { AstraWork } from '../AstraService';

export class AstraRatingState {
  private _isDirty: boolean = false;
  private _data: AstraWork;
  private onDirtyChange?: (isDirty: boolean) => void;

  constructor(initialData: AstraWork, onDirtyChange?: (isDirty: boolean) => void) {
    // Deep clone to avoid mutating original reference before explicit save
    this._data = JSON.parse(JSON.stringify(initialData));
    this.onDirtyChange = onDirtyChange;
  }

  public get data(): AstraWork {
    return this._data;
  }

  public get isDirty(): boolean {
    return this._isDirty;
  }

  public set isDirty(value: boolean) {
    if (this._isDirty !== value) {
      this._isDirty = value;
      if (this.onDirtyChange) this.onDirtyChange(value);
    }
  }

  /**
   * Toggles the manual override mode for a specific season.
   */
  public setManualOverride(seasonIdx: number, enabled: boolean): void {
    const season = this._data.seasons[seasonIdx];
    if (!season) return;

    if (season.manualOverride !== enabled) {
      season.manualOverride = enabled;
      this.isDirty = true;
    }
  }

  /**
   * Updates a score for a specific section or sub-section
   */
  public setScore(seasonIdx: number, id: string, value: number): void {
    const season = this._data.seasons[seasonIdx];
    if (!season) return;

    if (season.scores[id] !== value) {
      season.scores[id] = value;
      this.isDirty = true;
    }
  }

  /**
   * Updates a general field in the work object
   */
  public updateField<K extends keyof AstraWork>(field: K, value: AstraWork[K]): void {
    if (this._data[field] !== value) {
      this._data[field] = value;
      this.isDirty = true;
    }
  }

  /**
   * Updates a field in the current season
   */
  public updateSeasonField(seasonIdx: number, field: string, value: any): void {
    const season = this._data.seasons[seasonIdx] as any;
    if (!season) return;

    if (season[field] !== value) {
      season[field] = value;
      this.isDirty = true;
    }
  }

  /**
   * Resets the dirty flag (usually after a successful save)
   */
  public resetDirty(): void {
    this.isDirty = false;
  }
}
