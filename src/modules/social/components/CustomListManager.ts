/**
 * @file CustomListManager.ts
 * @description Settings page UI for creating and managing custom user lists
 *
 * Provides a grid-based user selection interface with search filtering,
 * CRUD operations on named lists, and profile link navigation. Fetches
 * followings and followers, then includes saved users outside both groups.
 *
 * @see CustomListService.ts for data persistence
 * @see CustomListModule.ts for the router/mounting layer
 * @see docs/MODULES.md#7-custom-list-module
 */

import { injectable, inject } from 'tsyringe';
import { BaseComponent } from '@ui/components/BaseComponent';
import { SocialService } from '../SocialService';
import type { CustomListClient } from '../CustomListClient';
import type { CustomListUser } from '../CustomListService';
import { logger } from '@core/logger';
import { TOKENS } from '@core/di/tokens';
import { MSG, type AuthLoginResponse } from '@shared/messages';
import { html } from '@core/utils/Template';
import { cssImageUrl } from '@core/utils/WebUrl';
import { EVENT_TYPES } from '@core/events/EventTypes';
import type { EventSubscription, IEventBus } from '@core/interfaces/IEventBus';
import type { ApiContext, IApiClient } from '@core/interfaces/IApiClient';
import type { ToastService } from '@core/services/ToastService';

type Scope = { version: number; context: ApiContext | undefined; authenticated: boolean };
type UserGroup = {
  key: 'following' | 'followers' | 'manual';
  title: string;
  users: CustomListUser[];
};
type RemoteGroup = 'following' | 'followers';
const REMOTE_GROUP_TITLES: Record<RemoteGroup, string> = {
  following: 'Following',
  followers: 'Followers',
};
const SEARCH_DEBOUNCE_MS = 150;

@injectable()
export class CustomListManager extends BaseComponent<Record<string, never>> {
  private allFollowings: CustomListUser[] = [];
  private allFollowers: CustomListUser[] = [];
  private currentListName = 'Best Friends';
  private searchQuery = '';
  private isLoading = false;
  private isManagingList = false;
  private usersReady = false;
  private loadPromise: Promise<void> | null = null;
  private version = 0;
  private viewVersion = 0;
  private context: ApiContext | undefined;
  private authSubscription: EventSubscription | null = null;
  private viewEvents: Array<() => void> = [];
  private gridEvents: Array<() => void> = [];
  private pending = new Set<string>();
  private pendingMembership = new Map<string, boolean>();
  private sessionAuthenticated = false;
  private listSubscription: (() => void) | null = null;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private unavailableGroups: RemoteGroup[] = [];

  constructor(
    @inject(TOKENS.SocialService) private socialService: SocialService,
    @inject(TOKENS.CustomListService) private listService: CustomListClient,
    @inject(TOKENS.ApiClient) private api: IApiClient,
    @inject(TOKENS.EventBus) private bus: IEventBus,
    @inject(TOKENS.ToastService) private toast: ToastService
  ) {
    super({});
  }

  protected render(): HTMLElement {
    return html`<div class="au-custom-lists-manager">
      <div class="au-cl-loading-overlay">
        <i class="fa-solid fa-spinner fa-spin au-cl-loading-spinner"></i><span>Loading...</span>
      </div>
    </div>`;
  }

  protected override onMount(): void {
    this.authSubscription = this.bus.on(EVENT_TYPES.AUTH_STATE_CHANGED, () => this.beginSession());
    this.listSubscription = this.listService.onChange(() => this.handleListsChanged());
    this.beginSession();
  }

  protected override onUnmount(): void {
    this.version++;
    this.viewVersion++;
    this.authSubscription?.unsubscribe();
    this.authSubscription = null;
    this.listSubscription?.();
    this.listSubscription = null;
    this.clearSearchTimer();
    this.unavailableGroups = [];
    this.clearViewEvents();
    this.allFollowings = [];
    this.allFollowers = [];
    this.usersReady = false;
    this.loadPromise = null;
    this.pending.clear();
    this.pendingMembership.clear();
    this.isManagingList = false;
    this.searchQuery = '';
    this.context = undefined;
    this.element.replaceChildren();
  }

