/**
 * @file AstraWorkTable.ts
 * @description Main data grid for Astra works.
 * Refactored to use DI and secure `html` templates.
 */

import { injectable, inject } from 'tsyringe';
import { AstraView } from '../base/AstraView';
import { AstraDashboardStore } from '../../store/AstraDashboardStore';
import { IDashboardState, AstraSortType } from '../../interfaces/IDashboardState';
import { AstraService } from '../../AstraService';
import type { AstraSection, AstraWorkSummary } from '../../AstraInterfaces';
import { AstraRatingModal } from '../AstraRatingModal';
import { TOKENS } from '@core/di/tokens';
import { html, map } from '@core/utils/Template';
import { AstraRowRenderer } from './AstraRowRenderer';
import { MediaListStatus } from '@/api/AnilistTypes';
import { getStatusLabel } from '@core/utils/UIHelpers';
import { AstraWindowPlanner } from './AstraWindowPlanner';
import { sectionColumnsStyle } from './AstraTableColumns';
import type { ICalendarService } from '@core/interfaces/ICalendarService';
import type { IApiClient } from '@core/interfaces/IApiClient';
import type { IEventBus } from '@core/interfaces/IEventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { logger } from '@core/logger';

type AstraWorkGroup = {
  status: string;
  count: number;
  collapsed: boolean;
  works: AstraWorkSummary[];
};

@injectable()
export class AstraWorkTable extends AstraView<IDashboardState> {
  private static readonly RENDER_CHUNK_SIZE = 50;
  private static readonly RENDER_CHUNK_DELAY_MS = 75;
  private readonly collapsedGroups = new Set<string>([
    MediaListStatus.COMPLETED,
    MediaListStatus.PLAN_TO_WATCH,
    MediaListStatus.PLAN_TO_READ,
    MediaListStatus.PAUSED,
    MediaListStatus.DROPPED,
    MediaListStatus.REWATCHING,
    MediaListStatus.REREADING,
    'UNKNOWN',
  ]);
  private renderProcessId = 0;
  private pendingGroups: AstraWorkGroup[] = [];
  private pendingSections: AstraSection[] = [];
  private pendingCompact = false;
  private pendingGrid = false;
  private pendingBody: HTMLElement | null = null;
  private renderedGroupCounts = new Map<string, number>();
  private renderTimer: number | null = null;
  private renderFrame: number | null = null;
  private readonly renderedRows = new Map<number, HTMLElement>();
  private readonly renderedHeaders = new Map<string, HTMLElement>();
  private sectionSignature = '';
  private windowPlanner: AstraWindowPlanner | null = null;
  private windowObserver: ResizeObserver | null = null;
  private readonly windowHeights = new Map<string, number>();
  private windowColumns = 1;
  private windowRowHeight = 100;
  private windowWidth = 0;
  private windowStart = -1;
  private windowEnd = -1;
  private savedScrollTop = 0;
  private savedScrollLeft = 0;
  private savedAnchor: { mediaId?: number; status: string; offset: number } | null = null;
  private focusTimer: number | null = null;
  private focusedMediaId: number | null = null;
  private closeImagePreview: (() => void) | null = null;
  private airingMediaIds = new Set<number>();
  private airingRequestId = 0;
  private airingLoadedAt = 0;
  private airingLoadPromise: Promise<void> | null = null;
  private airingUserId: number | null = null;
  private airingOwnerVerified = false;
  private unsubscribeAiringAuth: (() => void) | null = null;

  constructor(
    @inject(TOKENS.AstraStore) private store: AstraDashboardStore,
    @inject(TOKENS.AstraService) private service: AstraService,
    @inject(AstraRatingModal) private ratingController: AstraRatingModal,
    @inject(TOKENS.CalendarService) private calendarService?: ICalendarService,
    @inject(TOKENS.ApiClient) private api?: Pick<IApiClient, 'getCurrentUserId'>,
    @inject(TOKENS.EventBus) private eventBus?: IEventBus
  ) {
    super({});
    // Safety re-render after DI assignment
    this.element = this.render();
  }

  // Sections can change outside dashboard state; avoid BaseComponent's full-list
  // serialization and check the actual rendering dependencies in onUpdate.
  protected override shouldUpdate(): boolean {
    return true;
  }

  protected override onUpdate(prevState?: Partial<IDashboardState>): boolean {
    if (!this.mounted) return false;
    const body = this.$('.astra-grid-body');
    const state = this.props;
    if (!state.filteredWorks || !state.stats) return false;

    if (prevState && prevState.layout !== state.layout) {
      this.renderProcessId++;
      return false;
    }

    if (prevState && prevState.separateAiring !== state.separateAiring) {
      this.renderVisibleRows();
      if (state.separateAiring) void this.loadAiringMediaIds().catch((error: unknown) => logger.error('[AstraWorkTable] Airing refresh failed', error));
      else this.cancelAiringDataRequest();
      return true;
    }

    if (state.filteredWorks.length === 0) {
      this.renderProcessId++;
      // Re-render only if the empty-state variant actually changed
      // (importer vs. "no results"); otherwise skip to avoid replaying
      // the portal's entrance animation on every filter click.
      const showsEmptyState = this.element?.classList.contains('astra-empty-state') ?? false;
      const showsImporter =
        this.element?.classList.contains('astra-empty-state--importer') ?? false;
      const needsImporter = state.stats.totalCount === 0;
      return showsEmptyState && showsImporter === needsImporter;
    }

    // Switch between populated grid and empty/import states with a full rerender.
    if (!body) return false;

    const sections = this.service.getSections();
    if (JSON.stringify(sections) !== this.sectionSignature || prevState?.sort !== state.sort) {
      return false;
    }
    if (JSON.stringify(prevState?.filters) !== JSON.stringify(state.filters)) {
      this.renderVisibleRows();
      return true;
    }
    if (this.updateProgressOnly(prevState?.filteredWorks, state.filteredWorks, sections))
      return true;

    this.renderVisibleRows();
    return true;
  }

  protected override onMount(): void {
    this.unsubscribeAiringAuth =
      this.eventBus?.on(EVENT_TYPES.AUTH_STATE_CHANGED, () => {
        this.cancelAiringDataRequest();
        this.airingMediaIds.clear();
        this.airingLoadedAt = 0;
        this.airingUserId = null;
        this.airingOwnerVerified = false;
        this.renderVisibleRows();
        if (this.props.separateAiring) void this.loadAiringMediaIds().catch((error: unknown) => logger.error('[AstraWorkTable] Airing refresh failed', error));
      }).unsubscribe ?? null;
    if (this.props.separateAiring) void this.loadAiringMediaIds().catch((error: unknown) => logger.error('[AstraWorkTable] Airing refresh failed', error));
  }

