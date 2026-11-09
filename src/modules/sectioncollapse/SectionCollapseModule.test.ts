import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SectionCollapseModule } from './SectionCollapseModule';
import { COLLAPSE_STORAGE_KEY, kindFromLabel, parseCollapsed } from './SectionCollapsePrefs';
import { SharedGlobalObserver } from '@core/observers/SharedGlobalObserver';
import { EVENT_TYPES } from '@core/events/EventTypes';

/** AniList's overview as rendered on anime pages, plus the extension's own sections. */
function overviewHtml(): string {
  return `<div class="overview">
    <div class="relations"><h2>Relations</h2><div class="grid-wrap">rel</div></div>
    <div class="staff"><h2>Staff</h2><div class="grid-wrap">staff</div></div>
    <div class="au-watchorder-section"><div class="au-wo-header"><h2>Watch Order</h2></div><div class="au-wo-body">wo</div></div>
    <div class="characters"><h2 class="link">Characters</h2><div class="grid-wrap">chars</div></div>
    <div class="au-music-section">
      <div><h2>Openings</h2><div class="op">op</div></div>
      <div><h2>Endings</h2><div class="ed">ed</div></div>
    </div>
    <div class="grid-section-wrap">
      <div class="threads"><h2 class="link"><a href="/anime/1/x/social">Threads</a></h2><div class="list">t</div></div>
    </div>
    <div class="recommendations"><h2>Recommendations <div class="view-all"><div class="toggle">View All</div></div></h2><div class="recs">r</div></div>
  </div>`;
}

function setup(enabled = true) {
  const handlers = new Map<string, Set<(data?: unknown) => void>>();
  const bus = {
    on: (type: string, handler: (data?: unknown) => void) => {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type)!.add(handler);
      return { unsubscribe: () => handlers.get(type)!.delete(handler) };
    },
    emit: (type: string, data?: unknown) => {
      for (const handler of [...(handlers.get(type) ?? [])]) handler(data);
    },
    off: () => undefined,
  };
  const config = { isFeatureEnabled: () => enabled };
  const observer = new SharedGlobalObserver();
  const module = new SectionCollapseModule(config as never, observer, bus as never);
  const navigate = (path: string) => {
    history.pushState(null, '', path);
    bus.emit(EVENT_TYPES.PAGE_CHANGED, { path });
  };
  return { module, navigate, observer };
}

const section = (selector: string) => document.querySelector<HTMLElement>(selector)!;
const toggleOf = (selector: string) =>
  section(selector).querySelector<HTMLButtonElement>(
    ':scope > h2 > .au-sc-toggle, :scope > div > h2 > .au-sc-toggle'
  );
const isHidden = (el: Element) => getComputedStyle(el).display === 'none';

