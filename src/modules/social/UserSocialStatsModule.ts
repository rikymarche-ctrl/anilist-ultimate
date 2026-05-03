/**
 * @file UserSocialStatsModule.ts
 * @description Injects follower and following counts into user profile social sections
 */

import { injectable, inject } from 'tsyringe';
import { BaseModule } from '@core/modules/BaseModule';
import { log } from '@core/logger';
import { TOKENS } from '@core/di/tokens';
import type { IEventBus } from '@core/interfaces/IEventBus';
import { SocialService } from './SocialService';
import { SharedGlobalObserver } from '@core/observers/SharedGlobalObserver';

@injectable()
export class UserSocialStatsModule extends BaseModule {
  constructor(
    @inject(TOKENS.SocialService) private socialService: SocialService,
    @inject(TOKENS.SharedGlobalObserver) private sharedObserver: SharedGlobalObserver,
    @inject(TOKENS.EventBus) protected eventBus: IEventBus
  ) {
    super(eventBus);
  }

  public async init(): Promise<void> {
    log.info('[UserSocialStatsModule] Initializing...');

    this.onPageChange(() => {
      this.injectStats();
    });

    this.sharedObserver.register('social-stats', () => {
      this.injectStats();
    });

    // Initial check
    this.injectStats();
  }

  private async injectStats(): Promise<void> {
    const parts = window.location.pathname.split('/');
    const isSocialPage = parts[3] === 'social' || parts[4] === 'social';
    const isProfilePage = parts[1] === 'user' && parts[2];
    
    if (!isProfilePage) return;

    const username = parts[2];
    const user = await this.socialService.getFullUser(username);
    if (!user) return;

    // 1. Target Social Sidebar (if on social page)
    if (isSocialPage) {
      this.injectIntoSocialSidebar(user);
    }

    // 2. Target Main Profile Navigation (always if on profile)
    this.injectIntoProfileNav(user);
  }

  private injectIntoSocialSidebar(counts: { following: number, followers: number }): void {
    const filters = document.querySelector('.user-social .filters');
    if (!filters) return;

    const items = filters.querySelectorAll('span');
    items.forEach(item => {
      const text = item.textContent?.trim().toLowerCase();
      if (text === 'following') {
        this.appendCount(item as HTMLElement, counts.following, 'au-sidebar-count');
      } else if (text === 'followers') {
        this.appendCount(item as HTMLElement, counts.followers, 'au-sidebar-count');
      }
    });
  }

  private injectIntoProfileNav(counts: { following: number, followers: number }): void {
    const nav = document.querySelector('.header .nav.container');
    if (!nav) return;

    const links = nav.querySelectorAll('.link');
    links.forEach(link => {
      const text = link.textContent?.trim().toLowerCase();
      if (text === 'social') {
        const total = counts.following + counts.followers;
        this.appendCount(link as HTMLElement, total, 'au-nav-count');
      }
    });
  }

  private appendCount(el: HTMLElement, count: number, className: string): void {
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
    this.sharedObserver.unregister('social-stats');
    await super.destroy();
  }
}