  /** Load Airing data in parallel with the other startup work before the dashboard is shown. */
  public async prepareAiringData(): Promise<void> {
    const requestId = this.airingRequestId;
    await this.store.ready();
    if (!this.store.getState().separateAiring) return;
    // A startup preload can already be fetching while the user opens the dashboard.
    // Join it so the dashboard still waits for the completed grouping.
    if (this.airingLoadPromise) {
      await this.airingLoadPromise;
      return;
    }
    if (requestId !== this.airingRequestId) return;
    await this.loadAiringMediaIds(true);
  }

  /** Invalidate a pending pre-open fetch when the dashboard open is canceled. */
  public cancelAiringDataRequest(): void {
    this.airingRequestId++;
    this.airingLoadPromise = null;
  }

  private loadAiringMediaIds(allowBeforeMount = false): Promise<void> {
    const enabled = allowBeforeMount
      ? this.store.getState().separateAiring
      : this.props.separateAiring;
    if (!enabled || !this.calendarService || !this.api) return Promise.resolve();
    if (this.airingLoadPromise) return this.airingLoadPromise;
    const isFresh = () =>
      this.airingLoadedAt && Date.now() - this.airingLoadedAt < 24 * 60 * 60 * 1000;
    // Auth changes clear this snapshot. Reuse it without even asking for the
    // current user again during a normal Quick Edit → Dashboard return.
    if (this.airingOwnerVerified && isFresh()) return Promise.resolve();
    const requestId = ++this.airingRequestId;
    const isCurrent = () => this.isCurrentAiringRequest(requestId, allowBeforeMount);
    const request = (async () => {
      try {
        const userId = await this.api!.getCurrentUserId();
        if (!isCurrent()) return;
        const alreadyVerified = this.airingOwnerVerified && this.airingUserId === userId;
        if (this.airingUserId !== userId) {
          this.airingUserId = userId;
          this.airingMediaIds.clear();
          this.airingLoadedAt = 0;
          this.renderAiringRows();
        }
        this.airingOwnerVerified = true;
        // Membership in the Airing group changes slowly. Keep the account-scoped
        // snapshot warm for a day so opening the dashboard does not rescan AniList.
        if (isFresh()) {
          if (!alreadyVerified) this.renderAiringRows();
          return;
        }
        const entries = await this.calendarService!.fetchAiringSchedule(userId);
        if (!isCurrent()) return;
        const verifiedUserId = await this.api!.getCurrentUserId();
        if (!isCurrent()) return;
        if (verifiedUserId !== userId) {
          this.airingMediaIds.clear();
          this.airingLoadedAt = 0;
          this.airingUserId = null;
          this.airingOwnerVerified = false;
          this.renderAiringRows();
          return;
        }
        const next = new Set(entries.map((entry) => entry.mediaId));
        const changed =
          next.size !== this.airingMediaIds.size ||
          [...next].some((mediaId) => !this.airingMediaIds.has(mediaId));
        this.airingMediaIds = next;
        this.airingUserId = userId;
        this.airingLoadedAt = Date.now();
        if (changed) this.renderAiringRows();
      } catch (error) {
        if (isCurrent()) {
          this.airingMediaIds.clear();
          this.airingLoadedAt = 0;
          this.airingUserId = null;
          this.airingOwnerVerified = false;
          this.renderAiringRows();
          logger.warn('[AstraWorkTable] Airing section could not be refreshed', error);
        }
      }
    })();
    const tracked = request.finally(() => {
      if (this.airingLoadPromise === tracked) this.airingLoadPromise = null;
    });
    this.airingLoadPromise = tracked;
    return tracked;
  }

  private renderAiringRows(): void {
    if (this.mounted && this.element.isConnected) this.renderVisibleRows();
  }

  private isCurrentAiringRequest(requestId: number, allowBeforeMount = false): boolean {
    return (
      requestId === this.airingRequestId &&
      this.store.getState().separateAiring &&
      (allowBeforeMount ||
        (this.mounted && this.element.isConnected && this.props.separateAiring === true))
    );
  }

  /** Keep row identity and native pending chunks when only progress/display data changed. */
  private updateProgressOnly(
    previous: AstraWorkSummary[] | undefined,
    next: AstraWorkSummary[],
    sections: AstraSection[]
  ): boolean {
    if (!previous || previous.length !== next.length) return false;
    if (previous === next) return true;
    const changed: AstraWorkSummary[] = [];
    for (let index = 0; index < next.length; index++) {
      const before = previous[index];
      const after = next[index];
      // Metadata affecting filters/sorts is already reflected in the supplied
      // membership/order. Compare every field used by row/card/group rendering.
      if (
        before.id !== after.id ||
        before.mediaId !== after.mediaId ||
        before.title !== after.title ||
        before.type !== after.type ||
        before.cover !== after.cover ||
        before.country !== after.country ||
        before.status !== after.status ||
        before.episodes !== after.episodes ||
        before.chapters !== after.chapters ||
        before.currentScore !== after.currentScore ||
        sections.some(
          (section) => before.sectionScores?.[section.id] !== after.sectionScores?.[section.id]
        )
      )
        return false;
      if (before.progress !== after.progress) changed.push(after);
    }

    // Replace even unchanged summaries: future chunks and collapsed groups must
    // read the newest references without restarting their current render process.
    const latest = new Map(next.map((work) => [work.mediaId, work]));
    for (const group of this.pendingGroups) {
      group.works = group.works.map((work) => latest.get(work.mediaId)!);
    }
    if (this.windowPlanner) this.rebuildWindowPlan();
    for (const work of changed) {
      const row = this.renderedRows.get(work.mediaId);
      if (!row || !this.pendingBody?.contains(row)) continue;
      if (this.pendingGrid) {
        const label = row.querySelector('.astra-layout-card-meta');
        if (label) label.textContent = this.formatProgress(work);
      } else {
        AstraRowRenderer.updateProgress(row, work);
      }
    }
    return true;
  }

  /**
   * Renders the data grid using safe templates.
   */
  protected template(state: Partial<IDashboardState>): HTMLElement {
    if (!this.service || !state.filteredWorks || !state.stats) return html`<div></div>`;
    const sections = this.service.getSections();
    this.sectionSignature = JSON.stringify(sections);
    const works = state.filteredWorks;

    if (works.length === 0) {
      if (state.stats.totalCount === 0) {
        return this.renderImporter();
      }

      return html`
        <div class="astra-empty-state">
          <i class="fa-solid fa-magnifying-glass"></i>
          <p>No works found matching your filters.</p>
        </div>
      `;
    }

    if (state.layout === 'grid') {
      return this.renderGridLayout(works);
    }

    if (state.layout === 'list') {
      return this.renderListLayout(works, sections);
    }

    return this.renderTableLayout(works, sections);
  }

