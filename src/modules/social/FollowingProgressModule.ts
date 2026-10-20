import { inject, injectable } from 'tsyringe';
import { BaseModule } from '@core/modules/BaseModule';
import { TOKENS } from '@core/di/tokens';
import type { IApiClient } from '@core/interfaces/IApiClient';
import type { IEventBus } from '@core/interfaces/IEventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { logger } from '@core/logger';
import { getMediaRoute } from '@core/navigation/MediaRoute';
import { FollowingProgressService, FOLLOWING_PROGRESS_TTL } from './FollowingProgressService';
import '../../styles/following.css';

export function isFollowingProgressRoute(path: string): boolean {
  const media = getMediaRoute(path);
  return media?.type === 'ANIME' && media.id <= 2147483647
    && /^\/anime\/[1-9]\d*(?:\/[^/]+)?(?:\/social)?\/?$/.test(path)
    && !/^\/anime\/\d+\/(characters|staff|stats|reviews|recommendations)\/?$/.test(path);
}

interface FollowingRow {
  link: HTMLAnchorElement;
  status: HTMLElement;
  username: string;
  mediaId: number;
  path: string;
  badge?: HTMLElement;
  progress?: number;
  pending: boolean;
  refreshAt: number;
}

/** Enhances native Following rows independently of note/tooltip availability. */
@injectable()
export class FollowingProgressModule extends BaseModule {
  private active = false;
  private version = 0;
  private contextKey = '';
  private rows = new Map<HTMLElement, FollowingRow>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private activeReads = 0;
  private layoutSection: HTMLElement | null = null;

  constructor(
    @inject(TOKENS.ApiClient) private api: IApiClient,
    @inject(FollowingProgressService) private progress: FollowingProgressService,
    @inject(TOKENS.EventBus) protected eventBus: IEventBus
  ) { super(eventBus); }

  getName(): string { return 'followingProgress'; }

  async init(): Promise<void> {
    if (this.active) return;
    this.active = true;
    this.onPageChange(() => {
      void this.restart().catch((error: unknown) => logger.error('[FollowingProgress] Restart failed', error));
    });
    this.subscribe(EVENT_TYPES.AUTH_STATE_CHANGED, () => {
      void this.restart().catch((error: unknown) => logger.error('[FollowingProgress] Restart failed', error));
    });
    await this.restart();
  }

  private reset(): void {
    this.version++;
    this.cleanup();
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.rows.forEach(row => { row.badge?.remove(); row.link.classList.remove('au-following-row'); });
    this.rows.clear();
    this.layoutSection?.classList.remove('au-following-section');
    this.layoutSection = null;
    this.progress.clear();
  }

  private async restart(): Promise<void> {
    this.reset();
    const version = this.version;
    if (!this.active || !isFollowingProgressRoute(location.pathname) || !this.api.isAuthenticated()) return;
    try { await this.api.ensureContext?.(); } catch { return; }
    if (!this.active || version !== this.version || !this.api.isAuthenticated()) return;
    this.contextKey = this.getContextKey();
    this.registerObserver('following-progress', document.body,
      { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['href'] }, () => this.scan());
    this.timer = setInterval(() => this.scan(), 30000);
    this.scan();
  }

  private getContextKey(): string {
    const context = this.api.getContext?.();
    return JSON.stringify([this.api.isAuthenticated(), context?.sessionId, context?.userId]);
  }

  private username(link: HTMLAnchorElement): string | null {
    try {
      const url = new URL(link.getAttribute('href') || '', location.origin);
      const match = /^\/user\/([^/]+)\/?$/.exec(url.pathname);
      const name = match ? decodeURIComponent(match[1]) : '';
      return url.origin === location.origin && name.trim() && name.length <= 100 ? name : null;
    } catch { return null; }
  }

  private section(): HTMLElement | null {
    const section = document.querySelector<HTMLElement>('.following');
    if (section && !/\/social\/?$/.test(location.pathname)) return section;
    const header = [...document.querySelectorAll('h2, h3, .section-header')].find(node => node.textContent?.trim().toLowerCase() === 'following');
    if (!header) return section;
    const sectionByHeader = header.closest<HTMLElement>('.grid-section, section');
    if (sectionByHeader?.querySelector('a[href*="/user/"]')) return sectionByHeader;
    const next = header.nextElementSibling as HTMLElement | null;
    if (next?.querySelector('a[href*="/user/"]')) return next;
    return header.parentElement?.querySelector('a[href*="/user/"]') ? header.parentElement : null;
  }

