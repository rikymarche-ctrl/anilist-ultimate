import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ForumEnhancerModule } from './ForumEnhancerModule';
import { EventBus } from '@core/events/EventBus';
import type { SharedGlobalObserver } from '@core/observers/SharedGlobalObserver';

const modules: ForumEnhancerModule[] = [];
beforeEach(() => { history.replaceState({}, '', '/forum/thread/1'); document.body.innerHTML = ''; });
afterEach(async () => { for (const module of modules.splice(0)) await module.destroy(); document.body.innerHTML = ''; });
async function setup(href = '/anime/12/title') {
  document.body.innerHTML = '<div class="forum-thread"><h1 class="title"><span>Original title</span></h1><div class="category media"><a>Anime</a></div></div>';
  document.querySelector('a')!.setAttribute('href', href);
  const observer = { register: vi.fn<SharedGlobalObserver['register']>(), unregister: vi.fn() };
  const module = new ForumEnhancerModule(observer as unknown as SharedGlobalObserver, new EventBus()); modules.push(module);
  const title = document.querySelector<HTMLElement>('h1')!; const original = title.firstChild!;
  await module.init(); return { module, observer, title, original };
}
describe('forum title link ownership and mutation filtering', () => {
  it('restores the original title nodes and owned marker on destroy', async () => {
    const f = await setup();
    const link = f.title.querySelector('a');
    expect(link?.pathname).toBe('/anime/12');
    expect(link?.classList.contains('au-title-link')).toBe(true);
    await f.module.destroy(); expect(f.title.querySelector('a')).toBeNull(); expect(f.title.firstChild).toBe(f.original);
    expect(f.title.hasAttribute('data-au-enhanced')).toBe(false);
  });
  it.each(['javascript:alert(1)', 'https://evil.test/anime/12', '/anime/2147483648'])('does not promote an unsafe or invalid media target %s', async href => {
    const f = await setup(href); expect(f.title.querySelector('a')).toBeNull(); expect(f.title.hasAttribute('data-au-enhanced')).toBe(false);
  });
  it('does not unwrap a foreign link that happens to share the class', async () => {
    const f = await setup(); const foreign = document.createElement('a'); foreign.className = 'au-title-link'; foreign.textContent = 'Foreign';
    document.body.prepend(foreign); await f.module.destroy(); expect(foreign.isConnected).toBe(true); expect(foreign.textContent).toBe('Foreign');
    expect(f.title.querySelector('a')).toBeNull();
  });
  it('rebuilds the enhanced title link when the media target changes', async () => {
    const f = await setup(); const callback = f.observer.register.mock.calls[0][1];
    document.querySelector('.category.media a')!.setAttribute('href', '/manga/34');
    callback([], new MutationObserver(() => {}));
    expect(f.title.querySelectorAll('a')).toHaveLength(1); expect(f.title.querySelector('a')?.pathname).toBe('/manga/34');
    expect(f.title.textContent).toBe('Original title');
  });
  it('makes a copied callback inert after teardown', async () => {
    const f = await setup(); const callback = f.observer.register.mock.calls[0][1]; await f.module.destroy();
    document.body.innerHTML = '<div class="forum-thread"><h1 class="title">New</h1><div class="category media"><a href="/anime/42">Tag</a></div></div>';
    callback([], new MutationObserver(() => {})); expect(document.querySelector('h1 a')).toBeNull();
  });
  it('filters unrelated changes while detecting inserted thread subtrees', async () => {
    const f = await setup(); const filter = f.observer.register.mock.calls[0][3]; expect(filter).toBeTypeOf('function');
    const collect = (element: HTMLElement) => { const recorder = new MutationObserver(() => {}); recorder.observe(document.body, { childList: true }); document.body.append(element); const records = recorder.takeRecords(); recorder.disconnect(); return records; };
    expect(filter!(collect(document.createElement('aside')))).toBe(false);
    const inserted = document.createElement('section'); inserted.innerHTML = '<div class="forum-thread"><h1 class="title">Inserted</h1></div>';
    expect(filter!(collect(inserted))).toBe(true);
  });
});
