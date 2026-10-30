import { beforeEach, describe, expect, it } from 'vitest';
import { ActivityTemplateCache, hasActivitySlots, scrubActivityRow } from './ActivityTemplates';
import {
  NATIVE_LIST_ROW,
  NATIVE_MESSAGE_ROW,
  NATIVE_TEXT_ROW,
} from '@/test/fixtures/anilist-activity-rows';

function parse(html: string): HTMLElement {
  const host = document.createElement('template');
  host.innerHTML = html;
  return host.content.firstElementChild as HTMLElement;
}

/** Every decoration a clone must never carry. */
function decorations(root: HTMLElement): string[] {
  const found: string[] = [];
  const all = [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))];
  for (const el of all) {
    if (Array.from(el.classList).some((name) => name.startsWith('au-')))
      found.push(`class ${el.className}`);
    if (Array.from(el.attributes).some((attr) => attr.name.startsWith('data-au-')))
      found.push('data-au-*');
    if (el.hasAttribute('id') || el.hasAttribute('aria-controls')) found.push('id/aria-controls');
    if (
      el.classList.contains('router-link-active') ||
      el.classList.contains('router-link-exact-active')
    ) {
      found.push('router-link');
    }
    if (el.classList.contains('liked')) found.push('liked');
  }
  return found;
}

describe('scrubActivityRow', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('removes every extension decoration, document id and router state from a native list row', () => {
    const scrubbed = scrubActivityRow(parse(NATIVE_LIST_ROW), 'list')!;
    expect(scrubbed).not.toBeNull();
    expect(scrubbed.querySelector('.au-activity-rating')).toBeNull();
    expect(scrubbed.querySelector('[data-au-score-enhanced], [data-au-media-id]')).toBeNull();
    expect(scrubbed.querySelector('.action-pill, .pill-section, .pill-separator')).toBeNull();
    expect(scrubbed.querySelector('[id]')).toBeNull();
    expect(scrubbed.querySelector('[aria-controls]')).toBeNull();
    expect(scrubbed.querySelector('.router-link-active')).toBeNull();
    expect(decorations(scrubbed)).toEqual([]);
  });

  it('empties per-row data and drops count badges and hrefs', () => {
    const scrubbed = scrubActivityRow(parse(NATIVE_LIST_ROW), 'list')!;
    expect(scrubbed.querySelector('.time')!.childNodes).toHaveLength(0);
    expect(scrubbed.querySelector('.status')!.childNodes).toHaveLength(0);
    expect(scrubbed.querySelector('.reply-wrap')!.childNodes).toHaveLength(0);
    expect(scrubbed.querySelector('.like-wrap .users')!.childNodes).toHaveLength(0);
    expect(scrubbed.querySelector('.count')).toBeNull();
    expect(scrubbed.querySelector('.name')!.textContent).toBe('');
    expect(scrubbed.querySelector('a[href]')).toBeNull();
    expect(scrubbed.querySelector('.avatar')!.getAttribute('style')).toBeNull();
    expect(scrubbed.querySelector('.cover')!.getAttribute('style')).toBeNull();
    expect(scrubbed.getAttribute('style')).toBeNull();
  });

  it('keeps the AniList scope attributes so native scoped CSS still applies', () => {
    const scrubbed = scrubActivityRow(parse(NATIVE_LIST_ROW), 'list')!;
    expect(scrubbed.hasAttribute('data-v-eb51fd0e')).toBe(true);
    expect(scrubbed.querySelector('.wrap')!.hasAttribute('data-v-0f4a73fc')).toBe(true);
  });

  it('never mutates the input row', () => {
    const row = parse(NATIVE_LIST_ROW);
    const before = row.outerHTML;
    scrubActivityRow(row, 'list');
    expect(row.outerHTML).toBe(before);
  });

  it('keeps the header slots of a native text row and removes its decorations', () => {
    const scrubbed = scrubActivityRow(parse(NATIVE_TEXT_ROW), 'text')!;
    expect(scrubbed.querySelector('.header a.avatar')).not.toBeNull();
    expect(scrubbed.querySelector('.header a.name')).not.toBeNull();
    expect(scrubbed.querySelector('.activity-markdown .markdown')!.childNodes).toHaveLength(0);
    expect(decorations(scrubbed)).toEqual([]);
  });

  it('returns null when a required slot is missing', () => {
    const row = parse(NATIVE_LIST_ROW);
    row.querySelector('.actions')!.remove();
    expect(scrubActivityRow(row, 'list')).toBeNull();
    expect(scrubActivityRow(parse(NATIVE_LIST_ROW), 'text')).toBeNull();
  });
});