  private scope(): Scope {
    return {
      version: this.version,
      context: this.context && { ...this.context },
      authenticated: this.sessionAuthenticated,
    };
  }
  private current(scope: Scope): boolean {
    if (
      !this.mounted ||
      !this.element.isConnected ||
      scope.version !== this.version ||
      this.api.isAuthenticated() !== scope.authenticated
    )
      return false;
    const context = this.api.getContext?.();
    return (
      !scope.context ||
      (context?.sessionId === scope.context.sessionId && context.userId === scope.context.userId)
    );
  }

  private beginSession(): void {
    this.version++;
    this.viewVersion++;
    this.clearViewEvents();
    this.allFollowings = [];
    this.allFollowers = [];
    this.usersReady = false;
    this.loadPromise = null;
    this.pending.clear();
    this.pendingMembership.clear();
    this.searchQuery = '';
    this.isManagingList = false;
    this.clearSearchTimer();
    this.unavailableGroups = [];
    this.sessionAuthenticated = this.api.isAuthenticated();
    const context = this.api.getContext?.();
    this.context = context && { ...context };
    this.element.replaceChildren(
      html`<div class="au-cl-loading-overlay">
        <i class="fa-solid fa-spinner fa-spin"></i><span>Loading...</span>
      </div>`
    );
    void this.initialize(this.scope());
  }

  private async initialize(scope: Scope): Promise<void> {
    try {
      await this.api.ensureContext?.();
      if (!this.current(scope)) return;
      if (!this.api.isAuthenticated()) throw new Error('Authentication required');
      await this.listService.init();
      if (!this.current(scope)) return;
      this.renderInitial(this.element);
      this.attachEvents();
    } catch (error) {
      if (!this.current(scope)) return;
      logger.error('[CustomListManager] Failed to initialize', error);
      this.renderError(this.element, () => this.beginSession());
    }
  }

  private clearGridEvents(): void {
    this.gridEvents.splice(0).forEach((remove) => remove());
  }
  private clearViewEvents(): void {
    this.clearGridEvents();
    this.viewEvents.splice(0).forEach((remove) => remove());
  }
  private listen(
    target: HTMLElement,
    type: string,
    handler: (event: Event) => void,
    grid = false
  ): void {
    const scope = this.scope();
    const view = this.viewVersion;
    const listener: EventListener = (event) => {
      if (this.current(scope) && this.viewVersion === view && this.element.contains(target))
        handler(event);
    };
    target.addEventListener(type, listener);
    (grid ? this.gridEvents : this.viewEvents).push(() =>
      target.removeEventListener(type, listener)
    );
  }

  private renderInitial(container: HTMLElement): void {
    const lists = this.listService.getLists();

    this.clearViewEvents();
    this.viewVersion++;
    container.replaceChildren();
    container.appendChild(html`
      <div style="display: contents;">
        <div class="au-cl-info">
          <h3><i class="fa-solid fa-circle-info"></i> Custom User Lists</h3>
          <p>
            Create and manage personalized groups of users to filter activities.
            <b>Important:</b> This feature requires you to be authenticated with
            <b>Anilist Ultimate</b>.
          </p>
        </div>

        <div class="au-cl-header">
          <button class="au-cl-add-list-btn" title="Create new list">
            <i class="fa-solid fa-plus"></i> New List
          </button>
        </div>

        <div class="au-cl-lists-overview">
          ${Object.keys(lists).map((name) => {
            const userCount = lists[name].length;
            return html`
              <div class="au-cl-list-card" data-list="${name}">
                <div class="au-cl-list-info">
                  <h4 class="au-cl-list-name">${name}</h4>
                  <p class="au-cl-list-count">${userCount} user${userCount !== 1 ? 's' : ''}</p>
                </div>
                <div class="au-cl-list-actions">
                  <button class="au-cl-manage-btn" data-list="${name}" title="Manage users">
                    <i class="fa-solid fa-users"></i> Manage
                  </button>
                  <button class="au-cl-delete-btn" data-list="${name}" title="Delete list">
                    <i class="fa-solid fa-trash"></i>
                  </button>
                </div>
              </div>
            `;
          })}
        </div>

        <div class="au-cl-content" style="display: none;">
          <div class="au-cl-loading-overlay">
            <i class="fa-solid fa-spinner fa-spin au-cl-loading-spinner"></i>
            <span>Retrieving your followings and followers from AniList...</span>
          </div>
        </div>
      </div>
    `);
  }

