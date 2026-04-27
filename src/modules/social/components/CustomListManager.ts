/**
 * @file CustomListManager.ts
 * @description Settings page UI for creating and managing custom user lists
 *
 * Provides a grid-based user selection interface with search filtering,
 * CRUD operations on named lists, and profile link navigation. Fetches
 * all followings from SocialService to populate the user grid.
 *
 * @see CustomListService.ts for data persistence
 * @see CustomListModule.ts for the router/mounting layer
 * @see docs/MODULES.md#7-custom-list-module
 */

import { injectable, inject } from 'tsyringe';
import { BaseComponent } from '@ui/components/BaseComponent';
import { SocialService } from '../SocialService';
import { CustomListService, CustomListUser } from '../CustomListService';
import { log } from '@core/logger';
import { TOKENS } from '@core/di/tokens';
import type { IApiClient } from '@core/interfaces/IApiClient';

@injectable()
export class CustomListManager extends BaseComponent<Record<string, never>> {
  private allFollowings: CustomListUser[] = [];
  private currentListName: string = 'Best Friends';
  private searchQuery: string = '';
  private isLoading = true;
  private isManagingList = false;

  constructor(
    @inject(TOKENS.SocialService) private socialService: SocialService,
    @inject(TOKENS.CustomListService) private listService: CustomListService,
    @inject(TOKENS.ApiClient) private apiClient: IApiClient
  ) {
    super({});
  }

  protected render(): HTMLElement {
    const container = this.createElement('div', { class: 'au-custom-lists-manager' });

    // Show loading state initially
    container.innerHTML = `
      <div class="au-cl-loading-overlay">
        <i class="fa fa-spinner fa-spin au-cl-loading-spinner"></i>
        <span>Loading...</span>
      </div>
    `;

    // Initialize lists and render
    this.initializeAndRender(container);

    return container;
  }

  private async initializeAndRender(container: HTMLElement): Promise<void> {
    await this.listService.init();
    this.renderInitial(container);
    this.attachEvents();
  }

  private renderInitial(container: HTMLElement): void {
    const lists = this.listService.getLists();

    container.innerHTML = `
      <div class="au-cl-info">
        <h3><i class="fa fa-info-circle"></i> Custom User Lists</h3>
        <p>Create and manage personalized groups of users to filter activities.
        <b>Important:</b> This feature requires you to be authenticated with <b>Anilist Ultimate</b>.</p>
      </div>

      <div class="au-cl-header">
        <button class="au-cl-add-list-btn" title="Create new list">
          <i class="fa fa-plus"></i> New List
        </button>
      </div>

      <div class="au-cl-lists-overview">
        ${Object.keys(lists).map(name => {
      const userCount = lists[name].length;
      return `
            <div class="au-cl-list-card" data-list="${name}">
              <div class="au-cl-list-info">
                <h4 class="au-cl-list-name">${name}</h4>
                <p class="au-cl-list-count">${userCount} user${userCount !== 1 ? 's' : ''}</p>
              </div>
              <div class="au-cl-list-actions">
                <button class="au-cl-manage-btn" data-list="${name}" title="Manage users">
                  <i class="fa fa-users"></i> Manage
                </button>
                <button class="au-cl-delete-btn" data-list="${name}" title="Delete list">
                  <i class="fa fa-trash"></i>
                </button>
              </div>
            </div>
          `;
    }).join('')}
      </div>

      <div class="au-cl-content" style="display: none;">
        <div class="au-cl-loading-overlay">
          <i class="fa fa-spinner fa-spin au-cl-loading-spinner"></i>
          <span>Retrieving your following list from AniList...</span>
        </div>
      </div>
    `;
  }

  private async loadData(): Promise<void> {
    try {
      this.isLoading = true;

      // Save services to local variables to prevent 'this' context loss during await
      const socialService = this.socialService;
      const listService = this.listService;

      await listService.init();
      const followings = await socialService.getAllFollowings();

      this.allFollowings = followings.map(f => ({
        id: f.id,
        name: f.name,
        avatar: f.avatar.medium
      }));

      this.isLoading = false;
      this.refreshGrid();
    } catch (e) {
      log.error('[CustomListManager] Failed to load data', e);
      const content = this.element.querySelector('.au-cl-content')!;
      content.innerHTML = `
        <div class="au-cl-empty">
          <i class="fa fa-exclamation-triangle" style="font-size: 24px; color: #e85d75; margin-bottom: 15px; display: block;"></i>
          <p>Failed to load your following list.</p>
          <p style="font-size: 13px; margin-top: 10px; color: #8fa0b1; line-height: 1.6;">
            Questa funzione richiede l'autenticazione con <b>Anilist Ultimate</b>.<br>
            Per favore, clicca sull'icona dell'estensione e premi <b>Login</b>.<br>
            <button class="au-cl-login-btn" style="margin-top: 15px; background: rgb(var(--color-blue)); color: #fff; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; font-weight: 600;">
              Login con Anilist Ultimate
            </button>
          </p>
        </div>
      `;

      content.querySelector('.au-cl-login-btn')?.addEventListener('click', () => {
        window.open(this.apiClient.getAuthUrl(), '_blank');
      });
    }
  }

