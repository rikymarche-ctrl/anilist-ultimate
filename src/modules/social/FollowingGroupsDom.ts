import { html } from '@core/utils/Template';
import { cssImageUrl } from '@core/utils/WebUrl';
import { getStatusLabel } from '@core/utils/UIHelpers';
import { ScoreFormatter } from '@core/utils/ScoreFormatter';
import type { ScoreFormat } from '@core/types';
import type { FollowingMediaEntry } from './FollowingMediaReader';

export const HIDDEN_CLASS = 'au-following-group-hidden';
export const CLONE_CLASS = 'au-following-clone';
const GAP_VAR = '--au-fg-gap';
const DEFAULT_GAP = 10;

export interface GroupHeader {
  element: HTMLElement;
  toggle: HTMLButtonElement;
  label: HTMLElement;
  count: HTMLElement;
}

// Writes happen only when the value differs. The observer sees our own edits, so an unchanged DOM must
// produce zero mutations on the next scan.
export function setClass(element: Element, name: string, on: boolean): void {
  if (element.classList.contains(name) !== on) element.classList.toggle(name, on);
}
export function setText(element: Element, text: string): void {
  if (element.textContent !== text) element.textContent = text;
}
export function setOrder(element: HTMLElement, order: string): void {
  if (element.style.order !== order) element.style.order = order;
}

/** Header spacing matches row spacing: the first row's bottom margin, else the column gap, else 10px. */
export function syncGapVar(parent: HTMLElement, sample: HTMLElement | undefined): void {
  const margin = sample ? parseFloat(getComputedStyle(sample).marginBottom) : NaN;
  const style = getComputedStyle(parent);
  const gap =
    margin > 0 ? margin : parseFloat(style.rowGap) || parseFloat(style.gap) || DEFAULT_GAP;
  const value = `${gap}px`;
  if (parent.style.getPropertyValue(GAP_VAR) !== value) parent.style.setProperty(GAP_VAR, value);
}
export function clearGapVar(parent: HTMLElement): void {
  if (parent.style.getPropertyValue(GAP_VAR) !== '') parent.style.removeProperty(GAP_VAR);
}

export function createHeader(name: string | null, onToggle: () => void): GroupHeader {
  const element = html`<div class="au-following-group-header">
    <button type="button" class="au-following-group-toggle">
      <span class="au-following-group-label"></span><span class="au-following-group-count"></span
      ><span class="au-following-group-chevron" aria-hidden="true"></span>
    </button>
  </div>`;
  if (name === null) element.dataset.auOthers = '';
  else element.dataset.auGroup = name;
  const toggle = element.querySelector<HTMLButtonElement>('.au-following-group-toggle')!;
  toggle.setAttribute('aria-expanded', 'true');
  toggle.addEventListener('click', onToggle);
  return {
    element,
    toggle,
    label: element.querySelector<HTMLElement>('.au-following-group-label')!,
    count: element.querySelector<HTMLElement>('.au-following-group-count')!,
  };
}

/**
 * Clones a native row for a group member the Overview did not render. cloneNode keeps AniList's scoped
 * data-v attributes, so the clone takes the same styling. Our badges, bubbles and ids are stripped.
 */
export function createClone(
  template: HTMLElement,
  entry: FollowingMediaEntry,
  scoreFormat: ScoreFormat,
  mediaType: string
): HTMLElement {
  const clone = template.cloneNode(true) as HTMLElement;
  clone.removeAttribute('id');
  clone.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
  clone.classList.remove('au-following-row', HIDDEN_CLASS);
  clone.classList.add(CLONE_CLASS);
  clone.style.removeProperty('order');
  clone
    .querySelectorAll('.au-following-progress, .comment-icon-ghost')
    .forEach((node) => node.remove());
  clone.querySelectorAll('.hover-icon').forEach((node) => {
    if (node.querySelector('svg[data-icon="comment"]')) node.remove();
  });
  const href = `/user/${encodeURIComponent(entry.name)}/`;
  const links = clone.matches('a[href*="/user/"]')
    ? [clone]
    : [...clone.querySelectorAll('a[href*="/user/"]')];
  links.forEach((link) => link.setAttribute('href', href));
  const nameNode = clone.querySelector('.name');
  if (nameNode) nameNode.textContent = entry.name;
  const avatar = clone.querySelector<HTMLElement>('.avatar');
  if (avatar instanceof HTMLImageElement) {
    if (entry.avatar) avatar.src = entry.avatar;
  } else if (avatar) {
    avatar.style.backgroundImage = cssImageUrl(entry.avatar);
  }
  const status = clone.querySelector('.status');
  if (status) status.textContent = getStatusLabel(entry.status, mediaType);
  const score = clone.querySelector('.score');
  const text = entry.score === null ? '' : ScoreFormatter.format(entry.score, scoreFormat);
  if (score && text) score.textContent = text;
  else score?.remove();
  return clone;
}
