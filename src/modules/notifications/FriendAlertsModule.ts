import { inject, injectable } from 'tsyringe';
import { BaseModule } from '@core/modules/BaseModule';
import { TOKENS } from '@core/di/tokens';
import type { IEventBus } from '@core/interfaces/IEventBus';
import type { AuthStateClient } from '@core/auth/AuthStateClient';
import type { SharedGlobalObserver } from '@core/observers/SharedGlobalObserver';
import type { IConfigManager } from '@core/interfaces/IConfigManager';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { MSG } from '@shared/messages';
import { CustomListClient } from '@/modules/social/CustomListClient';
import {
  emptyFriendAlerts,
  FRIEND_ALERTS_PREFIX,
  parseFriendAlerts,
  USER_POLL_MIN_SECONDS,
  type FriendAlertsState,
} from './FriendAlerts';
import '@/styles/friend-alerts.css';
import { FriendAlertsNavbar } from './FriendAlertsNavbar';

function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text = '',
  className = ''
): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag);
  result.textContent = text;
  result.className = className;
  return result;
}
function button(text: string, action: () => void): HTMLButtonElement {
  const result = node('button', text);
  result.type = 'button';
  result.addEventListener('click', action);
  return result;
}
function icon(name: string): HTMLElement {
  const result = node('i', '', `fa-solid ${name}`);
  result.setAttribute('aria-hidden', 'true');
  return result;
}
function iconButton(label: string, glyph: string, action: () => void): HTMLButtonElement {
  const result = button('', action);
  result.className = 'au-friend-alerts-icon-button';
  result.title = label;
  result.setAttribute('aria-label', label);
  result.append(icon(glyph));
  return result;
}
const PAGE_SIZE = 25;

