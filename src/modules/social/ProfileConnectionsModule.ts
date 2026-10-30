/**
 * @file ProfileConnectionsModule.ts
 * @description "3 followers in common, 1 following (1 in Best Friends)" under another user's profile name.
 *
 * The line is absolutely positioned inside the banner's name block, so it never moves
 * the profile layout. Each count opens a native-looking dropdown with the people behind
 * it. A navigation token guards every await: a response for a profile the viewer has
 * left never renders, and AniList reusing the header between profiles is detected by
 * comparing the rendered name with the route.
 */

import { inject, injectable } from 'tsyringe';
import { BaseModule } from '@core/modules/BaseModule';
import { TOKENS } from '@core/di/tokens';
import { EVENT_TYPES } from '@core/events/EventTypes';
import type { IApiClient } from '@core/interfaces/IApiClient';
import type { IEventBus } from '@core/interfaces/IEventBus';
import { logger } from '@core/logger';
import { navigateInApp } from '@core/navigation/SpaNavigate';
import { parseWebUrl } from '@core/utils/WebUrl';
import type { CustomListClient } from './CustomListClient';
import {
  followersLabel,
  followingLabel,
  isEmptyConnections,
  listLabel,
  type ProfileConnections,
  type SocialUser,
} from './ProfileConnections';
import type { ProfileConnectionsService } from './ProfileConnectionsService';
import '../../styles/profile-connections.css';

const NAME_WRAPPER_SELECTOR = '.header-wrap .banner-content .name-wrapper';
const LINE_CLASS = 'au-profile-connections';
const POPOVER_CLASS = 'au-profile-connections-dropdown';
const OBSERVER_NAME = 'profile-connections-header';
const HEADER_WAIT_MS = 10_000;
const HEADER_POLL_MS = 150;
/** Lists longer than this get a search box. */
const SEARCH_THRESHOLD = 12;
const POPOVER_GAP_PX = 10;
const VIEWPORT_GUTTER_PX = 16;

interface ConnectionSection {
  key: string;
  label: string;
  title: string;
  users: SocialUser[];
}

/** The profile name in `/user/<name>/...`, or null on any other page. */
export function profileNameFromPath(path: string): string | null {
  const parts = path.split('/');
  if (parts[1] !== 'user' || !parts[2]) return null;
  try {
    return decodeURIComponent(parts[2]);
  } catch {
    return null;
  }
}

@injectable()
export class ProfileConnectionsModule extends BaseModule {
  /** Bumped on every navigation, auth or list change; stale work compares and stops. */
  private token = 0;
  private line: HTMLElement | null = null;
  private popover: HTMLElement | null = null;
  private popoverAbort: AbortController | null = null;
  private listUnsubscribe: (() => void) | null = null;
  private current: { name: string; connections: ProfileConnections } | null = null;

  constructor(
    @inject(TOKENS.ApiClient) private api: IApiClient,
    @inject(TOKENS.ProfileConnectionsService) private service: ProfileConnectionsService,
    @inject(TOKENS.CustomListService) private lists: CustomListClient,
    @inject(TOKENS.EventBus) protected eventBus: IEventBus
  ) {
    super(eventBus);
  }

  public async init(): Promise<void> {
    this.onPageChange(() => this.refresh());
    this.subscribe(EVENT_TYPES.AUTH_STATE_CHANGED, () => {
      this.service.clear();
      this.refresh();
    });
    this.listUnsubscribe = this.lists.onChange(() => this.refresh());
    await this.render(this.startRun());
  }

  public getName(): string {
    return 'profileConnections';
  }

  public override async destroy(): Promise<void> {
    this.token++;
    this.listUnsubscribe?.();
    this.listUnsubscribe = null;
    this.removeLine();
    await super.destroy();
  }

  private refresh(): void {
    void this.render(this.startRun()).catch((error: unknown) =>
      logger.error('[ProfileConnectionsModule] Render failed', error)
    );
  }

  /** Invalidates in-flight work and clears what the previous page showed. */
  private startRun(): number {
    this.removeLine();
    this.cleanup();
    return ++this.token;
  }

  private isStale(token: number, name: string): boolean {
    return (
      token !== this.token ||
      profileNameFromPath(location.pathname)?.toLowerCase() !== name.toLowerCase()
    );
  }

