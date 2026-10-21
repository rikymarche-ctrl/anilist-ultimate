import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '@core/events/EventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { FollowingProgressModule, isFollowingProgressRoute } from './FollowingProgressModule';
import { FollowingProgressService } from './FollowingProgressService';

interface TestAccess { scan(): void; }
const row = (name = 'Friend') => `<a class="follow" href="/user/${name}/"><div class="name">${name}</div><div class="status">Watching</div><span class="native-comment">Notes</span></a>`;
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
describe('Following progress rows and lifecycle', () => {
  let module: FollowingProgressModule; let bus: EventBus; let sessionId: string; let authenticated: boolean;
  let query: ReturnType<typeof vi.fn>;
  const scan = () => (module as unknown as TestAccess).scan();
  const badges = () => document.querySelectorAll('.au-following-progress');
  async function settle() { await vi.advanceTimersByTimeAsync(0); }
  beforeEach(() => {
    vi.useFakeTimers(); history.replaceState({}, '', '/anime/1/title');
    document.body.innerHTML = `<div class="following">${row()}</div>`;
    sessionId = 'A'; authenticated = true; bus = new EventBus();
    query = vi.fn(async (_query: string, vars: Record<string, unknown>): Promise<unknown> => ({ id: 90, mediaId: vars.mediaId,
      userId: 2, progress: 8, user: { id: 2, name: vars.userName } }));
    const api = { isAuthenticated: () => authenticated, getContext: () => ({ sessionId, userId: authenticated ? 1 : null }) };
    module = new FollowingProgressModule(api as never, new FollowingProgressService({ query } as never, api as never), bus);
  });
  afterEach(async () => { await module.destroy(); vi.clearAllTimers(); vi.useRealTimers(); document.body.innerHTML = ''; });
  it('adds one compact counter without replacing status, vote, native links or comment handlers', async () => {
    const native = document.querySelector('.native-comment')!; const click = vi.fn(); native.addEventListener('click', click);
    await module.init(); await settle(); scan(); scan(); await settle();
    expect(badges()).toHaveLength(1); expect(document.querySelector('.status')?.textContent).toBe('Watching · 8 ep');
    native.dispatchEvent(new MouseEvent('click')); expect(click).toHaveBeenCalledOnce(); expect(query).toHaveBeenCalledOnce();
  });
  it.each([0, null, -1, 2.5, undefined, '8'])('shows no counter for progress %j', async progress => {
    query.mockResolvedValue({ id: 90, mediaId: 1, userId: 2, user: { id: 2, name: 'Friend' }, progress });
    await module.init(); await settle(); expect(badges()).toHaveLength(0); expect(document.querySelector('.status')?.textContent).toBe('Watching');
  });
  it('includes the viewer, deduplicates identical profile links and ignores unrelated activity feeds', async () => {
    document.body.innerHTML = `<div class="following">${row('Viewer')}${row('Viewer')}</div><div class="activities">${row('Other')}</div>`;
    await module.init(); await settle(); expect(badges()).toHaveLength(2); expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0][1]).toEqual({ userName: 'Viewer', mediaId: 1 });
  });
  it('replaces cloned counters and reuses cached progress when Vue replaces a row', async () => {
    await module.init(); await settle(); const section = document.querySelector('.following')!;
    section.replaceChildren(...[...section.children].map(child => child.cloneNode(true))); scan(); await settle();
    expect(badges()).toHaveLength(1); expect(query).toHaveBeenCalledOnce();
  });
  it('hides episodes for Completed and rereads actual progress when the native status changes', async () => {
    await module.init(); await settle(); document.querySelector('.status')!.textContent = 'Completed';
    scan(); await settle(); expect(badges()).toHaveLength(0);
    expect(document.querySelector('.status')?.textContent).toBe('Completed');
    document.querySelector('.status')!.firstChild!.textContent = 'Watching';
    await vi.advanceTimersByTimeAsync(300);
    expect(document.querySelector('.status')?.textContent).toBe('Watching · 8 ep'); expect(query).toHaveBeenCalledTimes(3);
  });
  it('does not turn a new Watching state with zero progress into a watched first episode', async () => {
    document.querySelector('.status')!.textContent = 'Planning';
    query.mockResolvedValueOnce({ id: 90, mediaId: 1, userId: 2, user: { id: 2, name: 'Friend' }, progress: 1 });
    await module.init(); await settle();
    const waiting = deferred<unknown>(); query.mockReturnValueOnce(waiting.promise);
    document.querySelector('.status')!.textContent = 'Watching'; scan();
    expect(document.querySelector('.status')?.textContent).toBe('Watching');
    waiting.resolve({ id: 90, mediaId: 1, userId: 2, user: { id: 2, name: 'Friend' }, progress: 0 });
    await settle();
    expect(document.querySelector('.status')?.textContent).toBe('Watching');
    expect(badges()).toHaveLength(0);
  });
  it('shows a first episode when AniList confirms progress one', async () => {
    query.mockResolvedValueOnce({ id: 90, mediaId: 1, userId: 2, user: { id: 2, name: 'Friend' }, progress: 1 });
    await module.init(); await settle();
    expect(document.querySelector('.status')?.textContent).toBe('Watching · 1 ep');
  });
  it('discards an old in-flight progress result after a native status change', async () => {
    const old = deferred<unknown>(); query.mockReturnValueOnce(old.promise);
    await module.init();
    query.mockResolvedValueOnce({ id: 90, mediaId: 1, userId: 2, user: { id: 2, name: 'Friend' }, progress: 0 });
    document.querySelector('.status')!.textContent = 'Paused'; scan(); await settle();
    old.resolve({ id: 90, mediaId: 1, userId: 2, user: { id: 2, name: 'Friend' }, progress: 1 });
    await settle();
    expect(document.querySelector('.status')?.textContent).toBe('Paused');
    expect(badges()).toHaveLength(0);
  });
  it('keeps Completed entries without an episode suffix when progress arrives late', async () => {
    document.querySelector('.status')!.textContent = 'Completed'; await module.init(); await settle();
    expect(badges()).toHaveLength(0); expect(document.querySelector('.status')?.textContent).toBe('Completed');
    expect(document.querySelector('.follow')?.classList.contains('au-following-row')).toBe(true);
    await module.destroy(); expect(document.querySelector('.au-following-row')).toBeNull();
  });
  it('does not inject a pending result into a removed or relabelled row', async () => {
    const waiting = deferred<unknown>(); query.mockReturnValueOnce(waiting.promise);
    await module.init(); const old = document.querySelector('.follow')!;
    old.setAttribute('href', '/user/Other/'); scan(); await settle();
    waiting.resolve({ id: 90, mediaId: 1, userId: 2, user: { id: 2, name: 'Friend' }, progress: 99 }); await settle();
    expect(badges()).toHaveLength(1); expect(old.textContent).toContain('8 ep'); expect(old.textContent).not.toContain('99');
  });
  it('preserves one counter on A→B→A row reuse and inverted responses', async () => {
    const waiting = deferred<unknown>(); query.mockReturnValueOnce(waiting.promise);
    await module.init(); const link = document.querySelector('.follow')!;
    link.setAttribute('href', '/user/Other/'); scan(); await settle(); link.setAttribute('href', '/user/Friend/'); scan();
    waiting.resolve({ id: 90, mediaId: 1, userId: 2, user: { id: 2, name: 'Friend' }, progress: 7 }); await settle();
    expect(badges()).toHaveLength(1); expect(badges()[0].textContent).toContain('7 ep');
  });
  it.each(['account', 'logout', 'navigation', 'destroy'] as const)('removes counters and ignores pending work after %s', async kind => {
    await module.init(); await settle();
    const waiting = deferred<unknown>(); query.mockReturnValueOnce(waiting.promise);
    document.querySelector('.following')!.insertAdjacentHTML('beforeend', row('Pending')); scan();
    if (kind === 'destroy') await module.destroy();
    else if (kind === 'navigation') { history.replaceState({}, '', '/character/1'); bus.emit(EVENT_TYPES.PAGE_CHANGED, { previousPath: '/anime/1/title', path: '/character/1', timestamp: new Date() }); }
    else { sessionId = 'B'; authenticated = kind !== 'logout'; bus.emit(EVENT_TYPES.AUTH_STATE_CHANGED, { isAuthenticated: authenticated, timestamp: new Date() }); }
    await settle(); waiting.resolve({ id: 90, mediaId: 1, userId: 2, user: { id: 2, name: 'Pending' }, progress: 99 }); await settle();
    expect(document.body.textContent).not.toContain('99 ep');
    expect(badges()).toHaveLength(kind === 'account' ? 2 : 0);
  });
  it('limits a large Following list to eight active reads, then drains it', async () => {
    document.querySelector('.following')!.innerHTML = Array.from({ length: 205 }, (_, i) => row(`Friend${i}`)).join('');
    const waiting = deferred<unknown>(); query.mockImplementationOnce(() => waiting.promise);
    const rest: Array<() => void> = [];
    query.mockImplementation((_q: string, vars: Record<string, unknown>) => new Promise(resolve => rest.push(() => resolve({ id: 90, mediaId: 1,
      userId: 2, user: { id: 2, name: vars.userName }, progress: 8 }))));
    await module.init(); await settle(); expect(query).toHaveBeenCalledTimes(8);
    for (let i = 0; i < 30; i++) { rest.splice(0).forEach(resolve => resolve()); await settle(); }
    waiting.resolve(null); await settle();
    expect(query).toHaveBeenCalledTimes(205); expect(badges()).toHaveLength(204);
  });
  it('backs off failed reads and retries after 30 seconds', async () => {
    query.mockRejectedValueOnce(new Error('offline')); await module.init(); await settle();
    scan(); await settle(); expect(query).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(30000); expect(badges()).toHaveLength(1); expect(query).toHaveBeenCalledTimes(2);
  });
  it('refreshes expired progress and removes the counter after a confirmed reset to zero', async () => {
    await module.init(); await settle(); expect(badges()).toHaveLength(1);
    query.mockResolvedValueOnce({ id: 90, mediaId: 1, userId: 2, user: { id: 2, name: 'Friend' }, progress: 0 });
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000); expect(badges()).toHaveLength(0);
    expect(query).toHaveBeenCalledTimes(2);
  });
  it.each(['/anime/1/title/social', '/anime/1/social', '/anime/16498/Attack-on-Titan/social', '/anime/16498/Attack-on-Titan/social/'])(
    'supports the Following section on social route %s', async path => {
      expect(isFollowingProgressRoute(path)).toBe(true); history.replaceState({}, '', path);
      document.body.innerHTML = `<section><div class="section-header">Recent Activity</div>${row('Other')}</section><section><div class="section-header">Following</div><div class="users">${row()}</div></section>`;
      await module.init(); await settle(); expect(badges()).toHaveLength(1);
      expect(query.mock.calls[0][1]).toEqual({ userName: 'Friend', mediaId: path.includes('16498') ? 16498 : 1 });
      expect(document.querySelector('.au-following-section')?.textContent).toContain('Following');
      await module.destroy(); expect(document.querySelector('.au-following-section')).toBeNull();
    });
  it('moves overview → social → overview without duplicating or retaining the old indicators', async () => {
    await module.init(); await settle();
    for (const path of ['/anime/1/title/social', '/anime/1/title']) {
      const previousPath = location.pathname; history.replaceState({}, '', path);
      bus.emit(EVENT_TYPES.PAGE_CHANGED, { path, previousPath, timestamp: new Date() });
      expect(badges()).toHaveLength(0); await settle(); expect(badges()).toHaveLength(1);
    }
  });
  it.each(['/home', '/manga/1/title', '/character/1/anime/2', '/anime/1/title/characters', '/anime/1/characters', '/anime/2147483648/title'])(
    'does not query excluded route %s', async path => {
      expect(isFollowingProgressRoute(path)).toBe(false); history.replaceState({}, '', path);
      await module.init(); await settle(); expect(query).not.toHaveBeenCalled();
    });
});
