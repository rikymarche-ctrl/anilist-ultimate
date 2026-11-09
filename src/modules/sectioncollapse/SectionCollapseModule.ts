/**
 * @file SectionCollapseModule.ts
 * @description Collapsible sections on anime and manga overview pages.
 *
 * Every `h2` in `.overview` gets a small chevron button; its parent element is the
 * section. Collapsing hides everything in the section but the heading. The state is kept
 * per section kind (slug of the heading: "characters", "openings", ...), so a kind
 * collapsed once stays collapsed on every media page and after a reload.
 *
 * AniList reuses `.overview` across SPA navigations and re-renders sections in place, so
 * mounting is idempotent and re-run on PAGE_CHANGED, on `.overview` mutations (shared
 * observer) and by a 1 s mount check. The Watch Order section has its own collapse
 * header and is skipped.
 */

import { injectable, inject } from 'tsyringe';
import { BaseModule } from '@core/modules/BaseModule';
import { TOKENS } from '@core/di/tokens';
import type { IEventBus } from '@core/interfaces/IEventBus';
import type { IConfigManager } from '@core/interfaces/IConfigManager';
import {
  mutationsMatchSelector,
  type SharedGlobalObserver,
} from '@core/observers/SharedGlobalObserver';
import { getMediaRoute } from '@core/navigation/MediaRoute';
import { kindFromLabel, loadCollapsed, saveCollapsed, withKind } from './SectionCollapsePrefs';
import {
  ATTR_CLICKABLE,
  ATTR_COLLAPSED,
  ATTR_HEAD,
  TOGGLE_CLASS,
  ensureSectionCollapseStyles,
  removeSectionCollapseStyles,
} from './SectionCollapseStyles';

export const FEATURE_FLAG = 'sectionCollapse';
const OBSERVER_NAME = 'sectionCollapse';
const MOUNT_CHECK_MS = 1000;
/** Sections with their own collapse control. */
const SKIP_SELECTOR = '.au-watchorder-section';
/**
 * Relations had been collapsed by mistake for some viewers: it is opened once, then collapses
 * and opens like any other section. The marker remembers that the reset ran.
 */
const RELATIONS_RESET_MARKER = 'au-section-collapse-relations-reset';
/** Clicks on these inside a heading keep their own meaning. */
const INTERACTIVE_SELECTOR = `a, button, input, select, textarea, .view-all, .${TOGGLE_CLASS}`;
const ATTR_KIND = 'data-au-sc-kind';

const CHEVRON_SVG =
  '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">' +
  '<path d="M3.5 6l4.5 4.5L12.5 6" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** Set an attribute only when it changes, so our writes don't re-trigger the observer. */
function setAttr(el: Element, name: string, value: string | null): void {
  if (el.getAttribute(name) === value) return;
  if (value === null) el.removeAttribute(name);
  else el.setAttribute(name, value);
}

/** Visible label of a heading: its own text, or its first child's (Threads is a link). */
function headingLabel(heading: HTMLElement): string {
  const own = Array.from(heading.childNodes)
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent ?? '')
    .join(' ')
    .trim();
  if (own) return own;
  const first = Array.from(heading.children).find(
    (child) => !child.classList.contains(TOGGLE_CLASS)
  );
  return first?.textContent?.trim() ?? '';
}

@injectable()
export class SectionCollapseModule extends BaseModule {
  private destroyed = false;
  private mountTimer: number | undefined;
  private collapsed: ReadonlySet<string> = new Set();
  private sequence = 0;
  /** Undo functions of the mounted headings (button + listeners + attributes). */
  private mounted: Array<{ heading: HTMLElement; undo: () => void }> = [];

  constructor(
    @inject(TOKENS.Config) private config: IConfigManager,
    @inject(TOKENS.SharedGlobalObserver) private sharedObserver: SharedGlobalObserver,
    @inject(TOKENS.EventBus) protected eventBus: IEventBus
  ) {
    super(eventBus);
  }

  public getName(): string {
    return 'sectionCollapse';
  }

  public async init(): Promise<void> {
    if (this.destroyed) return;
    this.onPageChange(() => this.restart());
    this.restart();
  }