  private showManageView(listName: string): void {
    this.currentListName = listName;
    this.isManagingList = true;

    const overview = this.element.querySelector('.au-cl-lists-overview') as HTMLElement;
    const content = this.element.querySelector('.au-cl-content') as HTMLElement;
    const header = this.element.querySelector('.au-cl-header') as HTMLElement;

    if (overview) overview.style.display = 'none';
    if (content) content.style.display = 'block';

    // Add back button and search
    header.innerHTML = `
      <button class="au-cl-back-btn" title="Back to lists">
        <i class="fa fa-arrow-left"></i> Back
      </button>
      <div class="au-cl-search-container">
        <i class="fa fa-search au-cl-search-icon"></i>
        <input type="text" class="au-cl-search-input" placeholder="Search users..." />
      </div>
      <span class="au-cl-current-list">Managing: <b>${listName}</b></span>
    `;

    // Attach back button event
    header.querySelector('.au-cl-back-btn')?.addEventListener('click', () => {
      this.showOverview();
    });

    // Attach search event
    const searchInput = header.querySelector('.au-cl-search-input') as HTMLInputElement;
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.searchQuery = (e.target as HTMLInputElement).value;
        this.refreshGrid();
      });
    }

    this.refreshGrid();
  }

  private showOverview(): void {
    this.isManagingList = false;
    this.searchQuery = '';
    this.renderInitial(this.element);
    this.attachEvents();
  }

  private refreshGrid(): void {
    const content = this.element.querySelector('.au-cl-content') as HTMLElement;
    if (!content || this.isLoading || !this.isManagingList) return;

    let filtered = this.allFollowings;
    if (this.searchQuery) {
      filtered = filtered.filter(u => u.name.toLowerCase().includes(this.searchQuery.toLowerCase()));
    }

    if (filtered.length === 0) {
      content.innerHTML = `<div class="au-cl-empty">No users found${this.searchQuery ? ` matching "${this.searchQuery}"` : ''}</div>`;
      return;
    }

    const listService = this.listService;
    const currentListName = this.currentListName;

    content.innerHTML = `
      <div class="au-cl-grid">
        ${filtered.map(user => {
      const isActive = listService.isUserInList(currentListName, user.id);
      return `
            <div class="au-cl-user-card ${isActive ? 'active' : ''}" data-user-id="${user.id}">
              <div class="au-cl-avatar" style="background-image: url('${user.avatar}')"></div>
              <div class="au-cl-name">${user.name}</div>
              <div class="au-cl-checkbox"></div>
            </div>
          `;
    }).join('')}
      </div>
    `;

    this.attachGridEvents(content);
  }

  protected attachEvents(): void {
    // New List button
    const addListBtn = this.element.querySelector('.au-cl-add-list-btn');
    if (addListBtn) {
      addListBtn.addEventListener('click', async () => {
        const listName = prompt('Enter new list name:');
        if (listName && listName.trim()) {
          await this.listService.createList(listName.trim());
          this.showOverview();
        }
      });
    }

    // Manage buttons
    this.element.querySelectorAll('.au-cl-manage-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const listName = btn.getAttribute('data-list');
        if (listName) {
          if (this.allFollowings.length === 0) {
            // Load data if not already loaded
            await this.loadData();
          }
          this.showManageView(listName);
        }
      });
    });

    // Delete buttons (on list cards)
    this.element.querySelectorAll('.au-cl-delete-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const listName = btn.getAttribute('data-list');
        if (!listName) return;

        const lists = Object.keys(this.listService.getLists());
        if (lists.length <= 1) {
          alert('Cannot delete the last list!');
          return;
        }

        if (confirm(`Delete "${listName}"?`)) {
          await this.listService.deleteList(listName);
          this.showOverview();
        }
      });
    });
  }

  private attachGridEvents(container: HTMLElement): void {
    container.querySelectorAll('.au-cl-user-card').forEach(card => {
      // Avatar click - go to profile
      const avatar = card.querySelector('.au-cl-avatar');
      if (avatar) {
        avatar.addEventListener('click', (e) => {
          e.stopPropagation(); // Don't trigger card toggle
          const userId = parseInt(card.getAttribute('data-user-id') || '0');
          const user = this.allFollowings.find(u => u.id === userId);
          if (user) {
            window.open(`https://anilist.co/user/${user.name}/`, '_blank');
          }
        });
        avatar.setAttribute('style', avatar.getAttribute('style') + '; cursor: pointer;');
      }

      // Card click - toggle selection
      card.addEventListener('click', async () => {
        const userId = parseInt(card.getAttribute('data-user-id') || '0');
        const user = this.allFollowings.find(u => u.id === userId);
        if (!user) return;

        const isCurrentlyActive = card.classList.contains('active');
        const newActive = !isCurrentlyActive;

        card.classList.toggle('active', newActive);
        await this.listService.toggleUserInList(this.currentListName, user, newActive);
      });
    });
  }
}
