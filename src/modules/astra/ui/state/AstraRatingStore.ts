/**
 * @file AstraRatingStore.ts
 * @description Centralized state management for the Astra Rating session.
 * Prevents state fragmentation and ensures data integrity during re-renders.
 */

import { AstraWork } from '../../AstraService';
import type { IEventBus } from '@core/interfaces/IEventBus';

export interface AstraRatingState {
  work: AstraWork;
  media: any;
  allCustomLists: string[];
  currentSeasonIdx: number;
  activeTab: 'rating' | 'journal';
  isDirty: boolean;
  isSaving: boolean;
  airedCount: number | null;
  totalCount: number | null;
}

export class AstraRatingStore {
  private state: AstraRatingState;

  constructor(initialData: Omit<AstraRatingState, 'isDirty' | 'isSaving'>, private eventBus: IEventBus) {
    this.state = {
      ...initialData,
      isDirty: false,
      isSaving: false
    };
  }

  public getState(): AstraRatingState {
    return { ...this.state };
  }

  public updateWork(patch: Partial<AstraWork>): void {
    this.state.work = { ...this.state.work, ...patch };
    this.setDirty(true);
    this.notify();
  }

  public updateSeason(patch: Partial<any>): void {
    const season = this.state.work.seasons[this.state.currentSeasonIdx];
    Object.assign(season, patch);
    this.setDirty(true);
    const field = Object.keys(patch)[0];
    this.notify('season-update', field);
  }

  public updateScore(id: string, value: number): void {
    const season = this.state.work.seasons[this.state.currentSeasonIdx];
    season.scores[id] = value;
    this.setDirty(true);
    this.notify('score-update');
  }

  public updateJournal(episode: number, text: string): void {
    const season = this.state.work.seasons[this.state.currentSeasonIdx];
    if (!season.episodeNotes) season.episodeNotes = {};
    season.episodeNotes[episode] = { text };
    this.setDirty(true);
    this.notify();
  }

  public setTab(tab: 'rating' | 'journal'): void {
    if (this.state.activeTab === tab) return;
    this.state.activeTab = tab;
    this.notify('tab-change');
  }

  public setDirty(dirty: boolean): void {
    if (this.state.isDirty === dirty) return;
    this.state.isDirty = dirty;
    this.notify('dirty-change');
  }

  public setSaving(saving: boolean): void {
    this.state.isSaving = saving;
    this.notify('saving-change');
  }

  private notify(type: string = 'state-change', field?: string): void {
    this.eventBus.emit('astra-store-updated', { state: this.getState(), type, field });
  }
}
