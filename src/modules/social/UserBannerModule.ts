/**
 * @file UserBannerModule.ts
 * @description Injects a custom list management button into the user profile banner
 */

import { injectable, inject } from 'tsyringe';
import { BaseModule } from '@core/modules/BaseModule';
import { log } from '@core/logger';
import { TOKENS } from '@core/di/tokens';
import type { IEventBus } from '@core/interfaces/IEventBus';
import type { IApiClient } from '@core/interfaces/IApiClient';
import type { SharedGlobalObserver } from '@core/observers/SharedGlobalObserver';
import { CustomListService, CustomListUser } from './CustomListService';
import { SocialService } from './SocialService';
import { ToastService } from '@core/services/ToastService';

@injectable()
export class UserBannerModule extends BaseModule {
  private popover: HTMLElement | null = null;
  private currentUser: CustomListUser | null = null;

  constructor(
    @inject(TOKENS.ApiClient) private apiClient: IApiClient,
    @inject(TOKENS.CustomListService) private listService: CustomListService,
    @inject(TOKENS.SocialService) private socialService: SocialService,
    @inject(TOKENS.SharedGlobalObserver) private sharedObserver: SharedGlobalObserver,
    @inject(TOKENS.ToastService) private toast: ToastService,
    @inject(TOKENS.EventBus) protected eventBus: IEventBus
  ) {
    super(eventBus);
  }

  public async init(): Promise<void> {
    // Auth guard: modulo richiede autenticazione
    if (!this.apiClient.isAuthenticated()) {
      log.warn('[UserBannerModule] Not authenticated, deferring initialization');
      return;
    }

    log.info('[UserBannerModule] Initializing...');

    // Load lists data
    await this.listService.init();

    this.onPageChange(() => {
      this.cleanup();
      if (this.isOnUserProfilePage()) {
        this.startObservation();
      }
    });

    if (this.isOnUserProfilePage()) {
      this.startObservation();
    }
  }

  private isOnUserProfilePage(): boolean {
    return window.location.pathname.startsWith('/user/');
  }

  private startObservation(): void {
    this.sharedObserver.register('user-banner-actions', () => {
      this.injectButton();
    });
    this.injectButton();
  }

  private async injectButton(): Promise<void> {
    // Target the actions container in the user banner content
    const actions = document.querySelector('.banner-content .actions');
    if (!actions || actions.querySelector('.au-banner-list-btn')) return;

    // Find the follow button container to anchor next to it
    const followBtn = actions.querySelector('.nav-btn');
    if (!followBtn) return;

    const btn = document.createElement('div');
    btn.className = 'nav-btn au-banner-list-btn';
    btn.setAttribute('data-v-b1e442a6', ''); // Match AniList scoped styles
    btn.innerHTML = '<span>Add to List</span>';
    btn.title = 'Manage Custom Lists';
    
    // Insert after follow button container
    followBtn.parentNode?.insertBefore(btn, followBtn.nextSibling);

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.togglePopover(btn);
    });

    // Update button state if user is already in a list
    this.updateButtonState(btn);
  }

  private async updateButtonState(btn: HTMLElement): Promise<void> {
    const username = window.location.pathname.split('/')[2];
    const btnSpan = btn.querySelector('span');
    if (!btnSpan) return;

    if (!this.currentUser || this.currentUser.name !== username) {
      const rawUser = await this.socialService.getUserByName(username);
      if (rawUser) {
        this.currentUser = {
          id: rawUser.id,
          name: rawUser.name,
          avatar: rawUser.avatar.medium
        };
      }
    }

    if (!this.currentUser) return;

    const lists = this.listService.getLists();
    const isInAnyList = Object.keys(lists).some(listName => 
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

    this.renderPopover(anchor);
  }

  private async renderPopover(anchor: HTMLElement): Promise<void> {
    const username = window.location.pathname.split('/')[2];
    if (!this.currentUser || this.currentUser.name !== username) {
      const rawUser = await this.socialService.getUserByName(username);
      if (rawUser) {
        this.currentUser = {
          id: rawUser.id,
          name: rawUser.name,
          avatar: rawUser.avatar.medium
        };
      }
    }

    if (!this.currentUser) {
      this.toast.error('Could not fetch user details');
      return;
    }

    this.popover = document.createElement('div');
    this.popover.className = 'au-banner-popover';
    
    const lists = this.listService.getLists();
    const listNames = Object.keys(lists);

    this.popover.innerHTML = `
      <div class="au-popover-header">
        <span>Add to List</span>
      </div>
      <div class="au-popover-content">
        ${listNames.map(name => {
          const isActive = this.listService.isUserInList(name, this.currentUser!.id);
          return `
            <div class="au-popover-item ${isActive ? 'active' : ''}" data-list="${name}">
              <div class="au-popover-checkbox"></div>
              <span class="au-popover-name">${name}</span>
            </div>
          `;
        }).join('')}
        ${listNames.length === 0 ? '<div class="au-popover-empty">No custom lists found. Create one in AU Settings.</div>' : ''}
      </div>
    `;

    document.body.appendChild(this.popover);

    // Position popover relative to anchor
    const rect = anchor.getBoundingClientRect();
    this.popover.style.top = `${rect.bottom + window.scrollY + 10}px`;
    this.popover.style.left = `${rect.right + window.scrollX - 220}px`; // 220 matches CSS width

    // Add events
    this.popover.querySelectorAll('.au-popover-item').forEach(item => {
      item.addEventListener('click', async (e) => {
        e.stopPropagation();
        const listName = item.getAttribute('data-list')!;
        const isActive = item.classList.contains('active');
        
        await this.listService.toggleUserInList(listName, this.currentUser!, !isActive);
        item.classList.toggle('active');
        
        this.updateButtonState(anchor);
      });
    });

    // Close on click outside
    const outsideClick = (e: MouseEvent) => {
      if (this.popover && !this.popover.contains(e.target as Node) && !anchor.contains(e.target as Node)) {
        this.destroyPopover();
        document.removeEventListener('click', outsideClick);
      }
    };
    setTimeout(() => document.addEventListener('click', outsideClick), 10);
  }

  private destroyPopover(): void {
    if (this.popover) {
      this.popover.remove();
      this.popover = null;
    }
  }

  public getName(): string {
    return 'userBanner';
  }

  public override async destroy(): Promise<void> {
    this.sharedObserver.unregister('user-banner-actions');
    this.destroyPopover();
    await super.destroy();
  }
}
