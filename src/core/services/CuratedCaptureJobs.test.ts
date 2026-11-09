import { afterEach, describe, expect, it, vi } from 'vitest';
import { CuratedCaptureJobs, validTitles } from './CuratedCaptureJobs';
import type { CuratedOrderClient } from './CuratedOrderClient';
import { CURATED_ORIGIN, rankSlugsByTitles } from '@/modules/watchorder/CuratedOrderMatch';
import { MSG } from '@shared/messages';

describe('capture job input', () => {
  it('accepts only non-empty string titles, capped in length and count', () => {
    expect(validTitles(null)).toBeNull();
    expect(validTitles([])).toBeNull();
    expect(validTitles([1, '', 'Attack on Titan'])).toEqual(['Attack on Titan']);
    expect(validTitles(Array.from({ length: 200 }, () => 'x'.repeat(500)))?.length).toBe(80);
    expect(validTitles(['x'.repeat(500)])?.[0]).toHaveLength(200);
  });
  it('ranks franchise slugs from bare AniList titles', () => {
    const slugs = ['attack-on-titan', 'monogatari', 'titan-x'];
    expect(rankSlugsByTitles(slugs, ['Attack on Titan', 'Attack on Titan Season 2'])[0]).toBe(
      'attack-on-titan'
    );
    expect(rankSlugsByTitles(slugs, [])).toEqual([]);
  });
});

describe('CuratedCaptureJobs', () => {
  const setup = (slugs: string[]) => {
    const create = vi.fn(async () => ({ id: 7 }));
    const update = vi.fn(async () => ({}));
    const remove = vi.fn(async () => undefined);
    const sendMessage = vi.fn(async () => undefined);
    vi.stubGlobal('chrome', { tabs: { create, update, remove, sendMessage } });
    const client = { knownSlugs: async () => slugs } as unknown as CuratedOrderClient;
    return { jobs: new CuratedCaptureJobs(client), create, remove, sendMessage };
  };
  afterEach(() => vi.unstubAllGlobals());

  it('opens the page of a known franchise, else the home page', async () => {
    const known = setup(['attack-on-titan']);
    await known.jobs.open(['Attack on Titan'], 3);
    expect(known.create).toHaveBeenCalledWith(
      expect.objectContaining({ url: `${CURATED_ORIGIN}/franchise/attack-on-titan` })
    );
    const unknown = setup([]);
    await unknown.jobs.open(['Attack on Titan'], 3);
    expect(unknown.create).toHaveBeenCalledWith(
      expect.objectContaining({ url: `${CURATED_ORIGIN}/` })
    );
  });
  it('closes only its own tab and tells the AniList tab to look again', async () => {
    const { jobs, remove, sendMessage } = setup(['attack-on-titan']);
    await jobs.finish(7);
    expect(remove).not.toHaveBeenCalled();
    await jobs.open(['Attack on Titan'], 3);
    expect(jobs.isJob(7)).toBe(true);
    await jobs.finish(7);
    expect(remove).toHaveBeenCalledWith(7);
    expect(sendMessage).toHaveBeenCalledWith(3, { type: MSG.WATCH_ORDER_READY });
    expect(jobs.isJob(7)).toBe(false);
  });
});
