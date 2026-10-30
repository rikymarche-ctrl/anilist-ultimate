/**
 * @file UserSocialStatsModule.ts
 * @description Injects follower and following counts into user profile social sections
 */

import { injectable, inject } from 'tsyringe';
import { BaseModule } from '@core/modules/BaseModule';
import { logger } from '@core/logger';
import { TOKENS } from '@core/di/tokens';
import type { IEventBus } from '@core/interfaces/IEventBus';
import { SocialService } from './SocialService';
import { formatTally, type ProfileSocialCounts, type RelationTally } from './ProfileConnections';
import type { ProfileConnectionsService } from './ProfileConnectionsService';

const PROFILE_NAV_LINK_SELECTOR = '.header .nav.container .link';
const SOCIAL_SIDEBAR_SELECTOR = '.user-social .filters';
/** Sidebar entries AniList shows without a count, keyed by their lowercase label. */
const EXTRA_SIDEBAR_COUNTS: Record<string, keyof ProfileSocialCounts> = {
  'mutual followers': 'mutualFollowers',
  'forum threads': 'forumThreads',
  'forum comments': 'forumComments',
  messages: 'messages',
};

interface ProfileRoute {
  username: string;
  isSocialPage: boolean;
  key: string;
}

@injectable()
export class UserSocialStatsModule extends BaseModule {
  private processedUser: string | null = null;

  constructor(
    @inject(TOKENS.SocialService) private socialService: SocialService,
    @inject(TOKENS.EventBus) protected eventBus: IEventBus,
    @inject(TOKENS.ProfileConnectionsService) private connections: ProfileConnectionsService
  ) {
    super(eventBus);
  }

  public async init(): Promise<void> {
    logger.info('[UserSocialStatsModule] Initializing...');

    this.onPageChange(() => {
      void this.injectStats().catch((error: unknown) =>
        logger.error('[UserSocialStatsModule] Stats injection failed', error)
      );
    });

    // Initial check
    void this.injectStats().catch((error: unknown) =>
      logger.error('[UserSocialStatsModule] Stats injection failed', error)
    );
  }

  private async injectStats(): Promise<void> {
    const route = this.currentRoute();
    if (!route) return;

    // Prevent redundant fetches for the same user on the same page
    if (this.processedUser === route.key) return;

    try {
      const user = await this.socialService.getFullUser(route.username);
      // The route may have changed while the profile was loading; never write counts for a stale page.
      if (!user || this.currentRoute()?.key !== route.key) return;

      // A cached profile can resolve before the page renders its navigation or sidebar, so wait for both targets.
      const [nav, sidebar] = await Promise.all([
        this.waitForElement(PROFILE_NAV_LINK_SELECTOR),
        route.isSocialPage ? this.waitForElement(SOCIAL_SIDEBAR_SELECTOR) : null,
      ]);
      if (this.currentRoute()?.key !== route.key) return;

      // 1. Target Social Sidebar (if on social page)
      const sidebarInjected =
        !route.isSocialPage || (sidebar !== null && this.injectIntoSocialSidebar(user));
      // 2. Target Main Profile Navigation (always if on profile)
      const navInjected = nav !== null && this.injectIntoProfileNav(user);

      // Only a complete injection counts as processed; otherwise a later page change may retry it.
      if (navInjected && sidebarInjected) this.processedUser = route.key;
      if (route.isSocialPage && sidebarInjected) await this.injectExtraSidebarCounts(user.id, route.key);
    } catch (error) {
      logger.error(`[UserSocialStatsModule] Failed to inject stats for ${route.username}`, error);
    }
  }

  private currentRoute(): ProfileRoute | null {
    const parts = window.location.pathname.split('/');
    if (parts[1] !== 'user' || !parts[2]) return null;

    const username = parts[2];
    const isSocialPage = parts[3] === 'social' || parts[4] === 'social';
    return { username, isSocialPage, key: `${username}-${isSocialPage}` };
  }

  private injectIntoSocialSidebar(counts: { following: number; followers: number }): boolean {
    const filters = document.querySelector('.user-social .filters');
    if (!filters) return false;

    const found = new Set<string>();
    const items = filters.querySelectorAll('span');
    items.forEach((item) => {
      const text = item.textContent?.trim().toLowerCase();
      if (text === 'following') {
        this.appendCount(item as HTMLElement, counts.following, 'au-sidebar-count');
        found.add('following');
      } else if (text === 'followers') {
        this.appendCount(item as HTMLElement, counts.followers, 'au-sidebar-count');
        found.add('followers');
      }
    });
    return found.has('following') && found.has('followers');
  }

  /** Mutual followers, forum threads/comments and messages; a capped count reads "150+". */
  private async injectExtraSidebarCounts(profileId: number, routeKey: string): Promise<void> {
    let counts: ProfileSocialCounts;
    try {
      counts = await this.connections.getSocialCounts(profileId);
    } catch (error) {
      logger.warn('[UserSocialStatsModule] Extra sidebar counts unavailable', error);
      return;
    }
    if (this.currentRoute()?.key !== routeKey) return;
    document.querySelectorAll<HTMLElement>(`${SOCIAL_SIDEBAR_SELECTOR} span`).forEach((item) => {
      const field = EXTRA_SIDEBAR_COUNTS[this.ownLabel(item)];
      const tally: RelationTally | null | undefined = field ? counts[field] : undefined;
      if (tally) this.appendCount(item, formatTally(tally), 'au-sidebar-count');
    });
  }

  /** The entry's own label, without a count this module appended earlier. */
  private ownLabel(item: HTMLElement): string {
    return [...item.childNodes]
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent ?? '')
      .join('')
      .trim()
      .toLowerCase();
  }

  private injectIntoProfileNav(counts: { following: number; followers: number }): boolean {
    const nav = document.querySelector('.header .nav.container');
    if (!nav) return false;

    let injected = false;
    const links = nav.querySelectorAll('.link');
    links.forEach((link) => {
      const text = link.textContent?.trim().toLowerCase();
      if (text === 'social') {
        const total = counts.following + counts.followers;
        this.appendCount(link as HTMLElement, total, 'au-nav-count');
        injected = true;
      }
    });
    return injected;
  }

  private appendCount(el: HTMLElement, count: number | string, className: string): void {
    if (el.querySelector(`.${className}`)) {
      const existing = el.querySelector(`.${className}`);
      if (existing) existing.textContent = ` (${count})`;
      return;
    }

    const span = document.createElement('span');
    span.className = className;
    span.textContent = ` (${count})`;
    span.style.opacity = '0.7';
    span.style.fontSize = '0.85em';
    span.style.marginLeft = '4px';
    span.style.fontWeight = 'normal';

    el.appendChild(span);
  }

  public getName(): string {
    return 'userSocialStats';
  }

  public override async destroy(): Promise<void> {
    this.processedUser = null;
    await super.destroy();
  }
}