@injectable()
export class FriendAlertsModule extends BaseModule {
  private initialized = false;
  private unsubscribeConfig: (() => void) | null = null;
  private active = false;
  private version = 0;
  private state = emptyFriendAlerts();
  private root: HTMLElement | null = null;
  private bell: HTMLButtonElement | null = null;
  private panel: HTMLElement | null = null;
  private watchButton: HTMLButtonElement | null = null;
  private actions: HTMLElement | null = null;
  private addedActionsClass = false;
  private open = false;
  private busy = false;
  private message = '';
  private inboxTab: 'activity' | 'following' = 'activity';
  private rulesPage = 0;
  private alertsPage = 0;
  private mediaPath = '';
  /** The #friend-alerts hash opens the inbox once per navigation, not on every root rebuild. */
  private hashConsumed = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly navbar = new FriendAlertsNavbar(event => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey
      || !/^\/notifications\/?$/.test(location.pathname)) return;
    event.preventDefault();
    this.hashConsumed = true;
    this.open = true;
    this.inboxTab = 'activity';
    this.reconcile();
    this.render();
    this.bell?.focus();
    this.root?.scrollIntoView?.({ block: 'nearest' });
  });
  private readonly visible = (): void => {
    if (document.visibilityState === 'visible') void this.refresh();
  };
  private readonly runtimeEvents = chrome.runtime.onMessage;
  private readonly listener = (value: unknown): void => {
    const signal = value as { type?: string; keys?: unknown[] } | null;
    if (
      signal?.type === MSG.LOCAL_CHANGED &&
      signal.keys?.some((key) => typeof key === 'string' && key.startsWith(FRIEND_ALERTS_PREFIX))
    ) {
      if (!this.busy) void this.refresh();
    }
  };
  private readonly keydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && this.open) {
      this.close();
    } else if (
      event.key === 'Tab' &&
      this.open &&
      this.root?.classList.contains('au-friend-alerts-dialog')
    ) {
      const controls = [
        ...this.root.querySelectorAll<HTMLElement>(
          'button:not(:disabled), select:not(:disabled), a[href]'
        ),
      ];
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  };
  private close(): void {
    const trigger = this.bell ?? this.watchButton;
    this.open = false;
    this.reconcile();
    this.render();
    trigger?.focus();
  }
  constructor(
    @inject(TOKENS.EventBus) protected eventBus: IEventBus,
    @inject(TOKENS.AuthTokenService) private auth: AuthStateClient,
    @inject(TOKENS.CustomListService) private lists: CustomListClient,
    @inject(TOKENS.SharedGlobalObserver) private observer: SharedGlobalObserver,
    @inject(TOKENS.Config) private config: IConfigManager
  ) {
    super(eventBus);
  }
  getName(): string {
    return 'friendAlerts';
  }
  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    this.onPageChange(() => {
      this.hashConsumed = false;
      if (!this.active) return;
      this.open = false;
      this.reconcile();
      this.render();
    });
    this.subscribe(EVENT_TYPES.AUTH_STATE_CHANGED, () => {
      if (!this.active) return;
      this.version++;
      this.busy = false;
      this.state = emptyFriendAlerts();
      this.inboxTab = 'activity';
      this.rulesPage = 0;
      this.alertsPage = 0;
      this.open = false;
      this.message = '';
      this.reconcile();
      this.render();
      void this.refresh();
    });
    this.unsubscribeConfig = this.config.onChange('features', () => this.syncEnabled());
    await this.syncEnabled();
  }
  private async syncEnabled(): Promise<void> {
    if (!this.initialized) return;
    if (!this.config.isFeatureEnabled('friendAlerts')) {
      this.deactivate();
      return;
    }
    if (this.active) return;
    this.active = true;
    this.runtimeEvents.addListener(this.listener);
    document.addEventListener('keydown', this.keydown);
    document.addEventListener('visibilitychange', this.visible);
    this.observer.register(this.getName(), () => this.reconcile());
    this.timer = setInterval(() => {
      if (document.visibilityState === 'visible') void this.refresh();
    }, 60000);
    this.reconcile();
    await this.refresh();
  }
  private async request(operation: string, value?: unknown): Promise<FriendAlertsState> {
    const version = this.version;
    await this.auth.ensureInitialized();
    const sessionId = this.auth.getSessionId();
    if (!this.active || version !== this.version || !this.auth.hasToken())
      throw new Error('Sign in to the extension to use friend alerts.');
    const response = await chrome.runtime.sendMessage({
      type: MSG.FRIEND_ALERTS,
      operation,
      value,
      sessionId,
    });
    if (!this.active || version !== this.version || sessionId !== this.auth.getSessionId())
      throw new Error('Alerts account changed');
    if (!response || response.success !== true)
      throw new Error('Unable to update friend alerts. Please try again.');
    return parseFriendAlerts(response.data);
  }
  private async refresh(): Promise<void> {
    if (!this.active || this.busy) return;
    const version = this.version;
    try {
      const state = await this.request('get');
      if (version !== this.version || !this.active || this.busy) return;
      this.state = state;
      this.reconcile();
      this.render();
    } catch {
      /* Auth changes clear the previous account before any read. */
    }
  }
  private async run(operation: string, value?: unknown): Promise<void> {
    if (this.busy || !this.active) return;
    const version = ++this.version;
    this.busy = true;
    this.message = '';
    this.render();
    const sentAt = Math.floor(Date.now() / 1000);
    try {
      this.state = await this.request(operation, value);
      this.message =
        operation === 'watch'
          ? 'Alerts enabled. New activity will appear here.'
          : operation === 'poll'
            ? this.pollMessage(sentAt)
            : '';
    } catch (error) {
      if (this.active && version === this.version)
        this.message = error instanceof Error ? error.message : 'Unable to update alerts.';
    } finally {
      if (this.active && version === this.version) {
        this.busy = false;
        this.render();
      }
    }
  }
  /**
   * The host answers a throttled check with unchanged state, not an error: a check
   * that ran stamps lastPoll at or after the request time, so anything earlier was skipped.
   */
  private pollMessage(sentAt: number): string {
    const wait = USER_POLL_MIN_SECONDS - (sentAt - this.state.lastPoll);
    return this.state.lastPoll < sentAt && wait > 0
      ? `Checked recently — try again in ${wait}s`
      : 'Check requested.';
  }
  private media(): { id: number; title: string } | null {
    const match = /^\/(?:anime|manga)\/(\d+)(?:\/|$)/.exec(location.pathname);
    return match
      ? {
          id: Number(match[1]),
          title:
            document.querySelector('.media .content h1, .header h1, h1')?.textContent?.trim() ||
            'this title',
        }
      : null;
  }
  private reconcile(): void {
    if (!this.active) return;
    this.navbar.update(this.auth.hasToken() ? this.state.alerts.filter(alert => !alert.read).length : 0);
    const notifications = /^\/notifications\/?$/.test(location.pathname)
      ? document.querySelector<HTMLElement>('.notifications')
      : null;
    const dialog = !notifications && this.open && !!this.media();
    const mode = notifications ? 'inbox' : dialog ? 'dialog' : '';
    let changed = false;
    if (
      !mode ||
      !this.root?.isConnected ||
      this.root.dataset.mode !== mode ||
      (notifications && this.root.parentElement !== notifications)
    ) {
      this.root?.remove();
      this.root = null;
      this.panel = null;
      this.bell = null;
      changed = true;
      if (mode) {
        this.root = node('section', '', `au-friend-alerts au-friend-alerts-${mode}`);
        this.root.dataset.mode = mode;
      }
      if (notifications && this.root) {
        this.bell = button('Friend alerts', () => {
          this.open = !this.open;
          this.message = '';
          this.render();
          if (this.open) this.loadLists();
        });
        this.bell.className = 'au-friend-alerts-bell';
        this.bell.setAttribute('aria-controls', 'au-friend-alerts-panel');
        this.root.append(this.bell);
        notifications.prepend(this.root);
        if (location.hash === '#friend-alerts' && !this.hashConsumed) {
          this.hashConsumed = true;
          this.open = true;
        }
      } else if (dialog && this.root) {
        this.root.addEventListener('click', (event) => {
          if (event.target === this.root) this.close();
        });
        document.body.append(this.root);
      }
    }
    const path = location.pathname;
    if (path !== this.mediaPath || !this.watchButton?.isConnected) {
      this.clearWatchButton();
      this.mediaPath = path;
      const media = this.media();
      const actions = document.querySelector<HTMLElement>(
        '.media .header .actions, .media .actions, .header .actions'
      );
      if (media && actions) {
        this.watchButton = button('', () => {
          this.open = true;
          this.message = '';
          this.reconcile();
          this.render();
          this.loadLists();
          this.panel?.querySelector<HTMLElement>('select, button')?.focus();
        });
        this.watchButton.className = 'au-friend-alerts-watch';
        this.watchButton.title = 'Friend alerts';
        this.watchButton.setAttribute('aria-label', 'Friend alerts');
        this.watchButton.setAttribute('aria-haspopup', 'dialog');
        const icon = node('i', '', 'fa-solid fa-bell');
        icon.setAttribute('aria-hidden', 'true');
        this.watchButton.append(icon);
        const size =
          actions.querySelector('.favourite, .favorite')?.getBoundingClientRect().height || 35;
        this.watchButton.style.setProperty('--au-friend-alert-size', `${size}px`);
        this.actions = actions;
        this.addedActionsClass = !actions.classList.contains('au-friend-alerts-actions');
        actions.classList.add('au-friend-alerts-actions');
        actions.append(this.watchButton);
        changed = true;
      }
    }
    if (changed) this.render();
  }
  private clearWatchButton(): void {
    this.watchButton?.remove();
    this.watchButton = null;
    if (this.addedActionsClass) this.actions?.classList.remove('au-friend-alerts-actions');
    this.actions = null;
    this.addedActionsClass = false;
  }
  private loadLists(): void {
    const version = this.version;
    void this.lists
      .init()
      .then(() => {
        if (this.active && this.open && version === this.version) this.render();
      })
      .catch(() => {
        if (this.active && this.open && version === this.version) {
          this.message = 'Unable to load custom lists. Close and reopen to retry.';
          this.render();
        }
      });
  }
  private render(): void {
    if (!this.active) return;
    const unread = this.state.alerts.filter((alert) => !alert.read).length;
    this.navbar.update(this.auth.hasToken() ? unread : 0);
    const watched = this.state.rules.some((rule) => rule.mediaId === this.media()?.id);
    this.watchButton?.setAttribute('aria-pressed', String(watched));
    this.watchButton?.classList.toggle('is-watched', watched);
    if (!this.root) return;
    const currentMedia = this.media();
    const selected =
      this.panel?.dataset.media === String(currentMedia?.id ?? '')
        ? this.panel?.querySelector('select')?.value
        : undefined;
    const focus = this.panel?.contains(document.activeElement)
      ? (document.activeElement as HTMLElement).dataset.focus
      : undefined;
    this.panel?.remove();
    this.panel = null;
    if (this.bell) {
      const glyph = node('span', '', 'au-friend-alerts-header-icon');
      glyph.append(icon('fa-bell'));
      this.bell.replaceChildren(glyph, node('span', 'Friend alerts', 'au-friend-alerts-title'));
      if (unread) this.bell.append(node('span', String(unread), 'au-friend-alerts-badge'));
      const chevron = icon('fa-chevron-down');
      chevron.classList.add('au-friend-alerts-chevron');
      this.bell.append(chevron);
      this.bell.setAttribute('aria-label', `Friend alerts${unread ? ` · ${unread} unread` : ''}`);
    }
    this.bell?.setAttribute('aria-expanded', String(this.open));
    if (!this.open) return;
    const panel = node('section', '', 'au-friend-alerts-panel');
    panel.id = 'au-friend-alerts-panel';
    panel.dataset.media = String(currentMedia?.id ?? '');
    panel.setAttribute('aria-label', 'Friend activity alerts');
    if (!currentMedia) {
      this.renderInbox(panel);
      this.finishPanel(panel, focus);
      return;
    }
    if (this.root.dataset.mode === 'dialog') {
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'true');
    }
    const header = node('div', '', 'au-friend-alerts-heading');
    header.append(
      node('h2', 'Friend alerts'),
      button('Close', () => {
        this.close();
      })
    );
    panel.append(header);
    panel.append(
      node(
        'p',
        currentMedia
          ? 'Choose whose activity you want to follow for this title.'
          : 'Activity on your followed titles. Open a title to add an alert.'
      )
    );
    if (!this.auth.hasToken()) {
      panel.append(node('p', 'Sign in through the extension to enable alerts.'));
      this.root.append(panel);
      this.panel = panel;
      return;
    }
    const media = this.media();
    if (media) {
      const editor = node('form', '', 'au-friend-alerts-editor');
      editor.append(node('strong', `Follow activity on ${media.title}`));
      const label = node('label', 'Notify me about ');
      const select = node('select');
      select.dataset.focus = 'audience';
      const following = node('option', 'People I follow');
      following.value = '';
      select.append(following);
      const rule = this.state.rules.find((rule) => rule.mediaId === media.id);
      const lists = this.lists.getLists();
      for (const name of Object.keys(lists)) {
        const option = node('option', `${name} (${lists[name].length})`);
        option.value = name;
        select.append(option);
      }
      if (rule?.list && !Object.prototype.hasOwnProperty.call(lists, rule.list)) {
        const option = node('option', `${rule.list} (unavailable)`);
        option.value = rule.list;
        option.disabled = true;
        select.append(option);
      }
      select.value = selected ?? rule?.list ?? '';
      select.disabled = this.busy;
      label.append(select);
      editor.append(label);
      editor.append(
        button(rule ? 'Update alert' : 'Enable alert', () => {
          void this.run('watch', { mediaId: media.id, list: select.value || null });
        })
      );
      editor.addEventListener('submit', (event) => event.preventDefault());
      if (rule)
        editor.append(
          button('Disable alert', () => {
            void this.run('remove', { mediaId: media.id });
          })
        );
      panel.append(editor);
    }
    if (media) {
      const message = node('p', this.busy ? 'Updating…' : this.message);
      message.setAttribute('role', 'status');
      panel.append(message);
      const inbox = node('a', `View all friend alerts${unread ? ` · ${unread} unread` : ''}`);
      inbox.href = '/notifications/#friend-alerts';
      panel.append(inbox);
      this.finishPanel(panel, focus);
      return;
    }
  }
  private renderInbox(panel: HTMLElement): void {
    if (!this.auth.hasToken()) {
      panel.append(node('p', 'Sign in through the extension to enable alerts.'));
      return;
    }
    const toolbar = node('div', '', 'au-friend-alerts-toolbar');
    const tabs = node('div', '', 'au-friend-alerts-tabs');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Friend alerts views');
    for (const tab of ['activity', 'following'] as const) {
      const control = button(tab === 'activity' ? 'Activity' : 'Following', () => {
        this.inboxTab = tab;
        this.render();
        this.panel?.querySelector<HTMLElement>(`[data-focus="tab-${tab}"]`)?.focus();
      });
      control.className = 'au-friend-alerts-tab';
      control.dataset.focus = `tab-${tab}`;
      control.id = `au-friend-alerts-tab-${tab}`;
      control.setAttribute('role', 'tab');
      control.setAttribute('aria-selected', String(this.inboxTab === tab));
      control.tabIndex = this.inboxTab === tab ? 0 : -1;
      control.setAttribute('aria-controls', 'au-friend-alerts-content');
      if (tab === 'following')
        control.append(node('span', String(this.state.rules.length), 'au-friend-alerts-tab-count'));
      control.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        this.inboxTab =
          event.key === 'Home'
            ? 'activity'
            : event.key === 'End'
              ? 'following'
              : this.inboxTab === 'activity'
                ? 'following'
                : 'activity';
        this.render();
        this.panel?.querySelector<HTMLElement>(`[data-focus="tab-${this.inboxTab}"]`)?.focus();
      });
      tabs.append(control);
    }
    const actions = node('div', '', 'au-friend-alerts-toolbar-actions');
    const refresh = iconButton('Check now', 'fa-arrow-rotate-right', () => {
      void this.run('poll', { manual: true });
    });
    refresh.classList.toggle('is-checking', this.busy);
    actions.append(refresh);
    if (this.state.alerts.length) {
      actions.append(
        iconButton('Mark all read', 'fa-check-double', () => {
          void this.run('read');
        })
      );
      const more = node('details', '', 'au-friend-alerts-more');
      const summary = node('summary');
      summary.title = 'More actions';
      summary.setAttribute('aria-label', 'More actions');
      summary.append(icon('fa-ellipsis'));
      const menu = node('div', '', 'au-friend-alerts-menu');
      menu.append(
        button('Clear inbox', () => {
          void this.run('clear');
        })
      );
      more.append(summary, menu);
      actions.append(more);
    }
    toolbar.append(tabs, actions);
    panel.append(toolbar);
    const content = node('div', '', 'au-friend-alerts-content');
    content.id = 'au-friend-alerts-content';
    content.setAttribute('role', 'tabpanel');
    content.setAttribute('aria-labelledby', `au-friend-alerts-tab-${this.inboxTab}`);
    content.tabIndex = 0;
    if (this.inboxTab === 'following') this.renderFollowing(content);
    else this.renderActivity(content);
    panel.append(content);
    const message = node(
      'p',
      this.busy ? 'Checking for updates…' : this.message,
      'au-friend-alerts-status'
    );
    message.setAttribute('role', 'status');
    panel.append(message);
    if (this.state.failed)
      panel.append(
        node(
          'p',
          'Some titles couldn’t be checked. We’ll retry automatically.',
          'au-friend-alerts-status'
        )
      );
    else if (this.state.groups?.some((group) => !group.complete && group.page > 1))
      panel.append(node('p', 'Catching up on recent activity…', 'au-friend-alerts-status'));
  }
  private emptyState(parent: HTMLElement, title: string, description: string): void {
    const empty = node('div', '', 'au-friend-alerts-empty');
    const glyph = node('span', '', 'au-friend-alerts-empty-icon');
    glyph.append(icon('fa-bell'));
    empty.append(glyph, node('strong', title), node('p', description));
    parent.append(empty);
  }
  private renderFollowing(parent: HTMLElement): void {
    if (!this.state.rules.length) {
      this.emptyState(
        parent,
        'Follow your first title',
        'Use the bell on an anime or manga page to choose whose activity to follow.'
      );
      return;
    }
    this.rulesPage = Math.min(this.rulesPage, Math.ceil(this.state.rules.length / PAGE_SIZE) - 1);
    const rules = [...this.state.rules].sort((a, b) => a.title.localeCompare(b.title));
    for (const rule of rules.slice(this.rulesPage * PAGE_SIZE, (this.rulesPage + 1) * PAGE_SIZE)) {
      const row = node('div', '', 'au-friend-alerts-rule');
      const kind = node('span', rule.mediaType === 'ANIME' ? 'A' : 'M', 'au-friend-alerts-kind');
      kind.title = rule.mediaType === 'ANIME' ? 'Anime' : 'Manga';
      const link = node('a', rule.title);
      link.href = `/${rule.mediaType.toLowerCase()}/${rule.mediaId}/`;
      const details = node('div', '', 'au-friend-alerts-rule-details');
      details.append(
        link,
        node('span', rule.list ?? 'People I follow', 'au-friend-alerts-audience')
      );
      const remove = iconButton(`Stop following ${rule.title}`, 'fa-xmark', () => {
        void this.run('remove', { mediaId: rule.mediaId });
      });
      row.append(kind, details, remove);
      parent.append(row);
    }
    this.pagination(parent, this.rulesPage, rules.length, (page) => {
      this.rulesPage = page;
    });
  }
  private renderActivity(parent: HTMLElement): void {
    if (!this.state.alerts.length) {
      this.emptyState(
        parent,
        this.state.rules.length ? 'You’re all caught up' : 'Follow your first title',
        this.state.rules.length
          ? 'New activity from your friends will appear here.'
          : 'Use the bell on an anime or manga page to get started.'
      );
      return;
    }
    this.alertsPage = Math.min(
      this.alertsPage,
      Math.ceil(this.state.alerts.length / PAGE_SIZE) - 1
    );
    for (const alert of this.state.alerts.slice(
      this.alertsPage * PAGE_SIZE,
      (this.alertsPage + 1) * PAGE_SIZE
    )) {
      const row = node('article', '', `au-friend-alerts-item${alert.read ? '' : ' is-unread'}`);
      const avatar = node(
        'span',
        [...alert.userName][0]?.toUpperCase() ?? '?',
        'au-friend-alerts-avatar'
      );
      avatar.setAttribute('aria-hidden', 'true');
      const link = node('a');
      link.href = `/activity/${alert.id}/`;
      link.append(
        node('strong', alert.userName, 'au-friend-alerts-user'),
        document.createTextNode(` ${alert.status}${alert.progress ? ` ${alert.progress}` : ''} `),
        node('strong', alert.title, 'au-friend-alerts-media')
      );
      link.addEventListener('click', () => {
        void this.run('read', { id: alert.id });
      });
      const date = new Date(alert.createdAt * 1000);
      const seconds = Math.max(0, Math.floor(Date.now() / 1000) - alert.createdAt);
      const label =
        seconds < 60
          ? 'Just now'
          : seconds < 3600
            ? `${Math.floor(seconds / 60)}m ago`
            : seconds < 86400
              ? `${Math.floor(seconds / 3600)}h ago`
              : `${Math.floor(seconds / 86400)}d ago`;
      const time = node('time', label);
      time.dateTime = date.toISOString();
      time.title = date.toLocaleString();
      row.append(avatar, link, time);
      parent.append(row);
    }
    this.pagination(parent, this.alertsPage, this.state.alerts.length, (page) => {
      this.alertsPage = page;
    });
  }
  private pagination(
    parent: HTMLElement,
    current: number,
    total: number,
    update: (page: number) => void
  ): void {
    if (total <= PAGE_SIZE) return;
    const pager = node('div', '', 'au-friend-alerts-pagination');
    const previous = button('Previous', () => {
      update(current - 1);
      this.render();
    });
    previous.disabled = current === 0;
    previous.dataset.boundaryDisabled = String(previous.disabled);
    const next = button('Next', () => {
      update(current + 1);
      this.render();
    });
    next.disabled = (current + 1) * PAGE_SIZE >= total;
    next.dataset.boundaryDisabled = String(next.disabled);
    pager.append(
      previous,
      node(
        'span',
        `${current * PAGE_SIZE + 1}–${Math.min((current + 1) * PAGE_SIZE, total)} of ${total}`
      ),
      next
    );
    parent.append(pager);
  }
  private finishPanel(panel: HTMLElement, focus?: string): void {
    Array.from(panel.querySelectorAll<HTMLButtonElement>('button')).forEach((control, index) => {
      control.disabled = this.busy || control.dataset.boundaryDisabled === 'true';
      control.dataset.focus ??= `button-${index}`;
    });
    this.root?.append(panel);
    this.panel = panel;
    if (focus) panel.querySelector<HTMLElement>(`[data-focus="${focus}"]`)?.focus();
  }
  override async destroy(): Promise<void> {
    this.initialized = false;
    this.unsubscribeConfig?.();
    this.unsubscribeConfig = null;
    this.deactivate();
    await super.destroy();
  }
  private deactivate(): void {
    if (!this.active) return;
    this.active = false;
    this.version++;
    clearInterval(this.timer);
    this.timer = undefined;
    this.busy = false;
    this.open = false;
    this.message = '';
    this.observer.unregister(this.getName());
    this.runtimeEvents.removeListener(this.listener);
    document.removeEventListener('keydown', this.keydown);
    document.removeEventListener('visibilitychange', this.visible);
    this.navbar.clear();
    this.clearWatchButton();
    this.root?.remove();
    this.watchButton = null;
    this.root = null;
    this.bell = null;
    this.panel = null;
    this.state = emptyFriendAlerts();
  }
}
