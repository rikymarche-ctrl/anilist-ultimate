/**
 * @file UserBannerModule.ts
 * @description Injects a custom list management button into the user profile banner
 */

import { injectable, inject } from 'tsyringe';
import { BaseModule } from '@core/modules/BaseModule';
import { logger } from '@core/logger';
import { TOKENS } from '@core/di/tokens';
import type { IEventBus } from '@core/interfaces/IEventBus';
import type { IApiClient } from '@core/interfaces/IApiClient';
import type { SharedGlobalObserver } from '@core/observers/SharedGlobalObserver';
import { EVENT_TYPES } from '@core/events/EventTypes';
import type { CustomListClient } from './CustomListClient';
import type { CustomListUser } from './CustomListService';
import { SocialService } from './SocialService';
import { ToastService } from '@core/services/ToastService';
import { html } from '@core/utils/Template';

@injectable()
export class UserBannerModule extends BaseModule {
  private popover: HTMLElement | null = null;
  private currentUser: CustomListUser | null = null;
  private initialized = false;
  private generation = 0;
  private popoverAbort: AbortController | null = null;
  private buttons = new Set<HTMLElement>();
  private watching = false;
  private listUnsubscribe: (() => void) | null = null;
  private pendingItems = new WeakSet<HTMLElement>();

  constructor(
    @inject(TOKENS.ApiClient) private apiClient: IApiClient,
    @inject(TOKENS.CustomListService) private listService: CustomListClient,
    @inject(TOKENS.SocialService) private socialService: SocialService,
    @inject(TOKENS.SharedGlobalObserver) private sharedObserver: SharedGlobalObserver,
    @inject(TOKENS.ToastService) private toast: ToastService,
    @inject(TOKENS.EventBus) protected eventBus: IEventBus
  ) {
    super(eventBus);
  }

  public async init(): Promise<void> {
    if (!this.watching) {
      this.watching = true;
      // Watch auth and navigation before the auth guard, so a logged-out start still activates after login.
      this.subscribe(EVENT_TYPES.AUTH_STATE_CHANGED, () => {
        void this.reactivate().catch((error: unknown) =>
          logger.error('[UserBannerModule] Re-activation failed', error)
        );
      });
      this.listUnsubscribe = this.listService.onChange(() => this.handleListsChanged());
      this.onPageChange(() => {
        if (!this.initialized) return;
        this.cleanup();
        this.stopObservation();
        if (this.isOnUserProfilePage()) {
          this.startObservation();
        }
      });
    }
    await this.activate();
  }

  private async activate(): Promise<void> {
    if (this.initialized) return;
    // Auth guard: modulo richiede autenticazione
    if (!this.apiClient.isAuthenticated()) {
      logger.warn('[UserBannerModule] Not authenticated, deferring initialization');
      return;
    }

    logger.info('[UserBannerModule] Initializing...');
    this.initialized = true;
    const generation = this.generation;

    // Load lists data
    try {
      await this.listService.init();
    } catch (error) {
      this.initialized = false;
      throw error;
    }
    if (!this.initialized || generation !== this.generation) return;

    if (this.isOnUserProfilePage()) {
      this.startObservation();
    }
  }

  /** Account switch or login/logout: drop everything tied to the previous state, then set up for the current one. */
  private async reactivate(): Promise<void> {
    this.initialized = false;
    this.stopObservation();
    this.cleanup();
    await this.activate();
  }

  private handleListsChanged(): void {
    if (!this.initialized) return;
    this.buttons.forEach((button) => {
      void this.updateButtonState(button).catch((error: unknown) =>
        logger.error('[UserBannerModule] Button state update failed', error)
      );
    });
    this.syncPopoverItems();
  }

  /** Refresh popover rows from the shared snapshot, leaving rows whose toggle is in flight untouched. */
  private syncPopoverItems(): void {
    if (!this.popover || !this.currentUser) return;
    const userId = this.currentUser.id;
    this.popover.querySelectorAll<HTMLElement>('.au-popover-item').forEach((item) => {
      const listName = item.getAttribute('data-list');
      if (listName === null || this.pendingItems.has(item)) return;
      item.classList.toggle('active', this.listService.isUserInList(listName, userId));
    });
  }