  private loadUsers(scope: Scope): Promise<void> {
    if (this.usersReady) return Promise.resolve();
    if (this.loadPromise) return this.loadPromise;
    const task = (async () => {
      // Settle each group on its own: one over-limit group must not hide the group that loaded.
      const [followings, followers] = await Promise.allSettled([
        this.socialService.getAllFollowings(),
        this.socialService.getAllFollowers(),
      ]);
      if (!this.current(scope)) return;
      if (followings.status === 'rejected' && followers.status === 'rejected')
        throw followings.reason;
      this.allFollowings =
        followings.status === 'fulfilled'
          ? followings.value.map((user) => ({
              id: user.id,
              name: user.name,
              avatar: user.avatar.medium,
            }))
          : [];
      this.allFollowers =
        followers.status === 'fulfilled'
          ? followers.value.map((user) => ({
              id: user.id,
              name: user.name,
              avatar: user.avatar.medium,
            }))
          : [];
      this.unavailableGroups = [];
      if (followings.status === 'rejected') {
        this.unavailableGroups.push('following');
        logger.warn('[CustomListManager] Following list unavailable', followings.reason);
      }
      if (followers.status === 'rejected') {
        this.unavailableGroups.push('followers');
        logger.warn('[CustomListManager] Followers list unavailable', followers.reason);
      }
      this.usersReady = true;
    })();
    this.loadPromise = task;
    void task
      .finally(() => {
        if (this.loadPromise === task) this.loadPromise = null;
      })
      .catch(() => undefined);
    return task;
  }

  private async updateManageGrid(scope: Scope, view: number): Promise<void> {
    const content = this.element.querySelector<HTMLElement>('.au-cl-content');
    if (!content) return;
    this.isLoading = !this.usersReady;
    if (this.isLoading)
      content.replaceChildren(
        html`<div class="au-cl-loading-overlay">
          <i class="fa-solid fa-spinner fa-spin"></i
          ><span>Retrieving your followings and followers from AniList...</span>
        </div>`
      );
    try {
      await this.loadUsers(scope);
      if (!this.current(scope) || view !== this.viewVersion || !this.isManagingList) return;
      this.isLoading = false;
      this.refreshGrid();
    } catch (error) {
      if (!this.current(scope) || view !== this.viewVersion || !this.isManagingList) return;
      this.isLoading = false;
      logger.error('[CustomListManager] Failed to load data', error);
      this.renderError(content, () => {
        void this.updateManageGrid(this.scope(), this.viewVersion);
      });
    }
  }

  private renderError(target: HTMLElement, retry: () => void): void {
    this.clearGridEvents();
    target.replaceChildren(
      html`<div class="au-cl-empty">
        <i
          class="fa-solid fa-triangle-exclamation"
          style="font-size:24px;color:#e85d75;margin-bottom:15px;display:block;"
        ></i>
        <p>Failed to load your user lists.</p>
        <button class="au-cl-retry-btn">Retry</button>
        ${!this.api.isAuthenticated()
          ? html`<div>
              Questa funzione richiede l'autenticazione con <b>Anilist Ultimate</b>.<br />
              <button class="au-cl-login-btn">Login con Anilist Ultimate</button>
            </div>`
          : ''}
      </div>`
    );
    const retryButton = target.querySelector<HTMLElement>('.au-cl-retry-btn');
    if (retryButton) this.listen(retryButton, 'click', retry, true);
    const login = target.querySelector<HTMLElement>('.au-cl-login-btn');
    if (login)
      this.listen(
        login,
        'click',
        () => {
          void this.login();
        },
        true
      );
  }

  private async login(): Promise<void> {
    const scope = this.scope();
    if (!this.current(scope) || this.pending.has('login')) return;
    this.pending.add('login');
    try {
      const response = (await chrome.runtime.sendMessage({
        type: MSG.AUTH_LOGIN,
      })) as AuthLoginResponse;
      if (!this.current(scope)) return;
      if (response?.success) location.reload();
      else this.toast.error('Login failed. Please retry.');
    } catch (error) {
      if (this.current(scope)) {
        logger.error('[CustomListManager] Login failed', error);
        this.toast.error('Login failed. Please retry.');
      }
    } finally {
      if (scope.version === this.version) this.pending.delete('login');
    }
  }