  private valid(row: FollowingRow): boolean {
    return this.active && this.api.isAuthenticated() && this.contextKey === this.getContextKey()
      && location.pathname === row.path && row.link.isConnected && row.status.isConnected
      && row.username === this.username(row.link) && !!this.section()?.contains(row.link)
      && (row.link.contains(row.status) || row.link.closest('.user-status-row, .following-list-item')?.contains(row.status) === true);
  }

  private scan(): void {
    if (!this.active) return;
    if (this.contextKey !== this.getContextKey() || !isFollowingProgressRoute(location.pathname)) {
      void this.restart(); return;
    }
    const section = this.section();
    const media = getMediaRoute(location.pathname);
    if (!media) return;
    const found = new Map<HTMLElement, { link: HTMLAnchorElement; username: string }>();
    section?.querySelectorAll<HTMLAnchorElement>('a[href*="/user/"]').forEach(link => {
      const status = link.querySelector<HTMLElement>('.status')
        ?? link.closest('.user-status-row, .following-list-item')?.querySelector<HTMLElement>('.status');
      const username = this.username(link);
      if (status && username && !found.has(status)) found.set(status, { link, username });
    });
    this.rows.forEach((row, status) => {
      const candidate = found.get(status);
      if (!candidate || candidate.link !== row.link || candidate.username !== row.username || row.mediaId !== media.id || !this.valid(row)) {
        row.badge?.remove(); row.link.classList.remove('au-following-row'); this.rows.delete(status);
      }
    });
    found.forEach(({ link, username }, status) => {
      if (!this.rows.has(status)) this.rows.set(status, { link, status, username, mediaId: media.id,
        path: location.pathname, pending: false, refreshAt: 0 });
      if (link.matches('a.follow') && link.contains(status)) link.classList.add('au-following-row');
    });
    const layoutSection = found.size ? section : null;
    if (layoutSection !== this.layoutSection) {
      this.layoutSection?.classList.remove('au-following-section');
      this.layoutSection = layoutSection;
      layoutSection?.classList.add('au-following-section');
    }
    // Vue clones markup without our row ownership; discard only orphaned counters.
    const owned = new Set([...this.rows.values()].map(row => row.badge));
    section?.querySelectorAll('.au-following-progress').forEach(node => { if (!owned.has(node as HTMLElement)) node.remove(); });
    this.rows.forEach(row => {
      if (this.valid(row)) this.renderProgress(row);
    });
    this.pump();
  }

  private renderProgress(row: FollowingRow): void {
    // Use the displayed native state so a Vue status change takes effect even
    // while progress is cached. Ignore our own text when reading that state.
    const status = [...row.status.childNodes].filter(node => node !== row.badge).map(node => node.textContent ?? '').join('').trim();
    if (/^completed\b/i.test(status) || row.progress === undefined || row.progress <= 0) {
      row.badge?.remove(); row.badge = undefined; return;
    }
    const badge = row.badge ?? document.createElement('span');
    badge.className = 'au-following-progress';
    const label = ` · ${row.progress} ep`;
    if (badge.textContent !== label) badge.textContent = label;
    if (badge.parentElement !== row.status) row.status.appendChild(badge);
    row.badge = badge;
  }

  private pump(): void {
    if (!this.active) return;
    for (const row of this.rows.values()) {
      if (this.activeReads >= 8) break;
      if (row.pending || row.refreshAt > Date.now() || !this.valid(row)) continue;
      const version = this.version;
      row.pending = true; this.activeReads++;
      void this.progress.getProgress(row.username, row.mediaId).then(value => {
        if (version !== this.version || this.rows.get(row.status) !== row || !this.valid(row)) return;
        row.refreshAt = Date.now() + (value === undefined ? 30000 : FOLLOWING_PROGRESS_TTL);
        row.progress = value;
        this.renderProgress(row);
      }).finally(() => { row.pending = false; this.activeReads--; this.pump(); });
    }
  }

  override async destroy(): Promise<void> {
    this.active = false; this.reset();
    await super.destroy();
  }
}