  private async render(token: number): Promise<void> {
    const name = profileNameFromPath(location.pathname);
    if (!name || !this.api.isAuthenticated()) return;
    let connections: ProfileConnections | null;
    try {
      connections = await this.service.getConnections(name);
    } catch (error) {
      if (!this.isStale(token, name))
        logger.warn('[ProfileConnectionsModule] Connections unavailable', error);
      return;
    }
    if (this.isStale(token, name) || !connections || isEmptyConnections(connections)) return;
    const wrapper = await this.waitForHeader(name, token);
    if (!wrapper || this.isStale(token, name)) return;
    this.current = { name, connections };
    this.mount(wrapper);
    const banner = wrapper.closest('.banner-content');
    if (banner)
      this.registerObserver(
        OBSERVER_NAME,
        banner,
        { childList: true, subtree: true, characterData: true },
        () => this.keepMounted(token)
      );
  }

  /** The name block once it shows this profile; AniList keeps the old header while the next one loads. */
  private async waitForHeader(name: string, token: number): Promise<HTMLElement | null> {
    const deadline = Date.now() + HEADER_WAIT_MS;
    while (!this.isStale(token, name) && Date.now() < deadline) {
      const wrapper = document.querySelector<HTMLElement>(NAME_WRAPPER_SELECTOR);
      if (wrapper && this.headerShows(wrapper, name)) return wrapper;
      await new Promise((resolve) => window.setTimeout(resolve, HEADER_POLL_MS));
    }
    return null;
  }

  private headerShows(wrapper: HTMLElement, name: string): boolean {
    return wrapper.querySelector('.name')?.textContent?.trim().toLowerCase() === name.toLowerCase();
  }

  /** Vue may re-render the name block; put the line back, or drop it if the header changed profile. */
  private keepMounted(token: number): void {
    if (!this.current || this.isStale(token, this.current.name)) return;
    const wrapper = document.querySelector<HTMLElement>(NAME_WRAPPER_SELECTOR);
    if (!wrapper || !this.headerShows(wrapper, this.current.name)) {
      this.removeLine();
      return;
    }
    if (this.line?.parentElement !== wrapper) this.mount(wrapper);
  }

  private sections(connections: ProfileConnections): ConnectionSection[] {
    const sections: ConnectionSection[] = [];
    if (connections.followers.users.length > 0)
      sections.push({
        key: 'followers',
        label: followersLabel(connections.followers),
        title: 'Followers in common',
        users: connections.followers.users,
      });
    if (connections.following.users.length > 0)
      sections.push({
        key: 'following',
        label: followingLabel(connections.following),
        title: 'Following you also follow',
        users: connections.following.users,
      });
    return sections;
  }

  private mount(wrapper: HTMLElement): void {
    if (!this.current) return;
    this.removeLine(false);
    const { connections } = this.current;
    const line = document.createElement('div');
    line.className = LINE_CLASS;
    this.sections(connections).forEach((section, index) => {
      if (index > 0) line.append(', ');
      line.append(this.trigger(section, connections));
    });
    if (connections.lists.length > 0) {
      line.append(' (');
      connections.lists.forEach((list, index) => {
        if (index > 0) line.append(', ');
        line.append(
          this.trigger(
            {
              key: `list:${list.name}`,
              label: listLabel(list),
              title: list.name,
              users: list.users,
            },
            connections
          )
        );
      });
      line.append(')');
    }
    wrapper.append(line);
    this.line = line;
  }

