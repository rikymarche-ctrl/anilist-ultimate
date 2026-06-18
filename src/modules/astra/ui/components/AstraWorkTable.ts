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
import { AstraWorkSummary } from '../../AstraInterfaces';
import { AstraRatingModal } from '../AstraRatingModal';
import { TOKENS } from '@core/di/tokens';
import { html, map } from '@core/utils/Template';
import { AstraRowRenderer } from './AstraRowRenderer';
import { MediaListStatus } from '@/api/AnilistTypes';
import { getStatusLabel } from '@core/utils/UIHelpers';

type AstraWorkGroup = {
  status: string;
  count: number;
  collapsed: boolean;
  works: AstraWorkSummary[];
};

@injectable()
export class AstraWorkTable extends AstraView {
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
  private pendingSections: any[] = [];
  private pendingCompact = false;
  private pendingGrid = false;
  private pendingBody: HTMLElement | null = null;
  private renderedGroupCounts = new Map<string, number>();
  private renderTimer: number | null = null;

  constructor(
    @inject(TOKENS.AstraStore) private store: AstraDashboardStore,
    @inject(TOKENS.AstraService) private service: AstraService,
    @inject(AstraRatingModal) private ratingController: AstraRatingModal
  ) {
    super({});
    // Safety re-render after DI assignment
    this.element = this.render();
  }

