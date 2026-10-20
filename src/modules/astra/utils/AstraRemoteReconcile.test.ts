import { describe, it, expect, vi, afterEach } from 'vitest';
import { reconcileWithRemote } from './AstraRemoteReconcile';
import { AstraParserService } from '../services/AstraParserService';
import { DEFAULT_SECTIONS, ASTRA_MARKERS } from './AstraConstants';
import { MediaListStatus } from '@/api/AnilistTypes';
import { logger } from '@core/logger';
import type { AstraSeason, AstraWork } from '../AstraInterfaces';

const PLAIN_NOTES = 'Story 8 | Characters 7.8';

function makeWork(seasonOver: Partial<AstraSeason> = {}, notes = ''): AstraWork {
  return {
    id: 'w',
    mediaId: 1,
    title: 'Test',
    type: 'anime',
    status: MediaListStatus.COMPLETED,
    customLists: [],
    tags: [],
    notes,
    updatedAt: 0,
    seasons: [
      { id: 's', name: 'Season 1', scores: {}, notes: '', episodeNotes: {}, ...seasonOver },
    ],
  };
}

const latest = (work: AstraWork): AstraSeason => work.seasons[work.seasons.length - 1];

describe('reconcileWithRemote', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('adopts plain AniList notes over empty local notes without touching scores', () => {
    const work = makeWork();
    const result = reconcileWithRemote(
      work,
      { notes: PLAIN_NOTES, score: 83 },
      { sections: DEFAULT_SECTIONS, appendAstraToComment: false }
    );
    expect(result.changed).toBe(true);
    expect(result.work.notes).toBe(PLAIN_NOTES);
    expect(latest(result.work).notes).toBe(PLAIN_NOTES);
    expect(latest(result.work).scores).toEqual({});
  });

  it('clears stale local scores when AniList is unrated', () => {
    const work = makeWork({ scores: { story: 8 } });
    const result = reconcileWithRemote(
      work,
      { notes: '', score: 0 },
      { sections: DEFAULT_SECTIONS, appendAstraToComment: false }
    );
    expect(result.changed).toBe(true);
    expect(latest(result.work).scores).toEqual({});
  });

  it('keeps local notes and scores when the remote Astra block is malformed', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const work = makeWork({ scores: { story: 8 }, notes: 'Local note' }, 'Local note');
    const remoteNotes = `${ASTRA_MARKERS.HEADER}\nPersonal text without footer`;
    const result = reconcileWithRemote(
      work,
      { notes: remoteNotes, score: 80 },
      { sections: DEFAULT_SECTIONS, appendAstraToComment: true }
    );
    expect(result.changed).toBe(false);
    expect(result.work.notes).toBe('Local note');
    expect(latest(result.work).notes).toBe('Local note');
    expect(latest(result.work).scores).toEqual({ story: 8 });
    expect(warn).toHaveBeenCalledOnce();
  });

  it('merges a well-formed Astra block when appending to comments is enabled', () => {
    const source = makeWork({ scores: { story: 8, characters: 7.8 } });
    const block = new AstraParserService().inject('', source, DEFAULT_SECTIONS);
    const result = reconcileWithRemote(
      makeWork(),
      { notes: block, score: 80 },
      { sections: DEFAULT_SECTIONS, appendAstraToComment: true }
    );
    expect(result.changed).toBe(true);
    expect(latest(result.work).scores).toMatchObject({ story: 8, characters: 7.8 });
  });

  it('ignores a well-formed Astra block when appending to comments is disabled', () => {
    const source = makeWork({ scores: { story: 8, characters: 7.8 } });
    const block = new AstraParserService().inject('', source, DEFAULT_SECTIONS);
    const result = reconcileWithRemote(
      makeWork(),
      { notes: block, score: 80 },
      { sections: DEFAULT_SECTIONS, appendAstraToComment: false }
    );
    expect(result.changed).toBe(false);
    expect(latest(result.work).scores).toEqual({});
  });

  it('never mutates the input work', () => {
    const work = makeWork({ scores: { story: 8 } });
    const before = JSON.stringify(work);
    const season = latest(work);
    reconcileWithRemote(
      work,
      { notes: PLAIN_NOTES, score: 0 },
      { sections: DEFAULT_SECTIONS, appendAstraToComment: false }
    );
    expect(JSON.stringify(work)).toBe(before);
    expect(latest(work)).toBe(season);
  });

  it('reports no change when the local work already matches AniList', () => {
    const work = makeWork({ scores: { story: 8 }, notes: PLAIN_NOTES }, PLAIN_NOTES);
    const result = reconcileWithRemote(
      work,
      { notes: PLAIN_NOTES, score: 80 },
      { sections: DEFAULT_SECTIONS, appendAstraToComment: false }
    );
    expect(result.changed).toBe(false);
    expect(result.work).toEqual(work);
  });
});
