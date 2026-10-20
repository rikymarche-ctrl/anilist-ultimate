import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomListModule, isCustomListSettingsPath } from './CustomListModule';
import { CustomListManager } from './components/CustomListManager';
import { TOKENS } from '@core/di/tokens';
import { EventBus } from '@core/events/EventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { container } from '@core/di/container';

describe('custom list route module ownership', () => {
  const modules: CustomListModule[] = [];
  beforeEach(() => {
    history.replaceState({}, '', '/settings#au-custom-lists');
    document.body.innerHTML = '<div class="nav-group mobile-nav-hidden"><div class="group-header">Settings</div><a class="router-link-active router-link-exact-active" href="/settings">Native</a></div><div class="settings container"><div class="content" style="display:flex">Native settings</div></div>';
  });
  afterEach(async () => { for (const module of modules) await module.destroy(); modules.length = 0; document.body.replaceChildren(); history.replaceState({}, '', '/'); vi.restoreAllMocks(); });
  function fixture() {
    const bus = new EventBus();
    const callbacks: Array<() => void> = [];
    const observer = { register: vi.fn((_name: string, callback: () => void) => { callbacks.push(callback); }), unregister: vi.fn() };
    const element = document.createElement('div'); element.textContent = 'Manager';
    const component = { getElement: () => element, mount: vi.fn((parent: HTMLElement) => { parent.appendChild(element); }), unmount: vi.fn(() => { element.remove(); }) };
    vi.spyOn(container, 'resolve').mockReturnValue(component as never);
    const module = new CustomListModule(observer as never, bus, component as never); modules.push(module);
    const native = document.querySelector<HTMLElement>('.settings > .content')!;
    return { module, bus, observer, callbacks, component, element, native };
  }

  it('mounts the injected manager once and restores the exact native display on close', async () => {
    const f = fixture(); await f.module.init(); await f.module.init();
    expect(f.component.mount).toHaveBeenCalledTimes(1);
    expect(f.observer.register).toHaveBeenCalledTimes(1); expect(f.native.style.display).toBe('none');
    history.replaceState({}, '', '/settings'); window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(f.component.unmount).toHaveBeenCalledTimes(1); expect(f.native.style.display).toBe('flex');
    expect(document.getElementById('au-custom-settings-container')).toBeNull();
  });

  it('unmounts and removes owned wrappers/links on destroy and ignores a late observer after reinit', async () => {
    const f = fixture(); await f.module.init(); const stale = f.callbacks[0];
    await f.module.destroy();
    expect(f.component.unmount).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.au-custom-lists-link')).toBeNull();
    expect(document.getElementById('au-custom-settings-container')).toBeNull();
    await f.module.init(); expect(f.component.mount).toHaveBeenCalledTimes(2);
    history.replaceState({}, '', '/home#au-custom-lists'); stale();
    expect(f.component.unmount).toHaveBeenCalledTimes(1);
    f.callbacks[1](); expect(f.component.unmount).toHaveBeenCalledTimes(2);
  });

  it('handles path navigation and ignores a matching hash outside settings', async () => {
    const f = fixture(); await f.module.init(); history.replaceState({}, '', '/home#au-custom-lists');
    f.bus.emit(EVENT_TYPES.PAGE_CHANGED, { path: '/home', previousPath: '/settings', timestamp: new Date() });
    expect(f.component.unmount).toHaveBeenCalledTimes(1);
    f.callbacks[0](); expect(f.component.mount).toHaveBeenCalledTimes(1);
  });

  it('releases removed native content without altering the replacement owned by Vue', async () => {
    const f = fixture(); await f.module.init();
    const replacement = document.createElement('div'); replacement.className = 'content'; replacement.style.display = 'grid';
    f.native.replaceWith(replacement); f.callbacks[0]();
    expect(f.native.style.display).toBe('flex'); expect(replacement.style.display).toBe('none');
    await f.module.destroy(); expect(replacement.style.display).toBe('grid');
    expect(f.component.mount).toHaveBeenCalledTimes(2);
  });

  it('does not overwrite a newer native display value during teardown', async () => {
    const f = fixture(); await f.module.init(); f.native.style.display = 'grid'; await f.module.destroy();
    expect(f.native.style.display).toBe('grid');
  });

  it('matches only settings paths with a real path boundary', () => {
    expect(isCustomListSettingsPath('/settings')).toBe(true); expect(isCustomListSettingsPath('/settings/account')).toBe(true);
    for (const path of ['/home', '/user/Name', '/settings-other']) expect(isCustomListSettingsPath(path)).toBe(false);
  });

  it('does not create a self-triggered observer cycle when routing is already applied', async () => {
    const f = fixture(); await f.module.init();
    const records: MutationRecord[] = [];
    const observer = new MutationObserver(changes => { records.push(...changes); });
    observer.observe(document.body, { attributes: true, childList: true, subtree: true });
    f.callbacks[0](); await Promise.resolve();
    expect(records).toHaveLength(0); observer.disconnect();
  });

  it('resolves the real component in a child container and owns its account subscription', async () => {
    const child = container.createChildContainer(); const bus = new EventBus();
    const lists = { init: vi.fn(async () => undefined), getLists: () => ({ Team: [] }), onChange: () => () => undefined };
    child.registerInstance(TOKENS.EventBus, bus);
    child.registerInstance(TOKENS.SharedGlobalObserver, { register: vi.fn(), unregister: vi.fn() });
    child.registerInstance(TOKENS.SocialService, { getAllFollowings: vi.fn(async () => []) });
    child.registerInstance(TOKENS.CustomListService, lists);
    child.registerInstance(TOKENS.ApiClient, { isAuthenticated: () => true, getContext: () => ({ sessionId: 'A', userId: 10 }), ensureContext: async () => ({ sessionId: 'A', userId: 10 }) });
    child.registerInstance(TOKENS.ToastService, { error: vi.fn() });
    child.registerSingleton(CustomListManager);
    const module = child.resolve(CustomListModule); modules.push(module); await module.init();
    for (let index = 0; index < 12; index++) await Promise.resolve();
    expect(document.querySelector('.au-cl-list-name')?.textContent).toBe('Team');
    expect(bus.listenerCount(EVENT_TYPES.AUTH_STATE_CHANGED)).toBe(1);
    await module.destroy(); expect(bus.listenerCount(EVENT_TYPES.AUTH_STATE_CHANGED)).toBe(0); expect(bus.listenerCount(EVENT_TYPES.PAGE_CHANGED)).toBe(0);
  });
});
