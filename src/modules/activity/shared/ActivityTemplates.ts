/**
 * @file ActivityTemplates.ts
 * @description Native AniList activity rows as templates for the custom-list feed.
 *
 * A template is a scrubbed deep clone of a native row. Every extension decoration (au-* classes and
 * attributes, score badges, Astra pills), every document-scoped id, AniList router state and all
 * per-row data is removed, so the renderer fills a row it fully owns. When no native row was seen yet,
 * a skeleton with the same element tree is built instead. Both paths carry AniList's scoped data-v-*
 * attributes so that native scoped CSS applies.
 *
 * @see ActivityRenderer.ts for the consumer
 */

import { injectable } from 'tsyringe';

export type ActivityTemplateKind = 'list' | 'text';

type ScopeAttributes = ReadonlyArray<readonly [string, string]>;

interface ScopeSet {
  root: ScopeAttributes;
  inner: ScopeAttributes;
  like: ScopeAttributes;
}

const NATIVE_ROW_SELECTORS: Record<ActivityTemplateKind, string> = {
  list: '.activity-entry.activity-anime_list:not(.au-custom-activity), .activity-entry.activity-manga_list:not(.au-custom-activity)',
  text: '.activity-entry.activity-text:not(.au-custom-activity)',
};

/** Any AniList row a template or scope can be taken from; never matches extension placeholders. */
export const NATIVE_TEMPLATE_ROW_SELECTOR = `${NATIVE_ROW_SELECTORS.list}, ${NATIVE_ROW_SELECTORS.text}`;

const REQUIRED_SLOTS: Record<ActivityTemplateKind, readonly string[]> = {
  list: [
    '.wrap',
    'a.cover',
    '.details a.name',
    '.details .status',
    '.details a.avatar',
    '.time',
    '.actions .action.replies',
    '.actions .action.likes .like-wrap .button',
  ],
  text: [
    '.wrap .text .header a.avatar',
    '.wrap .text .header a.name',
    '.activity-markdown .markdown',
    '.time',
    '.actions .action.replies',
    '.actions .action.likes .like-wrap .button',
  ],
};

const STATE_CLASSES = ['router-link-exact-active', 'router-link-active', 'liked', 'is-liked'];
const DECORATION_SELECTOR = '.action-pill, .pill-section, .pill-separator';
const CLEARED_SELECTOR = '.time, .reply-wrap, .like-wrap .users, .status, .markdown';
const DOCUMENT_ATTRIBUTES = ['id', 'aria-controls'];
const EXTENSION_ATTRIBUTES = ['data-astra-processed'];
const EXTENSION_ATTRIBUTE_PREFIX = 'data-au-';
const SCOPE_ATTRIBUTE_PREFIX = 'data-v-';

function everyElement(root: HTMLElement): HTMLElement[] {
  return [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))];
}

function removeAuClasses(el: HTMLElement): void {
  for (const name of Array.from(el.classList)) {
    if (name.startsWith('au-')) el.classList.remove(name);
  }
}

function isExtensionAttribute(name: string): boolean {
  return (
    name.startsWith(EXTENSION_ATTRIBUTE_PREFIX) ||
    EXTENSION_ATTRIBUTES.includes(name) ||
    DOCUMENT_ATTRIBUTES.includes(name)
  );
}

/** True when every slot the renderer writes into exists inside the row. */
export function hasActivitySlots(root: ParentNode, kind: ActivityTemplateKind): boolean {
  return REQUIRED_SLOTS[kind].every((selector) => root.querySelector(selector) !== null);
}

/**
 * Returns a scrubbed deep clone of a native row, or null when the row lacks a required slot.
 * The input row is never mutated.
 */
export function scrubActivityRow(row: HTMLElement, kind: ActivityTemplateKind): HTMLElement | null {
  const clone = row.cloneNode(true) as HTMLElement;

  clone.querySelectorAll<HTMLElement>('[class]').forEach((el) => {
    if (Array.from(el.classList).some((name) => name.startsWith('au-'))) el.remove();
  });
  clone.querySelectorAll(DECORATION_SELECTOR).forEach((el) => el.remove());
  removeAuClasses(clone);

  for (const el of everyElement(clone)) {
    el.classList.remove(...STATE_CLASSES);
    for (const attr of Array.from(el.attributes)) {
      if (isExtensionAttribute(attr.name)) el.removeAttribute(attr.name);
    }
  }

  clone.removeAttribute('style');
  clone.querySelectorAll('.avatar, .cover').forEach((el) => el.removeAttribute('style'));
  clone.querySelectorAll(CLEARED_SELECTOR).forEach((el) => el.replaceChildren());
  clone.querySelectorAll('.count').forEach((el) => el.remove());
  clone.querySelectorAll('.name').forEach((el) => {
    el.textContent = '';
  });
  clone.querySelectorAll('a[href]').forEach((el) => el.removeAttribute('href'));

  return hasActivitySlots(clone, kind) ? clone : null;
}

