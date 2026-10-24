import { describe, expect, it, vi } from 'vitest';
import { AstraService } from './AstraService';
import { EventBus } from '@core/events/EventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import type { ApiContext, IApiClient } from '@core/interfaces/IApiClient';

const response = (name: string) => ({ Viewer: { mediaListOptions: { animeList: { customLists: [name] }, mangaList: { customLists: [] } } } });
function fixture() {
  let context: ApiContext = { userId: 7, sessionId: 'session-A' };
  const bus = new EventBus();
  const query = vi.fn(async () => response('Account A'));
  const ensureContext = vi.fn(async () => ({ ...context }));
  const api = { getContext: () => ({ ...context }), ensureContext, query } as unknown as IApiClient;
  const service = new AstraService(bus, api, {} as never, {} as never, {} as never, {} as never);
  return { service, query, ensureContext, bus, change: (sessionId: string, userId = 7, emit = false) => {
    context = { sessionId, userId };
    if (emit) bus.emit(EVENT_TYPES.AUTH_STATE_CHANGED, { isAuthenticated: true, userId, timestamp: new Date() });
  } };
}

describe('Astra facade custom-list cache account context', () => {
  it.each([7, 8])('does not reuse custom-list names after a silent session change for user %s', async userId => {
    const f = fixture(); expect(await f.service.getAniListCustomLists()).toEqual(['Account A']);
    f.change('session-B', userId); f.query.mockResolvedValue(response('Account B'));
    expect(await f.service.getAniListCustomLists()).toEqual(['Account B']);
    expect(f.query).toHaveBeenCalledTimes(2);
  });
  it('does not return a cached value when context changes during awaited context readiness', async () => {
    const f = fixture(); await f.service.getAniListCustomLists();
    let resolve!: (context: ApiContext) => void;
    f.ensureContext.mockReturnValueOnce(new Promise<ApiContext>(yes => { resolve = yes; }));
    const held = f.service.getAniListCustomLists(); f.change('session-B'); resolve({ userId: 7, sessionId: 'session-A' });
    await expect(held).rejects.toThrow('Astra account changed');
  });
  it('keeps cache results detached and invalidates them on an auth event', async () => {
    const f = fixture(); const names = await f.service.getAniListCustomLists(); names.push('Caller mutation');
    expect(await f.service.getAniListCustomLists()).toEqual(['Account A']);
    f.query.mockResolvedValue(response('Account B')); f.change('session-B', 7, true);
    expect(await f.service.getAniListCustomLists()).toEqual(['Account B']);
  });
  it('does not let a late old-session response restore its names over a newer cache', async () => {
    const f = fixture(); let resolve!: (value: ReturnType<typeof response>) => void;
    f.query.mockReturnValueOnce(new Promise(yes => { resolve = yes; }));
    const held = f.service.getAniListCustomLists();
    for (let index = 0; index < 8; index++) await Promise.resolve();
    f.change('session-B', 7, true); f.query.mockResolvedValue(response('Account B'));
    expect(await f.service.getAniListCustomLists()).toEqual(['Account B']);
    resolve(response('Old session secret')); await expect(held).rejects.toThrow('Astra account changed');
    expect(await f.service.getAniListCustomLists()).toEqual(['Account B']);
    expect(f.query).toHaveBeenCalledTimes(2);
  });
  it('releases its auth subscription and rejects pending and new list reads after disposal', async () => {
    const f = fixture(); let resolve!: (value: ReturnType<typeof response>) => void;
    f.query.mockReturnValueOnce(new Promise(yes => { resolve = yes; }));
    const held = f.service.getAniListCustomLists(); for (let index = 0; index < 8; index++) await Promise.resolve();
    (f.service as unknown as { dispose(): void }).dispose(); (f.service as unknown as { dispose(): void }).dispose();
    expect(f.bus.listenerCount(EVENT_TYPES.AUTH_STATE_CHANGED)).toBe(0);
    resolve(response('Late private names')); await expect(held).rejects.toThrow('disposed');
    await expect(f.service.getAniListCustomLists()).rejects.toThrow('disposed'); expect(f.query).toHaveBeenCalledOnce();
  });
  it('does not initiate delegated commands after disposal', async () => {
    const f = fixture(); f.service.dispose();
    await expect(f.service.init()).rejects.toThrow('disposed');
    await expect(f.service.updateSettings({ autoSync: true })).rejects.toThrow('disposed');
    await expect(f.service.factoryReset()).rejects.toThrow('disposed');
    await expect(f.service.incrementProgress(1)).rejects.toThrow('disposed');
    await expect(f.service.exportJSON()).rejects.toThrow('disposed');
  });
});

describe('Astra scoring mode', () => {
  const mode = (detailedScoring: boolean | undefined, sectionScores?: Record<string, number | null>) => {
    const { service } = fixture();
    vi.spyOn(service, 'getSettings').mockReturnValue({
      enableSeriesFinale: false, finaleWeightMultiplier: 2, autoSync: true, appendAstraToComment: false, detailedScoring,
    });
    vi.spyOn(service, 'getWorks').mockReturnValue(sectionScores ? [{ sectionScores } as never] : []);
    return service.getScoringMode();
  };
  it('follows an explicit choice', () => {
    expect(mode(true)).toBe('detailed');
    expect(mode(false, { story: 8 })).toBe('simple');
  });
  it('treats a library with section scores as detailed and asks otherwise', () => {
    expect(mode(undefined, { story: 8 })).toBe('detailed');
    expect(mode(undefined, { story: null })).toBe('unset');
    expect(mode(undefined)).toBe('unset');
  });
});