  /**
   * Performance: Surgical update of the grid body only.
   * Prevents full rerender stuttering with thousands of entries.
   */
  protected override onUpdate(prevState?: IDashboardState): boolean {
    const body = this.$('.astra-grid-body');
    const state = this.props;

    if (prevState && prevState.layout !== state.layout) {
      this.renderProcessId++;
      return false;
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

    this.renderVisibleRows();
    return true;
  }

  /**
   * Renders the data grid using safe templates.
   */
  protected template(state: IDashboardState): HTMLElement {
    if (!this.service || !state || !state.filteredWorks) return html`<div></div>`;
    const sections = this.service.getSections();
    const works = state.filteredWorks;

    if (works.length === 0) {
      if (state.stats.totalCount === 0) {
        return this.renderImporter();
      }

      return html`
        <div class="astra-empty-state">
          <i class="fa fa-search"></i>
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

  private renderTableLayout(_works: AstraWorkSummary[], sections: any[]): HTMLElement {
    return html`
      <div class="astra-table-wrap">
        <div class="astra-grid" style="--astra-dynamic-cols: repeat(${sections.length}, 105px)">
          <div
            class="astra-grid-header"
            style="display: grid; grid-template-columns: 60px 1fr 80px 80px var(--astra-dynamic-cols) 100px;"
          >
            <div class="astra-col-cover">Cover</div>
            ${this.sortHeader('astra-col-title', 'Title', 'title')}
            ${this.sortHeader('astra-col-type', 'Type', 'type')}
            ${this.sortHeader('astra-col-score', 'Score', 'score')}
            ${map(sections, (s: any) =>
              this.sortHeader('astra-col-section', s.name, `section-${s.id}`)
            )}
            <div class="astra-col-actions">Actions</div>
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

  private renderListLayout(_works: AstraWorkSummary[], sections: any[]): HTMLElement {
    return html`
      <div class="astra-table-wrap astra-layout-list-wrap">
        <div
          class="astra-grid astra-grid--compact"
          style="--astra-dynamic-cols: repeat(${sections.length}, 105px)"
        >
          <div
            class="astra-grid-header"
            style="display: grid; grid-template-columns: 1fr 80px 80px var(--astra-dynamic-cols) 100px;"
          >
            ${this.sortHeader('astra-col-title', 'Title', 'title')}
            ${this.sortHeader('astra-col-type', 'Type', 'type')}
            ${this.sortHeader('astra-col-score', 'Score', 'score')}
            ${map(sections, (s: any) =>
              this.sortHeader('astra-col-section', s.name, `section-${s.id}`)
            )}
            <div class="astra-col-actions">Actions</div>
          </div>
          <div class="astra-grid-body"></div>
        </div>
      </div>
    `;
  }

  private renderVisibleRows(): void {
    const body = this.$('.astra-grid-body');
    if (!body) return;

    const state = this.props;
    const sections = this.service.getSections();
    const compact = state.layout === 'list';
    const grid = state.layout === 'grid';
    const groups = this.buildWorkGroups(state.filteredWorks);
    const processId = ++this.renderProcessId;

    this.stopAutoRender();
    body.innerHTML = '';
    this.pendingGroups = groups;
    this.pendingSections = sections;
    this.pendingCompact = compact;
    this.pendingGrid = grid;
    this.pendingBody = body;
    this.renderedGroupCounts.clear();

    this.renderGroupSkeleton(processId);
    this.scheduleAutoRender(processId);
  }

  private buildWorkGroups(works: AstraWorkSummary[]): AstraWorkGroup[] {
    const groups = new Map<string, AstraWorkSummary[]>();

    works.forEach((work) => {
      const status = this.getDisplayStatus(work);
      if (!groups.has(status)) groups.set(status, []);
      groups.get(status)!.push(work);
    });

    const statusOrder = [
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

    const activeStatusFilters =
      this.props.filters.anilistStatus === 'all' ? [] : this.props.filters.anilistStatus;
    const forceOpen = new Set<string>(
      activeStatusFilters.flatMap((status: MediaListStatus) =>
        this.getPossibleDisplayStatuses(status)
      )
    );

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
    if (this.pendingGrid) return this.renderGridCard(work);
    if (this.pendingCompact) {
      return AstraRowRenderer.renderCompact(work, this.pendingSections, (id) =>
        this.ratingController.open(id)
      );
    }

    return AstraRowRenderer.render(work, this.pendingSections, (id) =>
      this.ratingController.open(id)
    );
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
    if (this.renderTimer !== null || !this.hasPendingRows()) return;

    this.renderTimer = window.setTimeout(() => {
      window.requestAnimationFrame(() => {
        this.renderTimer = null;
        if (processId !== this.renderProcessId) return;

        const nextGroup = this.pendingGroups.find((group) => {
          const renderedCount = this.renderedGroupCounts.get(group.status) ?? 0;
          return !group.collapsed && renderedCount < group.works.length;
        });

        if (nextGroup) {
          this.renderNextGroupChunk(nextGroup);
          this.scheduleAutoRender(processId);
        }
      });
    }, AstraWorkTable.RENDER_CHUNK_DELAY_MS);
  }

  private stopAutoRender(): void {
    if (this.renderTimer === null) return;

    window.clearTimeout(this.renderTimer);
    this.renderTimer = null;
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
    const group = this.pendingGroups.find((candidate) =>
      candidate.works.some((work) => work.mediaId === mediaId)
    );
    if (!group || group.collapsed) return;

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

    return html`
      <button
        type="button"
        class="astra-grid-group-header ${collapsed ? 'collapsed' : ''}"
        data-status="${status}"
      >
        <div class="astra-group-info">
          <i class="fa fa-chevron-down"></i>
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
    return html`
      <button
        type="button"
        class="astra-layout-card"
        data-action="edit"
        data-media-id="${work.mediaId}"
        title="${work.title}"
      >
        <img
          src="${work.cover || ''}"
          class="astra-layout-card-cover"
          loading="lazy"
          data-action="preview"
          data-title="${work.title}"
        />
        <div class="astra-layout-card-shade"></div>
        <div class="astra-layout-card-info">
          <div class="astra-layout-card-title">${work.title}</div>
          <div class="astra-layout-card-meta">${this.formatProgress(work)}</div>
        </div>
      </button>
    `;
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
        </svg>
      </div>
    `;
  }

  /**
   * Binds navigation and modal events.
   */
  protected bindEvents(): void {
    if (this.props.filteredWorks?.length > 0) {
      this.renderVisibleRows();
    }

    this.$('.astra-grid-body')?.addEventListener('click', (event) => {
      const header = (event.target as HTMLElement).closest(
        '.astra-grid-group-header'
      ) as HTMLElement | null;
      const status = header?.dataset.status;
      if (!status) return;

      if (this.collapsedGroups.has(status)) {
        this.collapsedGroups.delete(status);
      } else {
        this.collapsedGroups.add(status);
      }
      this.renderVisibleRows();
    });

    this.$('.astra-grid-body')?.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      const preview = target.closest('[data-action="preview"]') as HTMLImageElement | null;
      if (preview) {
        event.preventDefault();
        event.stopPropagation();
        this.openImagePreview(preview.src, preview.dataset.title || '');
        return;
      }

      const editTarget = target.closest(
        '[data-action="edit"][data-media-id]'
      ) as HTMLElement | null;
      const mediaId = Number(editTarget?.dataset.mediaId);
      if (mediaId) this.ratingController.open(mediaId);
    });

    if (this.props.layout !== 'grid') {
      this.$$('[data-action="edit"][data-media-id]').forEach((target) => {
        target.addEventListener('click', (event) => {
          const mediaId = Number((event.currentTarget as HTMLElement).dataset.mediaId);
          if (mediaId) this.ratingController.open(mediaId);
        });
      });
    }

    // Column header sorting (toggles asc/desc, e.g. A–Z / Z–A on Title).
    this.$('.astra-grid-header')?.addEventListener('click', (event) => {
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

    this.$('[data-empty-action="sync"]')?.addEventListener('click', () => {
      void this.runSync();
    });

    this.$('[data-empty-action="import"]')?.addEventListener('click', () => {
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

    const overlay = document.createElement('div');
    overlay.className = 'astra-preview-overlay';
    const content = document.createElement('div');
    content.className = 'astra-preview-content';
    const img = document.createElement('img');
    img.className = 'astra-preview-img';
    img.src = src;
    img.alt = title;
    content.appendChild(img);
    overlay.appendChild(content);

    const close = () => overlay.remove();
    overlay.addEventListener('click', close);
    document.addEventListener('keydown', function onKeydown(event) {
      if (event.key !== 'Escape') return;
      close();
      document.removeEventListener('keydown', onKeydown);
    });

    document.body.appendChild(overlay);
  }

  /**
   * Lets the user drop a JSON backup anywhere on the dashed area
   * surrounding the portal card to trigger the same import flow as
   * the "Import JSON" button.
   */
  private bindDropZone(): void {
    const dropZone = this.$('.astra-empty-state--importer') as HTMLElement | null;
    if (!dropZone) return;

    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('is-dragover');
    });

    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('is-dragover');
    });

    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('is-dragover');
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      void file.text().then((content) => this.service.importJSON(content));
    });
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
    } catch (err) {
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
    let row = this.$(`.astra-grid-row[data-media-id="${mediaId}"]`);
    if (!row) {
      this.renderUntilMedia(mediaId);
      row = this.$(`.astra-grid-row[data-media-id="${mediaId}"]`);
    }

    if (row) {
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      row.classList.remove('astra-row-focus-pulse');
      // Force reflow for animation restart
      void (row as HTMLElement).offsetWidth;
      row.classList.add('astra-row-focus-pulse');
      setTimeout(() => row.classList.remove('astra-row-focus-pulse'), 4000);
    }
  }
}