  private showManageView(listName: string): void {
    this.clearViewEvents();
    this.viewVersion++;
    this.clearSearchTimer();
    this.currentListName = listName;
    this.isManagingList = true;
    this.searchQuery = '';
    const overview = this.element.querySelector<HTMLElement>('.au-cl-lists-overview');
    const content = this.element.querySelector<HTMLElement>('.au-cl-content');
    const header = this.element.querySelector<HTMLElement>('.au-cl-header');
    if (!content || !header) return;
    if (overview) overview.style.display = 'none';
    content.style.display = 'block';
    header.replaceChildren();
    header.appendChild(html`
      <div style="display: contents;">
        <button class="au-cl-back-btn" title="Back to lists">
          <i class="fa-solid fa-arrow-left"></i> Back
        </button>
        <div class="au-cl-search-container">
          <i class="fa-solid fa-magnifying-glass au-cl-search-icon"></i>
          <input type="text" class="au-cl-search-input" placeholder="Search users..." />
        </div>
        <span class="au-cl-current-list">Managing: <b>${listName}</b></span>
      </div>
    `);

    const back = header.querySelector<HTMLElement>('.au-cl-back-btn');
    if (back) this.listen(back, 'click', () => this.showOverview());
    const search = header.querySelector<HTMLInputElement>('.au-cl-search-input');
    if (search)
      this.listen(search, 'input', () => {
        this.searchQuery = search.value;
        this.scheduleSearchRefresh();
      });
    void this.updateManageGrid(this.scope(), this.viewVersion);
  }

  private showOverview(): void {
    this.isManagingList = false;
    this.searchQuery = '';
    this.clearSearchTimer();
    this.renderInitial(this.element);
    this.attachEvents();
  }

  private refreshGrid(): void {
    const scope = this.scope();
    const content = this.element.querySelector<HTMLElement>('.au-cl-content');
    if (
      !this.current(scope) ||
      !content ||
      this.isLoading ||
      !this.usersReady ||
      !this.isManagingList
    )
      return;
    this.clearGridEvents();
    const query = this.searchQuery.toLowerCase();
    const groups = this.userGroups()
      .map((group) => ({
        ...group,
        users: this.searchQuery
          ? group.users.filter((user) => user.name.toLowerCase().includes(query))
          : group.users,
      }))
      .filter((group) => group.users.length > 0);
    content.replaceChildren();
    this.unavailableGroups.forEach((group) =>
      content.appendChild(this.renderUnavailableNote(group))
    );
    if (!groups.length) {
      content.appendChild(
        html`<div class="au-cl-empty">
          No users found${this.searchQuery ? ` matching "${this.searchQuery}"` : ''}
        </div>`
      );
      return;
    }
    const listName = this.currentListName;
    for (const group of groups) {
      const section = html`<section class="au-cl-user-group" data-user-group="${group.key}">
        <h4 class="au-cl-user-group-title">${group.title}<span>${group.users.length}</span></h4>
        <div class="au-cl-grid"></div>
      </section>`;
      const grid = section.querySelector<HTMLElement>('.au-cl-grid')!;
      for (const user of group.users) {
        const key = `member:${listName}:${user.id}`;
        const active =
          this.pendingMembership.get(key) ?? this.listService.isUserInList(listName, user.id);
        const card = html`<div
          class="au-cl-user-card ${active ? 'active' : ''}"
          data-user-id="${user.id}"
        >
          <div class="au-cl-avatar"></div>
          <div class="au-cl-name">${user.name}</div>
          <div class="au-cl-checkbox"></div>
        </div>`;
        const avatar = card.querySelector<HTMLElement>('.au-cl-avatar')!;
        avatar.style.backgroundImage = cssImageUrl(user.avatar);
        avatar.style.cursor = 'pointer';
        this.listen(
          avatar,
          'click',
          (event) => {
            event.stopPropagation();
            window.open(
              `https://anilist.co/user/${encodeURIComponent(user.name)}/`,
              '_blank',
              'noopener,noreferrer'
            );
          },
          true
        );
        this.listen(
          card,
          'click',
          () => {
            if (this.pending.has(key) || !this.api.isAuthenticated()) return;
            const desired = !this.listService.isUserInList(listName, user.id);
            this.pendingMembership.set(key, desired);
            card.classList.toggle('active', desired);
            // The grid is rebuilt once, by mutate's finally block, when the write settles.
            void this.mutate(key, () => this.listService.toggleUserInList(listName, user, desired));
          },
          true
        );
        grid.appendChild(card);
      }
      content.appendChild(section);
    }
  }

