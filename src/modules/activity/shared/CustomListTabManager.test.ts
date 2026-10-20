import { afterEach, describe, expect, it, vi } from 'vitest';
import { CustomListTabManager } from './CustomListTabManager';
import { logger } from '@core/logger';
describe('custom list menu safety and lifecycle', () => {
  afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });
  it('renders arbitrary list names as text rather than executable HTML', async () => {
    document.body.innerHTML = '<div class="feed-type-toggle"></div>';
    const name = '"><img src=x onerror=alert(1)>';
    const service = { init: async () => undefined, getLists: () => ({ [name]: [] }) };
    const manager = new CustomListTabManager(logger, service as never);
    expect(await manager.inject()).toBe(true);
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelectorAll('.au-custom-list-item')[1].textContent).toBe(name);
    expect(document.querySelectorAll('.au-custom-list-item')[1].getAttribute('data-list')).toBe(name);
    const remove = vi.spyOn(document, 'removeEventListener'); manager.destroy();
    expect(remove).toHaveBeenCalledWith('click', expect.any(Function));
  });
  it('does not inject after destruction while the list service is loading', async () => {
    document.body.innerHTML = '<div class="feed-type-toggle"></div>';
    let resolve!: () => void;
    const manager = new CustomListTabManager(logger, { init: () => new Promise<void>(r => { resolve = r; }), getLists: () => ({ Friends: [] }) } as never);
    const pending = manager.inject(); manager.destroy(); resolve();
    expect(await pending).toBe(false); expect(document.querySelector('.au-custom-list-btn')).toBeNull();
  });
});


describe('custom list tab re-injection and empty-state memory', () => {
  afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

  it('replaces a stale body menu and its document listeners when AniList rebuilds the toggle', async () => {
    document.body.innerHTML = '<div class="feed-type-toggle"></div>';
    const service = { init: async () => undefined, getLists: () => ({ Friends: [] }) };
    const manager = new CustomListTabManager(logger, service as never);
    expect(await manager.inject()).toBe(true);
    document.querySelector('.feed-type-toggle')!.outerHTML = '<div class="feed-type-toggle"></div>';
    const remove = vi.spyOn(document, 'removeEventListener');
    expect(await manager.inject()).toBe(true);
    expect(document.querySelectorAll('.au-custom-list-menu')).toHaveLength(1);
    expect(document.querySelectorAll('.au-custom-list-btn')).toHaveLength(1);
    expect(remove).toHaveBeenCalledWith('click', expect.any(Function));
    manager.destroy();
    expect(document.querySelector('.au-custom-list-menu')).toBeNull();
  });

  it('does not repeat the background list lookup while this page has no lists, and checks again after navigation', async () => {
    document.body.innerHTML = '<div class="feed-type-toggle"></div>';
    const init = vi.fn(async () => undefined);
    const service = { init, getLists: vi.fn(() => ({})) };
    const manager = new CustomListTabManager(logger, service as never);
    expect(await manager.inject()).toBe(false);
    expect(await manager.inject()).toBe(false);
    expect(init).toHaveBeenCalledTimes(1);
    manager.destroy();
    expect(await manager.inject()).toBe(false);
    expect(init).toHaveBeenCalledTimes(2);
  });

  it('injects as soon as local lists appear without waiting for navigation', async () => {
    document.body.innerHTML = '<div class="feed-type-toggle"></div>';
    let lists: Record<string, unknown[]> = {};
    const init = vi.fn(async () => undefined);
    const manager = new CustomListTabManager(logger, { init, getLists: () => lists } as never);
    expect(await manager.inject()).toBe(false);
    lists = { Friends: [] };
    expect(await manager.inject()).toBe(true);
    expect(document.querySelector('.au-custom-list-btn')).not.toBeNull();
    expect(init).toHaveBeenCalledTimes(2);
  });
});
