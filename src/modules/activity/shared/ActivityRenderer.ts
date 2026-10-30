/**
 * @file ActivityRenderer.ts
 * @description Activity visibility filtering and custom-list rendering from native AniList rows
 *
 * Shared between ActivityEnhancerModule and MediaSocialEnhancer.
 * Manages show/hide of native activity DOM entries based on filter type, search query and custom list
 * membership. Custom rows are built from scrubbed native templates (ActivityTemplates.ts) or a skeleton
 * with the same markup, so no extension decoration, duplicate id or router state is ever copied.
 *
 * @see ActivityTemplates.ts for template capture and scrubbing
 * @see ActivityMarkdown.ts for the sanitized text-activity body
 * @see SpaNavigate.ts for in-app navigation
 * @see ActivityFilterBar.ts for the filter UI component
 * @see docs/MODULES.md#3-activity-enhancer-module
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import { cssImageUrl } from '@core/utils/WebUrl';
import type { ILogger } from '@core/interfaces/ILogger';
import type { IApiClient } from '@core/interfaces/IApiClient';
import type { ToastService } from '@core/services/ToastService';
import { interceptInternalLinks, navigateInApp } from '@core/navigation/SpaNavigate';
import { isRecord } from '@/api/GraphQLResponse';
import type { ActivityFilterType, AniListActivity } from '../ActivityUtils';
import { getActivityType, getTimeAgo } from '../ActivityUtils';
import { parseFeedActivity } from '../ActivityResponse';
import { ActivityTemplateCache, type ActivityTemplateKind } from './ActivityTemplates';
import { activateMarkdownInteractions, renderActivityMarkdown } from './ActivityMarkdown';

/**
 * Native feed rows only. Custom-list clones carry au-custom-activity and must
 * never be hidden, shown or filtered by the native-row passes.
 */
export const NATIVE_ACTIVITY_SELECTOR = [
  '.activity-feed > .activity-entry',
  '.activities > .activity-entry',
  '.activity-entry',
  '.activity-anime',
  '.activity-manga',
  '.activity-text',
]
  .map((part) => `${part}:not(.au-custom-activity)`)
  .join(', ');

const CUSTOM_CLASS = 'au-custom-activity';
const TYPE_CLASSES = [
  'activity-text',
  'activity-anime_list',
  'activity-manga_list',
  'activity-anime',
  'activity-manga',
];
const LOGIN_REQUIRED_MESSAGE =
  'Connect your AniList account in AniList Ultimate (extension popup) to like posts in custom feeds.';
const LIKE_FAILED_MESSAGE = 'Could not update the like. Try again.';

export const TOGGLE_LIKE_MUTATION =
  'mutation ($id: Int) { ToggleLikeV2(id: $id, type: ACTIVITY) { ... on ListActivity { id isLiked likeCount } ... on TextActivity { id isLiked likeCount } } }';

/** Containers whose delegated listeners are already installed. */
const wiredContainers = new WeakSet<HTMLElement>();

function isActivationKey(event: KeyboardEvent): boolean {
  return event.key === 'Enter' || event.key === ' ';
}

