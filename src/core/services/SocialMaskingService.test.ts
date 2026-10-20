import { afterEach, describe, expect, it, vi } from 'vitest';
import { SocialMaskingService } from './SocialMaskingService';
import { CalendarStore } from '@/modules/calendar/CalendarStore';
import { ConfigManager } from '@core/config/ConfigManager';

vi.mock('@core/logger', () => ({ logger: { info: vi.fn(), debug: vi.fn(), success: vi.fn(), error: vi.fn() } }));

const services: SocialMaskingService[] = [];
function fixture() {
  const observer = {
    register: vi.fn<(name: string, callback: () => void, throttleMs: number) => void>(),
    unregister: vi.fn<(name: string) => void>(),
  };
  const config = new ConfigManager({ set: vi.fn(async () => true) } as never);
  const store = new CalendarStore({} as never, { create: vi.fn(() => ({})) } as never);
  store.setState({ preferences: { ...store.getState().preferences, socialEnabled: false } });
  const service = new SocialMaskingService(observer as never, config, store);
  services.push(service);
  return { service, observer, config, store };
}
afterEach(() => {
  for (const service of services.splice(0)) service.destroy();
  document.body.className = '';
});

describe('SocialMaskingService lifecycle', () => {
  it('initializes once and reacts immediately when Astra is disabled in config', async () => {
    const { service, observer, config, store } = fixture();
    service.init();
    service.init();
    expect(observer.register).toHaveBeenCalledTimes(1);
    expect(store.getDebugInfo().listenerCount).toBe(1);
    expect(document.body.classList.contains('au-social-avatars-hidden')).toBe(true);
    await config.setFeature('astra', false);
    expect(document.body.classList.contains('au-social-avatars-hidden')).toBe(false);
    expect(document.body.classList.contains('au-astra-enabled')).toBe(false);
  });

  it('removes only its classes and subscriptions; obsolete callbacks cannot remask the page', async () => {
    const { service, observer, store, config } = fixture();
    document.body.classList.add('anilist-native');
    service.init();
    const obsolete = observer.register.mock.calls[0][1];
    service.destroy();
    service.destroy();
    expect(observer.unregister).toHaveBeenCalledExactlyOnceWith('social-masking-persistence');
    expect(store.getDebugInfo().listenerCount).toBe(0);
    store.setState({ preferences: { ...store.getState().preferences, socialShowAvatars: false } });
    await config.setFeature('astra', false);
    obsolete();
    service.sync();
    expect(document.body.className).toBe('anilist-native');
  });

  it('restarts with one subscription and ignores observer callbacks from the previous lifecycle', () => {
    const { service, observer, store } = fixture();
    service.init();
    const obsolete = observer.register.mock.calls[0][1];
    service.destroy();
    service.init();
    expect(store.getDebugInfo().listenerCount).toBe(1);
    document.body.classList.remove('au-astra-enabled');
    obsolete();
    expect(document.body.classList.contains('au-astra-enabled')).toBe(false);
    observer.register.mock.calls[1][1]();
    expect(document.body.classList.contains('au-astra-enabled')).toBe(true);
  });
});
