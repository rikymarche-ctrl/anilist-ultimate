import { describe, expect, it, vi } from 'vitest';
import { AstraThemeRatingService } from './AstraThemeRatingService';
import { applyLinkedThemeScores, linkedScoreKeys } from '../utils/AstraThemeScores';
import {
  withThemeRating,
  withThemesPrompted,
  type ThemeMediaRatings,
  type ThemeRatingArchive,
  type ThemeRatingInput,
} from '../store/AstraThemeRatings';
import { createMusicThemeCache } from '@/modules/media/MediaMusicResponse';
import type { AstraSection, AstraWork } from '../AstraInterfaces';

const SECTIONS: AstraSection[] = [
  { id: 'story', name: 'Story', weight: 3 },
  {
    id: 'sound',
    name: 'Sound',
    weight: 1,
    subSections: [
      { id: 'intro', name: 'Intro', weight: 1, source: 'OP' },
      { id: 'outro', name: 'Outro', weight: 1, source: 'ED' },
      { id: 'all', name: 'All', weight: 2 },
    ],
  },
];

describe('linked theme scores', () => {
  it('maps sections and sub-sections to score keys', () => {
    expect(linkedScoreKeys(SECTIONS)).toEqual([
      { key: 'sound_intro', source: 'OP' },
      { key: 'sound_outro', source: 'ED' },
    ]);
    expect(linkedScoreKeys([{ id: 'music', name: 'Music', weight: 1, source: 'ED' }])).toEqual([
      { key: 'music', source: 'ED' },
    ]);
  });

  it('writes the means into linked keys and leaves the rest alone', () => {
    const scores = { story: 8, sound_all: 7, sound_intro: 5 };
    const next = applyLinkedThemeScores(scores, SECTIONS, { OP: 9, ED: null });
    expect(next).toEqual({ story: 8, sound_all: 7, sound_intro: 9, sound_outro: null });
    expect(scores.sound_intro).toBe(5);
    expect(applyLinkedThemeScores(next!, SECTIONS, { OP: 9, ED: null })).toBeNull();
    expect(
      applyLinkedThemeScores(scores, [{ id: 'story', name: 'S', weight: 1 }], { OP: 9, ED: 9 })
    ).toBeNull();
  });
});

function fixture(
  sections: AstraSection[] = SECTIONS,
  work?: AstraWork,
  settings: { songRatings?: boolean; songRatingsUncounted?: Array<'OP' | 'ED'> } = {}
) {
  let archive: ThemeRatingArchive = {};
  const repository = {
    getThemeRatings: vi.fn(
      async (mediaId: number): Promise<ThemeMediaRatings> =>
        structuredClone(archive[mediaId] ?? { ratings: {} })
    ),
    saveThemeRating: vi.fn(async (mediaId: number, id: string, rating: ThemeRatingInput | null) => {
      archive = withThemeRating(archive, mediaId, id, rating);
      return structuredClone(archive[mediaId] ?? { ratings: {} });
    }),
    markThemesPrompted: vi.fn(async (mediaId: number, ids: string[]) => {
      archive = withThemesPrompted(archive, mediaId, ids);
      return archive[mediaId];
    }),
  };
  const astra = {
    init: vi.fn(async () => {}),
    getSections: () => sections,
    getSettings: () => settings,
    getFullWork: vi.fn(async () => structuredClone(work)),
    saveWork: vi.fn(async (value: AstraWork) => value),
  };
  const cache = new Map<string, unknown>([
    [
      `music_themes_cache_5`,
      createMusicThemeCache(
        5,
        {
          openings: ['1: "First" by A (eps 1-13)', '2: "Second" by A (eps 14-25)'],
          endings: ['1: "Loose" by B'],
        },
        Date.now() - 7 * 24 * 3600 * 1000
      ),
    ],
  ]);
  const storage = { get: async (key: string) => cache.get(key) ?? null };
  const loader = { load: vi.fn(async () => ({ openings: ['1: "First" by A'], endings: [] })) };
  const service = new AstraThemeRatingService(
    repository as never,
    astra as never,
    storage as never,
    loader as never
  );
  return { service, repository, astra, loader, getArchive: () => archive };
}

const song = (id: string, kind: 'OP' | 'ED' = 'OP') => ({ id, kind, title: 'T', artist: '' });

