import { describe, expect, it, vi } from 'vitest';
vi.mock('../AstraService', () => ({ AstraService: class {} }));
import { AstraJournalService } from './AstraJournalService';
import { EVENT_TYPES } from '@core/events/EventTypes';
import type { AstraService } from '../AstraService';
import type { IEventBus, EventHandler, EventPayload } from '@core/interfaces/IEventBus';
import type { ProgressUpdatedEvent } from '@core/events/EventTypes';
import { MediaListStatus } from '@/api/AnilistTypes';
import type { AstraWork } from '../AstraInterfaces';

function setup() {
  let saved: AstraWork = { id: 'anime-1', mediaId: 1, title: 'Test', type: 'anime',
    status: MediaListStatus.CURRENT, customLists: [], tags: [], notes: '', updatedAt: 0, seasons: [{ scores: {}, episodeNotes: {
    1: { text: 'Existing note', score: 8, timestamp: 123 }, 2: { text: 'Second note', score: 7 },
  } }] };
  let progressHandler: EventHandler<ProgressUpdatedEvent> | undefined;
  let noteHandler: EventHandler<EventPayload<typeof EVENT_TYPES.ASTRA_SAVE_NOTE>> | undefined;
  const unsubscribers: Array<ReturnType<typeof vi.fn>> = [];
  const bus: Pick<IEventBus, 'on'> = {
    on(event, handler) {
      if (event === EVENT_TYPES.PROGRESS_UPDATED) {
        progressHandler = handler as EventHandler<ProgressUpdatedEvent>;
      }
      if (event === EVENT_TYPES.ASTRA_SAVE_NOTE) noteHandler = handler as typeof noteHandler;
      const unsubscribe = vi.fn(); unsubscribers.push(unsubscribe); return { unsubscribe };
    },
  };
  const astra = { getFullWork: vi.fn(async () => structuredClone(saved)), saveWork: vi.fn(async (work: AstraWork) => {
    await Promise.resolve(); saved = structuredClone(work); return work;
  }) } satisfies Pick<AstraService, 'getFullWork' | 'saveWork'>;
  const service = new AstraJournalService(astra as unknown as AstraService, bus as IEventBus);
  const progress = (from: number, to: number) => progressHandler!({ mediaId: 1, previousProgress: from, progress: to, userId: 1 });
  return { service, astra, progress, unsubscribers, note: () => noteHandler!({ mediaId: 1, episode: 2, notes: 'New note' }), getSaved: () => saved };
}

