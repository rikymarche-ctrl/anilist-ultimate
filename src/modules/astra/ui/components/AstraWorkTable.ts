/**
 * @file AstraWorkTable.ts
 * @description Main data grid for Astra works.
 * Refactored to use DI and secure `html` templates.
 */

import { injectable, inject } from 'tsyringe';
import { AstraView } from '../base/AstraView';
import { AstraDashboardStore } from '../../store/AstraDashboardStore';
import { IDashboardState } from '../../interfaces/IDashboardState';
import { AstraService } from '../../AstraService';
import { AstraWorkSummary } from '../../AstraInterfaces';
import { AstraRatingController } from '../AstraRatingController';
import { TOKENS } from '@core/di/tokens';
import { html, map } from '@core/utils/Template';
import { AstraRowRenderer } from './AstraRowRenderer';

@injectable()
export class AstraWorkTable extends AstraView {
  constructor(
    @inject(TOKENS.AstraStore) _store: AstraDashboardStore,
    @inject(TOKENS.AstraService) private service: AstraService,
    @inject(TOKENS.AstraRatingController) private ratingController: AstraRatingController
  ) {
    super({});
    // Safety re-render after DI assignment
    this.element = this.render();
  }

  /**
   * Performance: Surgical update of the grid body only.
   * Prevents full rerender stuttering with thousands of entries.
   */
  protected override onUpdate(): boolean {
    const body = this.$('.astra-grid-body');
    const state = this.props;

    if (state.filteredWorks.length === 0) {
      // Re-render only if the empty-state variant actually changed
      // (importer vs. "no results"); otherwise skip to avoid replaying
      // the portal's entrance animation on every filter click.
      const showsImporter =
        this.element?.classList.contains('astra-empty-state--importer') ?? false;
      const needsImporter = state.stats.totalCount === 0;
      return showsImporter === needsImporter;
    }

    // Switch between populated grid and empty/import states with a full rerender.
    if (!body) return false;

    const sections = this.service.getSections();

    // Clear and batch-append using DocumentFragment
    body.innerHTML = '';
    const fragment = document.createDocumentFragment();

    state.filteredWorks.forEach((work: AstraWorkSummary) => {
      fragment.appendChild(
        AstraRowRenderer.render(work, sections, (id) => this.ratingController.open(id))
      );
    });

    body.appendChild(fragment);
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

    return html`
      <div class="astra-table-wrap">
        <div class="astra-grid" style="--astra-dynamic-cols: repeat(${sections.length}, 105px)">
          <div
            class="astra-grid-header"
            style="display: grid; grid-template-columns: 60px 1fr 80px 80px var(--astra-dynamic-cols) 100px;"
          >
            <div class="astra-col-cover">Cover</div>
            <div class="astra-col-title">Title</div>
            <div class="astra-col-type">Type</div>
            <div class="astra-col-score">Score</div>
            ${map(sections, (s: any) => html`<div class="astra-col-section">${s.name}</div>`)}
            <div class="astra-col-actions">Actions</div>
          </div>
          <div class="astra-grid-body">
            ${map(works, (w: AstraWorkSummary) =>
              AstraRowRenderer.render(w, sections, (id: number) => this.ratingController.open(id))
            )}
          </div>
        </div>
      </div>
    `;
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
    const row = this.$(`.astra-grid-row[data-media-id="${mediaId}"]`);
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