describe('ActivityTemplateCache', () => {
  let cache: ActivityTemplateCache;

  beforeEach(() => {
    document.body.innerHTML = '';
    cache = new ActivityTemplateCache();
  });

  it('captures a list template from a native row and returns a clone of it', () => {
    document.body.innerHTML = NATIVE_LIST_ROW;
    cache.capture(document);
    const first = cache.create('list');
    const second = cache.create('list');
    expect(first).not.toBe(second);
    expect(first.querySelector('.au-activity-rating')).toBeNull();
    expect(hasActivitySlots(first, 'list')).toBe(true);
  });

  it('prefers the first native row whose scrub succeeds', () => {
    const invalid = document.createElement('div');
    invalid.className = 'activity-entry activity-anime_list';
    invalid.setAttribute('data-src', 'invalid');
    const valid = NATIVE_LIST_ROW.replace(
      '<div data-v-0f4a73fc=""',
      '<div data-src="valid" data-v-0f4a73fc=""'
    );
    document.body.innerHTML = invalid.outerHTML + valid;
    cache.capture(document);
    expect(cache.create('list').getAttribute('data-src')).toBe('valid');
  });

  it('does not capture a message row as a text template', () => {
    document.body.innerHTML = NATIVE_MESSAGE_ROW;
    cache.capture(document);
    const created = cache.create('text');
    expect(created.classList.contains('activity-message')).toBe(false);
    expect(hasActivitySlots(created, 'text')).toBe(true);
  });

  it('ignores custom clones when capturing', () => {
    document.body.innerHTML = NATIVE_LIST_ROW.replace(
      'class="activity-entry activity-anime_list au-astra-card"',
      'class="activity-entry activity-anime_list au-custom-activity" data-src="custom"'
    );
    cache.capture(document);
    expect(cache.create('list').getAttribute('data-src')).toBeNull();
  });

  it('builds a skeleton with the full slot structure when no native row was seen', () => {
    expect(hasActivitySlots(cache.create('list'), 'list')).toBe(true);
    expect(hasActivitySlots(cache.create('text'), 'text')).toBe(true);
  });

  it('ignores unscoped rows such as extension placeholders when harvesting scopes', () => {
    document.body.innerHTML =
      '<div class="activity-entry">Loading…</div>' +
      '<div class="activity-entry activity-anime_list" data-v-eb51fd0e="" data-v-0f4a73fc=""></div>';
    cache.capture(document);
    expect(cache.create('list').hasAttribute('data-v-eb51fd0e')).toBe(true);
    document.body.innerHTML = '<div class="activity-entry">Loading…</div>';
    cache.capture(document);
    expect(cache.create('list').hasAttribute('data-v-eb51fd0e')).toBe(true);
  });

  it('carries harvested scope attributes into the skeleton', () => {
    document.body.innerHTML =
      '<div class="activity-entry activity-anime" data-v-eb51fd0e="" data-v-0f4a73fc="">' +
      '<div class="wrap" data-v-0f4a73fc=""><div class="like-wrap" data-v-5fb0ec91=""></div></div></div>';
    cache.capture(document);
    const skeleton = cache.create('list');
    expect(skeleton.hasAttribute('data-v-eb51fd0e')).toBe(true);
    expect(skeleton.querySelector('.wrap')!.hasAttribute('data-v-0f4a73fc')).toBe(true);
    expect(skeleton.querySelector('.time')!.hasAttribute('data-v-0f4a73fc')).toBe(true);
    expect(skeleton.querySelector('.like-wrap .button')!.hasAttribute('data-v-5fb0ec91')).toBe(
      true
    );
    expect(skeleton.querySelector('.time')!.hasAttribute('data-v-5fb0ec91')).toBe(false);
    expect(hasActivitySlots(skeleton, 'list')).toBe(true);
  });

  it('builds no scope attributes when no native row was seen', () => {
    expect(cache.create('text').querySelector('[data-v-0f4a73fc]')).toBeNull();
    expect(cache.create('text').hasAttribute('data-v-eb51fd0e')).toBe(false);
  });
});

describe('hasActivitySlots', () => {
  it('reports a row without its action slots as incomplete', () => {
    const row = parse(NATIVE_TEXT_ROW);
    row.querySelector('.actions .action.likes')!.remove();
    expect(hasActivitySlots(row, 'text')).toBe(false);
  });
});
