import { inject, injectable } from 'tsyringe';
import { BaseModule } from '@core/modules/BaseModule';
import { TOKENS } from '@core/di/tokens';
import type { IApiClient } from '@core/interfaces/IApiClient';
import type { IEventBus } from '@core/interfaces/IEventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { logger } from '@core/logger';
import { getMediaRoute } from '@core/navigation/MediaRoute';
import type { CustomListClient } from './CustomListClient';
import type { CustomLists } from './CustomListService';
import { FollowingGroupsService } from './FollowingGroupsService';
import { planFollowingGroups, type FollowingGroupPlan, type FollowingGroupsConfig } from './FollowingGrouping';
import { FollowingMediaReader, type FollowingMediaEntry, type FollowingMediaResult } from './FollowingMediaReader';
import { OVERVIEW_LIMIT, hasEnabledMembers, rankOverview, type OverviewCandidate } from './FollowingOverviewPlan';
import {
  CLONE_CLASS,
  clearGapVar,
  createClone,
  createHeader,
  setClass,
  setGear,
  setOrder,
  setText,
  syncGapVar,
  type GroupHeader,
} from './FollowingGroupsDom';
import { FollowingNativeLayout, type NativeOrder } from './FollowingNativeLayout';
import {
  isFollowingGroupsOverviewRoute,
  isFollowingGroupsPageRoute,
  isFollowingGroupsRoute,
} from './FollowingGroupsRoutes';
import { findFollowingSection, followingUsername } from './FollowingSection';
import '../../styles/following-groups.css';

export {
  isFollowingGroupsOverviewRoute,
  isFollowingGroupsPageRoute,
  isFollowingGroupsRoute,
} from './FollowingGroupsRoutes';

const GROUPED = 'au-following-grouped';
const GROUPED_FLEX = 'au-following-grouped-flex';
const ROW_SELECTOR = '.user-status-row, .following-list-item';
const FLEX_OR_GRID = /^(inline-)?(flex|grid)$/;

interface Snapshot {
  lists: CustomLists;
  config: FollowingGroupsConfig;
}
interface Row {
  row: HTMLElement;
  username: string;
}
type FetchState = 'idle' | 'loading' | 'ready' | 'failed';

/**
 * Groups the native Following column on the Social tab (headers and CSS order). On the title Overview it shows
 * at most OVERVIEW_LIMIT rows by group priority. Native nodes are styled, never moved or re-parented.
 */
@injectable()
export class FollowingGroupsModule extends BaseModule {
  private active = false;
  private version = 0;
  private snapshot: Snapshot | null = null;
  private parent: HTMLElement | null = null;
  private flexParent = false;
  private headers = new Map<string | null, GroupHeader>();
  private clones = new Map<string, HTMLElement>();
  private native = new FollowingNativeLayout();
  private unsubscribers: Array<() => void> = [];
  private fetchState: FetchState = 'idle';
  private fetched: FollowingMediaResult | null = null;

  constructor(
    @inject(TOKENS.ApiClient) private api: IApiClient,
    @inject(TOKENS.CustomListService) private listService: CustomListClient,
    @inject(FollowingGroupsService) private groupService: FollowingGroupsService,
    @inject(FollowingMediaReader) private media: FollowingMediaReader,
    @inject(TOKENS.EventBus) protected eventBus: IEventBus
  ) {
    super(eventBus);
  }

  getName(): string {
    return 'followingGroups';
  }

  async init(): Promise<void> {
    if (this.active) return;
    this.active = true;
    this.onPageChange(() => {
      void this.restart().catch((error: unknown) => logger.error('[FollowingGroups] Restart failed', error));
    });
    this.subscribe(EVENT_TYPES.AUTH_STATE_CHANGED, () => {
      void this.restart().catch((error: unknown) => logger.error('[FollowingGroups] Restart failed', error));
    });
    await this.restart();
  }

  private reset(): void {
    this.version++;
    this.cleanup();
    this.unsubscribers.splice(0).forEach((unsubscribe) => unsubscribe());
    this.snapshot = null;
    this.fetchState = 'idle';
    this.fetched = null;
    this.clear();
  }

