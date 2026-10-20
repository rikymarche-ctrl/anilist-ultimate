import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AstraNavigationService } from './AstraNavigationService';
import { AstraUIBridge } from './AstraUIBridge';
import { AstraRoutingService } from './AstraRoutingService';
import { EventBus } from '@core/events/EventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { logger } from '@core/logger';
type Lifecycle = { activate(): void; deactivate(): void; dispose(): void };
const services: AstraNavigationService[] = [];
const bridges: AstraUIBridge[] = [];
afterEach(() => { for (const service of services.splice(0)) (service as unknown as Lifecycle).dispose?.(); for (const bridge of bridges.splice(0)) bridge.dispose(); vi.restoreAllMocks(); document.body.innerHTML = ''; });
beforeEach(() => { history.replaceState({}, '', '/anime/7/title'); document.body.innerHTML = '<div class="actions"><button class="list">Add</button></div>'; });
function setup() { const service = new AstraNavigationService({ navigateToDashboard: vi.fn() } as never); services.push(service); const onOpen = vi.fn(); return { service, onOpen, button: document.querySelector<HTMLButtonElement>('.actions .list')! }; }
describe('Astra native media-button ownership', () => {
  it('updates a reused button to its current anime or manga identity', () => {
    const f = setup(); f.service.hijackMediaButton(f.onOpen); f.button.click();
    history.replaceState({}, '', '/manga/8/other'); f.service.hijackMediaButton(f.onOpen); f.button.click();
    expect(f.onOpen.mock.calls).toEqual([[7], [8]]);
  });
  it('handles a replaced media button immediately without waiting for another observer scan', () => {
    const f = setup(); f.service.hijackMediaButton(f.onOpen);
    for (const id of [8, 9, 10]) {
      history.replaceState({}, '', `/anime/${id}/title`);
      document.querySelector('.actions')!.innerHTML = '<button class="list"><svg><path></path></svg></button>';
      document.querySelector('path')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    }
    expect(f.onOpen.mock.calls).toEqual([[8], [9], [10]]);
  });
  it('handles a button that arrives after the first scan', () => {
    const f = setup(); document.body.replaceChildren(); f.service.hijackMediaButton(f.onOpen);
    document.body.innerHTML = '<div class="actions"><button class="list">Add</button></div>';
    document.querySelector<HTMLButtonElement>('.list')!.click();
    expect(f.onOpen).toHaveBeenCalledExactlyOnceWith(7);
  });
  it.each(['/character/1/anime/7', '/staff/1/anime/7', '/anime/7oops', '/anime/0', '/anime/2147483648'])('preserves native behavior on the excluded route %s', path => {
    history.replaceState({}, '', path); const f = setup(); const native = vi.fn(); f.button.addEventListener('click', native);
    f.service.hijackMediaButton(f.onOpen); f.button.click(); expect(f.onOpen).not.toHaveBeenCalled(); expect(native).toHaveBeenCalledOnce();
  });
  it('resolves the current work from a reused button before another scan', () => {
    const f = setup(); f.service.hijackMediaButton(f.onOpen); const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    history.replaceState({}, '', '/anime/8/other'); f.button.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true); expect(f.onOpen).toHaveBeenCalledExactlyOnceWith(8);
  });
  it('removes its exact capture listener and marker on OFF; ON rebinds once', () => {
    const add = vi.spyOn(window, 'addEventListener'); const remove = vi.spyOn(window, 'removeEventListener');
    const f = setup(); f.service.hijackMediaButton(f.onOpen); f.service.hijackMediaButton(f.onOpen);
    const registered = add.mock.calls.filter((call, i) => add.mock.contexts[i] === window && call[0] === 'click'); expect(registered).toHaveLength(1);
    (f.service as unknown as Lifecycle).deactivate(); const native = vi.fn(); f.button.addEventListener('click', native); f.button.click();
    expect(f.onOpen).not.toHaveBeenCalled(); expect(native).toHaveBeenCalledOnce(); expect(f.button.hasAttribute('data-astra-hijacked')).toBe(false);
    expect(remove.mock.calls.some((call, i) => remove.mock.contexts[i] === window && call[0] === 'click' && call[1] === registered[0][1] && call[2] === true)).toBe(true);
    (f.service as unknown as Lifecycle).activate(); f.service.hijackMediaButton(f.onOpen); f.button.click(); expect(f.onOpen).toHaveBeenCalledOnce();
  });
  it.each([null, 'native-owner', 'true'])('restores the original marker %s and preserves a later foreign value', marker => {
    const f = setup(); if (marker !== null) f.button.setAttribute('data-astra-hijacked', marker);
    f.service.hijackMediaButton(f.onOpen); f.button.click(); expect(f.onOpen).toHaveBeenCalledOnce();
    (f.service as unknown as Lifecycle).deactivate(); expect(f.button.getAttribute('data-astra-hijacked')).toBe(marker);
    (f.service as unknown as Lifecycle).activate(); f.service.hijackMediaButton(f.onOpen); f.button.setAttribute('data-astra-hijacked', 'new-native');
    (f.service as unknown as Lifecycle).deactivate(); expect(f.button.getAttribute('data-astra-hijacked')).toBe('new-native');
  });
  it('ignores a copied listener after replacement, OFF/ON and permanent disposal', () => {
    const add = vi.spyOn(window, 'addEventListener'); const f = setup(); f.service.hijackMediaButton(f.onOpen);
    const listener = add.mock.calls.find((call, i) => add.mock.contexts[i] === window && call[0] === 'click')![1] as EventListener;
    f.button.outerHTML = '<button class="list">Replacement</button>'; (f.service as unknown as Lifecycle).deactivate(); (f.service as unknown as Lifecycle).activate(); f.service.hijackMediaButton(f.onOpen);
    listener(new MouseEvent('click')); expect(f.onOpen).not.toHaveBeenCalled();
    (f.service as unknown as Lifecycle).dispose(); (f.service as unknown as Lifecycle).activate(); f.service.hijackMediaButton(f.onOpen);
    document.querySelector<HTMLButtonElement>('.list')!.click(); expect(f.onOpen).not.toHaveBeenCalled();
  });
  it('updates the current callback without adding duplicate handlers', () => {
    const f = setup(); const next = vi.fn(); f.service.hijackMediaButton(f.onOpen); f.service.hijackMediaButton(next); f.button.click();
    expect(f.onOpen).not.toHaveBeenCalled(); expect(next).toHaveBeenCalledExactlyOnceWith(7);
  });
  it('does not install new navigation effects or run its existing navbar callback after disposal', () => {
    const navigate = vi.fn(); const service = new AstraNavigationService({ navigateToDashboard: navigate } as never); services.push(service);
    document.body.innerHTML = '<div class="nav"><div class="links"></div></div>'; service.injectNavbarButton();
    const old = document.querySelector<HTMLElement>('.au-astra-nav')!;
    (service as unknown as Lifecycle).dispose(); old.addEventListener('click', event => event.preventDefault()); old.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    old.remove(); expect(service.injectNavbarButton()).toBe(false); expect(navigate).not.toHaveBeenCalled();
  });
  it('contains a rejected open handler' , async () => {
    const f = setup(); const errorLog = vi.spyOn(logger, 'error').mockImplementation(() => {});
    f.service.hijackMediaButton(() => Promise.reject(new Error('private provider payload'))); f.button.click();
    await Promise.resolve(); await Promise.resolve(); expect(errorLog).toHaveBeenCalledWith('[Astra] Rating open failed');
  });
});
describe('Browse dropdown seasonal link', () => {
  it('keeps Seasonal on one line and expands the fixed-width outer menu for a 25px gutter', () => {
    document.body.innerHTML = '<div class="dropdown" style="width: 270px"><div class="primary-link"><section><div class="secondary-links"><a href="/search/anime?sort=top">Top Anime</a><a href="/search/manga?sort=top">Top Manga</a><a href="/search/anime?sort=top-movies">Top Movies</a></div></section></div></div>';
    const service = new AstraNavigationService({ navigateToDashboard: vi.fn() } as never); services.push(service);

    service.enhanceBrowseDropdown();

    const dropdown = document.querySelector<HTMLElement>('.dropdown')!;
    const container = document.querySelector<HTMLElement>('.secondary-links')!;
    const seasonalLink = container.querySelector<HTMLAnchorElement>('.au-seasonal-link')!;
    expect(seasonalLink.innerText).toBe('Seasonal');
    expect(container.lastElementChild).toBe(seasonalLink);
    expect(seasonalLink.style.whiteSpace).toBe('nowrap');
    expect(seasonalLink.style.flexShrink).toBe('0');
    expect(container.style.width).toBe('max-content');
    expect(container.style.flexWrap).toBe('nowrap');
    expect(dropdown.style.width).toBe('295px');
  });
});
describe('navbar integration with the actual global bridge', () => {
  it('removes its own link and Vue clones on OFF, preserving unrelated links and restoring one working link on ON', () => {
    document.body.innerHTML = '<nav class="nav"><div class="links"><a class="link" href="/home">Home</a></div></nav>';
    const bus = new EventBus(); const opened = vi.fn(); bus.on(EVENT_TYPES.ASTRA_OPEN, opened);
    const service = new AstraNavigationService({ navigateToDashboard: () => bus.emit(EVENT_TYPES.ASTRA_OPEN) } as never); services.push(service);
    const bridge = new AstraUIBridge(bus); bridges.push(bridge); bridge.initGlobalListeners();
    service.injectNavbarButton(); const own = document.querySelector<HTMLAnchorElement>('.au-astra-nav')!;
    const clone = own.cloneNode(true) as HTMLElement; own.after(clone);
    const unrelated = document.createElement('a'); unrelated.href = '/user/Other'; unrelated.className = 'au-astra-nav'; own.after(unrelated);
    service.deactivate(); bridge.deactivate();
    expect(own.isConnected).toBe(false); expect(clone.isConnected).toBe(false); expect(unrelated.isConnected).toBe(true);
    expect(own.hasAttribute('href')).toBe(false); expect(clone.hasAttribute('href')).toBe(false);
    own.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); expect(opened).not.toHaveBeenCalled();
    unrelated.remove(); service.activate(); bridge.initGlobalListeners(); service.injectNavbarButton();
    expect(document.querySelectorAll('.au-astra-nav')).toHaveLength(1);
    document.querySelector('.au-astra-nav')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(opened).toHaveBeenCalledOnce(); service.dispose(); expect(document.querySelector('.au-astra-nav')).toBeNull();
  });
  it('emits one open event for one real navbar click', () => {
    const bus = new EventBus(); const opened = vi.fn(); bus.on(EVENT_TYPES.ASTRA_OPEN, opened);
    const bridge = new AstraUIBridge(bus); bridges.push(bridge); bridge.initGlobalListeners();
    const service = new AstraNavigationService(new AstraRoutingService(bridge)); services.push(service);
    document.body.innerHTML = '<div class="nav"><div class="links"></div></div>'; service.injectNavbarButton();
    document.querySelector<HTMLElement>('.au-astra-nav .au-astra-text')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(opened).toHaveBeenCalledOnce();
  });
});