  private isOnUserProfilePage(): boolean {
    return window.location.pathname.startsWith('/user/');
  }

  private startObservation(): void {
    this.sharedObserver.register('user-banner-actions', () => {
      return this.injectButton();
    });
    void this.injectButton().catch((error) =>
      logger.error('[UserBannerModule] Injection failed', error)
    );
  }

  /**
   * The shared observer outlives this module's page-specific DOM. Always
   * unregister it when leaving a profile, otherwise its callback can run on
   * routes such as /anime/:id and mistake the media ID for a username.
   */
  private stopObservation(): void {
    this.sharedObserver.unregister('user-banner-actions');
  }

  private getProfileUsername(): string | null {
    if (!this.isOnUserProfilePage()) return null;

    const username = window.location.pathname.split('/')[2];
    try {
      return username ? decodeURIComponent(username) : null;
    } catch {
      return null;
    }
  }

  private async injectButton(): Promise<void> {
    const username = this.getProfileUsername();
    if (!this.initialized || !username) return;
    const generation = this.generation;

    // Prevention: don't inject on own profile
    const targetUser = await this.socialService.getFullUser(username);
    const viewerId = await this.socialService.getViewerId();

    // Navigation may have happened while the profile request was in flight.
    if (
      !this.initialized ||
      generation !== this.generation ||
      this.getProfileUsername() !== username
    )
      return;

    if (!targetUser || (viewerId && targetUser.id === viewerId)) {
      logger.info('[UserBannerModule] Skipping injection for self or invalid profile');
      return;
    }

    // Target the actions container in the user banner content
    const actions = document.querySelector('.banner-content .actions');
    if (!actions || actions.querySelector('.au-banner-list-btn')) return;

    // Find the follow button container to anchor next to it
    const followBtn = actions.querySelector('.nav-btn');
    if (!followBtn) return;

    const btn = html`
      <div class="nav-btn au-banner-list-btn" data-v-b1e442a6="" title="Manage Custom Lists">
        <span>Add to List</span>
      </div>
    `;

    // Insert after follow button container
    followBtn.parentNode?.insertBefore(btn, followBtn.nextSibling);
    this.buttons.add(btn);
    this.currentUser = {
      id: targetUser.id,
      name: targetUser.name,
      avatar: targetUser.avatar.medium,
    };

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.togglePopover(btn);
    });

    // Update button state if user is already in a list
    void this.updateButtonState(btn).catch((error: unknown) =>
      logger.error('[UserBannerModule] Button state update failed', error)
    );
  }

  private async updateButtonState(btn: HTMLElement): Promise<void> {
    const username = this.getProfileUsername();
    if (!this.initialized || !username || !btn.isConnected) return;
    const generation = this.generation;
    const btnSpan = btn.querySelector('span');
    if (!btnSpan) return;

    if (!this.currentUser || this.currentUser.name !== username) {
      const rawUser = await this.socialService.getFullUser(username);
      if (
        !this.initialized ||
        generation !== this.generation ||
        this.getProfileUsername() !== username ||
        !btn.isConnected
      )
        return;
      if (rawUser) {
        this.currentUser = {
          id: rawUser.id,
          name: rawUser.name,
          avatar: rawUser.avatar.medium,
        };
      }
    }

    if (!this.currentUser) return;

    const lists = this.listService.getLists();
    const isInAnyList = Object.keys(lists).some((listName) =>
      this.listService.isUserInList(listName, this.currentUser!.id)
    );

    if (isInAnyList) {
      btn.classList.add('au-in-list');
      btnSpan.innerText = 'In Lists';
    } else {
      btn.classList.remove('au-in-list');
      btnSpan.innerText = 'Add to List';
    }
  }

  private togglePopover(anchor: HTMLElement): void {
    if (this.popover) {
      this.destroyPopover();
      return;
    }

    void this.renderPopover(anchor).catch((error) =>
      logger.error('[UserBannerModule] Popover failed', error)
    );
  }

  private async renderPopover(anchor: HTMLElement): Promise<void> {
    const username = this.getProfileUsername();
    if (!this.initialized || !username || !anchor.isConnected) return;
    const generation = this.generation;
    if (!this.currentUser || this.currentUser.name !== username) {
      const rawUser = await this.socialService.getFullUser(username);
      if (
        !this.initialized ||
        generation !== this.generation ||
        this.getProfileUsername() !== username ||
        !anchor.isConnected
      )
        return;
      if (rawUser) {
        this.currentUser = {
          id: rawUser.id,
          name: rawUser.name,
          avatar: rawUser.avatar.medium,
        };
      }
    }

    if (
      !this.initialized ||
      generation !== this.generation ||
      this.getProfileUsername() !== username ||
      !anchor.isConnected ||
      this.popover
    )
      return;
    if (!this.currentUser) {
      this.toast.error('Could not fetch user details');
      return;
    }

    this.popover = document.createElement('div');
    this.popover.className = 'au-banner-popover';
    const popover = this.popover;
    const user = { ...this.currentUser };
    this.popoverAbort = new AbortController();

    const lists = this.listService.getLists();
    const listNames = Object.keys(lists);

    const content = html`
      <div style="display: contents;">
        <div class="au-popover-header">
          <span>Add to List</span>
        </div>
        <div class="au-popover-content">
          ${listNames.map((name) => {
            const isActive = this.listService.isUserInList(name, this.currentUser!.id);
            return html`
              <div class="au-popover-item ${isActive ? 'active' : ''}" data-list="${name}">
                <div class="au-popover-checkbox"></div>
                <span class="au-popover-name">${name}</span>
              </div>
            `;
          })}
          ${listNames.length === 0
            ? html`<div class="au-popover-empty">
                No custom lists found. Create one in AU Settings.
              </div>`
            : ''}
        </div>
      </div>
    `;

    this.popover.appendChild(content);

    document.body.appendChild(this.popover);

    // Position popover relative to anchor
    const rect = anchor.getBoundingClientRect();
    this.popover.style.top = `${rect.bottom + window.scrollY + 10}px`;
    this.popover.style.left = `${rect.right + window.scrollX - 220}px`; // 220 matches CSS width

    // Add events
    this.popover.querySelectorAll<HTMLElement>('.au-popover-item').forEach((item) => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        // The row's toggle is in flight; a further click would race it and invert the checkbox.
        if (this.pendingItems.has(item)) return;
        void (async () => {
          const listName = item.getAttribute('data-list')!;
          // The intended state is fixed once, at the click that starts the toggle.
          const desired = !item.classList.contains('active');

          if (!this.initialized || generation !== this.generation || this.popover !== popover)
            return;
          this.pendingItems.add(item);
          try {
            await this.listService.toggleUserInList(listName, user, desired);
            if (!this.initialized || generation !== this.generation || this.popover !== popover)
              return;
            item.classList.toggle('active', desired);
            await this.updateButtonState(anchor);
          } catch (error) {
            logger.error('[UserBannerModule] List update failed', error);
            if (this.popover === popover) this.toast.error('Could not update the list');
          } finally {
            this.pendingItems.delete(item);
          }
        })().catch((error: unknown) =>
          logger.error('[UserBannerModule] Popover item click failed', error)
        );
      });
    });

    // Close on click outside
    const outsideClick = (e: MouseEvent) => {
      if (
        this.popover &&
        !this.popover.contains(e.target as Node) &&
        !anchor.contains(e.target as Node)
      ) {
        this.destroyPopover();
      }
    };
    document.addEventListener('click', outsideClick, { signal: this.popoverAbort.signal });
  }

  private destroyPopover(): void {
    this.popoverAbort?.abort();
    this.popoverAbort = null;
    if (this.popover) {
      this.popover.remove();
      this.popover = null;
    }
  }

  public getName(): string {
    return 'userBanner';
  }

  protected override cleanup(): void {
    this.generation++;
    this.destroyPopover();
    this.currentUser = null;
    this.buttons.forEach((button) => button.remove());
    this.buttons.clear();
    super.cleanup();
  }

  public override async destroy(): Promise<void> {
    this.initialized = false;
    this.watching = false;
    this.listUnsubscribe?.();
    this.listUnsubscribe = null;
    this.stopObservation();
    this.destroyPopover();
    await super.destroy();
  }
}