describe('AstraThemeRatingService', () => {
  it('finds new songs from a stale cache without touching the network', async () => {
    const { service } = fixture();
    // "Loose" has no range and was never offered: the first update shows it too.
    expect((await service.findNewThemes(5, 13, 14)).map((item) => item.title)).toEqual([
      'Second',
      'Loose',
    ]);
    expect(await service.findNewThemes(6, 0, 1)).toEqual([]);
  });

  it('offers unranged songs once and skips rated ones', async () => {
    const { service, repository } = fixture();
    expect((await service.findNewThemes(5, 3, 4)).map((item) => item.title)).toEqual(['Loose']);
    await vi.waitFor(() =>
      expect(repository.markThemesPrompted).toHaveBeenCalledWith(5, ['5:ED:1:loose'])
    );
    expect(await service.findNewThemes(5, 4, 5)).toEqual([]);
    await service.rate(5, song('5:OP:2:second'), 8);
    expect(await service.findNewThemes(5, 13, 14)).toEqual([]);
  });

  it('updates linked sections of an existing Astra entry', async () => {
    const work = { mediaId: 5, seasons: [{ scores: { story: 8 } }] } as unknown as AstraWork;
    const { service, astra } = fixture(SECTIONS, work);
    await service.rate(5, song('5:OP:1:first'), 9);
    await service.rate(5, song('5:OP:2:second'), 8);
    const saved = astra.saveWork.mock.calls.at(-1)![0] as AstraWork;
    expect(saved.seasons[0].scores).toEqual({ story: 8, sound_intro: 8.5, sound_outro: null });
  });

  it('never creates an Astra entry and skips works when nothing is linked', async () => {
    const unlinked = fixture([{ id: 'story', name: 'S', weight: 1 }], {
      mediaId: 5,
      seasons: [{ scores: {} }],
    } as unknown as AstraWork);
    await unlinked.service.rate(5, song('5:OP:1:first'), 9);
    expect(unlinked.astra.getFullWork).not.toHaveBeenCalled();
    const missing = fixture();
    await missing.service.rate(5, song('5:OP:1:first'), 9);
    expect(missing.astra.saveWork).not.toHaveBeenCalled();
  });

  it('moves a vote stored under a renumbered id instead of counting it twice', async () => {
    const { service, getArchive } = fixture();
    await service.rate(5, song('5:OP:1:first'), 6);
    await service.rate(5, song('5:OP:3:first'), 7);
    expect(Object.keys(getArchive()[5].ratings)).toEqual(['5:OP:3:first']);
    expect(await service.getScores(5, [song('5:OP:3:first')])).toEqual({ '5:OP:3:first': 7 });
  });
});

describe('song ratings preference', () => {
  it('is off without links in older data, and follows the switch once set', async () => {
    const plain = [{ id: 'story', name: 'S', weight: 1 }];
    expect((await fixture(plain).service.availability()).enabled).toBe(false);
    expect((await fixture().service.availability()).enabled).toBe(true);
    expect((await fixture(SECTIONS, undefined, { songRatings: false }).service.availability()).enabled).toBe(false);
    expect(await fixture(plain, undefined, { songRatings: true }).service.availability()).toEqual({
      enabled: true,
      kinds: { OP: 'unset', ED: 'unset' },
    });
    expect((await fixture(plain, undefined, { songRatings: true, songRatingsUncounted: ['ED'] }).service.availability()).kinds)
      .toEqual({ OP: 'unset', ED: 'uncounted' });
  });

  it('prompts only for linked kinds, and nothing when switched off', async () => {
    const opOnly: AstraSection[] = [{ id: 'op', name: 'Intro', weight: 1, source: 'OP' }];
    const linked = fixture(opOnly, undefined, { songRatings: true });
    expect((await linked.service.findNewThemes(5, 13, 14)).map((item) => item.title)).toEqual(['Second']);
    const free = fixture(opOnly, undefined, { songRatings: true, songRatingsUncounted: ['ED'] });
    expect((await free.service.findNewThemes(5, 13, 14)).map((item) => [item.title, item.counted])).toEqual([
      ['Second', true],
      ['Loose', false],
    ]);
    const off = fixture(SECTIONS, undefined, { songRatings: false });
    expect(await off.service.findNewThemes(5, 13, 14)).toEqual([]);
  });

  it('leaves Astra scores alone when switched off', async () => {
    const work = { mediaId: 5, seasons: [{ scores: {} }] } as unknown as AstraWork;
    const { service, astra } = fixture(SECTIONS, work, { songRatings: false });
    await service.rate(5, song('5:OP:1:first'), 9);
    expect(astra.saveWork).not.toHaveBeenCalled();
  });
});

describe('AstraService.setThemeTarget', () => {
  it('moves a song kind to one target and clears the previous one', async () => {
    const { AstraService } = await import('../AstraService');
    const { EventBus } = await import('@core/events/EventBus');
    let stored = structuredClone(SECTIONS);
    const repo = { getSections: () => structuredClone(stored), updateSections: vi.fn(async (next: AstraSection[]) => { stored = next; }) };
    const service = new AstraService(new EventBus(), {} as never, repo as never, {} as never, {} as never, {} as never);
    await service.setThemeTarget('OP', { sectionId: 'story' });
    expect(linkedScoreKeys(stored)).toEqual([{ key: 'story', source: 'OP' }, { key: 'sound_outro', source: 'ED' }]);
    await service.setThemeTarget('ED', null);
    expect(linkedScoreKeys(stored)).toEqual([{ key: 'story', source: 'OP' }]);
    expect(stored[1].subSections!.every(sub => !('source' in sub))).toBe(true);
  });

  it('refuses to give openings and endings the same section', async () => {
    const { AstraService } = await import('../AstraService');
    const { EventBus } = await import('@core/events/EventBus');
    let stored = structuredClone(SECTIONS);
    const repo = { getSections: () => structuredClone(stored), updateSections: vi.fn(async (next: AstraSection[]) => { stored = next; }) };
    const service = new AstraService(new EventBus(), {} as never, repo as never, {} as never, {} as never, {} as never);
    await expect(service.setThemeTarget('OP', { sectionId: 'sound', subId: 'outro' })).rejects.toThrow('already takes the endings');
    expect(linkedScoreKeys(stored)).toEqual([{ key: 'sound_intro', source: 'OP' }, { key: 'sound_outro', source: 'ED' }]);
  });
});

describe('AstraThemeRatingService.getSongs', () => {
  it('loads the song list on demand for the rating form', async () => {
    const { service, loader } = fixture();
    expect(await service.getSongs(9)).toEqual([{ id: '9:OP:1:first', kind: 'OP', title: 'First', artist: 'A' }]);
    expect(loader.load).toHaveBeenCalledWith(9);
  });
});