  private renderTableLayout(_works: AstraWorkSummary[], sections: AstraSection[]): HTMLElement {
    return html`
      <div class="astra-table-wrap">
        <div class="astra-grid" style="${sectionColumnsStyle(sections)}">
          <div
            class="astra-grid-header"
            style="display: grid; grid-template-columns: 60px minmax(220px, 1fr) 80px 80px var(--astra-dynamic-cols, );"
          >
            <div class="astra-col-cover">Cover</div>
            ${this.sortHeader('astra-col-title', 'Title', 'title')}
            ${this.sortHeader('astra-col-type', 'Type', 'type')}
            ${this.sortHeader('astra-col-score', 'Score', 'score')}
            ${map(sections, (s) => this.sortHeader('astra-col-section', s.name, `section-${s.id}`))}
          </div>
          <div class="astra-grid-body"></div>
        </div>
      </div>
    `;
  }

  /** Renders a clickable column header that toggles sort direction. */
  private sortHeader(colClass: string, label: string, key: string): HTMLElement {
    const sort = this.props.sort || '';
    const isAsc = sort === `${key}-asc`;
    const isDesc = sort === `${key}-desc`;
    const arrow = isAsc ? '▲' : isDesc ? '▼' : '';
    return html`
      <div
        class="${colClass} astra-col--sortable ${isAsc || isDesc ? 'astra-col--sorted' : ''}"
        data-sort-key="${key}"
        title="Sort by ${label}"
      >
        <span>${label}</span><span class="astra-sort-arrow">${arrow}</span>
      </div>
    `;
  }

  private renderListLayout(_works: AstraWorkSummary[], sections: AstraSection[]): HTMLElement {
    return html`
      <div class="astra-table-wrap astra-layout-list-wrap">
        <div class="astra-grid astra-grid--compact" style="${sectionColumnsStyle(sections)}">
          <div
            class="astra-grid-header"
            style="display: grid; grid-template-columns: minmax(220px, 1fr) 80px 80px var(--astra-dynamic-cols, );"
          >
            ${this.sortHeader('astra-col-title', 'Title', 'title')}
            ${this.sortHeader('astra-col-type', 'Type', 'type')}
            ${this.sortHeader('astra-col-score', 'Score', 'score')}
            ${map(sections, (s) => this.sortHeader('astra-col-section', s.name, `section-${s.id}`))}
          </div>
          <div class="astra-grid-body"></div>
        </div>
      </div>
    `;
  }

  private renderVisibleRows(): void {
    if (!this.mounted) return;
    const body = this.$('.astra-grid-body');
    if (!body) return;

    const state = this.props;
    if (!state.filteredWorks) return;
    const sections = this.service.getSections();
    const compact = state.layout === 'list';
    const grid = state.layout === 'grid';
    const groups = this.buildWorkGroups(state.filteredWorks);
    const processId = ++this.renderProcessId;

    this.saveWindowAnchor();
    this.windowObserver?.disconnect();
    this.windowObserver = null;
    this.windowPlanner = null;

    this.stopAutoRender();
    body.innerHTML = '';
    this.pendingGroups = groups;
    // Forget the remembered entry once it is no longer visible (collapsed or filtered out).
    const focusedId = this.focusedMediaId;
    if (
      focusedId !== null &&
      !groups.some(
        (group) => !group.collapsed && group.works.some((work) => work.mediaId === focusedId)
      )
    )
      this.focusedMediaId = null;
    this.pendingSections = sections;
    this.pendingCompact = compact;
    this.pendingGrid = grid;
    this.pendingBody = body;
    this.renderedGroupCounts.clear();
    this.renderedRows.clear();
    this.renderedHeaders.clear();

    if (state.filteredWorks.length > 300) {
      this.startWindow();
      return;
    }

    this.renderGroupSkeleton(processId);
    this.element.scrollTop = this.savedScrollTop;
    this.element.scrollLeft = this.savedScrollLeft;
    this.scheduleAutoRender(processId);
  }

  private windowScrollTop(): number {
    const body = this.pendingBody;
    if (!body) return 0;
    return Math.max(
      0,
      this.element.scrollTop -
        (body.getBoundingClientRect().top -
          this.element.getBoundingClientRect().top +
          this.element.scrollTop)
    );
  }

  private saveWindowAnchor(): void {
    if (!this.pendingBody || !this.element.contains(this.pendingBody)) return;
    this.savedScrollTop = this.element.scrollTop;
    this.savedScrollLeft = this.element.scrollLeft;
    const planner = this.windowPlanner;
    if (!planner) {
      // A filtered list can cross below the window threshold. Its current
      // viewport replaces the previous virtual anchor before it grows again.
      const viewport = this.element.getBoundingClientRect();
      const selector = '.astra-grid-row, .astra-layout-card, .astra-grid-group-header';
      const visible = (candidate: HTMLElement | null): candidate is HTMLElement => {
        if (!candidate || !this.pendingBody?.contains(candidate)) return false;
        const rect = candidate.getBoundingClientRect();
        return rect.bottom > viewport.top && rect.top < viewport.bottom;
      };
      const focused =
        document.activeElement instanceof HTMLElement
          ? document.activeElement.closest<HTMLElement>(selector)
          : null;
      const anchor = visible(focused)
        ? focused
        : [...this.pendingBody.querySelectorAll<HTMLElement>(selector)].find((candidate) =>
            visible(candidate)
          );
      this.savedAnchor = null;
      if (anchor) {
        const mediaId = anchor.dataset.mediaId ? Number(anchor.dataset.mediaId) : undefined;
        const status =
          mediaId === undefined
            ? anchor.dataset.status
            : this.pendingGroups.find((group) =>
                group.works.some((work) => work.mediaId === mediaId)
              )?.status;
        if (status)
          this.savedAnchor = {
            mediaId,
            status,
            offset: viewport.top - anchor.getBoundingClientRect().top,
          };
      }
      return;
    }
    const top = this.windowScrollTop();
    const band = planner.bands[planner.bandAt(top)];
    if (band)
      this.savedAnchor = {
        mediaId: band.works[0]?.mediaId,
        status: band.status,
        offset: top - band.top,
      };
  }

  private rebuildWindowPlan(): void {
    this.windowPlanner = new AstraWindowPlanner(
      this.pendingGroups,
      this.windowColumns,
      this.windowRowHeight,
      this.windowHeights
    );
  }

  private readWindowColumns(): number {
    if (!this.pendingGrid || !this.pendingBody) return 1;
    const columns = getComputedStyle(this.pendingBody).gridTemplateColumns.trim();
    return columns && columns !== 'none' ? Math.max(1, columns.split(/\s+/).length) : 1;
  }

  private startWindow(): void {
    this.windowHeights.clear();
    this.windowWidth = this.element.clientWidth;
    this.windowColumns = this.readWindowColumns();
    this.windowRowHeight = this.pendingGrid ? 240 : this.pendingCompact ? 60 : 100;
    this.windowStart = -1;
    this.windowEnd = -1;
    this.rebuildWindowPlan();
    this.pendingBody?.replaceChildren(this.spacer(this.windowPlanner!.totalHeight));
    this.element.scrollTop = this.savedScrollTop;
    this.element.scrollLeft = this.savedScrollLeft;
    this.restoreWindowAnchor();
    this.renderWindow();
    const processId = this.renderProcessId;
    if (typeof ResizeObserver !== 'undefined') {
      this.windowObserver = new ResizeObserver(() => {
        if (this.mounted && processId === this.renderProcessId && this.element.isConnected)
          this.scheduleWindow();
      });
      this.observeWindow();
    }
  }