  private trigger(section: ConnectionSection, connections: ProfileConnections): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'au-profile-connections-count';
    button.textContent = section.label;
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-expanded', 'false');
    button.dataset.section = section.key;
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const open = this.popover?.dataset.section === section.key;
      this.closePopover();
      if (!open) this.openPopover(button, section, connections);
    });
    return button;
  }

  private openPopover(
    anchor: HTMLButtonElement,
    section: ConnectionSection,
    connections: ProfileConnections
  ): void {
    const popover = document.createElement('div');
    popover.className = POPOVER_CLASS;
    popover.dataset.section = section.key;
    popover.setAttribute('role', 'dialog');
    popover.setAttribute('aria-label', section.title);
    const title = document.createElement('div');
    title.className = 'au-profile-connections-title';
    title.textContent = `${section.title} · ${section.users.length}`;
    const list = document.createElement('div');
    list.className = 'au-profile-connections-users';
    const search = section.users.length > SEARCH_THRESHOLD ? this.searchBox(list) : null;
    for (const user of section.users)
      list.append(
        this.userRow(
          user,
          section.key.startsWith('list:')
            ? []
            : connections.lists
                .filter((entry) => entry.users.some((member) => member.id === user.id))
                .map((entry) => entry.name)
        )
      );
    popover.append(title);
    if (search) popover.append(search);
    popover.append(list);
    document.body.append(popover);
    this.position(popover, anchor);
    anchor.setAttribute('aria-expanded', 'true');
    this.popover = popover;

    const abort = new AbortController();
    this.popoverAbort = abort;
    const close = () => {
      this.closePopover();
      anchor.focus();
    };
    document.addEventListener(
      'click',
      (event) => {
        if (!popover.contains(event.target as Node)) this.closePopover();
      },
      { signal: abort.signal }
    );
    document.addEventListener(
      'keydown',
      (event) => {
        if (event.key === 'Escape') close();
      },
      { signal: abort.signal }
    );
    window.addEventListener('resize', () => this.position(popover, anchor), {
      signal: abort.signal,
    });
  }

  /** Filters the rows by name; long lists only, short ones fit without it. */
  private searchBox(list: HTMLElement): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'search';
    input.className = 'au-profile-connections-search';
    input.placeholder = 'Search';
    input.setAttribute('aria-label', 'Search users');
    input.addEventListener('input', () => {
      const query = input.value.trim().toLowerCase();
      list.querySelectorAll<HTMLElement>('.au-profile-connections-user').forEach((row) => {
        row.hidden = !!query && !(row.dataset.name ?? '').includes(query);
      });
    });
    return input;
  }

  private userRow(user: SocialUser, listNames: string[]): HTMLAnchorElement {
    const path = `/user/${encodeURIComponent(user.name)}/`;
    const row = document.createElement('a');
    row.className = 'au-profile-connections-user';
    row.href = path;
    row.dataset.name = user.name.toLowerCase();
    // Lazy images load only rows scrolled into view, so a 500-person list does not fetch 500 avatars.
    const avatar = document.createElement('img');
    avatar.className = 'au-profile-connections-avatar';
    avatar.alt = '';
    avatar.loading = 'lazy';
    avatar.decoding = 'async';
    const url = parseWebUrl(user.avatar.medium);
    if (url?.protocol === 'https:') avatar.src = url.href;
    const name = document.createElement('span');
    name.className = 'au-profile-connections-name';
    name.textContent = user.name;
    row.append(avatar, name);
    for (const listName of listNames) {
      const chip = document.createElement('span');
      chip.className = 'au-profile-connections-list';
      chip.textContent = listName;
      row.append(chip);
    }
    row.addEventListener('click', (event) => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
        return;
      event.preventDefault();
      this.closePopover();
      navigateInApp(path);
    });
    return row;
  }

  private position(popover: HTMLElement, anchor: HTMLElement): void {
    const rect = anchor.getBoundingClientRect();
    const maxLeft = document.documentElement.clientWidth - popover.offsetWidth - VIEWPORT_GUTTER_PX;
    popover.style.top = `${rect.bottom + window.scrollY + POPOVER_GAP_PX}px`;
    popover.style.left = `${Math.max(VIEWPORT_GUTTER_PX, Math.min(rect.left, maxLeft)) + window.scrollX}px`;
  }

  private closePopover(): void {
    this.popoverAbort?.abort();
    this.popoverAbort = null;
    this.popover?.remove();
    this.popover = null;
    this.line
      ?.querySelectorAll('[aria-expanded="true"]')
      .forEach((button) => button.setAttribute('aria-expanded', 'false'));
  }

  /** Removes the line and its dropdown; `forget` also drops the data it showed. */
  private removeLine(forget = true): void {
    this.closePopover();
    this.line?.remove();
    this.line = null;
    if (forget) this.current = null;
  }
}