  private userGroups(): UserGroup[] {
    const seen = new Set<number>();
    const following = this.allFollowings.filter((user) => {
      if (seen.has(user.id)) return false;
      seen.add(user.id);
      return true;
    });
    const followers = this.allFollowers.filter((user) => {
      if (seen.has(user.id)) return false;
      seen.add(user.id);
      return true;
    });
    const manual = Object.values(this.listService.getLists())
      .flat()
      .filter((user) => {
        if (seen.has(user.id)) return false;
        seen.add(user.id);
        return true;
      });
    return [
      { key: 'following', title: 'Following', users: following },
      { key: 'followers', title: 'Followers', users: followers },
      { key: 'manual', title: 'Added manually', users: manual },
    ];
  }

  /** Shared-snapshot change: re-render the open view, unless a mutation in flight refreshes it when it settles. */
  private handleListsChanged(): void {
    if (!this.mounted || [...this.pending].some((key) => key !== 'login')) return;
    if (this.isManagingList) {
      this.refreshGrid();
      return;
    }
    if (this.element.querySelector('.au-cl-lists-overview')) {
      this.renderInitial(this.element);
      this.attachEvents();
    }
  }

  private scheduleSearchRefresh(): void {
    this.clearSearchTimer();
    this.searchTimer = setTimeout(() => {
      this.searchTimer = null;
      this.refreshGrid();
    }, SEARCH_DEBOUNCE_MS);
  }

  private clearSearchTimer(): void {
    if (this.searchTimer === null) return;
    clearTimeout(this.searchTimer);
    this.searchTimer = null;
  }

  private renderUnavailableNote(group: RemoteGroup): HTMLElement {
    const note = html`<div class="au-cl-group-note">
      <span
        >${REMOTE_GROUP_TITLES[group]} list is truncated or unavailable, so only the loaded users
        are shown.</span
      >
      <button class="au-cl-retry-btn">Retry</button>
    </div>`;
    const retry = note.querySelector<HTMLElement>('.au-cl-retry-btn');
    if (retry)
      this.listen(
        retry,
        'click',
        () => {
          this.usersReady = false;
          void this.updateManageGrid(this.scope(), this.viewVersion);
        },
        true
      );
    return note;
  }

  private async mutate(
    key: string,
    action: () => Promise<void>,
    success?: () => void,
    failure?: () => void
  ): Promise<void> {
    const scope = this.scope();
    const view = this.viewVersion;
    if (!this.current(scope) || !this.api.isAuthenticated() || this.pending.has(key)) return;
    this.pending.add(key);
    try {
      await action();
      if (this.current(scope) && view === this.viewVersion) success?.();
    } catch (error) {
      if (this.current(scope) && view === this.viewVersion) {
        logger.error('[CustomListManager] Failed to save list', error);
        failure?.();
        this.toast.error('Failed to save user list. Please retry.');
      }
    } finally {
      if (scope.version === this.version) {
        this.pending.delete(key);
        this.pendingMembership.delete(key);
        if (key.startsWith('member:') && this.current(scope)) this.refreshGrid();
      }
    }
  }

  protected override attachEvents(): void {
    const add = this.element.querySelector<HTMLElement>('.au-cl-add-list-btn');
    if (add)
      this.listen(add, 'click', () => {
        if (this.pending.has('list-edit')) return;
        const scope = this.scope();
        const view = this.viewVersion;
        const name = prompt('Enter new list name:')?.trim();
        if (name && this.current(scope) && view === this.viewVersion)
          void this.mutate(
            'list-edit',
            () => this.listService.createList(name),
            () => this.showOverview()
          );
      });
    this.element.querySelectorAll<HTMLElement>('.au-cl-manage-btn').forEach((button) => {
      this.listen(button, 'click', (event) => {
        event.stopPropagation();
        const name = button.dataset.list;
        if (name && !this.isManagingList) this.showManageView(name);
      });
    });
    this.element.querySelectorAll<HTMLElement>('.au-cl-delete-btn').forEach((button) => {
      this.listen(button, 'click', (event) => {
        event.stopPropagation();
        if (this.pending.has('list-edit')) return;
        const name = button.dataset.list;
        if (!name) return;
        if (Object.keys(this.listService.getLists()).length <= 1) {
          alert('Cannot delete the last list!');
          return;
        }
        const scope = this.scope();
        const view = this.viewVersion;
        if (confirm(`Delete "${name}"?`) && this.current(scope) && view === this.viewVersion)
          void this.mutate(
            'list-edit',
            () => this.listService.deleteList(name),
            () => this.showOverview()
          );
      });
    });
  }
}