  public override async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stopObservation();
    this.unmountAll();
    removeSectionCollapseStyles();
    await super.destroy();
  }

  private isActive(): boolean {
    return (
      getMediaRoute(window.location.pathname) !== null && this.config.isFeatureEnabled(FEATURE_FLAG)
    );
  }

  /** Re-read the stored state and (re)start watching, or stop off media pages. */
  private restart(): void {
    if (this.destroyed) return;
    this.stopObservation();
    this.pruneDetached();
    if (!this.isActive()) return;
    this.collapsed = openRelationsOnce(loadCollapsed());
    this.process();
    this.mountTimer = window.setInterval(() => this.process(), MOUNT_CHECK_MS);
    this.sharedObserver.register(
      OBSERVER_NAME,
      () => this.process(),
      undefined,
      mutationsMatchSelector('.overview')
    );
  }

  private stopObservation(): void {
    this.sharedObserver.unregister(OBSERVER_NAME);
    window.clearInterval(this.mountTimer);
    this.mountTimer = undefined;
  }

  /** Mount every heading missing its chevron and apply the state to all of them. */
  private process(): void {
    if (this.destroyed) return;
    const overview = document.querySelector<HTMLElement>('.overview');
    if (!overview) return;
    ensureSectionCollapseStyles();
    overview.querySelectorAll<HTMLElement>('h2').forEach((heading) => {
      const section = heading.parentElement;
      if (!section || section === overview || heading.closest(SKIP_SELECTOR)) return;
      if (!heading.querySelector(`:scope > .${TOGGLE_CLASS}`)) this.mount(heading, section);
      this.apply(heading);
    });
  }

  private mount(heading: HTMLElement, section: HTMLElement): void {
    const label = headingLabel(heading);
    const kind = kindFromLabel(label);
    if (!kind) return;
    this.pruneDetached();
    if (!section.id) section.id = `au-sc-section-${++this.sequence}`;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = TOGGLE_CLASS;
    button.setAttribute('aria-controls', section.id);
    button.dataset.label = label;
    button.innerHTML = CHEVRON_SVG;
    const onButton = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      this.toggle(kind);
    };
    button.addEventListener('click', onButton);

    // AniList's "link" headings open the matching tab: only the chevron toggles those.
    const headingToggles = !heading.classList.contains('link') && !heading.querySelector('a');
    const onHeading = (event: MouseEvent) => {
      if ((event.target as Element | null)?.closest(INTERACTIVE_SELECTOR)) return;
      this.toggle(kind);
    };
    if (headingToggles) {
      heading.addEventListener('click', onHeading);
      heading.setAttribute(ATTR_CLICKABLE, '');
    }

    heading.setAttribute(ATTR_HEAD, '');
    heading.setAttribute(ATTR_KIND, kind);
    heading.prepend(button);

    this.mounted.push({
      heading,
      undo: () => {
        button.removeEventListener('click', onButton);
        heading.removeEventListener('click', onHeading);
        button.remove();
        [ATTR_HEAD, ATTR_KIND, ATTR_CLICKABLE].forEach((name) => heading.removeAttribute(name));
        section.removeAttribute(ATTR_COLLAPSED);
        if (section.id.startsWith('au-sc-section-')) section.removeAttribute('id');
      },
    });
  }

  /** Reflect the stored state of the heading's kind on its section and button. */
  private apply(heading: HTMLElement): void {
    const kind = heading.getAttribute(ATTR_KIND);
    const section = heading.parentElement;
    const button = heading.querySelector<HTMLButtonElement>(`:scope > .${TOGGLE_CLASS}`);
    if (!kind || !section || !button) return;
    const isCollapsed = this.collapsed.has(kind);
    setAttr(section, ATTR_COLLAPSED, isCollapsed ? '' : null);
    setAttr(button, 'aria-expanded', String(!isCollapsed));
    const label = button.dataset.label ?? kind;
    setAttr(button, 'aria-label', `${isCollapsed ? 'Expand' : 'Collapse'} ${label}`);
    setAttr(button, 'title', isCollapsed ? 'Expand' : 'Collapse');
  }

  private toggle(kind: string): void {
    if (this.destroyed) return;
    this.collapsed = withKind(this.collapsed, kind, !this.collapsed.has(kind));
    saveCollapsed(this.collapsed);
    document
      .querySelectorAll<HTMLElement>(`.overview [${ATTR_KIND}="${kind}"]`)
      .forEach((heading) => this.apply(heading));
  }

  /** Drop undo functions of headings AniList already removed from the page. */
  private pruneDetached(): void {
    this.mounted = this.mounted.filter(({ heading }) => heading.isConnected);
  }

  private unmountAll(): void {
    const mounted = this.mounted;
    this.mounted = [];
    mounted.forEach(({ undo }) => undo());
  }
}

/** Opens Relations once (see RELATIONS_RESET_MARKER); later choices are kept as they are. */
function openRelationsOnce(collapsed: ReadonlySet<string>): ReadonlySet<string> {
  try {
    if (window.localStorage.getItem(RELATIONS_RESET_MARKER)) return collapsed;
    window.localStorage.setItem(RELATIONS_RESET_MARKER, '1');
  } catch {
    return collapsed;
  }
  if (!collapsed.has('relations')) return collapsed;
  const next = withKind(collapsed, 'relations', false);
  saveCollapsed(next);
  return next;
}