  private async restart(): Promise<void> {
    this.reset();
    const version = this.version;
    if (!this.active || !isFollowingGroupsPageRoute(location.pathname) || !this.api.isAuthenticated()) return;
    try {
      await Promise.all([this.listService.init(), this.groupService.init()]);
    } catch (error) {
      logger.warn('[FollowingGroups] Groups unavailable; Following column left unchanged', error);
      return;
    }
    if (!this.active || version !== this.version || !this.api.isAuthenticated()) return;
    this.capture();
    const refresh = (): void => {
      this.capture();
      this.scan();
    };
    this.unsubscribers.push(this.listService.onChange(refresh), this.groupService.onChange(refresh));
    this.registerObserver(
      'following-groups',
      document.body,
      { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] },
      () => this.scan()
    );
    this.scan();
  }

  /** Snapshots refresh only from change events, which avoids cloning every list on each scan. */
  private capture(): void {
    this.snapshot = { lists: this.listService.getLists(), config: this.groupService.getConfig() };
  }

  private scan(): void {
    const snapshot = this.snapshot;
    const path = location.pathname;
    const social = isFollowingGroupsRoute(path);
    if (!this.active || !snapshot || !(social || isFollowingGroupsOverviewRoute(path))) {
      this.clear();
      return;
    }
    const rows = this.collectRows(findFollowingSection());
    const parent = rows[0]?.row.parentElement ?? null;
    if (!parent || rows.some(({ row }) => row.parentElement !== parent)) {
      this.clear();
      return;
    }
    if (parent !== this.parent) this.adopt(parent);
    this.native.releaseDetached(parent);
    if (social) this.scanSocial(parent, rows, snapshot);
    else this.scanOverview(parent, rows, snapshot);
  }

  private scanSocial(parent: HTMLElement, rows: Row[], snapshot: Snapshot): void {
    this.removeClones();
    const plan = planFollowingGroups(rows.map(({ username }) => username), snapshot.lists, snapshot.config);
    if (!plan.active) {
      this.clear();
      return;
    }
    this.setGroupedClasses(true);
    syncGapVar(parent, rows[0].row);
    this.syncHeaders(parent, plan);
    const orders = new Map<HTMLElement, NativeOrder>();
    for (const { row, username } of rows) {
      const group = plan.assignment.get(username.toLowerCase()) ?? plan.groups.length - 1;
      orders.set(row, { order: String(2 * group + 1), hidden: plan.groups[group].collapsed });
    }
    this.native.apply(parent, orders, String(2 * plan.groups.length + 1), this.ownNodes());
  }

  /** Overview: no headers. At most OVERVIEW_LIMIT rows, group members first, fetched members cloned in. */
  private scanOverview(parent: HTMLElement, rows: Row[], snapshot: Snapshot): void {
    if (!hasEnabledMembers(snapshot.lists, snapshot.config)) {
      this.clear();
      return;
    }
    if (this.fetchState === 'idle') this.startFetch();
    if (this.fetchState === 'loading') return;
    const result = this.fetchState === 'ready' ? this.fetched : null;
    const nativeKeys = new Set(rows.map(({ username }) => username.toLowerCase()));
    const extras = (result?.entries ?? []).filter((entry) => !nativeKeys.has(entry.name.toLowerCase()));
    const plan = planFollowingGroups(
      [...rows.map(({ username }) => username), ...extras.map((entry) => entry.name)],
      snapshot.lists,
      snapshot.config
    );
    if (!plan.active) {
      this.clear();
      return;
    }
    const candidates: OverviewCandidate[] = [
      ...rows.map((row, index) => ({ key: row.username.toLowerCase(), kind: 'native' as const, index })),
      ...extras.map((entry, index) => ({ key: entry.name.toLowerCase(), kind: 'fetched' as const, index })),
    ];
    const ranked = rankOverview(candidates, plan.assignment, OVERVIEW_LIMIT);
    const rank = new Map<string, number>(
      ranked.map((candidate, position): [string, number] => [candidate.key, position])
    );
    this.removeClones(new Set(rank.keys()));
    this.setGroupedClasses(true);
    const orders = new Map<HTMLElement, NativeOrder>();
    for (const { row, username } of rows) {
      const position = rank.get(username.toLowerCase());
      orders.set(row, { order: String(position ?? OVERVIEW_LIMIT), hidden: position === undefined });
    }
    this.native.apply(parent, orders, String(OVERVIEW_LIMIT), this.ownNodes());
    const format = result?.scoreFormat ?? 'POINT_100';
    for (const candidate of ranked) {
      if (candidate.kind !== 'fetched') continue;
      this.placeClone(parent, rows[0].row, extras[candidate.index], format, rank.get(candidate.key) ?? 0);
    }
  }

  private placeClone(
    parent: HTMLElement,
    template: HTMLElement,
    entry: FollowingMediaEntry,
    format: FollowingMediaResult['scoreFormat'],
    order: number
  ): void {
    const key = entry.name.toLowerCase();
    let clone = this.clones.get(key);
    if (!clone) {
      clone = createClone(template, entry, format, getMediaRoute(location.pathname)?.type ?? 'ANIME');
      this.clones.set(key, clone);
    }
    setOrder(clone, String(order));
    if (clone.parentElement !== parent) parent.appendChild(clone);
  }

  /** One read per visit: later scans reuse the result, and only a new visit (restart) fetches again. */
  private startFetch(): void {
    const route = getMediaRoute(location.pathname);
    if (!route) return;
    const version = this.version;
    this.fetchState = 'loading';
    this.media.read(route.id).then(
      (result) => {
        if (version !== this.version) return;
        this.fetched = result;
        this.fetchState = 'ready';
        this.scan();
      },
      (error: unknown) => {
        if (version !== this.version) return;
        this.fetchState = 'failed';
        logger.warn('[FollowingGroups] Overview members unavailable', error);
        this.scan();
      }
    );
  }

  /** Rows must share one parent: the native column is a single container, and mixed parents mean an unknown layout. */
  private collectRows(section: HTMLElement | null): Row[] {
    if (!section) return [];
    const rows: Row[] = [];
    const seen = new Set<HTMLElement>();
    section.querySelectorAll<HTMLAnchorElement>('a[href*="/user/"]').forEach((link) => {
      if (link.closest(`.au-following-group-header, .${CLONE_CLASS}`)) return;
      const status =
        link.querySelector<HTMLElement>('.status') ?? link.closest(ROW_SELECTOR)?.querySelector<HTMLElement>('.status');
      const username = followingUsername(link);
      const row = link.closest<HTMLElement>(ROW_SELECTOR) ?? link;
      if (!status || !username || seen.has(row) || !section.contains(row)) return;
      seen.add(row);
      rows.push({ row, username });
    });
    return rows;
  }

  private adopt(parent: HTMLElement): void {
    this.clear();
    this.parent = parent;
    this.flexParent = !FLEX_OR_GRID.test(getComputedStyle(parent).display);
  }

  private syncHeaders(parent: HTMLElement, plan: FollowingGroupPlan): void {
    const wanted = new Set(plan.groups.map((group) => group.name));
    for (const [key, header] of [...this.headers]) {
      if (wanted.has(key)) continue;
      header.element.remove();
      this.headers.delete(key);
    }
    plan.groups.forEach((group, index) => {
      const header = this.headers.get(group.name) ?? this.addHeader(group.name);
      setText(header.label, group.label);
      setText(header.count, String(group.count));
      const expanded = String(!group.collapsed);
      if (header.toggle.getAttribute('aria-expanded') !== expanded)
        header.toggle.setAttribute('aria-expanded', expanded);
      setClass(header.element, 'au-following-group-header--first', index === 0);
      setGear(header.element, index === 0);
      setOrder(header.element, String(2 * index));
      if (header.element.parentElement !== parent) parent.appendChild(header.element);
    });
  }

  private addHeader(name: string | null): GroupHeader {
    const header = createHeader(name, () => this.toggle(name));
    this.headers.set(name, header);
    return header;
  }

  private toggle(name: string | null): void {
    const expanded = this.headers.get(name)?.toggle.getAttribute('aria-expanded') === 'true';
    this.groupService
      .setCollapsed(name, expanded)
      .catch((error: unknown) => logger.error('[FollowingGroups] Failed to save group state', error));
  }

  private ownNodes(): Set<Element> {
    const own = new Set<Element>();
    this.headers.forEach((header) => own.add(header.element));
    this.clones.forEach((clone) => own.add(clone));
    return own;
  }

  private setGroupedClasses(on: boolean): void {
    if (!this.parent) return;
    setClass(this.parent, GROUPED, on);
    setClass(this.parent, GROUPED_FLEX, on && this.flexParent);
  }

  /** Removes our clones, except those whose username is in `keep`. */
  private removeClones(keep: Set<string> = new Set()): void {
    for (const [key, clone] of [...this.clones]) {
      if (keep.has(key)) continue;
      clone.remove();
      this.clones.delete(key);
    }
  }

  private clear(): void {
    this.headers.forEach((header) => header.element.remove());
    this.headers.clear();
    this.removeClones();
    this.native.restoreAll();
    if (this.parent) {
      this.setGroupedClasses(false);
      clearGapVar(this.parent);
    }
    this.parent = null;
    this.flexParent = false;
  }

  override async destroy(): Promise<void> {
    this.active = false;
    this.reset();
    await super.destroy();
  }
}
