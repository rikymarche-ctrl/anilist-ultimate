import { afterEach, describe, expect, it, vi } from 'vitest';
import { SocialActivityModule } from './SocialActivityModule';
import { SocialSidebar } from './components/SocialSidebar';
import { EventBus } from '@core/events/EventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { container } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';

describe('social sidebar module ownership', () => {
  afterEach(() => document.body.replaceChildren());
  it('mounts once and releases its component/listeners on destroy, including after reinit', async () => {
    const bus = new EventBus();
    const service = { getDetailedActivity: vi.fn(async () => ({ nodes: [], hasNextPage: false })) };
    const child = container.createChildContainer();
    child.registerInstance(TOKENS.SocialService, service);
    child.registerInstance(TOKENS.CustomListService, { init: async () => undefined, getLists: () => ({}) });
    child.registerInstance(TOKENS.ApiClient, { getContext: () => ({ sessionId: 'A', userId: 10 }) });
    child.registerInstance(TOKENS.EventBus, bus);
    child.registerInstance(TOKENS.ToastService, { error: vi.fn() });
    child.registerSingleton(SocialSidebar);
    const view = child.resolve(SocialSidebar);
    const module = child.resolve(SocialActivityModule);
    await module.init(); await module.init();
    expect(document.querySelectorAll('#au-social-sidebar')).toHaveLength(1);
    expect(bus.listenerCount(EVENT_TYPES.AUTH_STATE_CHANGED)).toBe(1);
    await module.destroy();
    expect(module.getSidebar()).toBeNull();
    expect(document.querySelector('#au-social-sidebar')).toBeNull();
    expect(bus.listenerCount(EVENT_TYPES.AUTH_STATE_CHANGED)).toBe(0);
    window.dispatchEvent(new CustomEvent('au-open-social-sidebar', { detail: { mediaId: 1, title: 'Late' } }));
    expect(service.getDetailedActivity).not.toHaveBeenCalled();
    await module.init(); view.open(1, 'New'); await Promise.resolve();
    expect(bus.listenerCount(EVENT_TYPES.PAGE_CHANGED)).toBe(1);
    expect(service.getDetailedActivity).toHaveBeenCalledTimes(1);
    await module.destroy();
    expect(bus.listenerCount(EVENT_TYPES.PAGE_CHANGED)).toBe(0);
  });
});
