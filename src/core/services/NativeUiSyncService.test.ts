import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NativeUiSyncService } from './NativeUiSyncService';
import { EventBus } from '@core/events/EventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { MediaListStatus } from '@/api/AnilistTypes';

describe('native progress synchronization', () => {
  beforeEach(() => { history.replaceState({}, '', '/home'); document.body.replaceChildren(); });
  afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });
  function fixture() {
    const bus = new EventBus();
    const service = new NativeUiSyncService(bus, { getContext: () => ({ userId: 42, sessionId: 'current' }) } as never);
    return { service, bus };
  }

  it('matches exact media IDs and preserves nested nodes, totals and click handlers', () => {
    document.body.innerHTML = '<div class="media-card" id="one"><a href="/anime/1/name"></a><div class="progress"><span class="content">2</span> / 12 <button>+1</button></div><div class="info">Progress: 2 <button>edit</button></div></div><div class="media-card" id="ten"><a href="/anime/10/name"></a><div class="progress">2 / 12</div></div>';
    const { service } = fixture(); const content = document.querySelector('.content');
    const button = document.querySelector<HTMLButtonElement>('.info button')!; const click = vi.fn(); button.addEventListener('click', click);
    service.syncProgress(1, 3);
    expect(document.querySelector('.content')).toBe(content);
    expect(document.querySelector('#one .progress')!.textContent).toBe('3 / 12 +1');
    expect(document.querySelector('#ten .progress')!.textContent).toBe('2 / 12');
    expect(document.querySelector('.info')!.textContent).toBe('Progress: 3 edit');
    button.click(); expect(click).toHaveBeenCalledOnce(); service.destroy();
  });

  it('updates the media header only on its exact anime or manga route', () => {
    document.body.innerHTML = '<div class="entry-progress"><div class="progress">Progress: <strong>2</strong> / 12</div></div>';
    const { service } = fixture(); const node = document.querySelector('strong');
    history.replaceState({}, '', '/anime/10/name'); service.syncProgress(1, 3); expect(node!.textContent).toBe('2');
    history.replaceState({}, '', '/character/1/name'); service.syncProgress(1, 3); expect(node!.textContent).toBe('2');
    history.replaceState({}, '', '/manga/1/name'); service.syncProgress(1, 3); expect(node!.textContent).toBe('3');
    expect(document.querySelector('strong')).toBe(node); service.destroy();
  });

  it('subscribes once, ignores other-account events and unsubscribes on destroy', () => {
    const { service, bus } = fixture(); const sync = vi.spyOn(service, 'syncProgress'); service.init(); service.init();
    bus.emit(EVENT_TYPES.PROGRESS_UPDATED, { mediaId: 1, progress: 3, previousProgress: 2, userId: 1 });
    expect(sync).not.toHaveBeenCalled();
    bus.emit(EVENT_TYPES.PROGRESS_UPDATED, { mediaId: 1, progress: 3, previousProgress: 2, userId: 42 });
    expect(sync).toHaveBeenCalledOnce(); service.destroy();
    bus.emit(EVENT_TYPES.PROGRESS_UPDATED, { mediaId: 1, progress: 4, previousProgress: 3, userId: 42 });
    expect(sync).toHaveBeenCalledOnce();
  });

  it('restores original dimming styles after status reversal and account change', () => {
    document.body.innerHTML = '<div class="media-card" style="opacity: 0.9; filter: contrast(2)"><a href="/anime/1/name"></a></div>';
    const { service, bus } = fixture(); service.init(); const card = document.querySelector<HTMLElement>('.media-card')!;
    service.syncProgress(1, 12, MediaListStatus.COMPLETED); expect(card.style.opacity).toBe('0.4');
    service.syncProgress(1, 10, MediaListStatus.WATCHING); expect(card.style.opacity).toBe('0.9'); expect(card.style.filter).toBe('contrast(2)');
    service.syncProgress(1, 12, MediaListStatus.COMPLETED);
    bus.emit(EVENT_TYPES.AUTH_STATE_CHANGED, { isAuthenticated: false, timestamp: new Date() });
    expect(card.style.opacity).toBe('0.9'); service.destroy();
  });

  it('rejects invalid progress without touching inputs', () => {
    document.body.innerHTML = '<div class="entry row"><a href="/anime/1/name"></a><div class="progress"><input value="2"></div></div>';
    const { service } = fixture(); service.syncProgress(1, Infinity); service.syncProgress(1, -1); service.syncProgress(1, 1.5);
    expect(document.querySelector('input')!.value).toBe('2'); service.syncProgress(1, 3); expect(document.querySelector('input')!.value).toBe('3');
    service.destroy();
  });
});