describe('AstraJournalService progress and note integrity', () => {
  it('timestamps only new units while keeping existing text, scores and timestamps', async () => {
    const { progress, getSaved } = setup();
    await progress(0, 3);
    const notes = getSaved().seasons[0].episodeNotes!;
    expect(notes[1]).toEqual({ text: 'Existing note', score: 8, timestamp: 123 });
    expect(notes[2]).toMatchObject({ text: 'Second note', score: 7, timestamp: expect.any(Number) });
    expect(notes[3]).toMatchObject({ text: '', timestamp: expect.any(Number) });
  });

  it('does not save a duplicate progress event twice', async () => {
    const { progress, astra } = setup();
    await Promise.all([progress(1, 2), progress(1, 2)]);
    expect(astra.saveWork).toHaveBeenCalledTimes(1);
  });

  it('serializes overlapping progress and note updates without losing either', async () => {
    const { service, progress, getSaved } = setup();
    await Promise.all([progress(1, 3), service.saveEpisodeNote(1, 0, 2, { text: 'Edited' })]);
    const notes = getSaved().seasons[0].episodeNotes!;
    expect(notes[2]).toMatchObject({ text: 'Edited', score: 7, timestamp: expect.any(Number) });
    expect(notes[3].timestamp).toEqual(expect.any(Number));
  });

  it.each([[1, 1], [0, Infinity], [NaN, 3], [-1, 3], [0, 2.5]])('ignores invalid or unchanged progress %s -> %s', async (from, to) => {
    const { progress, astra } = setup();
    await progress(from, to);
    expect(astra.getFullWork).not.toHaveBeenCalled();
    expect(astra.saveWork).not.toHaveBeenCalled();
  });

  it('updates reduced progress without erasing previous watch history', async () => {
    const { progress, getSaved } = setup();
    await progress(3, 1);
    expect(getSaved().progress).toBe(1);
    expect(getSaved().seasons[0].episodeNotes![1]).toEqual({ text: 'Existing note', score: 8, timestamp: 123 });
    expect(getSaved().seasons[0].episodeNotes![2]).toEqual({ text: 'Second note', score: 7 });
  });

  it('lets later events proceed after a failed write', async () => {
    const { progress, astra, getSaved } = setup();
    astra.saveWork.mockRejectedValueOnce(new Error('Disk failed'));
    await expect(progress(1, 2)).rejects.toThrow('Disk failed');
    await progress(1, 3);
    expect(getSaved().seasons[0].episodeNotes![3].timestamp).toEqual(expect.any(Number));
  });
  it('removes exact subscriptions once and makes copied event handlers inert', async () => {
    const f = setup(); (f.service as unknown as { dispose(): void }).dispose(); (f.service as unknown as { dispose(): void }).dispose();
    for (const unsubscribe of f.unsubscribers) expect(unsubscribe).toHaveBeenCalledOnce();
    await f.progress(1, 3); await f.note(); expect(f.astra.getFullWork).not.toHaveBeenCalled(); expect(f.astra.saveWork).not.toHaveBeenCalled();
    await expect(f.service.saveEpisodeNote(1, 0, 2, { text: 'After disposal' })).rejects.toThrow('disposed');
  });
  it('retires queued work behind a pending read and does not write its late result', async () => {
    const f = setup(); let resolve!: (work: AstraWork) => void;
    f.astra.getFullWork.mockReturnValueOnce(new Promise<AstraWork>(yes => { resolve = yes; }));
    const first = f.service.saveEpisodeNote(1, 0, 2, { text: 'First' });
    const second = f.service.saveEpisodeNote(1, 0, 3, { text: 'Queued' });
    for (let index = 0; index < 8; index++) await Promise.resolve();
    (f.service as unknown as { dispose(): void }).dispose(); resolve(structuredClone(f.getSaved()));
    await expect(first).rejects.toThrow('disposed'); await expect(second).rejects.toThrow('disposed');
    expect(f.astra.getFullWork).toHaveBeenCalledOnce(); expect(f.astra.saveWork).not.toHaveBeenCalled();
    expect((f.service as unknown as { workUpdates: Map<number, unknown> }).workUpdates.size).toBe(0);
  });
  it('contains a late note-event read without starting a second read or write', async () => {
    const f = setup(); let resolve!: (work: AstraWork) => void;
    f.astra.getFullWork.mockReturnValueOnce(new Promise<AstraWork>(yes => { resolve = yes; }));
    const pending = f.note(); (f.service as unknown as { dispose(): void }).dispose(); resolve(structuredClone(f.getSaved()));
    await pending; expect(f.astra.getFullWork).toHaveBeenCalledOnce(); expect(f.astra.saveWork).not.toHaveBeenCalled();
  });
  it('allows an accepted writer to finish without running the next queued command', async () => {
    const f = setup(); let complete!: () => void;
    f.astra.saveWork.mockImplementationOnce(async work => { await new Promise<void>(yes => { complete = yes; }); return work; });
    const first = f.service.saveEpisodeNote(1, 0, 2, { text: 'Accepted' });
    const queued = f.service.saveEpisodeNote(1, 0, 3, { text: 'Queued' });
    for (let index = 0; index < 8; index++) await Promise.resolve();
    expect(f.astra.saveWork).toHaveBeenCalledOnce(); (f.service as unknown as { dispose(): void }).dispose(); complete();
    await expect(first).rejects.toThrow('disposed'); await expect(queued).rejects.toThrow('disposed');
    expect(f.astra.saveWork).toHaveBeenCalledOnce(); expect(f.astra.getFullWork).toHaveBeenCalledOnce();
  });
});
