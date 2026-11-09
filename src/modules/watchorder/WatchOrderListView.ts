/**
 * @file WatchOrderListView.ts
 * @description Timeline rendering of the Story, Release and Curated orders: a rail of numbered
 * stops (checked once watched), cover thumbnails, progress and relation badges. All AniList and
 * curated text goes through textContent.
 */

import {
  describeProgress,
  entryMeta,
  isEntryComplete,
  type WatchEntry,
  type WatchNode,
} from './WatchOrderGraph';
import { isRowWatched, type CuratedResult, type CuratedRow } from './CuratedOrderMatch';
import { KIND_COLOR, KIND_LABEL, icon, type TitleKind } from './WatchOrderTheme';

export interface ListOptions {
  currentId: number;
  nextId: number | null;
  /** Story order flags branch placement as estimated; release order does not. */
  estimated: boolean;
  /** Main line or branch relation of each title (see titleKinds). */
  kinds: ReadonlyMap<number, TitleKind>;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text = ''
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function cover(node: WatchNode | null): HTMLElement {
  if (!node?.cover) {
    const blank = el('span', 'au-wo-cover');
    blank.setAttribute('aria-hidden', 'true');
    return blank;
  }
  const image = el('img', 'au-wo-cover');
  image.src = node.cover;
  image.alt = '';
  image.loading = 'lazy';
  image.decoding = 'async';
  return image;
}

function marker(watched: boolean, number: number | null): HTMLElement {
  const dot = el('span', 'au-wo-marker');
  dot.setAttribute('aria-hidden', 'true');
  if (watched) dot.append(icon('check'));
  else if (number !== null) dot.append(el('span', 'au-wo-marker-num', String(number)));
  return dot;
}

function badge(
  text: string,
  variant: 'kind' | 'next' | 'here' | 'plain',
  color?: string,
  title?: string
): HTMLElement {
  const element = el(
    'span',
    `au-wo-badge${variant === 'plain' ? '' : ` au-wo-badge--${variant}`}`,
    text
  );
  if (color) element.style.setProperty('--wo-kind', color);
  if (title) element.title = title;
  return element;
}

function progressBar(node: WatchNode): HTMLElement | null {
  if (!describeProgress(node) || !node.episodes) return null;
  const track = el('span', 'au-wo-row-bar');
  const fill = el('span', '');
  fill.style.width = `${Math.min(100, (node.progress / node.episodes) * 100)}%`;
  track.append(fill);
  return track;
}

/** Same shape for every row: rail stop, cover, title + meta, badges. */
function row(
  node: WatchNode | null,
  title: string,
  meta: string,
  state: {
    watched: boolean;
    current: boolean;
    next: boolean;
    branch: boolean;
    number: number | null;
  },
  badges: HTMLElement[]
): HTMLElement {
  const element = node ? el('a', 'au-wo-row') : el('div', 'au-wo-row');
  if (element instanceof HTMLAnchorElement && node) element.href = `/anime/${node.id}`;
  const progress = node && !state.watched ? progressBar(node) : null;
  element.classList.toggle('is-watched', state.watched);
  element.classList.toggle('is-current', state.current);
  element.classList.toggle('is-next', state.next && !state.watched);
  element.classList.toggle('is-branch', state.branch);
  element.classList.toggle('is-progress', !!progress);
  if (state.current) element.setAttribute('aria-current', 'page');

  const text = el('span', 'au-wo-row-text');
  text.append(el('span', 'au-wo-row-title', title));
  const metaLine = el('span', 'au-wo-row-meta', meta);
  text.append(metaLine);
  if (progress) text.append(progress);
  const badgeBox = el('span', 'au-wo-badges');
  badgeBox.append(...badges);
  element.append(marker(state.watched, state.number), cover(node), text, badgeBox);
  return element;
}

/** Story or release order as a timeline. Main-line stops are numbered; branches hang off the rail. */
export function buildOrderList(entries: readonly WatchEntry[], options: ListOptions): HTMLElement {
  const list = el('div', 'au-wo-list');
  list.setAttribute('role', 'list');
  if (!entries.length) {
    list.append(el('div', 'au-wo-empty', 'Nothing left to show with these filters.'));
    return list;
  }
  let number = 0;
  for (const entry of entries) {
    const { node } = entry;
    const kind = options.kinds.get(node.id) ?? 'MAIN';
    const branch = kind !== 'MAIN';
    if (!branch) number++;
    const badges: HTMLElement[] = [];
    if (branch) {
      badges.push(
        badge(
          KIND_LABEL[kind],
          'kind',
          KIND_COLOR[kind],
          options.estimated
            ? 'Placement estimated: shown after the series it branches from.'
            : undefined
        )
      );
    }
    const item = row(
      node,
      node.title,
      entryMeta(node, true),
      {
        watched: isEntryComplete(node),
        current: node.id === options.currentId,
        next: node.id === options.nextId,
        branch,
        number: branch ? null : number,
      },
      badges
    );
    item.setAttribute('role', 'listitem');
    if (branch) item.style.setProperty('--wo-kind', KIND_COLOR[kind]);
    list.append(item);
  }
  return list;
}

const KIND_NAMES: Record<string, string> = {
  movie: 'Movie',
  ona: 'ONA',
  ova: 'OVA',
  special: 'Special',
  tv: 'TV',
};

function curatedMeta(row: CuratedRow): string {
  const { entry } = row;
  const range = (from: number, to: number, noun: string) =>
    from === to ? `${noun} ${from}` : `${noun}s ${from}–${to}`;
  return [
    entry.kind ? KIND_NAMES[entry.kind] : null,
    entry.episodes ? range(entry.episodes.from, entry.episodes.to, 'Episode') : null,
    entry.parts ? range(entry.parts.from, entry.parts.to, 'Part') : null,
    row.airDate ? `aired ${row.airDate}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Community-curated order: every stop numbered, linked to AniList only when the match is certain. */
export function buildCuratedList(curated: CuratedResult, currentId: number): HTMLElement {
  const wrapper = el('div', '');
  const list = el('div', 'au-wo-list');
  list.setAttribute('role', 'list');
  const next = curated.rows.some((r) => r.node)
    ? curated.rows.find((r) => !isRowWatched(r))
    : undefined;
  curated.rows.forEach((curatedRow, index) => {
    const badges = curatedRow.entry.optional ? [badge('Optional', 'plain')] : [];
    const item = row(
      curatedRow.node,
      curatedRow.entry.title,
      curatedMeta(curatedRow),
      {
        watched: isRowWatched(curatedRow),
        current: curatedRow.node?.id === currentId,
        next: curatedRow === next,
        branch: false,
        number: index + 1,
      },
      badges
    );
    item.setAttribute('role', 'listitem');
    list.append(item);
  });
  wrapper.append(list);
  return wrapper;
}

/** Bring the current title into view inside its scrolling list (not the page). */
export function revealCurrent(container: HTMLElement): void {
  const list = container.querySelector<HTMLElement>('.au-wo-list');
  const current =
    list?.querySelector<HTMLElement>('.is-current') ?? list?.querySelector<HTMLElement>('.is-next');
  if (!list || !current || list.scrollHeight <= list.clientHeight) return;
  list.scrollTop = Math.max(0, current.offsetTop - list.clientHeight / 3);
}