function make(tag: string, className: string, children: Node[] = []): HTMLElement {
  const el = document.createElement(tag);
  el.className = className;
  el.append(...children);
  return el;
}

function actionsSkeleton(): HTMLElement {
  const replies = make('div', 'action replies', [make('i', 'fa-solid fa-comments')]);
  const users = make('div', 'users');
  const button = make('div', 'button', [make('i', 'fa-solid fa-heart')]);
  const likes = make('div', 'action likes', [make('div', 'like-wrap activity', [users, button])]);
  return make('div', 'actions', [replies, likes]);
}

function listSkeleton(): HTMLElement {
  const cover = make('a', 'cover');
  const name = make('a', 'name');
  const status = make('div', 'status');
  const avatar = make('a', 'avatar');
  const details = make('div', 'details', [name, status, avatar]);
  const list = make('div', 'list small', [cover, details]);
  const wrap = make('div', 'wrap', [list, make('div', 'time'), actionsSkeleton()]);
  return make('div', 'activity-entry', [wrap, make('div', 'reply-wrap')]);
}

function textSkeleton(): HTMLElement {
  const header = make('div', 'header', [make('a', 'avatar'), make('a', 'name')]);
  const markdown = make('div', 'activity-markdown', [make('div', 'markdown')]);
  const text = make('div', 'text', [header, markdown]);
  const wrap = make('div', 'wrap', [text, make('div', 'time'), actionsSkeleton()]);
  return make('div', 'activity-entry', [wrap, make('div', 'reply-wrap')]);
}

function applyAttributes(el: HTMLElement, attributes: ScopeAttributes): void {
  for (const [name, value] of attributes) el.setAttribute(name, value);
}

function applyScopes(root: HTMLElement, scopes: ScopeSet): void {
  applyAttributes(root, scopes.root);
  root.querySelectorAll<HTMLElement>('*').forEach((node) => {
    applyAttributes(node, scopes.inner);
    if (node.closest('.like-wrap')) applyAttributes(node, scopes.like);
  });
}

function dataScope(el: Element): ScopeAttributes {
  return Array.from(el.attributes)
    .filter((attr) => attr.name.startsWith(SCOPE_ATTRIBUTE_PREFIX))
    .map((attr) => [attr.name, attr.value] as const);
}

/** Builds a row with the same element tree as AniList's native markup, without any pristine source. */
function buildSkeleton(kind: ActivityTemplateKind, scopes: ScopeSet): HTMLElement {
  const root = kind === 'list' ? listSkeleton() : textSkeleton();
  applyScopes(root, scopes);
  return root;
}

const EMPTY_SCOPES: ScopeSet = { root: [], inner: [], like: [] };

/**
 * Holds one scrubbed template per kind and the AniList scope attributes seen on native rows.
 * Templates are captured from the live feed, so a native redesign only changes the next capture.
 */
@injectable()
export class ActivityTemplateCache {
  private readonly pristine: Partial<Record<ActivityTemplateKind, HTMLElement>> = {};
  private scopes: ScopeSet = EMPTY_SCOPES;

  /** Captures the first native row per kind whose scrub succeeds; a valid capture replaces the previous one. */
  capture(root: ParentNode = document): void {
    for (const kind of ['list', 'text'] as const) {
      for (const row of Array.from(
        root.querySelectorAll<HTMLElement>(NATIVE_ROW_SELECTORS[kind])
      )) {
        const scrubbed = scrubActivityRow(row, kind);
        if (scrubbed) {
          this.pristine[kind] = scrubbed;
          break;
        }
      }
    }
    this.harvestScopes(root);
  }

  /** Returns an independent row: a clone of the captured template, or a skeleton when none exists. */
  create(kind: ActivityTemplateKind): HTMLElement {
    const template = this.pristine[kind];
    if (template) return template.cloneNode(true) as HTMLElement;
    return buildSkeleton(kind, this.scopes);
  }

  private harvestScopes(root: ParentNode): void {
    // Only rows AniList rendered carry scopes; an unscoped row would wipe the ones already seen.
    const entry = Array.from(
      root.querySelectorAll<HTMLElement>('.activity-entry:not(.au-custom-activity)')
    ).find((row) => dataScope(row).length > 0);
    if (!entry) return;
    const wrap = entry.querySelector<HTMLElement>(':scope > .wrap');
    const like = entry.querySelector<HTMLElement>('.like-wrap');
    this.scopes = {
      root: dataScope(entry),
      inner: wrap ? dataScope(wrap) : this.scopes.inner,
      like: like ? dataScope(like) : this.scopes.like,
    };
  }
}