describe('SectionCollapseModule', () => {
  let current: SectionCollapseModule | null = null;

  beforeEach(() => {
    localStorage.clear();
    document.head.innerHTML = '';
    document.body.innerHTML = overviewHtml();
    history.pushState(null, '', '/anime/1/Title');
  });

  afterEach(async () => {
    await current?.destroy();
    current = null;
    vi.useRealTimers();
  });

  it('injects one chevron per section heading, once', async () => {
    const { module } = setup();
    current = module;
    await module.init();
    // A second pass (mount check / observer) must not double-inject.
    (module as unknown as { process(): void }).process();

    const toggles = document.querySelectorAll('.au-sc-toggle');
    expect(toggles).toHaveLength(7); // relations, staff, characters, openings, endings, threads, recs
    document.querySelectorAll('.overview h2').forEach((h2) => {
      expect(h2.querySelectorAll(':scope > .au-sc-toggle').length).toBeLessThanOrEqual(1);
    });
    const button = toggleOf('.staff')!;
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.getAttribute('aria-controls')).toBe(section('.staff').id);
  });

  it('opens Relations once, then lets it collapse like any section', async () => {
    window.localStorage.setItem('au-section-collapse', '["relations"]');
    const { module } = setup();
    current = module;
    await module.init();
    expect(toggleOf('.relations')).not.toBeNull();
    expect(section('.relations').hasAttribute('data-au-collapsed')).toBe(false);
    toggleOf('.relations')!.click();
    expect(section('.relations').hasAttribute('data-au-collapsed')).toBe(true);
    expect(window.localStorage.getItem('au-section-collapse')).toBe('["relations"]');
  });

  it('skips the Watch Order section, which has its own collapse header', async () => {
    const { module } = setup();
    current = module;
    await module.init();
    expect(document.querySelector('.au-watchorder-section .au-sc-toggle')).toBeNull();
  });

  it('toggles a section body from the chevron and from a plain heading', async () => {
    const { module } = setup();
    current = module;
    await module.init();
    const body = section('.staff .grid-wrap');

    toggleOf('.staff')!.click();
    expect(section('.staff').hasAttribute('data-au-collapsed')).toBe(true);
    expect(isHidden(body)).toBe(true);
    expect(isHidden(section('.staff h2'))).toBe(false);
    expect(toggleOf('.staff')!.getAttribute('aria-expanded')).toBe('false');

    section('.staff h2').click();
    expect(isHidden(body)).toBe(false);
    expect(toggleOf('.staff')!.getAttribute('aria-expanded')).toBe('true');
  });

  it('keeps native link headings and interactive children out of the heading toggle', async () => {
    const { module } = setup();
    current = module;
    await module.init();
    section('.characters h2').click();
    expect(section('.characters').hasAttribute('data-au-collapsed')).toBe(false);
    section('.recommendations .view-all .toggle').click();
    expect(section('.recommendations').hasAttribute('data-au-collapsed')).toBe(false);
    toggleOf('.characters')!.click();
    expect(section('.characters').hasAttribute('data-au-collapsed')).toBe(true);
  });

  it('collapses Openings and Endings independently', async () => {
    const { module } = setup();
    current = module;
    await module.init();
    const [openings, endings] = Array.from(
      document.querySelectorAll<HTMLElement>('.au-music-section > div')
    );
    openings.querySelector<HTMLButtonElement>('.au-sc-toggle')!.click();
    expect(openings.hasAttribute('data-au-collapsed')).toBe(true);
    expect(endings.hasAttribute('data-au-collapsed')).toBe(false);
  });

  it('persists state per kind and reapplies it after an SPA navigation re-render', async () => {
    vi.useFakeTimers();
    const { module, navigate } = setup();
    current = module;
    await module.init();
    toggleOf('.characters')!.click();
    expect(parseCollapsed(localStorage.getItem(COLLAPSE_STORAGE_KEY))).toEqual(
      new Set(['characters'])
    );

    // AniList keeps .overview but re-renders its sections for the next anime.
    const overview = section('.overview');
    navigate('/manga/2/Other');
    overview.innerHTML = `
      <div class="staff"><h2>Staff</h2><div class="grid-wrap">staff 2</div></div>
      <div class="characters"><h2 class="link">Characters</h2><div class="grid-wrap">chars 2</div></div>`;
    vi.advanceTimersByTime(1100);

    expect(document.querySelectorAll('.au-sc-toggle')).toHaveLength(2);
    expect(section('.characters').hasAttribute('data-au-collapsed')).toBe(true);
    expect(isHidden(section('.characters .grid-wrap'))).toBe(true);
    expect(section('.staff').hasAttribute('data-au-collapsed')).toBe(false);
  });

  it('restores collapsed kinds from storage on a fresh load', async () => {
    localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify(['openings', 'bad kind!', 3]));
    const { module } = setup();
    current = module;
    await module.init();
    const [openings, endings] = Array.from(
      document.querySelectorAll<HTMLElement>('.au-music-section > div')
    );
    expect(openings.hasAttribute('data-au-collapsed')).toBe(true);
    expect(endings.hasAttribute('data-au-collapsed')).toBe(false);
  });

  it('does nothing when the feature flag is off, and cleans up on destroy', async () => {
    const off = setup(false);
    await off.module.init();
    expect(document.querySelector('.au-sc-toggle')).toBeNull();
    await off.module.destroy();

    const { module } = setup();
    await module.init();
    toggleOf('.staff')!.click();
    await module.destroy();
    expect(document.querySelector('.au-sc-toggle')).toBeNull();
    expect(document.querySelector('[data-au-collapsed]')).toBeNull();
    expect(document.getElementById('au-section-collapse-styles')).toBeNull();
  });
});

describe('kindFromLabel', () => {
  it('slugs headings', () => {
    expect(kindFromLabel('Status Distribution')).toBe('status-distribution');
    expect(kindFromLabel('External & Streaming links')).toBe('external-streaming-links');
    expect(kindFromLabel('  ')).toBe('');
  });
});
