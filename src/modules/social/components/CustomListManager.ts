/**
 * Custom List Manager Component
 * The main UI for managing user groupings in Settings
 */

import { BaseComponent } from '@ui/components/BaseComponent';
import { SocialService } from '../SocialService';
import { CustomListService, CustomListUser } from '../CustomListService';
import { log } from '@core/logger';

export class CustomListManager extends BaseComponent<{}> {
  private socialService = SocialService.getInstance();
  private listService = CustomListService.getInstance();
  
  private allFollowings: CustomListUser[] = [];
  private currentListName: string = 'Best Friends';
  private searchQuery: string = '';
  private isLoading = true;

  protected render(): HTMLElement {
    const container = this.createElement('div', { class: 'au-custom-lists-manager' });
    this.renderInitial(container);
    this.loadData();
    return container;
  }

  private renderInitial(container: HTMLElement): void {
    container.innerHTML = `
      <div class="au-cl-header">
        <div class="au-cl-nav">
          ${Object.keys(this.listService.getLists()).map(name => `
            <div class="au-cl-nav-item ${name === this.currentListName ? 'active' : ''}" data-list="${name}">
              ${name}
            </div>
          `).join('')}
        </div>
        <div class="au-cl-search-container">
          <i class="fa fa-search au-cl-search-icon"></i>
          <input type="text" class="au-cl-search-input" placeholder="Search following users..." />
        </div>
      </div>
      <div class="au-cl-content">
        <div class="au-cl-loading-overlay">
          <i class="fa fa-spinner fa-spin au-cl-loading-spinner"></i>
          <span>Retrieving your following list...</span>
        </div>
      </div>
    `;
  }

  private async loadData(): Promise<void> {
    try {
      this.isLoading = true;
      await this.listService.init();
      const followings = await this.socialService.getAllFollowings();
      
      this.allFollowings = followings.map(f => ({
        id: f.id,
        name: f.name,
        avatar: f.avatar.medium
      }));

      this.isLoading = false;
      this.refreshGrid();
    } catch (e) {
      log.error('[CustomListManager] Failed to load followings', e);
      const content = this.element.querySelector('.au-cl-content')!;
      content.innerHTML = `<div class="au-cl-empty">Failed to load followings. Make sure you are logged in.</div>`;
    }
  }

  private refreshGrid(): void {
    const content = this.element.querySelector('.au-cl-content') as HTMLElement;
    if (!content || this.isLoading) return;

    let filtered = this.allFollowings;
    if (this.searchQuery) {
      filtered = filtered.filter(u => u.name.toLowerCase().includes(this.searchQuery.toLowerCase()));
    }

    if (filtered.length === 0) {
      content.innerHTML = `<div class="au-cl-empty">No users found matching "${this.searchQuery}"</div>`;
      return;
    }

    content.innerHTML = `
      <div class="au-cl-grid">
        ${filtered.map(user => {
          const isActive = this.listService.isUserInList(this.currentListName, user.id);
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
    // Nav switching
    this.element.querySelectorAll('.au-cl-nav-item').forEach(item => {
      item.addEventListener('click', () => {
        this.currentListName = item.getAttribute('data-list') || 'Best Friends';
        this.element.querySelectorAll('.au-cl-nav-item').forEach(nav => {
          nav.classList.toggle('active', nav.getAttribute('data-list') === this.currentListName);
        });
        this.refreshGrid();
      });
    });

    // Search
    const searchInput = this.element.querySelector('.au-cl-search-input') as HTMLInputElement;
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.searchQuery = (e.target as HTMLInputElement).value;
        this.refreshGrid();
      });
    }
  }

  private attachGridEvents(container: HTMLElement): void {
    container.querySelectorAll('.au-cl-user-card').forEach(card => {
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