  private restoreWindowAnchor(): void {
    const planner = this.windowPlanner;
    const anchor = this.savedAnchor;
    const body = this.pendingBody;
    if (!planner || !anchor || !body) return;
    const index = anchor.mediaId === undefined ? undefined : planner.mediaBands.get(anchor.mediaId);
    const band =
      index === undefined
        ? planner.bands.find((candidate) => candidate.header && candidate.status === anchor.status)
        : planner.bands[index];
    if (band) {
      const bodyTop =
        body.getBoundingClientRect().top -
        this.element.getBoundingClientRect().top +
        this.element.scrollTop;
      this.element.scrollTop = bodyTop + band.top + anchor.offset;
    }
  }

  private observeWindow(): void {
    const observer = this.windowObserver;
    if (!observer) return;
    observer.disconnect();
    observer.observe(this.element);
    for (const row of this.renderedRows.values()) observer.observe(row);
    this.pendingBody
      ?.querySelectorAll('.astra-grid-group-header')
      .forEach((header) => observer.observe(header));
  }

  private scheduleWindow(): void {
    if (!this.windowPlanner || this.renderFrame !== null) return;
    const processId = this.renderProcessId;
    const frame = window.requestAnimationFrame(() => {
      if (processId !== this.renderProcessId || frame !== this.renderFrame) return;
      this.renderFrame = null;
      if (!this.mounted || !this.element.isConnected) return;
      this.renderWindow();
    });
    this.renderFrame = frame;
  }

  private spacer(height: number): HTMLElement {
    const spacer = document.createElement('div');
    spacer.className = 'astra-window-spacer';
    spacer.setAttribute('aria-hidden', 'true');
    spacer.style.cssText = `height:${Math.max(0, height)}px;grid-column:1/-1;pointer-events:none;overflow-anchor:none;`;
    return spacer;
  }

  private renderWindow(): void {
    const body = this.pendingBody;
    let planner = this.windowPlanner;
    if (!body || !planner || !this.mounted) return;
    const width = this.element.clientWidth;
    const columns = this.readWindowColumns();
    if (width !== this.windowWidth || columns !== this.windowColumns) {
      this.saveWindowAnchor();
      this.windowWidth = width;
      this.windowColumns = columns;
      this.windowHeights.clear();
      this.rebuildWindowPlan();
      this.restoreWindowAnchor();
      this.windowStart = -1;
      planner = this.windowPlanner!;
    }
    const range = planner.range(this.windowScrollTop(), this.element.clientHeight || 600);
    if (range.start !== this.windowStart || range.end !== this.windowEnd) {
      const focused =
        document.activeElement instanceof HTMLElement && body.contains(document.activeElement)
          ? document.activeElement
          : null;
      const focusedRow = focused?.closest<HTMLElement>('[data-media-id]');
      if (focusedRow) this.focusedMediaId = Number(focusedRow.dataset.mediaId);
      const fragment = document.createDocumentFragment();
      fragment.append(this.spacer(planner.bands[range.start]?.top ?? 0));
      const keep = new Set<number>();
      const keepHeaders = new Set<string>();
      for (const band of planner.bands.slice(range.start, range.end)) {
        if (band.header) {
          const group = this.pendingGroups.find((candidate) => candidate.status === band.status)!;
          keepHeaders.add(group.status);
          const header =
            this.renderedHeaders.get(group.status) ??
            this.renderGroupHeader(group.status, group.count, group.collapsed);
          this.renderedHeaders.set(group.status, header);
          fragment.append(header);
        } else
          for (const work of band.works) {
            keep.add(work.mediaId);
            const row = this.renderedRows.get(work.mediaId) ?? this.renderWorkItem(work);
            row.style.contentVisibility = 'visible';
            row.style.overflowAnchor = 'none';
            fragment.append(row);
          }
      }
      const last = planner.bands[range.end - 1];
      fragment.append(this.spacer(planner.totalHeight - (last ? last.top + last.height : 0)));
      body.replaceChildren(fragment);
      for (const id of this.renderedRows.keys()) if (!keep.has(id)) this.renderedRows.delete(id);
      for (const status of this.renderedHeaders.keys())
        if (!keepHeaders.has(status)) this.renderedHeaders.delete(status);
      this.windowStart = range.start;
      this.windowEnd = range.end;
      if (focused) {
        if (body.contains(focused)) focused.focus({ preventScroll: true });
        else {
          body.tabIndex = -1;
          body.focus({ preventScroll: true });
        }
      }
      this.observeWindow();
    }
    this.measureWindow(planner, range.start, range.end);
  }

  private measureWindow(planner: AstraWindowPlanner, start: number, end: number): void {
    let changed = false;
    let measuredRow: number | undefined;
    for (const band of planner.bands.slice(start, end)) {
      if (band.header) {
        const header = this.pendingBody?.querySelector<HTMLElement>(
          `.astra-grid-group-header[data-status="${band.status}"]`
        );
        const group = this.pendingGroups.find((candidate) => candidate.status === band.status)!;
        changed =
          this.measureWindowElement(header, `header:${band.status}:${group.collapsed}`) || changed;
      } else
        for (const work of band.works) {
          const key = `work:${work.mediaId}`;
          changed = this.measureWindowElement(this.renderedRows.get(work.mediaId), key) || changed;
          measuredRow = this.windowHeights.get(key) ?? measuredRow;
        }
    }
    if (!changed) return;
    this.saveWindowAnchor();
    if (measuredRow !== undefined) this.windowRowHeight = measuredRow;
    this.rebuildWindowPlan();
    // Refresh spacers immediately, then reconcile the range on the next frame.
    const updated = this.windowPlanner!;
    const spacers = this.pendingBody?.querySelectorAll<HTMLElement>('.astra-window-spacer');
    if (spacers?.length === 2) {
      spacers[0].style.height = `${updated.bands[start]?.top ?? 0}px`;
      const last = updated.bands[end - 1];
      spacers[1].style.height = `${Math.max(0, updated.totalHeight - (last ? last.top + last.height : 0))}px`;
    }
    this.restoreWindowAnchor();
    this.scheduleWindow();
  }

  private measureWindowElement(element: HTMLElement | null | undefined, key: string): boolean {
    if (!element) return false;
    const style = getComputedStyle(element);
    const height =
      element.getBoundingClientRect().height +
      (parseFloat(style.marginTop) || 0) +
      (parseFloat(style.marginBottom) || 0);
    if (height < 16) return false;
    const previous =
      this.windowHeights.get(key) ?? (key.startsWith('work:') ? this.windowRowHeight : 56);
    this.windowHeights.set(key, height);
    return Math.abs(previous - height) >= 0.5;
  }

