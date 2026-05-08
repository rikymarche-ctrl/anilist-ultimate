/**
 * @file AstraRatingStore.ts
 * @description Centralized state management for the Astra Rating session.
 * Prevents state fragmentation and ensures data integrity during re-renders.
 */

import type { AstraWork } from '../../AstraInterfaces';
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
  manualOverride: boolean;
  isSeriesFinale: boolean;
  showFinale: boolean;
}

export class AstraRatingStore {
  private listeners: ((state: AstraRatingState) => void)[] = [];
  private state: AstraRatingState;

  constructor(initialData: Omit<AstraRatingState, 'isDirty' | 'isSaving'>, private eventBus: IEventBus) {
    this.state = {
      ...initialData,
      isDirty: false,
      isSaving: false
    };
  }

  public subscribe(listener: (state: AstraRatingState) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  public getState(): AstraRatingState {
    return { ...this.state };
  }

  public setManualOverride(active: boolean): void {
    if (this.state.manualOverride === active) return;
    this.state.manualOverride = active;
    this.setDirty(true);
    this.notify('state-change');
  }

  public toggleSeriesFinale(): void {
    this.state.isSeriesFinale = !this.state.isSeriesFinale;
    this.setDirty(true);
    this.notify('state-change');
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
    this.notify('journal-update', 'episodeNotes');
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

  public updateMediaListEntry(patch: Partial<any>): void {
    if (!this.state.media.mediaListEntry) this.state.media.mediaListEntry = {};
    Object.assign(this.state.media.mediaListEntry, patch);
    this.setDirty(true);
    this.notify('state-change');
  }

  private notify(type: string = 'state-change', field?: string): void {
    const state = this.getState();
    this.listeners.forEach(l => l(state));
    this.eventBus.emit('astra-store-updated', { state, type, field });
  }
}