/** Only the server's own confirmation of this activity may overwrite the optimistic like state. */
function readToggleLike(
  response: unknown,
  id: number
): { isLiked: boolean; likeCount: number } | null {
  if (!isRecord(response) || !isRecord(response.ToggleLikeV2)) return null;
  const result = response.ToggleLikeV2;
  if (result.id !== id || typeof result.isLiked !== 'boolean') return null;
  if (
    typeof result.likeCount !== 'number' ||
    !Number.isInteger(result.likeCount) ||
    result.likeCount < 0
  )
    return null;
  return { isLiked: result.isLiked, likeCount: result.likeCount };
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Required slot lookup: a missing slot means the template contract was broken, so the row is skipped. */
function must<T extends HTMLElement = HTMLElement>(root: ParentNode, selector: string): T {
  const node = root.querySelector<T>(selector);
  if (!node) throw new Error(`Activity row is missing ${selector}`);
  return node;
}

/** Creates an element that carries the parent's AniList data-v-* scope so native scoped CSS applies. */
function scoped(parent: Element, tag: string): HTMLElement {
  const el = document.createElement(tag);
  for (const attr of Array.from(parent.attributes)) {
    if (attr.name.startsWith('data-v-')) el.setAttribute(attr.name, attr.value);
  }
  return el;
}

function setOptionalHref(anchor: HTMLElement, href: string | null): void {
  if (href) anchor.setAttribute('href', href);
  else anchor.removeAttribute('href');
}

function mediaPath(media: NonNullable<AniListActivity['media']>): string {
  return `/${media.type.toLowerCase()}/${media.id}/`;
}

function typeClass(activity: AniListActivity): string {
  if (activity.type === 'TEXT') return 'activity-text';
  return activity.type === 'MANGA_LIST' ? 'activity-manga_list' : 'activity-anime_list';
}

export interface RendererOptions {
  /**
   * CSS selector for activity elements
   */
  activitySelector?: string;

  /**
   * Whether to show activity scores
   */
  showScores?: boolean;
}

/**
 * Activity Renderer Component
 * Manages activity visibility, filtering, and custom rendering
 */
@injectable()
export class ActivityRenderer {
  private options: RendererOptions = {
    // BUG FIX: Use a more specific selector to avoid nested matches (especially on profile pages)
    activitySelector: NATIVE_ACTIVITY_SELECTOR,
    showScores: false,
  };

  private readonly templates = new ActivityTemplateCache();

  constructor(
    @inject(TOKENS.Logger) private logger: ILogger,
    @inject(TOKENS.ApiClient) private api: IApiClient,
    @inject(TOKENS.ToastService) private toast: ToastService
  ) {}

  /**
   * Configure renderer options
   */
  configure(options: Partial<RendererOptions>): void {
    this.options = { ...this.options, ...options };
  }

  /**
   * Apply filters to native activities
   */
  applyFilters(
    activeFilters: Set<ActivityFilterType>,
    searchQuery: string = ''
  ): { shown: number; hidden: number } {
    const allActivities = document.querySelectorAll(this.options.activitySelector!);

    // BUG FIX: Filter out nested elements to avoid double-processing or conflicts
    // Keep only elements that don't have a parent which is also an activity
    const activities = Array.from(allActivities).filter((el) => {
      return !Array.from(allActivities).some(
        (potentialParent) => potentialParent !== el && potentialParent.contains(el)
      );
    }) as HTMLElement[];

    this.logger.debug(
      `[ActivityRenderer] Applying filters to ${activities.length} top-level activities`
    );
    this.logger.debug(`[ActivityRenderer] Active filters:`, Array.from(activeFilters));
    this.logger.debug('[ActivityRenderer] Search active:', Boolean(searchQuery));

    let hiddenCount = 0;
    let shownCount = 0;

    activities.forEach((el, index) => {
      const text = el.textContent?.toLowerCase() || '';
      const type = getActivityType(text);
      const typeMatch = activeFilters.has('ALL') || activeFilters.has(type);
      const searchMatch = !searchQuery || text.includes(searchQuery);

      // Detailed logging for first 3 entries
      if (index < 3) {
        this.logger.debug(`[ActivityRenderer] Entry ${index}:`, {
          preview: text.substring(0, 100),
          detectedType: type,
          typeMatch,
          searchMatch,
          willShow: typeMatch && searchMatch,
        });
      }

      if (typeMatch && searchMatch) {
        el.style.display = '';
        el.classList.remove('au-activity-hidden');
        shownCount++;
      } else {
        el.style.display = 'none';
        el.classList.add('au-activity-hidden');
        hiddenCount++;
      }
    });

    this.logger.info(`[ActivityRenderer] Filtered: ${shownCount} shown, ${hiddenCount} hidden`);

    return { shown: shownCount, hidden: hiddenCount };
  }

  /**
   * Hide all native activities
   */
  hideNativeActivities(): void {
    const activities = document.querySelectorAll(this.options.activitySelector!);
    activities.forEach((activity) => {
      (activity as HTMLElement).style.display = 'none';
    });
  }

  /**
   * Show all native activities
   */
  showNativeActivities(): void {
    const activities = document.querySelectorAll(this.options.activitySelector!);
    activities.forEach((activity) => {
      (activity as HTMLElement).style.display = '';
    });
  }

  /**
   * Render custom activities from raw provider rows (or already parsed activities).
   * Invalid rows are skipped; every rendered row is a fresh element built from a scrubbed template.
   */
  renderCustomActivities(rows: readonly unknown[], container: HTMLElement, emptyMessage?: string): void {
    if (!rows || rows.length === 0) {
      this.showEmptyMessage(container, emptyMessage);
      return;
    }
    container.replaceChildren();
    this.appendCustomActivities(rows, container);
  }

  /** Adds rows after the ones already shown (Load More); status placeholders are replaced. */
  appendCustomActivities(rows: readonly unknown[], container: HTMLElement): void {
    this.templates.capture(document);
    container.querySelectorAll(':scope > .au-feed-status').forEach((status) => status.remove());
    this.wireContainer(container);

    let rendered = 0;
    for (const row of rows) {
      let activity: AniListActivity;
      try {
        activity = parseFeedActivity(row);
      } catch {
        this.logger.debug('[ActivityRenderer] Skipped an invalid activity row');
        continue;
      }
      const el = this.buildRow(activity);
      if (el) {
        container.appendChild(el);
        rendered++;
      }
    }

    this.logger.info(`[ActivityRenderer] Rendered ${rendered} custom activities`);
  }

  /** Delegated link and markdown handlers are installed once per container, never per row. */
  private wireContainer(container: HTMLElement): void {
    if (wiredContainers.has(container)) return;
    wiredContainers.add(container);
    interceptInternalLinks(container);
    activateMarkdownInteractions(container);
  }

  private buildRow(activity: AniListActivity): HTMLElement | null {
    const kind: ActivityTemplateKind = activity.type === 'TEXT' ? 'text' : 'list';
    const el = this.templates.create(kind);
    try {
      this.fillRoot(el, activity);
      this.fillIdentity(el, activity);
      this.fillTime(el, activity);
      if (activity.type === 'TEXT') this.fillText(el, activity);
      else this.fillList(el, activity);
      this.wireReplies(el, activity);
      this.wireLikes(el, activity);
      return el;
    } catch (error: unknown) {
      this.logger.error('[ActivityRenderer] Skipped a malformed activity row', error);
      return null;
    }
  }

  private fillRoot(el: HTMLElement, activity: AniListActivity): void {
    el.querySelectorAll('.donors-icon, .plus-icon').forEach((node) => node.remove());
    el.classList.remove(...TYPE_CLASSES);
    el.classList.add('activity-entry', CUSTOM_CLASS, typeClass(activity));
    el.setAttribute('data-activity-id', String(activity.id));
  }

  /** Avatar and name for both row kinds; an unknown owner is shown as text with no profile link. */
  private fillIdentity(el: HTMLElement, activity: AniListActivity): void {
    const user = activity.user;
    const avatar = must<HTMLElement>(el, 'a.avatar');
    const name = must<HTMLElement>(el, 'a.name');
    const profile = user ? `/user/${encodeURIComponent(user.name)}/` : null;
    avatar.style.backgroundImage = cssImageUrl(user?.avatar.medium ?? '');
    name.textContent = user?.name ?? 'Unknown';
    setOptionalHref(avatar, profile);
    setOptionalHref(name, profile);
  }

  /** The stamp links to the post; AniList's native "Direct Link" menu is removed with the template's .time content. */
  private fillTime(el: HTMLElement, activity: AniListActivity): void {
    const time = must(el, '.time');
    const link = scoped(time, 'a');
    link.className = 'au-activity-link';
    link.setAttribute('href', `/activity/${activity.id}`);
    const stamp = scoped(link, 'time');
    const createdAt = new Date(activity.createdAt * 1000);
    stamp.setAttribute('datetime', createdAt.toISOString());
    stamp.title = createdAt.toLocaleString();
    stamp.textContent = getTimeAgo(activity.createdAt);
    link.append(stamp);
    time.replaceChildren(this.timeSpacer(time), link);
  }

  /**
   * Invisible stand-in for the native "…" menu. Its 14px icon sets the height of the
   * .time line box in native rows; without it the stamp sits 3px higher.
   */
  private timeSpacer(time: HTMLElement): HTMLElement {
    const dropdown = scoped(time, 'div');
    dropdown.className = 'extras-dropdown el-dropdown au-time-spacer';
    dropdown.setAttribute('aria-hidden', 'true');
    const trigger = scoped(dropdown, 'span');
    trigger.className = 'el-dropdown-link action';
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('class', 'svg-inline--fa fa-ellipsis-h fa-w-16');
    icon.setAttribute('viewBox', '0 0 512 512');
    trigger.append(icon);
    dropdown.append(trigger);
    return dropdown;
  }

  private fillText(el: HTMLElement, activity: AniListActivity): void {
    const markdown = must(el, '.activity-markdown .markdown');
    markdown.replaceChildren(renderActivityMarkdown(activity.html ?? ''));
  }

  private fillList(el: HTMLElement, activity: AniListActivity): void {
    const media = activity.media;
    const cover = must<HTMLElement>(el, 'a.cover');
    if (media) {
      cover.setAttribute('href', mediaPath(media));
      cover.style.backgroundImage = cssImageUrl(media.coverImage.medium);
      cover.style.display = '';
    } else {
      cover.removeAttribute('href');
      cover.style.display = 'none';
    }

    const status = must(el, '.details .status');
    const label = `${capitalize(activity.status || 'watched')}${activity.progress ? ` ${activity.progress}` : ''}`;
    if (!media) {
      status.textContent = label;
      return;
    }
    const title = scoped(status, 'a');
    title.className = 'title';
    title.setAttribute('href', mediaPath(media));
    title.textContent = media.title.userPreferred || media.title.romaji;
    // AniList writes "Watched episode 4 of X" but "Completed X": "of" only follows a progress.
    status.replaceChildren(
      document.createTextNode(activity.progress ? `${label} of ` : `${label} `),
      title
    );
  }

  /** Replies open the post in-app. The count is rendered only when non-zero, as AniList does. */
  private wireReplies(el: HTMLElement, activity: AniListActivity): void {
    const replies = must<HTMLElement>(el, '.actions .action.replies');
    if (activity.replyCount > 0) {
      const count = scoped(replies, 'span');
      count.className = 'count';
      count.textContent = String(activity.replyCount);
      replies.prepend(count);
    }
    const open = (): void => navigateInApp(`/activity/${activity.id}`);
    replies.setAttribute('role', 'link');
    replies.tabIndex = 0;
    replies.addEventListener('click', open);
    replies.addEventListener('keydown', (event) => {
      if (!isActivationKey(event)) return;
      event.preventDefault();
      open();
    });
  }

  /**
   * Likes toggle through ToggleLikeV2 without retries: a toggle is not idempotent.
   * The optimistic state is replaced by the server's confirmation and rolled back on failure.
   */
  private wireLikes(el: HTMLElement, activity: AniListActivity): void {
    const button = must<HTMLElement>(el, '.actions .action.likes .like-wrap .button');
    must<HTMLElement>(el, '.like-wrap .users').hidden = true;

    let liked = activity.isLiked === true;
    let likeCount = activity.likeCount;
    let pending = false;

    const render = (): void => {
      button.querySelector(':scope > .count')?.remove();
      if (likeCount > 0) {
        const count = scoped(button, 'span');
        count.className = 'count';
        count.textContent = String(likeCount);
        button.prepend(count);
      }
      button.classList.toggle('liked', liked);
      button.setAttribute('aria-pressed', String(liked));
    };

    const toggle = async (): Promise<void> => {
      if (!this.api.isAuthenticated()) {
        this.toast.info(LOGIN_REQUIRED_MESSAGE);
        return;
      }
      if (pending) return;

      const previous = { liked, likeCount };
      pending = true;
      liked = !liked;
      likeCount = Math.max(0, likeCount + (liked ? 1 : -1));
      render();
      try {
        const server = readToggleLike(
          await this.api.mutateOnce<unknown>(TOGGLE_LIKE_MUTATION, { id: activity.id }),
          activity.id
        );
        if (!server) throw new Error('Invalid ToggleLikeV2 response');
        liked = server.isLiked;
        likeCount = server.likeCount;
        render();
      } catch (error: unknown) {
        liked = previous.liked;
        likeCount = previous.likeCount;
        render();
        this.logger.error('[ActivityRenderer] Like toggle failed', error);
        this.toast.error(LIKE_FAILED_MESSAGE);
      } finally {
        pending = false;
      }
    };

    button.setAttribute('role', 'button');
    button.tabIndex = 0;
    render();
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      void toggle();
    });
    button.addEventListener('keydown', (event) => {
      if (!isActivationKey(event)) return;
      event.preventDefault();
      event.stopPropagation();
      void toggle();
    });
  }

  /**
   * Show empty state message
   */
  showEmptyMessage(
    container: HTMLElement,
    message = 'No activities found for the users in this list.'
  ): void {
    const status = document.createElement('div');
    status.className = 'au-feed-status';
    status.style.cssText =
      'margin-bottom:20px; text-align:center; padding:40px; font-size:1.4rem; color:var(--color-text-lighter); background:var(--color-foreground); border-radius:3px;';
    status.textContent = message;
    container.replaceChildren(status);
  }

  /** A failed request is not a confirmed empty feed. Retry controls belong to this DOM. */
  showErrorMessage(container: HTMLElement, retry: () => void): void {
    container.innerHTML =
      '<div class="au-feed-status" style="margin-bottom:20px; text-align:center; padding:40px; color:var(--color-text-lighter); background:var(--color-foreground); border-radius:3px;">Activities could not be loaded. <button type="button">Try again</button></div>';
    const button = container.querySelector<HTMLButtonElement>('button')!;
    button.addEventListener('click', () => {
      if (!container.isConnected || !container.contains(button) || button.disabled) return;
      button.disabled = true;
      retry();
    });
  }

  /**
   * Show loading spinner
   */
  showLoader(container: HTMLElement): void {
    container.innerHTML = `
      <div class="au-feed-status" style="margin-bottom:20px; display: flex; justify-content: center; align-items: center; padding: 60px; font-size: 1.5rem; color: var(--color-text-lighter); background: var(--color-foreground); border-radius: 3px;">
        <i class="fa-solid fa-spinner fa-spin" style="margin-right: 12px;"></i>
        Loading custom list activities...
      </div>
    `;
  }

  /**
   * Clear container
   */
  clear(container: HTMLElement): void {
    container.innerHTML = '';
  }
}
