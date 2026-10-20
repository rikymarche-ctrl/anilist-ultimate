import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '@core/events/EventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { AstraUIBridge } from './AstraUIBridge';
const bridges: AstraUIBridge[] = [];
type Lifecycle = { deactivate(): void; dispose(): void };
afterEach(() => { for (const bridge of bridges.splice(0)) (bridge as unknown as Lifecycle).dispose?.(); vi.restoreAllMocks(); document.body.innerHTML = ''; });
function setup() {
  const bus = new EventBus(); const opened = vi.fn(); bus.on(EVENT_TYPES.ASTRA_OPEN, opened);
  const bridge = new AstraUIBridge(bus); bridges.push(bridge);
  document.body.innerHTML = '<a class="au-astra-nav"><svg><path /></svg><span>Open</span></a>';
  return { bridge, opened, bus };
}
describe('Astra global bridge ownership', () => {
  it('registers only two native listeners on repeated initialization and handles nested SVG clicks', () => {
    const addWindow = vi.spyOn(window, 'addEventListener'); const addDocument = vi.spyOn(document, 'addEventListener');
    const f = setup(); f.bridge.initGlobalListeners(); f.bridge.initGlobalListeners();
    expect(addWindow.mock.calls.filter(call => call[0] === 'astra:open')).toHaveLength(1);
    expect(addDocument.mock.calls.filter(call => call[0] === 'click')).toHaveLength(1);
    window.dispatchEvent(new Event('astra:open')); document.querySelector('path')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(f.opened).toHaveBeenCalledTimes(2);
  });
  it('removes exact listener functions and capture options on OFF and rebinds once on ON', () => {
    const add = vi.spyOn(EventTarget.prototype, 'addEventListener'); const remove = vi.spyOn(EventTarget.prototype, 'removeEventListener');
    const f = setup(); f.bridge.initGlobalListeners();
    const registrations = add.mock.calls.map((call, i) => ({ call, target: add.mock.contexts[i] }))
      .filter(({ call, target }) => (target === document && call[0] === 'click') || (target === window && call[0] === 'astra:open'));
    (f.bridge as unknown as Lifecycle).deactivate();
    for (const { call, target } of registrations) expect(remove.mock.calls.some((removed, i) => remove.mock.contexts[i] === target && removed[0] === call[0] && removed[1] === call[1] && Boolean(typeof removed[2] === 'boolean' ? removed[2] : removed[2]?.capture) === Boolean(typeof call[2] === 'boolean' ? call[2] : call[2]?.capture))).toBe(true);
    window.dispatchEvent(new Event('astra:open')); f.bridge.triggerDashboard(); expect(f.opened).not.toHaveBeenCalled();
    f.bridge.initGlobalListeners(); window.dispatchEvent(new Event('astra:open')); expect(f.opened).toHaveBeenCalledOnce();
  });
  it('ignores copied listeners from a previous lifecycle after reactivation', () => {
    const add = vi.spyOn(EventTarget.prototype, 'addEventListener'); const f = setup(); f.bridge.initGlobalListeners();
    const old = add.mock.calls.filter(call => call[0] === 'astra:open' || call[0] === 'click').map(call => call[1]);
    (f.bridge as unknown as Lifecycle).deactivate(); f.bridge.initGlobalListeners();
    const event = new MouseEvent('click'); Object.defineProperty(event, 'target', { value: document.querySelector('span') });
    old.forEach(listener => { if (typeof listener === 'function') listener(event); else listener?.handleEvent(event); });
    expect(f.opened).not.toHaveBeenCalled(); f.bridge.triggerDashboard(); expect(f.opened).toHaveBeenCalledOnce();
  });
  it('remains inactive before initialization and after permanent disposal', () => {
    const f = setup(); f.bridge.triggerDashboard(); expect(f.opened).not.toHaveBeenCalled();
    f.bridge.initGlobalListeners(); (f.bridge as unknown as Lifecycle).dispose(); (f.bridge as unknown as Lifecycle).dispose(); f.bridge.initGlobalListeners();
    window.dispatchEvent(new Event('astra:open')); f.bridge.triggerDashboard(); expect(f.opened).not.toHaveBeenCalled();
  });
  it('ignores non-element click targets without raising an exception', () => {
    const f = setup(); f.bridge.initGlobalListeners();
    expect(() => document.dispatchEvent(new Event('click'))).not.toThrow(); expect(f.opened).not.toHaveBeenCalled();
  });
});