  private buildWorkGroups(works: AstraWorkSummary[]): AstraWorkGroup[] {
    const groups = new Map<string, AstraWorkSummary[]>();

    works.forEach((work) => {
      const status =
        this.props.separateAiring &&
        this.airingOwnerVerified &&
        work.type === 'anime' &&
        work.status === MediaListStatus.CURRENT &&
        this.airingMediaIds.has(work.mediaId)
          ? 'AIRING'
          : this.getDisplayStatus(work);
      if (!groups.has(status)) groups.set(status, []);
      groups.get(status)!.push(work);
    });

    const statusOrder = [
      'AIRING',
      MediaListStatus.WATCHING,
      MediaListStatus.READING,
      MediaListStatus.REWATCHING,
      MediaListStatus.REREADING,
      MediaListStatus.COMPLETED,
      MediaListStatus.PLAN_TO_WATCH,
      MediaListStatus.PLAN_TO_READ,
      MediaListStatus.PAUSED,
      MediaListStatus.DROPPED,
      'UNKNOWN',
    ];

    const statusFilter = this.props.filters?.anilistStatus ?? 'all';
    const activeStatusFilters = statusFilter === 'all' ? [] : statusFilter;
    const forceOpen = new Set<string>(
      activeStatusFilters.flatMap((status: MediaListStatus) =>
        this.getPossibleDisplayStatuses(status)
      )
    );
    if (this.props.separateAiring && activeStatusFilters.includes(MediaListStatus.CURRENT))
      forceOpen.add('AIRING');

    return Array.from(groups.keys())
      .sort((a, b) => {
        const idxA = statusOrder.indexOf(a as MediaListStatus);
        const idxB = statusOrder.indexOf(b as MediaListStatus);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        return a.localeCompare(b);
      })
      .map((status) => {
        const groupWorks = groups.get(status)!;
        const collapsed = this.collapsedGroups.has(status) && !forceOpen.has(status);
        return {
          status,
          count: groupWorks.length,
          collapsed,
          works: groupWorks,
        };
      });
  }

  private renderGroupSkeleton(processId = this.renderProcessId): void {
    if (processId !== this.renderProcessId) return;

    const body = this.pendingBody;
    if (!body) return;

    const fragment = document.createDocumentFragment();
    this.pendingGroups.forEach((group) => {
      fragment.appendChild(this.renderGroupHeader(group.status, group.count, group.collapsed));
      this.renderedGroupCounts.set(group.status, 0);

      if (!group.collapsed) {
        const rows = this.renderGroupRows(group, 0);
        fragment.appendChild(rows.fragment);
        this.renderedGroupCounts.set(group.status, rows.nextCount);
      }
    });
    body.appendChild(fragment);
  }

  private renderGroupRows(
    group: AstraWorkGroup,
    start: number
  ): { fragment: DocumentFragment; nextCount: number } {
    const fragment = document.createDocumentFragment();
    const chunk = group.works.slice(start, start + AstraWorkTable.RENDER_CHUNK_SIZE);

    chunk.forEach((work) => {
      fragment.appendChild(this.renderWorkItem(work));
    });

    return { fragment, nextCount: start + chunk.length };
  }

  private renderWorkItem(work: AstraWorkSummary): HTMLElement {
    if (this.pendingGrid) {
      const card = this.renderGridCard(work);
      this.renderedRows.set(work.mediaId, card);
      return card;
    }
    const processId = this.renderProcessId;
    const body = this.pendingBody;
    const root = this.element;
    let row: HTMLElement;
    const edit = (id: number) => {
      if (
        !this.mounted ||
        processId !== this.renderProcessId ||
        body !== this.pendingBody ||
        root !== this.element ||
        !root.isConnected ||
        !body?.contains(row)
      )
        return;
      void this.ratingController.open(id);
    };
    if (this.pendingCompact) {
      row = AstraRowRenderer.renderCompact(work, this.pendingSections, edit);
    } else {
      row = AstraRowRenderer.render(work, this.pendingSections, edit);
    }
    this.renderedRows.set(work.mediaId, row);
    return row;
  }

  private renderNextGroupChunk(group: AstraWorkGroup): void {
    const body = this.pendingBody;
    if (!body || group.collapsed) return;

    const renderedCount = this.renderedGroupCounts.get(group.status) ?? 0;
    if (renderedCount >= group.works.length) return;

    const rows = this.renderGroupRows(group, renderedCount);
    body.insertBefore(rows.fragment, this.findNextGroupHeader(group.status));
    this.renderedGroupCounts.set(group.status, rows.nextCount);
  }

  private scheduleAutoRender(processId = this.renderProcessId): void {
    if (
      !this.mounted ||
      this.renderTimer !== null ||
      this.renderFrame !== null ||
      !this.hasPendingRows()
    )
      return;

    this.renderTimer = window.setTimeout(() => {
      if (processId !== this.renderProcessId || !this.mounted) return;
      this.renderTimer = null;
      const frame = window.requestAnimationFrame(() => {
        if (processId !== this.renderProcessId || !this.mounted || this.renderFrame !== frame)
          return;
        this.renderFrame = null;

        const nextGroup = this.pendingGroups.find((group) => {
          const renderedCount = this.renderedGroupCounts.get(group.status) ?? 0;
          return !group.collapsed && renderedCount < group.works.length;
        });

        if (nextGroup) {
          this.renderNextGroupChunk(nextGroup);
          this.scheduleAutoRender(processId);
        }
      });
      this.renderFrame = frame;
    }, AstraWorkTable.RENDER_CHUNK_DELAY_MS);
  }

  private stopAutoRender(): void {
    if (this.renderTimer !== null) window.clearTimeout(this.renderTimer);
    if (this.renderFrame !== null) window.cancelAnimationFrame(this.renderFrame);
    this.renderTimer = null;
    this.renderFrame = null;
  }

  protected override onUnmount(): void {
    this.cancelAiringDataRequest();
    this.unsubscribeAiringAuth?.();
    this.unsubscribeAiringAuth = null;
    this.airingOwnerVerified = false;
    this.saveWindowAnchor();
    this.renderProcessId++;
    this.stopAutoRender();
    this.windowObserver?.disconnect();
    this.windowObserver = null;
    this.windowPlanner = null;
    this.windowHeights.clear();
    if (this.focusTimer !== null) window.clearTimeout(this.focusTimer);
    this.focusTimer = null;
    this.closeImagePreview?.();
    this.pendingBody = null;
    this.pendingGroups = [];
    this.pendingSections = [];
    this.renderedGroupCounts.clear();
    this.renderedRows.clear();
    this.renderedHeaders.clear();
    super.onUnmount();
  }

