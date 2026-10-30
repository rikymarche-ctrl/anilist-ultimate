import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '@core/events/EventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import type { ProfileConnections } from './ProfileConnections';
import { ProfileConnectionsModule, profileNameFromPath } from './ProfileConnectionsModule';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((pass) => {
    resolve = pass;
  });
  return { promise, resolve };
}

const person = (id: number, name: string) => ({
  id,
  name,
  avatar: { medium: 'https://s4.anilist.co/a.png' },
});
const connections: ProfileConnections = {
  followers: { users: [person(2, 'Amy'), person(3, 'Bob'), person(4, 'Cy')], complete: true },
  following: { users: [person(3, 'Bob')], complete: true },
  lists: [{ name: 'Best Friends', users: [person(3, 'Bob')] }],
};
const header = (name: string) =>
  `<div class="header-wrap"><div class="banner"><div class="banner-content"><div class="name-wrapper"><h1 class="name"> ${name} </h1></div></div></div></div>`;

describe('ProfileConnectionsModule', () => {
  let api: { isAuthenticated: ReturnType<typeof vi.fn> };
  let service: { getConnections: ReturnType<typeof vi.fn>; clear: ReturnType<typeof vi.fn> };
  let lists: { onChange: ReturnType<typeof vi.fn> };
  let bus: EventBus;
  let module: ProfileConnectionsModule;

  const navigate = (path: string, name: string) => {
    history.replaceState({}, '', path);
    document.body.innerHTML = header(name);
    bus.emit(EVENT_TYPES.PAGE_CHANGED, { path, previousPath: '/', timestamp: new Date() });
  };

  beforeEach(() => {
    vi.useFakeTimers();
    history.replaceState({}, '', '/user/Friend/');
    document.body.innerHTML = header('Friend');
    api = { isAuthenticated: vi.fn(() => true) };
    service = { getConnections: vi.fn(async () => connections), clear: vi.fn() };
    lists = { onChange: vi.fn(() => () => undefined) };
    bus = new EventBus();
    module = new ProfileConnectionsModule(api as never, service as never, lists as never, bus);
  });
  afterEach(async () => {
    await module.destroy();
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('reads the profile name from any profile subpage', () => {
    expect(profileNameFromPath('/user/Friend/social')).toBe('Friend');
    expect(profileNameFromPath('/anime/1')).toBeNull();
  });

  it('renders the summary inside the name block', async () => {
    await module.init();
    const line = document.querySelector('.name-wrapper > .au-profile-connections');
    expect(line?.textContent).toBe('3 followers in common, 1 following (1 in Best Friends)');
    expect(line?.querySelectorAll('button')).toHaveLength(3);
  });

  it('opens a dropdown with the people behind a count and their custom lists', async () => {
    await module.init();
    const button = document.querySelector<HTMLButtonElement>('[data-section="followers"]')!;
    button.click();
    const rows = [...document.querySelectorAll<HTMLAnchorElement>('.au-profile-connections-user')];
    expect(
      rows.map((row) => row.querySelector('.au-profile-connections-name')?.textContent)
    ).toEqual(['Amy', 'Bob', 'Cy']);
    expect(rows[0].getAttribute('href')).toBe('/user/Amy/');
    expect(rows[1].querySelector('.au-profile-connections-list')?.textContent).toBe('Best Friends');
    expect(button.getAttribute('aria-expanded')).toBe('true');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('.au-profile-connections-dropdown')).toBeNull();
  });

  it('keeps a 500-person list usable: count in the title, lazy avatars, search by name', async () => {
    const many = Array.from({ length: 500 }, (_, index) => person(index + 10, `member${index}`));
    service.getConnections.mockResolvedValue({ ...connections, followers: { users: many, complete: false } });
    await module.init();
    document.querySelector<HTMLButtonElement>('[data-section="followers"]')!.click();
    expect(document.querySelector('.au-profile-connections-title')?.textContent).toBe('Followers in common · 500');
    const avatars = document.querySelectorAll<HTMLImageElement>('img.au-profile-connections-avatar');
    expect(avatars).toHaveLength(500);
    expect([...avatars].every((img) => img.loading === 'lazy')).toBe(true);

    const search = document.querySelector<HTMLInputElement>('.au-profile-connections-search')!;
    search.value = 'MEMBER49';
    search.dispatchEvent(new Event('input'));
    const visible = [...document.querySelectorAll<HTMLElement>('.au-profile-connections-user')].filter((row) => !row.hidden);
    expect(visible.map((row) => row.textContent)).toEqual(['member49', 'member490', 'member491', 'member492', 'member493', 'member494', 'member495', 'member496', 'member497', 'member498', 'member499']);
  });

  it('shows no search box for a short list', async () => {
    await module.init();
    document.querySelector<HTMLButtonElement>('[data-section="followers"]')!.click();
    expect(document.querySelector('.au-profile-connections-search')).toBeNull();
  });

  it('shows nothing when the extension is not connected', async () => {
    api.isAuthenticated.mockReturnValue(false);
    await module.init();
    expect(service.getConnections).not.toHaveBeenCalled();
    expect(document.querySelector('.au-profile-connections')).toBeNull();
  });

  it("shows nothing on the viewer's own profile", async () => {
    service.getConnections.mockResolvedValue(null);
    await module.init();
    expect(document.querySelector('.au-profile-connections')).toBeNull();
  });

  it('never renders a response for a profile the viewer already left', async () => {
    const slow = deferred<ProfileConnections>();
    service.getConnections.mockReturnValueOnce(slow.promise);
    service.getConnections.mockResolvedValueOnce({
      ...connections,
      lists: [],
      following: { users: [], complete: true },
    });
    const first = module.init();
    navigate('/user/Other/', 'Other');
    await vi.advanceTimersByTimeAsync(0);
    slow.resolve(connections);
    await first;
    await vi.advanceTimersByTimeAsync(0);
    const lines = document.querySelectorAll('.au-profile-connections');
    expect(lines).toHaveLength(1);
    expect(lines[0].textContent).toBe('3 followers in common');
  });

  it('waits until the reused header shows the new profile before rendering', async () => {
    document.body.innerHTML = header('Previous');
    const pending = module.init();
    await vi.advanceTimersByTimeAsync(300);
    expect(document.querySelector('.au-profile-connections')).toBeNull();
    document.querySelector('.name')!.textContent = 'Friend';
    await vi.advanceTimersByTimeAsync(300);
    await pending;
    expect(document.querySelector('.au-profile-connections')).not.toBeNull();
  });

  it('removes the line when navigating away from profiles', async () => {
    await module.init();
    history.replaceState({}, '', '/home');
    bus.emit(EVENT_TYPES.PAGE_CHANGED, {
      path: '/home',
      previousPath: '/user/Friend/',
      timestamp: new Date(),
    });
    expect(document.querySelector('.au-profile-connections')).toBeNull();
  });

  it('drops cached data and re-renders on an auth change', async () => {
    await module.init();
    api.isAuthenticated.mockReturnValue(false);
    bus.emit(EVENT_TYPES.AUTH_STATE_CHANGED, { isAuthenticated: false, timestamp: new Date() });
    await vi.advanceTimersByTimeAsync(0);
    expect(service.clear).toHaveBeenCalled();
    expect(document.querySelector('.au-profile-connections')).toBeNull();
  });
});
