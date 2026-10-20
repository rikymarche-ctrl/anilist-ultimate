import { describe, expect, it, vi } from 'vitest';
import { PreferencesService } from './PreferencesService';

describe('shared preferences service subscriber lifetime', () => {
  const setup = () => {
    let listener!: (value: unknown) => void;
    const unsubscribe = vi.fn();
    const prefs = { socialEnabled: true, socialShowAvatars: true, autoUpdateProgress: true, compactMode: false };
    const store = { getState: () => ({ preferences: prefs }), subscribeToSelector: vi.fn((_selector: unknown, callback: (value: unknown) => void) => { listener = callback; return unsubscribe; }) };
    const service = new PreferencesService(store as never);
    return { service, store, unsubscribe, trigger: () => listener(service.getPreferences()) };
  };
  it('unsubscribes once on manual unsubscribe or disposal and guards copied retired callbacks', () => {
    const f = setup(); const callback = vi.fn(); const remove = f.service.onChanges(callback);
    f.trigger(); expect(callback).toHaveBeenCalledTimes(1);
    remove(); remove(); f.service.dispose();
    f.trigger(); expect(callback).toHaveBeenCalledTimes(1); expect(f.unsubscribe).toHaveBeenCalledTimes(1);
  });
  it('releases remaining subscriptions on disposal and accepts no new subscribers afterward', () => {
    const f = setup(); const callback = vi.fn(); f.service.onChanges(callback);
    f.service.dispose(); f.service.dispose();
    f.trigger(); f.service.onChanges(callback);
    expect(callback).not.toHaveBeenCalled(); expect(f.unsubscribe).toHaveBeenCalledTimes(1);
    expect(f.store.subscribeToSelector).toHaveBeenCalledTimes(1);
  });

  it('releases a subscription when its immediate callback disposes the service', () => {
    const unsubscribe = vi.fn(); const callback = vi.fn(() => service.dispose());
    const prefs = { socialEnabled: true, socialShowAvatars: false, autoUpdateProgress: false, compactMode: false };
    const store = { getState: () => ({ preferences: prefs }), subscribeToSelector: vi.fn((selector: (state: { preferences: typeof prefs }) => unknown, listener: (value: unknown) => void) => {
      listener(selector(store.getState())); return unsubscribe;
    }) };
    const service = new PreferencesService(store as never); const remove = service.onChanges(callback); remove();
    expect(callback).toHaveBeenCalledTimes(1); expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