  private listenCurrent(
    target: HTMLElement | null,
    type: string,
    callback: (event: Event) => void
  ): void {
    if (!target) return;
    const root = this.element;
    this.addEventListener(target, type, (event) => {
      if (
        !this.mounted ||
        this.element !== root ||
        !root.isConnected ||
        !root.contains(target) ||
        !(event.target instanceof Node) ||
        !root.contains(event.target)
      )
        return;
      callback(event);
    });
  }

  private findNextGroupHeader(status: string): HTMLElement | null {
    const header = this.$(`.astra-grid-group-header[data-status="${status}"]`);
    let sibling = header?.nextElementSibling as HTMLElement | null;

    while (sibling) {
      if (sibling.classList.contains('astra-grid-group-header')) return sibling;
      sibling = sibling.nextElementSibling as HTMLElement | null;
    }

    return null;
  }

  private renderUntilMedia(mediaId: number): void {
    let group = this.pendingGroups.find((candidate) =>
      candidate.works.some((work) => work.mediaId === mediaId)
    );
    if (!group) return;
    if (group.collapsed) {
      this.collapsedGroups.delete(group.status);
      this.renderVisibleRows();
      group = this.pendingGroups.find((candidate) =>
        candidate.works.some((work) => work.mediaId === mediaId)
      );
      if (!group || group.collapsed) return;
    }

    const targetIndex = group.works.findIndex((work) => work.mediaId === mediaId);
    while ((this.renderedGroupCounts.get(group.status) ?? 0) <= targetIndex) {
      const previousCount = this.renderedGroupCounts.get(group.status) ?? 0;
      this.renderNextGroupChunk(group);
      if ((this.renderedGroupCounts.get(group.status) ?? 0) === previousCount) break;
    }
  }

  private hasPendingRows(): boolean {
    return this.pendingGroups.some((group) => {
      const renderedCount = this.renderedGroupCounts.get(group.status) ?? 0;
      return !group.collapsed && renderedCount < group.works.length;
    });
  }

  private renderGroupHeader(status: string, count: number, collapsed: boolean): HTMLElement {
    const label = this.getGroupLabel(status);
    const isLastGroup = this.pendingGroups[this.pendingGroups.length - 1]?.status === status;

    return html`
      <button
        type="button"
        class="astra-grid-group-header ${collapsed ? 'collapsed' : ''} ${isLastGroup ? 'astra-grid-group-header--last' : ''}"
        data-status="${status}"
      >
        <div class="astra-group-info">
          <i class="fa-solid fa-chevron-down"></i>
          <span class="astra-group-title">${label}</span>
          <span class="astra-group-badge">${count}</span>
        </div>
        <div class="astra-group-line"></div>
      </button>
    `;
  }

  private getDisplayStatus(work: AstraWorkSummary): string {
    switch (work.status) {
      case MediaListStatus.CURRENT:
        return work.type === 'anime' ? MediaListStatus.WATCHING : MediaListStatus.READING;
      case MediaListStatus.REPEATING:
        return work.type === 'anime' ? MediaListStatus.REWATCHING : MediaListStatus.REREADING;
      case MediaListStatus.PLANNING:
        return work.type === 'anime' ? MediaListStatus.PLAN_TO_WATCH : MediaListStatus.PLAN_TO_READ;
      default:
        return work.status || 'UNKNOWN';
    }
  }

  private getPossibleDisplayStatuses(status: MediaListStatus): string[] {
    switch (status) {
      case MediaListStatus.CURRENT:
        return [MediaListStatus.WATCHING, MediaListStatus.READING];
      case MediaListStatus.REPEATING:
        return [MediaListStatus.REWATCHING, MediaListStatus.REREADING];
      case MediaListStatus.PLANNING:
        return [MediaListStatus.PLAN_TO_WATCH, MediaListStatus.PLAN_TO_READ];
      default:
        return [status];
    }
  }

  private getGroupLabel(status: string): string {
    switch (status) {
      case 'AIRING':
        return 'Airing';
      case MediaListStatus.WATCHING:
        return 'Watching';
      case MediaListStatus.READING:
        return 'Reading';
      case MediaListStatus.REWATCHING:
        return 'Rewatching';
      case MediaListStatus.REREADING:
        return 'Rereading';
      case MediaListStatus.PLAN_TO_WATCH:
        return 'Planning Anime';
      case MediaListStatus.PLAN_TO_READ:
        return 'Planning Manga';
      case 'UNKNOWN':
        return 'Unknown';
      default:
        return getStatusLabel(status as MediaListStatus, 'ANIME');
    }
  }

  private renderGridLayout(_works: AstraWorkSummary[]): HTMLElement {
    return html`
      <div class="astra-table-wrap astra-layout-grid-wrap">
        <div class="astra-grid-header astra-grid-header--visual" aria-hidden="true"></div>
        <div class="astra-grid-body astra-layout-grid"></div>
      </div>
    `;
  }

  private renderGridCard(work: AstraWorkSummary): HTMLElement {
    const cover = AstraRowRenderer.coverSrc(work);
    const card = html`
      <button
        type="button"
        class="astra-layout-card"
        data-action="edit"
        data-media-id="${work.mediaId}"
        title="${work.title}"
      >
        <div class="astra-layout-card-cover-wrap">
          <img
            src="${cover}"
            class="astra-layout-card-cover"
            loading="lazy"
            data-action="preview"
            data-title="${work.title}"
          />
        </div>
        <div class="astra-layout-card-shade"></div>
        <div class="astra-layout-card-info">
          <div class="astra-layout-card-title">${work.title}</div>
          <div class="astra-layout-card-meta">${this.formatProgress(work)}</div>
        </div>
      </button>
    `;
    if (!cover) card.querySelector('img')?.removeAttribute('src');
    return card;
  }

  private formatProgress(work: AstraWorkSummary): string {
    const total = work.type === 'anime' ? work.episodes : work.chapters;
    return `${work.progress || 0}/${total || '?'}`;
  }

  /**
   * Renders the first-run onboarding "portal" — a branded empty state that
   * invites the user to sync their AniList or import a JSON backup.
   *
   * The static markup below is rendered verbatim (the `html` engine only
   * escapes interpolated values), so the inline brand SVG is safe to embed.
   */
  private renderImporter(): HTMLElement {
    return html`
      <div class="astra-empty-state astra-empty-state--importer">
        <div class="astra-portal-card" data-portal-state="idle">
          <!-- Welcome / idle -->
          <div class="astra-portal-view astra-portal-view--idle">
            ${AstraWorkTable.renderPortalLogo()}

            <h2 class="astra-portal-title">Sync your AniList</h2>
            <p class="astra-portal-sub">
              Pull in your anime &amp; manga to start rating, filtering, and building your personal
              archive.
            </p>

            <div class="astra-portal-actions">
              <button
                type="button"
                class="astra-portal-btn astra-portal-btn--primary"
                data-empty-action="sync"
              >
                <i class="fa-solid fa-rotate"></i>
                <span>Sync with AniList</span>
              </button>
              <button
                type="button"
                class="astra-portal-btn astra-portal-btn--ghost"
                data-empty-action="import"
              >
                <i class="fa-solid fa-file-arrow-up"></i>
                <span>Import JSON</span>
              </button>
            </div>
          </div>

          <!-- Syncing -->
          <div class="astra-portal-view astra-portal-view--syncing">
            ${AstraWorkTable.renderPortalLogo(true)}
            <h2 class="astra-portal-title" data-sync-title>Building your archive</h2>
            <p class="astra-portal-sub" data-sync-status>Connecting to AniList…</p>
            <div class="astra-portal-progress" role="progressbar" aria-label="Syncing">
              <div class="astra-portal-progress-bar"></div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Brand logo lockup with glow + orbiting particles, reused across the
   * idle and syncing views.
   *
   * @param syncing When true, adds the pulsing/spinning animation modifiers.
   */
  private static renderPortalLogo(syncing = false): HTMLElement {
    const logoClass = syncing
      ? 'astra-portal-logo astra-portal-logo--pulsing'
      : 'astra-portal-logo';
    return html`
      <div class="${logoClass}" aria-hidden="true">
        <svg viewBox="4.5 4 15 16" class="astra-portal-mark" width="46" height="46">
          <path d="M12 4L4.5 20H7L12 10.5L17 20H19.5L12 4Z"></path>
          <path d="M12 10.5L10.75 14.1H13.25L12 10.5Z"></path>
        </svg>
      </div>
    `;
  }

  /**
   * Binds navigation and modal events.
   */
  protected bindEvents(): void {
    if ((this.props.filteredWorks?.length ?? 0) > 0) {
      this.renderVisibleRows();
    }

    this.listenCurrent(this.element, 'scroll', () => this.scheduleWindow());
    this.listenCurrent(this.$('.astra-grid-body'), 'keydown', (event) =>
      this.onWindowKey(event as KeyboardEvent)
    );

    this.listenCurrent(this.$('.astra-grid-body'), 'click', (event) => {
      const header = (event.target as HTMLElement).closest(
        '.astra-grid-group-header'
      ) as HTMLElement | null;
      const status = header?.dataset.status;
      if (!status) return;
      const hadFocus = document.activeElement === header;

      if (this.collapsedGroups.has(status)) {
        this.collapsedGroups.delete(status);
      } else {
        this.collapsedGroups.add(status);
      }
      this.renderVisibleRows();
      if (hadFocus)
        this.$<HTMLButtonElement>(`.astra-grid-group-header[data-status="${status}"]`)?.focus({
          preventScroll: true,
        });
    });

    this.listenCurrent(this.$('.astra-grid-body'), 'click', (event) => {
      const target = event.target as HTMLElement;
      if (target.closest('.au-pill-wrapper')) return;
      const coverWrap = target.closest<HTMLElement>(
        '.astra-layout-card-cover-wrap, .astra-col-cover'
      );
      if (coverWrap) {
        const preview = coverWrap.querySelector<HTMLImageElement>(
          '.astra-layout-card-cover, .astra-table-cover'
        );
        if (!preview) return;
        event.preventDefault();
        event.stopPropagation();
        this.openImagePreview(preview.src, preview.dataset.title || preview.alt || '');
        return;
      }

      const editTarget = target.closest(
        '[data-action="edit"][data-media-id]'
      ) as HTMLElement | null;
      const mediaId = Number(editTarget?.dataset.mediaId);
      if (mediaId) void this.openRatingModal(mediaId);
    });

    if (this.props.layout !== 'grid') {
      this.$$('[data-action="edit"][data-media-id]').forEach((target) => {
        this.listenCurrent(target, 'click', (event) => {
          const mediaId = Number((event.currentTarget as HTMLElement).dataset.mediaId);
          if (mediaId) void this.openRatingModal(mediaId);
        });
      });
    }

    // Column header sorting (toggles asc/desc, e.g. A–Z / Z–A on Title).
    this.listenCurrent(this.$('.astra-grid-header'), 'click', (event) => {
      const cell = (event.target as HTMLElement).closest('[data-sort-key]') as HTMLElement | null;
      if (!cell) return;
      const key = cell.dataset.sortKey!;
      const current = this.props.sort || '';
      // Score & section columns feel natural high→low first; text columns A→Z first.
      const descFirst = key === 'score' || key.startsWith('section-');
      let next: string;
      if (current === `${key}-asc`) next = `${key}-desc`;
      else if (current === `${key}-desc`) next = `${key}-asc`;
      else next = descFirst ? `${key}-desc` : `${key}-asc`;

      // Update arrow indicators immediately (the surgical row update won't redraw the header).
      const header = cell.closest('.astra-grid-header');
      header?.querySelectorAll<HTMLElement>('[data-sort-key]').forEach((c) => {
        const active = c.dataset.sortKey === key;
        c.classList.toggle('astra-col--sorted', active);
        const arrowEl = c.querySelector('.astra-sort-arrow');
        if (arrowEl) arrowEl.textContent = active ? (next.endsWith('-asc') ? '▲' : '▼') : '';
      });

      this.store.setSort(next as AstraSortType);
    });

    this.listenCurrent(this.$('[data-empty-action="sync"]'), 'click', () => {
      void this.runSync();
    });

    this.listenCurrent(this.$('[data-empty-action="import"]'), 'click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'application/json,.json';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        const content = await file.text();
        await this.service.importJSON(content);
      };
      input.click();
    });

    this.bindDropZone();
  }

  private openImagePreview(src: string, title: string): void {
    if (!src) return;
    this.closeImagePreview?.();

    const overlay = document.createElement('div');
    overlay.className = 'astra-cover-full-overlay';
    const content = document.createElement('div');
    content.className = 'astra-cover-full-container';
    const img = document.createElement('img');
    img.className = 'astra-cover-full-img';
    img.src = src;
    img.alt = title;
    content.appendChild(img);
    overlay.appendChild(content);

    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    const close = () => {
      overlay.remove();
      document.removeEventListener('keydown', onKeydown);
      if (this.closeImagePreview === close) this.closeImagePreview = null;
    };
    overlay.addEventListener('click', close);
    document.addEventListener('keydown', onKeydown);

    document.body.appendChild(overlay);
    this.closeImagePreview = close;
  }

  /**
   * Lets the user drop a JSON backup anywhere on the dashed area
   * surrounding the portal card to trigger the same import flow as
   * the "Import JSON" button.
   */
  private bindDropZone(): void {
    const dropZone = this.$('.astra-empty-state--importer') as HTMLElement | null;
    if (!dropZone) return;

    this.listenCurrent(dropZone, 'dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('is-dragover');
    });

    this.listenCurrent(dropZone, 'dragleave', () => {
      dropZone.classList.remove('is-dragover');
    });

    this.listenCurrent(dropZone, 'drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('is-dragover');
      const file = (e as DragEvent).dataTransfer?.files?.[0];
      if (!file) return;
      void file.text().then((content) => this.service.importJSON(content));
    });
  }

  /**
   * Opens the rating modal for a media entry. Errors are logged here so the
   * click handler never produces an unhandled rejection.
   */
  private async openRatingModal(mediaId: number): Promise<void> {
    try {
      await this.ratingController.open(mediaId);
    } catch (error) {
      logger.error('[AstraWorkTable] Rating modal failed to open', error);
    }
  }

  /**
   * Drives the AniList sync while showing an animated, multi-step progress
   * view. AniList sync is bulk (no granular progress events), so the status
   * line cycles through descriptive steps to keep the experience alive.
   */
  private async runSync(): Promise<void> {
    const card = this.$('.astra-portal-card') as HTMLElement | null;
    const statusEl = this.$('[data-sync-status]') as HTMLElement | null;
    card?.setAttribute('data-portal-state', 'syncing');

    const steps = [
      'Connecting to AniList…',
      'Fetching your anime list…',
      'Fetching your manga list…',
      'Indexing covers & metadata…',
      'Building your archive…',
      'Almost there…',
    ];
    let stepIndex = 0;
    if (statusEl) statusEl.textContent = steps[0];
    const ticker = window.setInterval(() => {
      stepIndex = Math.min(stepIndex + 1, steps.length - 1);
      if (statusEl) statusEl.textContent = steps[stepIndex];
    }, 1200);

    try {
      await this.service.syncWithAniList();
      // On success the store re-renders with the populated grid; nothing else to do.
    } catch {
      // Restore the welcome view and surface the failure inline.
      card?.setAttribute('data-portal-state', 'idle');
      const titleEl = this.$('.astra-portal-view--idle .astra-portal-title') as HTMLElement | null;
      const subEl = this.$('.astra-portal-view--idle .astra-portal-sub') as HTMLElement | null;
      if (titleEl) titleEl.textContent = 'Sync failed';
      if (subEl)
        subEl.textContent = 'We couldn’t reach AniList. Check that you’re logged in and try again.';
    } finally {
      window.clearInterval(ticker);
    }
  }

  /**
   * Focuses and highlights a specific entry in the table.
   *
   * @param mediaId AniList media ID to focus
   */
  public focusEntry(mediaId: number): void {
    if (this.windowPlanner) this.jumpWindowToMedia(mediaId);
    let row = this.$(
      `.astra-grid-row[data-media-id="${mediaId}"], .astra-layout-card[data-media-id="${mediaId}"]`
    );
    if (!row) {
      this.renderUntilMedia(mediaId);
      row = this.$(
        `.astra-grid-row[data-media-id="${mediaId}"], .astra-layout-card[data-media-id="${mediaId}"]`
      );
    }

    if (row) {
      if (!this.windowPlanner) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      row.tabIndex = -1;
      row.focus({ preventScroll: true });
      row.classList.remove('astra-row-focus-pulse');
      // Force reflow for animation restart
      void (row as HTMLElement).offsetWidth;
      row.classList.add('astra-row-focus-pulse');
      if (this.focusTimer !== null) window.clearTimeout(this.focusTimer);
      this.focusTimer = window.setTimeout(() => {
        row.classList.remove('astra-row-focus-pulse');
        this.focusTimer = null;
      }, 4000);
    }
  }

  private jumpWindowToMedia(mediaId: number): void {
    let planner = this.windowPlanner;
    if (!planner) return;
    if (!planner.mediaBands.has(mediaId)) {
      const group = this.pendingGroups.find((candidate) =>
        candidate.works.some((work) => work.mediaId === mediaId)
      );
      if (!group) return;
      this.collapsedGroups.delete(group.status);
      this.renderVisibleRows();
      planner = this.windowPlanner;
    }
    const index = planner?.mediaBands.get(mediaId);
    const band = index === undefined ? undefined : planner?.bands[index];
    if (!band || !this.pendingBody) return;
    const bodyTop =
      this.pendingBody.getBoundingClientRect().top -
      this.element.getBoundingClientRect().top +
      this.element.scrollTop;
    this.element.scrollTop = Math.max(
      0,
      bodyTop + band.top - Math.max(0, (this.element.clientHeight - band.height) / 2)
    );
    this.renderWindow();
  }

  private onWindowKey(event: KeyboardEvent): void {
    if (!this.windowPlanner || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target as HTMLElement;
    const currentRow = target.closest<HTMLElement>('.astra-grid-row, .astra-layout-card');
    // Only the table container may fall back to the remembered row; a focused group header or
    // other control keeps its own arrow/Home/End/Tab behaviour.
    const onContainer = target === this.element || target === this.pendingBody;
    const fallbackId = onContainer ? (this.focusedMediaId ?? 0) : 0;
    const currentId = currentRow ? Number(currentRow.dataset.mediaId) : fallbackId;
    if (!currentId) return;
    const works = this.pendingGroups
      .filter((group) => !group.collapsed)
      .flatMap((group) => group.works);
    const index = works.findIndex((work) => work.mediaId === currentId);
    if (index === -1) return;
    let nextIndex = index;
    if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = works.length - 1;
    else if (event.key === 'ArrowDown') nextIndex += this.windowColumns;
    else if (event.key === 'ArrowUp') nextIndex -= this.windowColumns;
    else if (this.pendingGrid && event.key === 'ArrowRight') nextIndex++;
    else if (this.pendingGrid && event.key === 'ArrowLeft') nextIndex--;
    else if (event.key === 'PageDown' || event.key === 'PageUp')
      nextIndex +=
        (event.key === 'PageDown' ? 1 : -1) *
        Math.max(1, Math.floor(this.element.clientHeight / this.windowRowHeight)) *
        this.windowColumns;
    else if (event.key === 'Tab') {
      const controls = [...(currentRow?.querySelectorAll<HTMLElement>('button, a[href]') ?? [])];
      const atBoundary =
        !currentRow ||
        this.pendingGrid ||
        (event.shiftKey ? target === controls[0] : target === controls[controls.length - 1]);
      if (!atBoundary) return;
      nextIndex += event.shiftKey ? -1 : 1;
      if (!works[nextIndex] || this.renderedRows.has(works[nextIndex].mediaId)) return;
    } else return;
    nextIndex = Math.max(0, Math.min(works.length - 1, nextIndex));
    event.preventDefault();
    this.jumpWindowToMedia(works[nextIndex].mediaId);
    this.focusedMediaId = works[nextIndex].mediaId;
    const row = this.renderedRows.get(works[nextIndex].mediaId);
    const controls = row?.querySelectorAll<HTMLElement>('button, a[href]');
    const focus = this.pendingGrid
      ? row
      : event.shiftKey && event.key === 'Tab'
        ? controls?.[controls.length - 1]
        : controls?.[0];
    focus?.focus({ preventScroll: true });
  }
}
