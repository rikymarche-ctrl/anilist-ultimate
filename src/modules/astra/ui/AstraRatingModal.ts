/**
 * @file AstraRatingModal.ts
 * @description Modal form for rating individual works across multiple scoring sections
 *
 * Provides:
 *   - Slider inputs for each Astra section/sub-section
 *   - Season management (add, delete, toggle series finale)
 *   - Episode journal with per-episode notes and scores
 *   - Radar chart preview of current scores
 *   - Date range inputs and custom notes
 *   - Focus trap and ESC-to-close accessibility
 *
 * @warning The remaining event/lifecycle controller should be split further.
 *
 * @see AstraService.ts for score persistence
 * @see AstraRadarChart.ts for the SVG chart
 * @see docs/MODULES.md#5-astra-module-advanced-scoring
 */

import { injectable, singleton, inject, container } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import { AstraService } from '../AstraService';
import type {
  AstraSection,
  AstraSubSection,
  AstraWork,
  AstraSeason,
  AstraEpisodeNote,
} from '../AstraInterfaces';
import { AstraRadarChart } from './AstraRadarChart';
import { parseManualScoreInput } from './AstraManualScore';
import { isManualScore } from '../utils/AstraSeasons';
import type { IApiClient, ApiContext } from '@core/interfaces/IApiClient';
import type { ToastService } from '@core/services/ToastService';
import { logger } from '@core/logger';
import type { AstraDashboard } from './AstraDashboard';
import type { PreferencesService } from '@core/services/PreferencesService';
import { navigateInApp } from '@core/navigation/SpaNavigate';
import { MediaListStatus, type AniListDate } from '@/api/AnilistTypes';
import { getStatusLabel } from '@core/utils/UIHelpers';
import { statusAfterProgress } from '@core/utils/ProgressStatus';
import * as EventBusTypes from '@core/interfaces/IEventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';

import { AstraRatingViewScope } from './AstraRatingViewScope';
import { ASTRA_JOURNAL_PAGE_SIZE, journalPage } from './AstraJournalPage';
import { AstraRatingState } from './AstraRatingState';
import { AstraRatingHeader } from './components/AstraRatingHeader';
import type {
  IAstraRatingService,
  IRatingInitialData,
  AstraRatingMedia,
  AstraDispatchMode,
  AstraDispatchOutcome,
  AstraSaveOptions,
} from '../interfaces/IAstraRatingService';
import { captureApiContext, assertApiContext } from '@/api/ApiContext';
import { escapeHtml } from '@core/utils/Template';
import { parseWebUrl } from '@core/utils/WebUrl';
import {
  AstraRatingFormDraft,
  formatRatingDate,
  parseRatingDate,
  steppedCount,
  type AstraRatingFormValues,
} from './AstraRatingFormDraft';
import { astraSaveFailureMessage } from '../services/AstraSaveFailure';
import { stampAstraProgress } from '../utils/AstraProgressHistory';
import { reconcileWithRemote } from '../utils/AstraRemoteReconcile';
import { AstraOverlayService } from '../services/AstraOverlayService';

import {
  bindRatingDatePicker,
  bindEpisodeDatePicker,
  formatDateDisplay,
  formatEpisodeDate,
  formatEpisodeTime,
  miniCalendarDateParts,
} from './AstraDatePicker';

const LOCAL_ONLY_NOTICE =
  'Saved in Astra only: this title is not on your AniList list. Pick a status to add it.';
const EXTENSION_RELOADED_NOTICE =
  'AniList Ultimate was updated. Reload the page to use Quick Edit.';

function isExtensionContextInvalid(error: unknown): boolean {
  if (error instanceof Error && /Extension context invalidated/i.test(error.message)) return true;
  return typeof chrome !== 'undefined' && !!chrome.runtime && !chrome.runtime.id;
}
const SYNC_QUEUED_NOTICE = 'Saved locally. AniList synchronization is queued.';

const ANILIST_FALLBACK_TITLE = 'AniList score — rate the sections to replace it';

/** AniList scores run 0-100 with 0 meaning unrated; the overall box uses 0-10. */
function remoteOverallScore(data: IRatingInitialData): number | null {
  // A queued score (even a clear) is newer than the remote entry, so it wins over it.
  const score =
    data.pendingScore !== undefined
      ? (data.pendingScore ?? 0)
      : (data.media.mediaListEntry?.score ?? 0);
  return score > 0 ? score / 10 : null;
}

/** Everything the form showed when it opened, plus the save baselines of that moment. */
interface AstraRatingOpeningSnapshot {
  work: AstraWork;
  formValues: AstraRatingFormValues;
  seasonNotes: string[];
  reportSnapshot: string;
  scoresSnapshot: string;
  progress: number;
}

interface RatingMeta {
  progress: number;
  totalEpisodes: number | null;
  airedEpisodes: number | null;
  isManga: boolean;
}

@injectable()
@singleton()
export class AstraRatingModal {
  private overlay: HTMLElement | null = null;
  private header: AstraRatingHeader;
  private state: AstraRatingState | null = null;
  private currentSeasonIdx: number = 0;
  private activeTab: string = 'rating';
  private saveInFlight: Promise<void> | null = null;
  private reportedSaveFailures = new WeakSet<Error>();
  private isClosing = false;
  private deletingEntry = false;
  private media: AstraRatingMedia | null = null;
  private coverOverlay: HTMLElement | null = null;
  private formDraft: AstraRatingFormDraft | null = null;
  private formEditVersion = 0;
  /** Snapshot used to avoid rewriting AniList notes during list-only edits. */
  private initialSeasonNotes: string[] = [];
  private initialReportSnapshot = '';
  /** Scores as loaded; a save only sends the Astra score to AniList when the user changed it. */
  private initialScoresSnapshot = '';
  private needsListStatus = false;
  private initialProgress: number = 0; // Track initial progress for PROGRESS_UPDATED event
  /** The form as opened; Revert restores it. Null for a title not yet on the AniList list. */
  private openingSnapshot: AstraRatingOpeningSnapshot | null = null;
  private allCustomLists: string[] = [];
  /** A save has committed this view's edits since opening, so a revert must be saved back. */
  private savedSinceOpen = false;
  /** Drives the Revert button: true once the user edits, false again after a revert. */
  private hasEditsSinceOpen = false;
  /** AniList's own score on the 0-10 scale (null when unrated): stands in for the overall box until a section is rated. */
  private remoteOverall: number | null = null;
  /** True while the overall box shows its manual-score input. */
  private overallEditing = false;
  /** Scoring mode picked in this modal while its settings write is still in flight. */
  private pendingScoringMode: 'detailed' | 'simple' | null = null;
  private livePreviewRaf: number | null = null; // Coalesces live-preview redraws during slider drag
  /** Temporary journal unlocks never change the episode's watched/progress state. */
  private readonly unlockedNotAiredEpisodes = new Set<string>();
  private documentClickHandler: (() => void) | null = null;
  private documentEscHandler: ((e: KeyboardEvent) => void) | null = null;
  private openVersion = 0;
  private pendingOpen: {
    mediaId: number;
    tab: string;
    context: ApiContext | undefined;
    promise: Promise<void>;
  } | null = null;
  private loadingOverlay: HTMLElement | null = null;
  private loadingController: AbortController | null = null;
  private viewScope: AstraRatingViewScope | null = null;
  private journalScope: AstraRatingViewScope | null = null;
  private journalPageIndex = 0;
  private viewContext: ApiContext | undefined;
  private authSubscription: EventBusTypes.EventSubscription | null = null;
  private navigationSubscription: EventBusTypes.EventSubscription | null = null;
  private savingState: AstraRatingState | null = null;
  private closeInFlight: { root: HTMLElement; promise: Promise<void> } | null = null;
  private closingTimers = new Map<HTMLElement, ReturnType<typeof setTimeout>>();
  private opener: HTMLElement | null = null;
  private readonly resizeHandler = () => {
    if (this.overlay && !this.isClosing) this.updateLivePreview();
  };

  constructor(
    @inject(TOKENS.AstraService) private astraService: AstraService,
    @inject(TOKENS.ApiClient) private api: IApiClient,
    @inject(TOKENS.EventBus) private eventBus: EventBusTypes.IEventBus,
    @inject(TOKENS.ToastService) private toast: ToastService,
    @inject(TOKENS.IAstraRatingService) private ratingService: IAstraRatingService,
    @inject(AstraOverlayService) private overlayService: AstraOverlayService
  ) {
    this.header = new AstraRatingHeader({});
  }

  private get dashboard(): AstraDashboard {
    return container.resolve<AstraDashboard>(TOKENS.AstraDashboard);
  }

  /** The calendar's "Open in New Tab" preference; off (navigate in place) when preferences are unavailable. */
  private get opensInNewTab(): boolean {
    try {
      return container.resolve<PreferencesService>(TOKENS.PreferencesService).getPreferences()
        .openInNewTab;
    } catch {
      return false;
    }
  }

  /**
   * Opens the Astra rating modal view and initializes data.
   *
   * @param mediaId The AniList media ID to load.
   * @param initialTab The initial tab to show ('rating' or 'journal').
   * @returns A promise that resolves when the modal open operation has completed.
   */
  public open(mediaId: number, initialTab: 'rating' | 'journal' = 'rating'): Promise<void> {
    const context = this.api.getContext?.();
    const pending = this.pendingOpen;
    if (
      pending?.mediaId === mediaId &&
      pending.tab === initialTab &&
      pending.context?.sessionId === context?.sessionId &&
      pending.context?.userId === context?.userId
    )
      return pending.promise;
    const promise = this.openView(mediaId, initialTab);
    const request = {
      mediaId,
      tab: initialTab,
      context: context ? { ...context } : undefined,
      promise,
    };
    this.pendingOpen = request;
    const clear = () => {
      if (this.pendingOpen === request) this.pendingOpen = null;
    };
    void promise.then(clear, clear);
    return promise;
  }

  /** Warms the entry's AniList data before the user clicks (hover intent). */
  public prefetch(mediaId: number): void {
    if (this.overlay && !this.isClosing && this.media?.id === mediaId) return;
    this.ratingService.prefetchMediaRatingData?.(mediaId);
  }

  /** Hover ended before the prefetch dwell elapsed. */
  public cancelPrefetch(): void {
    this.ratingService.cancelPrefetch?.();
  }

  private async openView(mediaId: number, initialTab: 'rating' | 'journal'): Promise<void> {
    if (this.deletingEntry) return;
    const version = ++this.openVersion;
    this.ensureAuthSubscription();
    let rendering = false;
    try {
      if (!this.overlay || this.isClosing) this.showLoading();
      if (this.overlay && this.state && !this.isClosing) {
        const previousState = this.state;
        await this.save();
        if (version !== this.openVersion || this.state !== previousState || previousState.isDirty)
          return;
      }
      const context = await captureApiContext(this.api);
      if (version !== this.openVersion) return;
      const [data, existingWork] = await Promise.all([
        this.fetchAniListData(mediaId),
        this.astraService.getFullWork(mediaId),
      ]);
      if (version !== this.openVersion) return;
      assertApiContext(this.api, context);
      if (!data) {
        this.toast.error('Unable to load this entry. Retry opening the form.');
        if (!this.overlay) this.releaseAuthSubscription();
        return;
      }
      if (data.pendingDeletion) {
        this.toast.info(
          'This entry is queued for deletion. Wait for AniList synchronization before editing it.'
        );
        if (!this.overlay) this.releaseAuthSubscription();
        return;
      }
      this.isClosing = false;

      const { media, allCustomLists } = data;
      const mediaType =
        media.type === 'MANGA' && media.format === 'NOVEL'
          ? 'novel'
          : (media.type.toLowerCase() as 'anime' | 'manga');

      const listMemberships = media.mediaListEntry?.customLists ?? {};
      const customLists = Object.keys(listMemberships).filter((name) => listMemberships[name]);

      assertApiContext(this.api, context, existingWork?.ownerId);
      const worksCount = this.astraService.getWorks().length;
      const pending = data.pendingListState ?? {};

      let workData: AstraWork;
      if (existingWork) {
        logger.info(
          `[AstraRatingModal] Loaded existing work for mediaId ${mediaId}: ${existingWork.title} (Total works in DB: ${worksCount})`
        );
        const remoteEntry = media.mediaListEntry;
        const remoteFields: Partial<AstraWork> = {
          title: media.title.userPreferred,
          type: mediaType,
          country: media.countryOfOrigin ?? existingWork.country,
          cover: media.coverImage.extraLarge || media.coverImage.large || existingWork.cover,
          ...(media.episodes !== null ? { episodes: media.episodes } : {}),
          ...(media.chapters !== null ? { chapters: media.chapters } : {}),
        };
        if (remoteEntry)
          Object.assign(remoteFields, {
            status: pending.status ?? remoteEntry.status,
            progress: pending.progress ?? remoteEntry.progress,
            customLists: pending.customLists
              ? [...pending.customLists]
              : Object.keys(remoteEntry.customLists).filter(
                  (name) => remoteEntry.customLists[name]
                ),
            isPrivate: pending.private ?? remoteEntry.private,
            isHidden: pending.hidden ?? remoteEntry.hiddenFromStatusLists,
            startedAt: Object.prototype.hasOwnProperty.call(pending, 'startedAt')
              ? pending.startedAt
              : remoteEntry.startedAt,
            completedAt: Object.prototype.hasOwnProperty.call(pending, 'completedAt')
              ? pending.completedAt
              : remoteEntry.completedAt,
          });
        else
          Object.assign(remoteFields, {
            ...(pending.status !== undefined ? { status: pending.status } : {}),
            ...(pending.progress !== undefined ? { progress: pending.progress } : {}),
            ...(pending.customLists !== undefined ? { customLists: [...pending.customLists] } : {}),
            ...(pending.private !== undefined ? { isPrivate: pending.private } : {}),
            ...(pending.hidden !== undefined ? { isHidden: pending.hidden } : {}),
            ...(Object.prototype.hasOwnProperty.call(pending, 'startedAt')
              ? { startedAt: pending.startedAt }
              : {}),
            ...(Object.prototype.hasOwnProperty.call(pending, 'completedAt')
              ? { completedAt: pending.completedAt }
              : {}),
          });
        workData = {
          ...existingWork,
          ...remoteFields,
        };
        // AniList is the source of truth for list metadata. Persist that pull
        // locally without triggering the reverse notes sync; the partial patch
        // lets the repository preserve the journal from its newest copy.
        const changed = Object.entries(remoteFields).some(
          ([key, value]) =>
            JSON.stringify(existingWork[key as keyof AstraWork]) !== JSON.stringify(value)
        );
        // A queued local save is newer than AniList, so its report must not be replaced by the remote copy.
        const reconciled =
          remoteEntry && !data.pendingReport
            ? reconcileWithRemote(
                workData,
                { notes: remoteEntry.notes, score: remoteEntry.score },
                {
                  sections: this.astraService.getSections(),
                  appendAstraToComment: this.astraService.getSettings().appendAstraToComment,
                }
              )
            : { work: workData, changed: false };
        workData = reconciled.work;
        if (changed || reconciled.changed) {
          assertApiContext(this.api, context, existingWork.ownerId);
          // Report fields travel in the patch only when AniList actually changed them.
          workData = await this.astraService.saveWork(
            {
              mediaId,
              ...remoteFields,
              ...(reconciled.changed
                ? { notes: reconciled.work.notes, seasons: reconciled.work.seasons }
                : {}),
            },
            true
          );
          assertApiContext(this.api, context, workData.ownerId);
        }
      } else {
        logger.warn(
          `[AstraRatingModal] No existing work found for mediaId ${mediaId} in DB of ${worksCount} items. Creating default fallback.`
        );
        workData = {
          id: `w_${Math.random().toString(36).slice(2, 11)}`,
          mediaId,
          ...(context ? { ownerId: context.userId } : {}),
          title: media.title.userPreferred,
          type: mediaType,
          country: media.countryOfOrigin,
          cover: media.coverImage.extraLarge || media.coverImage.large,
          status: pending.status ?? media.mediaListEntry?.status ?? MediaListStatus.PLANNING,
          customLists: pending.customLists ? [...pending.customLists] : customLists,
          tags: [],
          notes: '',
          episodes: media.episodes ?? undefined,
          chapters: media.chapters ?? undefined,
          progress: pending.progress ?? media.mediaListEntry?.progress ?? 0,
          isPrivate: pending.private ?? media.mediaListEntry?.private,
          isHidden: pending.hidden ?? media.mediaListEntry?.hiddenFromStatusLists,
          ...(media.mediaListEntry
            ? {
                startedAt: Object.prototype.hasOwnProperty.call(pending, 'startedAt')
                  ? pending.startedAt
                  : media.mediaListEntry.startedAt,
                completedAt: Object.prototype.hasOwnProperty.call(pending, 'completedAt')
                  ? pending.completedAt
                  : media.mediaListEntry.completedAt,
              }
            : {}),
          updatedAt: Date.now(),
          seasons: [
            {
              id: 's_1',
              name: 'Season 1',
              scores: {},
              notes: media.mediaListEntry?.notes || '',
            },
          ],
        };
      }

      // AniList is the source of truth: no remote entry means the title is not on the list, even if a local work exists.
      this.needsListStatus = !media.mediaListEntry && pending.status === undefined;
      this.state = this.createState(workData);
      this.initialSeasonNotes = workData.seasons.map((season) => season.notes ?? '');
      this.initialReportSnapshot = this.reportContentSnapshot(workData);
      this.initialScoresSnapshot = this.scoresSnapshot(workData);

      this.activeTab = initialTab;
      this.viewContext = context;
      this.currentSeasonIdx = 0;
      this.journalPageIndex = 0;
      this.unlockedNotAiredEpisodes.clear();
      this.media = media;
      this.remoteOverall = remoteOverallScore(data);
      this.formDraft = new AstraRatingFormDraft(
        media.mediaListEntry,
        workData,
        data.pendingDates,
        pending
      );
      this.formEditVersion = 0;
      this.initialProgress = media.mediaListEntry?.progress || 0; // Save initial progress
      this.allCustomLists = allCustomLists;
      this.savedSinceOpen = false;
      this.hasEditsSinceOpen = false;
      this.openingSnapshot = this.needsListStatus
        ? null
        : {
            work: structuredClone(workData),
            formValues: structuredClone(this.formDraft.values),
            seasonNotes: [...this.initialSeasonNotes],
            reportSnapshot: this.initialReportSnapshot,
            scoresSnapshot: this.initialScoresSnapshot,
            progress: this.initialProgress,
          };
      rendering = true;
      this.render(media, allCustomLists);
    } catch (error) {
      if (version !== this.openVersion) return;
      logger.error('[AstraRatingModal] Unable to open form', error);
      if (rendering) {
        // The overlay was created but never completed: release backdrop, scroll lock and listeners.
        this.toast.error('Unable to open the form. Retry opening it.');
        this.dispose();
        return;
      }
      // After an extension reload this page still runs the old script, which can no longer reach storage.
      this.toast.error(
        isExtensionContextInvalid(error)
          ? EXTENSION_RELOADED_NOTICE
          : 'Unable to open the form. Your current edits remain open.'
      );
      if (!this.overlay) this.releaseAuthSubscription();
    } finally {
      if (version === this.openVersion) {
        const loading = this.loadingOverlay;
        this.clearLoading();
        if (!this.overlay) {
          this.releaseAuthSubscription();
          this.restoreHostState(loading);
        }
      }
    }
  }

  private showLoading(): void {
    if (this.loadingOverlay) return;
    if (this.isClosing) {
      for (const [root, timer] of this.closingTimers) {
        clearTimeout(timer);
        root.remove();
      }
      this.closingTimers.clear();
      this.overlay?.remove();
      this.overlay = null;
      this.isClosing = false;
    }
    const root = document.createElement('div');
    root.className = 'astra-modal-overlay astra-modal-overlay--open astra-modal-overlay--loading';
    root.innerHTML = `<section class="astra-modal astra-rating-loading" role="dialog" aria-modal="true" aria-labelledby="astra-loading-title" aria-busy="true">
      <h2 id="astra-loading-title">Astra Quick Edit</h2>
      <button type="button" class="astra-rating-loading__close" aria-label="Close Quick Edit">×</button>
      <p role="status" aria-live="polite">Loading entry…</p>
    </section>`;
    if (!this.opener)
      this.opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.loadingOverlay = root;
    const controller = new AbortController();
    this.loadingController = controller;
    const current = () => this.loadingOverlay === root;
    const close = root.querySelector<HTMLButtonElement>('button')!;
    close.addEventListener(
      'click',
      () => {
        if (current()) void this.close();
      },
      { signal: controller.signal }
    );
    root.addEventListener(
      'click',
      (event) => {
        if (current() && event.target === root) void this.close();
      },
      { signal: controller.signal }
    );
    const onKeyDown = (event: KeyboardEvent) => {
      if (!current()) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        void this.close();
      } else if (event.key === 'Tab') {
        event.preventDefault();
        close.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    controller.signal.addEventListener(
      'abort',
      () => document.removeEventListener('keydown', onKeyDown),
      { once: true }
    );
    document.body.append(root);
    this.overlayService.acquireScrollLock('rating-modal');
    close.focus({ preventScroll: true });
  }

  private clearLoading(): void {
    this.loadingController?.abort();
    this.loadingController = null;
    this.loadingOverlay?.remove();
    this.loadingOverlay = null;
  }

  private async fetchAniListData(mediaId: number): Promise<IRatingInitialData | null> {
    return this.ratingService.getMediaRatingData(mediaId);
  }

  private render(media: AstraRatingMedia | null, allCustomLists: string[]): void {
    // A fresh render replaces any open manual-score input.
    this.overallEditing = false;
    if (!media) return;
    this.clearLoading();
    this.viewScope?.release();
    this.releaseGlobalHandlers();
    this.coverOverlay?.remove();
    this.coverOverlay = null;
    if (this.overlay) this.overlay.remove();

    this.overlay = document.createElement('div');
    this.overlay.className = 'astra-modal-overlay';
    document.body.appendChild(this.overlay);
    const state = this.state!;
    const context = this.viewContext;
    const root = this.overlay;
    const scope: AstraRatingViewScope = new AstraRatingViewScope(
      root,
      () => this.matchesView(scope, state, context),
      (error) => {
        logger.error('[AstraRatingModal] Form action failed', error);
        this.toast.error('The action failed. Your edits remain open; retry.');
      }
    );
    this.viewScope = scope;
    this.listen(window, 'resize', this.resizeHandler);
    if (!this.opener) {
      this.opener =
        document.activeElement instanceof HTMLElement && !root.contains(document.activeElement)
          ? document.activeElement
          : null;
    }
    this.overlayService.acquireScrollLock('rating-modal');
    for (const [closingRoot, timer] of this.closingTimers) {
      clearTimeout(timer);
      closingRoot.remove();
    }
    this.closingTimers.clear();

    const work = this.state!.data;
    const season = work.seasons[this.currentSeasonIdx];
    const layout = this.scoringLayout();
    const sections = layout === 'solo' ? [] : this.astraService.getSections();
    const entry =
      this.formDraft?.values ?? new AstraRatingFormDraft(media.mediaListEntry, work).values;

    const isManga = media.type === 'MANGA';
    const meta = {
      progress: entry?.progress || 0,
      totalEpisodes: isManga ? media.chapters : media.episodes,
      airedEpisodes: isManga
        ? (media.chapters ?? null)
        : media.nextAiringEpisode
          ? media.nextAiringEpisode.episode - 1
          : media.status === 'FINISHED'
            ? media.episodes
            : media.episodes || 0,
      isManga,
    };

    const entryCustomLists = Object.fromEntries(entry.customLists.map((name) => [name, true]));

    this.overlay.innerHTML = `
      <div class="astra-rating-workspace ${this.activeTab === 'journal' ? 'astra-rating-workspace--journal' : ''}">
       <div class="astra-modal astra-modal--rating">
        <nav class="astra-modal-nav">
          <div class="astra-nav-back" id="astra-dashboard-link">
            <svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" style="width: 32px; height: 32px; transform: rotate(-90deg);">
              <path d="M12 4L4 20H8L12 12L16 20H20L12 4Z" />
              <path d="M12 12L10.7 15.5H13.3L12 12Z" />
            </svg>
            <div class="astra-nav-back-text">Back to Dashboard</div>
          </div>
          <button class="astra-nav-item ${this.activeTab === 'rating' ? 'active' : ''}" data-tab="rating">
            <i class="fa-solid fa-sliders"></i>
            <span>Rating</span>
          </button>
          <button class="astra-nav-item ${this.activeTab === 'journal' ? 'active' : ''}" data-tab="journal">
            <i class="fa-solid fa-book"></i>
            <span>Journal</span>
          </button>
        </nav>

        <div class="astra-modal-main">
          <div id="astra-header-container"></div>

          <div class="astra-modal-body">
            <!-- RATING TAB -->
            ${this.renderRatingTab(work, season, entry, sections, meta)}

            ${this.renderJournalTab(meta, season)}
          </div>

          </div>
       </div>
       ${this.renderCustomListsPanel(allCustomLists, entryCustomLists, entry)}
      </div>
    `;

    this.renderHeader();

    const renderedOverlay = this.overlay;
    const cover = this.overlay.querySelector('#astra-cover');
    if (cover) {
      this.listen(cover, 'click', () => {
        if (
          this.overlay !== renderedOverlay ||
          !renderedOverlay.isConnected ||
          !this.state?.data.cover
        )
          return;
        const hiResCover = parseWebUrl(this.state.data.cover.replace('/medium/', '/large/'));
        if (!hiResCover) return;
        this.coverOverlay?.remove();
        const fullOverlay = document.createElement('div');
        this.coverOverlay = fullOverlay;
        fullOverlay.className = 'astra-cover-full-overlay';
        const fullContainer = document.createElement('div');
        fullContainer.className = 'astra-cover-full-container';
        const image = document.createElement('img');
        image.className = 'astra-cover-full-img';
        image.src = hiResCover.href;
        fullContainer.append(image);
        fullOverlay.append(fullContainer);
        fullOverlay.onclick = () => fullOverlay.remove();
        document.body.appendChild(fullOverlay);
      });
    }

    this.attachEvents();
    this.updateLivePreview();
    this.refreshLodeButtons();

    // Trigger animation
    this.frame(() => {
      this.overlay?.classList.add('astra-modal-overlay--open');
    });
  }

  private renderHeader(): void {
    if (!this.overlay || !this.state || !this.media) return;
    const headerContainer = this.overlay.querySelector('#astra-header-container') as HTMLElement;

    if (headerContainer) {
      this.header.unmount();
      headerContainer.innerHTML = ''; // Clear existing header to prevent duplication
      this.header.mount(headerContainer, {
        mediaId: this.media.id,
        mediaType: this.media.type === 'MANGA' ? 'manga' : 'anime',
        title: this.media.title.userPreferred,
        canDelete: this.activeTab === 'rating' && !this.needsListStatus,
        canRevert: this.openingSnapshot !== null,
        hasChanges: this.hasEditsSinceOpen,
        openInNewTab: this.opensInNewTab,
      });
    }
  }

  private createState(work: AstraWork): AstraRatingState {
    return new AstraRatingState(work, (isDirty) => {
      logger.debug(`[AstraRatingModal] State dirty: ${isDirty}`);
      if (isDirty) this.noteEdit();
    });
  }

  /** Reveals the Revert button on the first edit since opening (or since the last revert). */
  private noteEdit(): void {
    if (this.hasEditsSinceOpen) return;
    this.hasEditsSinceOpen = true;
    this.refreshRevertButton();
  }

  private refreshRevertButton(): void {
    const button = this.overlay?.querySelector<HTMLButtonElement>('#astra-revert-entry');
    if (button) button.hidden = !this.hasEditsSinceOpen;
  }

  /**
   * Restores the form as it was opened. Edits never saved are simply dropped; edits an earlier
   * save already committed (tab switch, season change) stay dirty so closing writes the original
   * values back.
   */
  private async handleRevert(): Promise<void> {
    const snapshot = this.openingSnapshot;
    if (!this.overlay || !this.state || !this.media || !snapshot || this.deletingEntry) return;
    const root = this.overlay;
    const previousState = this.state;
    await this.saveInFlight?.catch(() => undefined);
    if (this.overlay !== root || this.state !== previousState || this.isClosing) return;

    // Keep the concurrency metadata an earlier save advanced, or the write-back would look stale.
    const { updatedAt, ownerId } = previousState.data;
    const state = this.createState({
      ...snapshot.work,
      updatedAt,
      ...(ownerId !== undefined ? { ownerId } : {}),
    });
    const draft = new AstraRatingFormDraft(null, snapshot.work);
    draft.values = structuredClone(snapshot.formValues);
    this.state = state;
    this.formDraft = draft;
    this.formEditVersion++;
    this.needsListStatus = false;
    this.unlockedNotAiredEpisodes.clear();
    this.currentSeasonIdx = Math.min(this.currentSeasonIdx, state.data.seasons.length - 1);
    this.journalPageIndex = 0;
    if (this.savedSinceOpen) {
      state.isDirty = true;
    } else {
      this.initialSeasonNotes = [...snapshot.seasonNotes];
      this.initialReportSnapshot = snapshot.reportSnapshot;
      this.initialScoresSnapshot = snapshot.scoresSnapshot;
      this.initialProgress = snapshot.progress;
    }
    this.hasEditsSinceOpen = false;
    this.render(this.media, this.allCustomLists);
    this.toast.info('Changes reverted.');
  }

  private renderRatingTab(
    work: AstraWork,
    season: AstraSeason,
    entry: AstraRatingFormValues,
    sections: AstraSection[],
    meta: RatingMeta
  ): string {
    const layout = this.scoringLayout();
    return `
      <div id="astra-tab-rating" class="astra-tab-content ${this.activeTab === 'rating' ? 'astra-tab-content--active' : ''}" data-layout="${layout}" data-density="${this.scoringDensity(layout)}">
        <div class="astra-header-section">
          <img ${parseWebUrl(work.cover) ? `src="${escapeHtml(parseWebUrl(work.cover)!.href)}"` : ''} class="astra-header-cover" id="astra-cover">
          <div class="astra-media-header">
            <div class="astra-quick-grid-2x2">
              <div class="astra-grid-cell astra-status-cell">
                <div class="astra-input-box">
                  <span class="astra-label-xs">STATUS</span>
                  <div class="astra-dropdown astra-status-dropdown" id="astra-status-dropdown">
                    <button type="button" class="astra-dropdown-trigger">
                      <i class="fa-solid ${this.needsListStatus ? 'fa-plus' : this.statusIcon(work.status)}" id="astra-status-icon"></i>
                      <span class="astra-dropdown-label" id="astra-status-label">${this.needsListStatus ? 'Add to List' : getStatusLabel(work.status, work.type)}</span>
                      <i class="fa-solid fa-chevron-down"></i>
                    </button>
                    <div class="astra-dropdown-menu">
                      <div class="astra-dropdown-scroll">
                        ${[
                          MediaListStatus.CURRENT,
                          MediaListStatus.COMPLETED,
                          MediaListStatus.PAUSED,
                          MediaListStatus.DROPPED,
                          MediaListStatus.PLANNING,
                          MediaListStatus.REPEATING,
                        ]
                          .map(
                            (s) => `
                          <div class="astra-dropdown-item astra-status-option ${!this.needsListStatus && work.status === s ? 'active' : ''}" data-value="${s}">
                            <i class="fa-solid ${this.statusIcon(s)}"></i>
                            <span>${getStatusLabel(s, work.type)}</span>
                          </div>`
                          )
                          .join('')}
                      </div>
                    </div>
                  </div>
                  <input type="hidden" id="astra-status" value="${this.needsListStatus ? '' : work.status}">
                </div>
              </div>

              <div class="astra-grid-cell astra-progress-cell">
                <div class="astra-input-split">
                  <div class="astra-input-box">
                    <span class="astra-label-xs">PROGRESS</span>
                    <div class="astra-stepper">
                      <button type="button" class="astra-step-btn" data-step-field="progress" data-step="-1">-</button>
                      <div class="astra-stepper-center">
                        <input type="number" class="astra-number-input" id="astra-progress" value="${meta.progress}">
                        <span class="astra-muted-inline">${this.formatProgressCounter(meta.progress, meta.airedEpisodes, meta.totalEpisodes)}</span>
                      </div>
                      <button type="button" class="astra-step-btn" data-step-field="progress" data-step="1">+</button>
                    </div>
                  </div>
                  <div class="astra-input-box">
                    <span class="astra-label-xs">REWATCHES</span>
                    <div class="astra-stepper">
                      <button type="button" class="astra-step-btn" data-step-field="repeat" data-step="-1">-</button>
                      <div class="astra-stepper-center">
                        <input type="number" class="astra-number-input" id="astra-repeat" value="${entry?.repeat || 0}">
                      </div>
                      <button type="button" class="astra-step-btn" data-step-field="repeat" data-step="1">+</button>
                    </div>
                  </div>
                </div>
              </div>

              <div class="astra-date-pickers-grid">
                ${this.renderDateField('astra-start-date', 'START DATE', this.formatDateForInput(entry?.startedAt))}
                ${this.renderDateField('astra-finish-date', 'FINISH DATE', this.formatDateForInput(entry?.completedAt))}
              </div>

            </div>
          </div>
        </div>

        ${layout === 'choice' ? this.renderScoringChoice(sections) : ''}

        <div class="astra-form-layout"${layout === 'sections' ? '' : ' hidden'}>
          <div class="astra-form">
            <div class="astra-form-scroll">
              <div class="astra-field-group">
                ${this.sortSectionsForSymmetry(sections)
                  .map((s) => this.renderScoreInput(s, season.scores, sections.length))
                  .join('')}
              </div>
            </div>
          </div>

          <div class="astra-sidebar">
            <div class="astra-radar-container"${AstraRadarChart.isVisible(sections, season.skip) ? '' : ' hidden'}>
              ${AstraRadarChart.getHTML(this.radarScores(season.scores, sections), sections, season.skip, 300)}
            </div>
          </div>
        </div>

        <div class="astra-form-footer">
          <div class="astra-notes-area">
            <textarea class="astra-textarea" id="astra-general-notes" placeholder="General thoughts...">${'\n'}${escapeHtml(season.notes || '')}</textarea>
          </div>
          ${this.renderOverallArea(this.currentSeasonIdx)}
        </div>
      </div>
    `;
  }

  /**
   * 'sections' shows the section grid, 'solo' a single score next to the notes, and 'choice'
   * asks once whether to score by sections before showing either.
   */
  private scoringLayout(): 'sections' | 'solo' | 'choice' {
    const mode = this.pendingScoringMode ?? this.astraService.getScoringMode();
    if (mode === 'simple' || this.astraService.getSections().length === 0) return 'solo';
    return mode === 'unset' ? 'choice' : 'sections';
  }

  /** Compact: no radar to place, so the window narrows and the header shrinks to match. */
  private scoringDensity(layout: 'sections' | 'solo' | 'choice'): 'compact' | 'full' {
    return layout === 'sections' && AstraRadarChart.isVisible(this.astraService.getSections())
      ? 'full'
      : 'compact';
  }
  private renderScoringChoice(sections: AstraSection[]): string {
    const names = sections
      .slice(0, 3)
      .map((s) => escapeHtml(s.name))
      .join(', ');
    return `
        <div class="astra-scoring-choice" role="group" aria-labelledby="astra-scoring-choice-title">
          <p class="astra-scoring-choice__title" id="astra-scoring-choice-title">How do you want to score?</p>
          <div class="astra-scoring-choice__options">
            <button type="button" class="astra-scoring-option" data-scoring-choice="detailed">
              <i class="fa-solid fa-sliders" aria-hidden="true"></i>
              <span class="astra-scoring-option__name">By sections</span>
              <span class="astra-scoring-option__desc">Rate ${sections.length} ${sections.length === 1 ? 'section' : 'sections'} (${names}${sections.length > 3 ? '…' : ''}) and get a weighted score with a radar chart.</span>
            </button>
            <button type="button" class="astra-scoring-option" data-scoring-choice="simple">
              <i class="fa-solid fa-star" aria-hidden="true"></i>
              <span class="astra-scoring-option__name">Single score</span>
              <span class="astra-scoring-option__desc">One overall score, as on AniList. Notes stay available.</span>
            </button>
          </div>
          <p class="astra-scoring-choice__foot">You can switch anytime in Astra settings.</p>
        </div>`;
  }

  /** Applies the picked mode to the open form at once and saves it as the default. */
  private chooseScoringMode(mode: 'detailed' | 'simple'): void {
    if (!this.overlay) return;
    this.pendingScoringMode = mode;
    const layout = this.scoringLayout();
    const tab = this.overlay.querySelector<HTMLElement>('#astra-tab-rating');
    if (tab) {
      tab.dataset.layout = layout;
      tab.dataset.density = this.scoringDensity(layout);
    }
    this.overlay.querySelector('.astra-scoring-choice')?.remove();
    const form = this.overlay.querySelector<HTMLElement>('.astra-form-layout');
    if (form) form.hidden = layout !== 'sections';
    this.refreshOverallArea();
    this.astraService
      .updateSettings({ detailedScoring: mode === 'detailed' })
      .then(() => {
        if (this.pendingScoringMode === mode) this.pendingScoringMode = null;
      })
      .catch((error) => {
        logger.error('[AstraRatingModal] Saving the scoring mode failed', error);
        this.toast.error('Unable to save the scoring mode. It applies to this entry only.');
      });
  }

  private renderCustomListsPanel(
    allCustomLists: string[],
    entryCustomLists: Record<string, boolean>,
    entry: AstraRatingFormValues
  ): string {
    return `
        <aside class="astra-custom-list-panel" id="astra-custom-list-panel" aria-label="Custom Lists" aria-hidden="${this.activeTab === 'journal'}" ${this.activeTab === 'journal' ? 'hidden' : ''}>
        <div class="astra-custom-list-panel__header">
          <i class="fa-solid fa-list-ul" aria-hidden="true"></i>
          <span>Custom Lists</span>
        </div>
        <div class="astra-custom-list-panel__list astra-dropdown-scroll">
          ${allCustomLists
            .map(
              (listName: string) => `
            <label class="astra-dropdown-item">
              <input type="checkbox" class="astra-custom-list-cb" data-name="${escapeHtml(listName)}" ${Object.prototype.hasOwnProperty.call(entryCustomLists, listName) && entryCustomLists[listName] ? 'checked' : ''}>
              <span>${escapeHtml(listName)}</span>
            </label>
          `
            )
            .join('')}
        </div>
        <div class="astra-dropdown-divider astra-custom-list-panel__divider"></div>
        <div class="astra-custom-list-panel__settings">
          <label class="astra-dropdown-item astra-dropdown-item--special">
            <input type="checkbox" id="astra-hide-cb" ${entry.hidden ? 'checked' : ''}>
            <span>Hide from status lists</span>
          </label>
          <label class="astra-dropdown-item astra-dropdown-item--special">
            <input type="checkbox" id="astra-private-cb" ${entry.private ? 'checked' : ''}>
            <span>Private Entry</span>
          </label>
        </div>
      </aside>
    `;
  }

  private renderJournalTab(meta: RatingMeta, season: AstraSeason): string {
    return `
      <div id="astra-tab-journal" class="astra-tab-content ${this.activeTab === 'journal' ? 'astra-tab-content--active' : ''}">
        <div class="astra-ep-log-header">
          <div class="astra-journal-title-box">
            <h3>${meta.isManga ? 'Chapter' : 'Episode'} Journal</h3>
            <p class="astra-muted">Track your thoughts for every single ${meta.isManga ? 'chapter' : 'episode'}.</p>
          </div>
        </div>
        <div class="astra-ep-list">
          ${this.renderEpisodeList(meta.progress, meta.totalEpisodes, season.episodeNotes || {}, meta.airedEpisodes, meta.isManga ? 'CH' : 'EP')}
        </div>
      </div>
    `;
  }

  /**
   * Optimizes the rendering order of sections for visual symmetry in a 2-column grid.
   * Groups half-width sections together to fill pairs, pushing full-width sections to the bottom.
   */
  private sortSectionsForSymmetry(sections: AstraSection[]): AstraSection[] {
    const half = sections.filter((s) => !s.subSections || s.subSections.length === 0);
    const full = sections.filter((s) => s.subSections && s.subSections.length > 0);
    return [...half, ...full];
  }

  private renderScoreInput(
    section: AstraSection,
    seasonScores: Record<string, number | null>,
    totalSections: number
  ): string {
    const season = this.state!.data.seasons[this.currentSeasonIdx];
    const settings = this.astraService.getSettings();
    let effectiveWeight = section.weight;

    const hasSubSections = section.subSections && section.subSections.length > 0;
    const isFullWidth = hasSubSections || totalSections === 1;
    const groupClass = isFullWidth ? 'astra-score-group--full' : '';

    // Dynamic Finale Weighting
    const isFinale = section.id === 'finale' || section.name.toLowerCase().trim() === 'finale';
    if (isFinale && season.isSeriesFinale && settings.enableSeriesFinale) {
      effectiveWeight *= settings.finaleWeightMultiplier || 2;
    }

    const finaleTypeLabel = season.isSeriesFinale ? 'Series Finale' : 'Season Finale';
    const finaleTitleHtml =
      isFinale && settings.enableSeriesFinale
        ? `<button type="button" class="astra-score-group-title astra-finale-title-toggle ${season.isSeriesFinale ? 'active' : ''}" id="astra-section-finale-btn" aria-pressed="${season.isSeriesFinale ? 'true' : 'false'}" aria-label="${finaleTypeLabel}. Toggle between season and series finale." title="Toggle between Season Finale and Series Finale (weight ×${settings.finaleWeightMultiplier || 2})">${finaleTypeLabel}</button>`
        : `<span class="astra-score-group-title">${escapeHtml(section.name)}</span>`;

    if (hasSubSections) {
      return `
        <div class="astra-score-group ${groupClass}" data-id="${escapeHtml(section.id)}">
          <div class="astra-score-group-header astra-accordion-toggle">
            <div class="astra-label-left">
              <i class="fa-solid fa-chevron-down astra-accordion-icon"></i>
              ${finaleTitleHtml} ${this.renderWeightTag(effectiveWeight)}
            </div>
            <div class="astra-group-score-tools">
              ${this.renderLodeButton(section.id, 'main')}
              <span class="astra-group-avg" id="avg-${escapeHtml(section.id)}">—</span>
            </div>
          </div>
          <div class="astra-sub-sections">
            ${section.subSections!.map((sub) => this.renderSubSectionInput(section.id, sub, seasonScores[`${section.id}_${sub.id}`])).join('')}
          </div>
        </div>
      `;
    }

    const value = seasonScores[section.id];

    return `
      <div class="astra-score-group ${groupClass}" data-id="${escapeHtml(section.id)}">
        <div class="astra-score-group-header">
          <div class="astra-label-left">
            ${finaleTitleHtml} ${this.renderWeightTag(effectiveWeight)}
          </div>
          <div class="astra-group-score-tools">
            ${this.renderLodeButton(section.id, 'main')}
            <span class="astra-group-avg" id="avg-${escapeHtml(section.id)}">—</span>
          </div>
        </div>
        <div class="astra-main-section" style="padding: 12px;">
          <input type="range" class="astra-slider" data-id="${escapeHtml(section.id)}" min="0" max="10" step="0.1" value="${value || 0}">
        </div>
      </div>
    `;
  }

  private renderWeightTag(weight: number): string {
    return `<small class="astra-weight-tag">w${weight.toFixed(weight % 1 === 0 ? 0 : 1)}</small>`;
  }

  private renderLodeButton(id: string, kind: 'main' | 'sub'): string {
    return `<button type="button" class="astra-lode-btn" data-lode-id="${escapeHtml(id)}" data-lode-kind="${kind}" aria-label="Award lode" aria-pressed="false" title="Award lode" disabled><i class="fa-regular fa-star" aria-hidden="true"></i></button>`;
  }

  private renderSubSectionInput(
    parentId: string,
    sub: AstraSubSection,
    value: number | null
  ): string {
    const fullId = `${parentId}_${sub.id}`;
    return `
      <div class="astra-score-input astra-score-input--sub " data-id="${escapeHtml(fullId)}">
        <div class="astra-score-label">
          <div class="astra-label-left">
            <span class="astra-sub-label">${escapeHtml(sub.name)} ${this.renderWeightTag(sub.weight)}</span>
          </div>
          <input type="number" class="astra-score-num-input"
            min="0" max="11" step="0.1"
            value="${value === null || value === undefined ? '0.0' : value.toFixed(1)}"
            style="color: ${AstraRadarChart.getScoreColor(value)}"
            >
          ${this.renderLodeButton(fullId, 'sub')}
        </div>
        <div class="astra-slider-row">
          <input type="range" class="astra-slider" min="0" max="10" step="0.1" value="${value || 0}" >
        </div>
      </div>
    `;
  }

  /**
   * Closes the rating modal view, auto-saves any unsaved modifications,
   * and cleans up global event listeners.
   *
   * @returns A promise that resolves when the close process completes.
   */
  public close(): Promise<void> {
    if (this.deletingEntry) return Promise.resolve();
    if (this.loadingOverlay && !this.overlay) {
      this.dispose();
      return Promise.resolve();
    }
    if (this.closeInFlight?.root === this.overlay) return this.closeInFlight.promise;
    this.pendingOpen = null;
    const version = ++this.openVersion;
    const root = this.overlay;
    const state = this.state;
    const scope = this.viewScope;
    if (!root || !state || this.isClosing) {
      if (!root) this.releaseAuthSubscription();
      return Promise.resolve();
    }
    const promise = this.closeView(root, state, scope, version);
    this.closeInFlight = { root, promise };
    const clear = () => {
      if (this.closeInFlight?.promise === promise) this.closeInFlight = null;
    };
    void promise.then(clear, clear);
    return promise;
  }

  private async closeView(
    root: HTMLElement,
    state: AstraRatingState,
    scope: AstraRatingViewScope | null,
    version: number
  ): Promise<void> {
    const current = () =>
      this.overlay === root &&
      this.state === state &&
      this.viewScope === scope &&
      this.openVersion === version &&
      (!scope || scope.active);
    try {
      if (this.saveInFlight && this.savingState === state) await this.saveInFlight;
      if (!current()) return;
      const progressInput = root.querySelector<HTMLInputElement>('#astra-progress');
      // An emptied count field is an unfinished edit, not a request to store 0.
      const progressEdited =
        !!progressInput &&
        progressInput.value.trim() !== '' &&
        Number(progressInput.value) !== this.initialProgress;
      if (state.isDirty || progressEdited) {
        // Closing never waits for AniList: the local commit and durable queue write are enough.
        state.isDirty = true;
        await this.save('background', (result) => this.onBackgroundDispatched(result));
        if (!current() || state.isDirty) return;
      }
    } catch (error) {
      if (current()) {
        logger.error('[AstraRatingModal] Auto-save on close failed', error);
        this.reportSaveFailure(error);
      }
      return;
    }
    if (!current()) return;
    scope?.release();
    this.viewScope = null;
    this.coverOverlay?.remove();
    this.coverOverlay = null;
    this.header.unmount();
    this.releaseGlobalHandlers();
    this.releaseAuthSubscription();
    this.isClosing = true;
    this.state = null;
    this.formDraft = null;
    this.openingSnapshot = null;
    root.classList.add('astra-modal-overlay--closing');
    root.classList.remove('astra-modal-overlay--open');
    const timer = setTimeout(() => {
      this.closingTimers.delete(root);
      root.remove();
      if (this.overlay !== root) return;
      this.overlay = null;
      this.isClosing = false;
      this.restoreHostState(root);
    }, 350);
    this.closingTimers.set(root, timer);
  }

  /** Remove view resources without accepting new writes; existing writes retain their original owner. */
  public dispose(): void {
    this.openVersion++;
    this.pendingOpen = null;
    const root = this.overlay ?? this.loadingOverlay;
    this.clearLoading();
    this.viewScope?.release();
    this.viewScope = null;
    this.releaseGlobalHandlers();
    this.releaseAuthSubscription();
    this.header.unmount();
    this.coverOverlay?.remove();
    this.coverOverlay = null;
    for (const [closingRoot, timer] of this.closingTimers) {
      clearTimeout(timer);
      closingRoot.remove();
    }
    this.closingTimers.clear();
    root?.remove();
    this.overlay = null;
    this.state = null;
    this.formDraft = null;
    this.openingSnapshot = null;
    this.media = null;
    this.remoteOverall = null;
    this.initialSeasonNotes = [];
    this.initialReportSnapshot = '';
    this.initialScoresSnapshot = '';
    this.isClosing = false;
    this.closeInFlight = null;
    this.deletingEntry = false;
    this.restoreHostState(root);
  }

  private reloadHost(): void {
    window.location.reload();
  }

  private restoreHostState(root: HTMLElement | null): void {
    this.overlayService.releaseScrollLock('rating-modal');
    if (
      this.opener?.isConnected &&
      (document.activeElement === document.body || (root && root.contains(document.activeElement)))
    ) {
      this.opener.focus({ preventScroll: true });
    }
    this.opener = null;
  }

  private ensureAuthSubscription(): void {
    this.authSubscription ??=
      this.eventBus.on?.(EVENT_TYPES.AUTH_STATE_CHANGED, () => this.dispose()) ?? null;
    this.navigationSubscription ??=
      this.eventBus.on?.(EVENT_TYPES.PAGE_CHANGED, () => this.handleNavigation()) ?? null;
  }
  /** Navigation keeps the account, so an open form closes through the auto-saving path; a changed account discards it. */
  private handleNavigation(): void {
    if (!this.overlay) {
      this.dispose();
      return;
    }
    try {
      assertApiContext(this.api, this.viewContext);
    } catch {
      this.dispose();
      return;
    }
    void this.close().catch((error: unknown) =>
      logger.error('[AstraRatingModal] Auto-save on navigation failed', error)
    );
  }
  private releaseAuthSubscription(): void {
    this.authSubscription?.unsubscribe();
    this.authSubscription = null;
    this.navigationSubscription?.unsubscribe();
    this.navigationSubscription = null;
  }

  private matchesView(
    scope: AstraRatingViewScope,
    state: AstraRatingState,
    context: ApiContext | undefined
  ): boolean {
    if (
      this.viewScope !== scope ||
      this.state !== state ||
      this.overlay !== scope.root ||
      this.isClosing
    )
      return false;
    try {
      assertApiContext(this.api, context, state.data.ownerId);
      return true;
    } catch {
      this.dispose();
      return false;
    }
  }

  private listen<K extends keyof HTMLElementEventMap>(
    target: EventTarget | null | undefined,
    type: K,
    callback: (event: HTMLElementEventMap[K]) => unknown
  ): void {
    this.viewScope?.listen(target, type, (event) => {
      if (!this.deletingEntry) return callback(event);
      return undefined;
    });
  }

  private frame(callback: FrameRequestCallback): number {
    if (this.viewScope) return this.viewScope.frame(callback);
    const root = this.overlay;
    const state = this.state;
    return requestAnimationFrame((time) => {
      if (root === this.overlay && state === this.state && !this.isClosing) callback(time);
    });
  }

  private async handleDocumentEscape(e: KeyboardEvent): Promise<void> {
    if (e.key === 'Escape') {
      if (this.coverOverlay?.isConnected) {
        this.coverOverlay.remove();
        this.coverOverlay = null;
        return;
      }
      await this.close();
    }
  }

  private releaseGlobalHandlers(): void {
    this.journalScope?.release();
    this.journalScope = null;
    window.removeEventListener('resize', this.resizeHandler);
    if (this.livePreviewRaf !== null) {
      cancelAnimationFrame(this.livePreviewRaf);
      this.livePreviewRaf = null;
    }
    if (this.documentEscHandler) {
      document.removeEventListener('keydown', this.documentEscHandler);
      this.documentEscHandler = null;
    }
    if (this.documentClickHandler) {
      document.removeEventListener('click', this.documentClickHandler);
      this.documentClickHandler = null;
    }
  }

  private findScoreElement(selector: string, id: string): HTMLElement | null {
    return (
      [...(this.overlay?.querySelectorAll<HTMLElement>(selector) ?? [])].find(
        (element) => element.dataset.id === id
      ) ?? null
    );
  }

  /**
   * Get all focusable elements in the modal
   */
  private getFocusableElements(): HTMLElement[] {
    if (!this.overlay) return [];

    const selectors =
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const workspace = this.overlay.querySelector('.astra-rating-workspace');
    if (!workspace) return [];

    return Array.from(workspace.querySelectorAll<HTMLElement>(selectors)).filter((element) => {
      if (
        element.matches('input[type="hidden"]') ||
        element.closest(
          '[hidden], [aria-hidden="true"], .astra-tab-content:not(.astra-tab-content--active)'
        )
      )
        return false;
      const menu = element.closest('.astra-dropdown-menu, .astra-ep-date-menu');
      if (menu && !menu.closest('.astra-dropdown.active, .astra-ep-date-picker.active'))
        return false;
      for (
        let current: HTMLElement | null = element;
        current && current !== this.overlay;
        current = current.parentElement
      ) {
        const style = getComputedStyle(current);
        if (
          style.display === 'none' ||
          style.visibility === 'hidden' ||
          style.visibility === 'collapse'
        )
          return false;
      }
      return true;
    });
  }

  /**
   * Setup focus trap to keep focus within modal
   */
  private setupFocusTrap(): void {
    if (!this.overlay) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      const focusableElements = this.getFocusableElements();
      if (focusableElements.length === 0) return;

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      // Shift + Tab: wrap to last element
      if (e.shiftKey && document.activeElement === firstElement) {
        e.preventDefault();
        lastElement.focus();
      }
      // Tab: wrap to first element
      else if (!e.shiftKey && document.activeElement === lastElement) {
        e.preventDefault();
        firstElement.focus();
      }
    };

    this.listen(this.overlay, 'keydown', handleKeyDown);
  }

  /**
   * A plain click on a same-tab title link navigates through AniList's router;
   * the resulting PAGE_CHANGED closes this form through its auto-saving path.
   */
  private followTitleInPlace(event: MouseEvent): void {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
      return;
    const link =
      event.target instanceof Element
        ? event.target.closest<HTMLAnchorElement>('a.astra-title-link:not([target])')
        : null;
    const path = link?.getAttribute('href');
    if (!path) return;
    event.preventDefault();
    try {
      navigateInApp(path);
    } catch (error) {
      logger.warn('[AstraRatingModal] In-app title navigation failed', error);
      window.location.assign(path);
    }
  }

  private attachEvents(): void {
    if (!this.overlay) return;

    // Dashboard link
    const dashboardLink = this.overlay.querySelector('#astra-dashboard-link');
    this.listen(dashboardLink, 'click', async () => {
      const root = this.overlay;
      const focusMediaId = this.media?.id;
      const context = this.viewContext;
      await this.close();
      if (this.overlay !== root || !this.isClosing) return;
      assertApiContext(this.api, context);
      await this.dashboard.open(focusMediaId ? { mediaId: focusMediaId } : undefined);
    });

    const navItems = this.overlay!.querySelectorAll('.astra-nav-item');
    const sliders = this.overlay!.querySelectorAll('.astra-slider');
    const progressInput = this.overlay!.querySelector('#astra-progress') as HTMLInputElement;
    const repeatInput = this.overlay!.querySelector('#astra-repeat') as HTMLInputElement;
    const accordions = this.overlay!.querySelectorAll('.astra-accordion-toggle');

    this.listen(this.overlay, 'click', (event) => {
      if (event.target instanceof Element && event.target.closest('#astra-delete-entry'))
        return this.handleDeleteEntry();
      if (event.target instanceof Element && event.target.closest('#astra-revert-entry'))
        return this.handleRevert();
      if (event instanceof MouseEvent) this.followTitleInPlace(event);
      return undefined;
    });

    accordions.forEach((acc) => {
      this.listen(acc, 'click', () => {
        const group = acc.closest('.astra-score-group');
        group?.classList.toggle('astra-score-group--collapsed');
      });
    });

    this.overlay!.querySelectorAll<HTMLButtonElement>('.astra-lode-btn').forEach((button) => {
      this.listen(button, 'click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.toggleLode(button);
      });
    });

    // A text-selection drag that starts inside the form and ends on the backdrop must not dismiss it.
    let backdropPressed = false;
    this.listen(this.overlay, 'mousedown', (e) => {
      backdropPressed = e.target === this.overlay;
    });
    this.listen(this.overlay, 'click', async (e) => {
      const pressedOnBackdrop = backdropPressed;
      backdropPressed = false;
      if (pressedOnBackdrop && e.target === this.overlay) await this.close();
    });

    // ESC key to close modal (accessibility)
    this.documentEscHandler = (e: KeyboardEvent) => {
      void this.handleDocumentEscape(e).catch((error: unknown) =>
        logger.error('[AstraRatingModal] Escape key handling failed', error)
      );
    };
    this.listen(document, 'keydown', this.documentEscHandler);

    // Global document click to close active dropdowns
    this.documentClickHandler = () => {
      if (this.overlay) {
        this.overlay
          .querySelectorAll('.astra-dropdown.active, .astra-ep-date-picker.active')
          .forEach((d) => {
            d.classList.remove('active');
          });
      }
    };
    this.listen(document, 'click', this.documentClickHandler);

    // Setup focus trap
    this.setupFocusTrap();

    // Auto-focus first focusable element
    this.frame(() => {
      const focusableElements = this.getFocusableElements();
      if (focusableElements.length > 0) {
        focusableElements[0].focus();
      }
    });

    // Tabs
    navItems.forEach((item) => {
      this.listen(item, 'click', async () => {
        const scope = this.viewScope;
        const tab = (item as HTMLElement).dataset.tab;
        if (!tab || tab === this.activeTab) return;

        // Auto-save before switching tab; an unlisted title stays as an unsaved draft until a status is chosen.
        if (!this.needsListStatus) {
          await this.save();
          if (scope && !scope.active) return;
        }

        this.activeTab = tab;
        this.overlay!.querySelector('.astra-rating-workspace')?.classList.toggle(
          'astra-rating-workspace--journal',
          tab === 'journal'
        );
        const customListPanel = this.overlay!.querySelector<HTMLElement>(
          '#astra-custom-list-panel'
        );
        customListPanel?.setAttribute('aria-hidden', String(tab === 'journal'));
        customListPanel?.toggleAttribute('hidden', tab === 'journal');
        this.overlay!.querySelectorAll('.astra-nav-item').forEach((i) =>
          i.classList.remove('active')
        );
        item.classList.add('active');
        this.overlay!.querySelectorAll('.astra-tab-content').forEach((c) =>
          c.classList.remove('astra-tab-content--active')
        );
        this.overlay!.querySelector(`#astra-tab-${tab}`)?.classList.add(
          'astra-tab-content--active'
        );
        // Re-render header to update Override/Finale visibility
        this.renderHeader();
      });
    });

    this.bindOverallScore();

    // Catch-all: any input/change inside the modal marks the state dirty so the
    // on-close save() never early-returns and silently drops changes. Several
    // controls (custom-list checkboxes, private/hide, general notes, journal
    // textareas, progress & rewatches) are only read at save time, so without
    // this their changes wouldn't flip isDirty and wouldn't persist.
    const markDirty = (event: Event) => {
      if (event.target instanceof HTMLElement && event.target.matches('[data-astra-journal-jump]'))
        return;
      this.formEditVersion++;
      if (this.state) this.state.isDirty = true;
      this.noteEdit();
      if (event.target === progressInput && progressInput.value.trim() !== '')
        this.completeProgress(Number(progressInput.value));
    };
    this.listen(this.overlay, 'input', markDirty);
    this.listen(this.overlay, 'change', markDirty);

    // Status custom dropdown (single-select, mirrors the Custom Lists styling/animation)
    const statusDropdown = this.overlay!.querySelector('#astra-status-dropdown');
    const statusTrigger = statusDropdown?.querySelector('.astra-dropdown-trigger');
    this.listen(statusTrigger, 'click', (e) => {
      e.stopPropagation();
      const wasActive = statusDropdown?.classList.contains('active');
      if (this.overlay) {
        this.overlay
          .querySelectorAll('.astra-dropdown.active')
          .forEach((d) => d.classList.remove('active'));
      }
      if (!wasActive) {
        statusDropdown?.classList.add('active');
      }
    });
    this.listen(statusDropdown?.querySelector('.astra-dropdown-menu'), 'click', (e) =>
      e.stopPropagation()
    );
    statusDropdown?.querySelectorAll('.astra-status-option').forEach((opt) => {
      this.listen(opt, 'click', () => {
        const value = (opt as HTMLElement).dataset.value as MediaListStatus;
        this.setStatus(value);
        this.noteEdit();
        statusDropdown.classList.remove('active');
        const hadNoStatus = this.needsListStatus;
        this.needsListStatus = false;
        this.state?.updateField('status', value);
        if (hadNoStatus && this.state) this.state.isDirty = true;
      });
    });

    // Custom date pickers
    this.overlay!.querySelectorAll('.astra-datepicker').forEach((dp) =>
      this.bindDatePicker(dp as HTMLElement)
    );
    this.bindEpisodeDatePickers();

    // Sliders & Number Inputs
    const scoreInputs = this.overlay!.querySelectorAll('.astra-score-num-input');

    sliders.forEach((slider) => {
      const el = slider as HTMLInputElement;
      this.listen(el, 'input', (e) => {
        const target = e.target as HTMLInputElement;
        const val = parseFloat(target.value);
        const id = target.dataset.id || target.closest('[data-id]')?.getAttribute('data-id');

        if (id && this.state) {
          this.setRatingScore(id, val);

          // Sync number input if it exists (for subsections)
          const parent = target.closest('.astra-score-input');
          const numInput = parent?.querySelector('.astra-score-num-input') as HTMLInputElement;
          if (numInput) numInput.value = val.toFixed(1);

          this.updateLivePreview();
        }
        this.updateSliderTrack(target);
      });
      this.updateSliderTrack(el);
    });

    scoreInputs.forEach((input) => {
      const el = input as HTMLInputElement;
      this.listen(el, 'input', (e) => {
        const target = e.target as HTMLInputElement;
        let val = parseFloat(target.value);
        if (isNaN(val)) val = 0;
        val = Math.max(0, Math.min(10, val));

        const parent = target.closest('.astra-score-input');
        const id = parent?.getAttribute('data-id');
        if (id && this.state) {
          this.setRatingScore(id, val);

          // Sync slider
          const slider = parent?.querySelector('.astra-slider') as HTMLInputElement;
          if (slider) {
            slider.value = val.toString();
            this.updateSliderTrack(slider);
          }

          this.updateLivePreview();
        }
      });

      this.listen(el, 'blur', (e) => {
        const target = e.target as HTMLInputElement;
        const val = parseFloat(target.value) || 0;
        const id = target.closest('.astra-score-input')?.getAttribute('data-id');
        const stored = id ? this.state?.data.seasons[this.currentSeasonIdx]?.scores[id] : null;
        target.value = Math.max(0, Math.min(stored === 11 ? 11 : 10, val)).toFixed(1);
      });
    });

    // Finale type toggle is part of the section title.
    const finaleBtn = this.overlay!.querySelector('#astra-section-finale-btn');
    this.listen(finaleBtn, 'click', (e) => {
      if (!finaleBtn) return;
      e.stopPropagation(); // don't trigger accordion collapse if finale has sub-sections
      if (!this.state) return;
      const season = this.state.data.seasons[this.currentSeasonIdx];
      const newState = !season.isSeriesFinale;
      this.state.updateSeasonField(this.currentSeasonIdx, 'isSeriesFinale', newState);
      finaleBtn.classList.toggle('active', newState);
      finaleBtn.textContent = newState ? 'Series Finale' : 'Season Finale';
      finaleBtn.setAttribute('aria-pressed', String(newState));
      finaleBtn.setAttribute(
        'aria-label',
        `${newState ? 'Series Finale' : 'Season Finale'}. Toggle between season and series finale.`
      );

      // Reflect the new effective weight on the Finale section's weight tag.
      const settings = this.astraService.getSettings();
      const finaleSection = this.astraService
        .getSections()
        .find((s) => s.id === 'finale' || s.name.toLowerCase().trim() === 'finale');
      if (finaleSection) {
        const eff = newState
          ? finaleSection.weight * (settings.finaleWeightMultiplier || 2)
          : finaleSection.weight;
        const tag = this.findScoreElement(
          '.astra-score-group',
          finaleSection.id
        )?.querySelector<HTMLElement>('.astra-weight-tag');
        if (tag) tag.textContent = `w${eff % 1 === 0 ? eff.toFixed(0) : eff.toFixed(1)}`;
      }

      this.updateLivePreview();
    });

    // Stepper
    this.overlay!.querySelectorAll('.astra-step-btn').forEach((btn) => {
      this.listen(btn, 'click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!this.state) return;
        const field = (btn as HTMLElement).dataset.stepField;
        const step = parseInt((btn as HTMLElement).dataset.step || '0');
        if (field === 'progress')
          this.captureEpisodeInputs(this.state.data.seasons[this.currentSeasonIdx]);
        const input = field === 'progress' ? progressInput : repeatInput;
        const lastValid =
          this.formDraft?.values[field === 'progress' ? 'progress' : 'repeat'] ??
          (field === 'progress' ? this.initialProgress : 0);
        const newVal = steppedCount(input.value, lastValid, step);
        input.value = newVal.toString();
        this.noteEdit();

        // This will be caught by the general change listener if we had one,
        // but for now we manually update the state since these inputs don't have change listeners attached here yet
        if (field === 'progress') {
          this.state.updateField('progress', newVal);
          this.completeProgress(newVal);
          if (step > 0) {
            const currentSeason = this.state.data.seasons[this.currentSeasonIdx];
            if (!currentSeason.episodeNotes) currentSeason.episodeNotes = {};
            const existing = currentSeason.episodeNotes[newVal] || { text: '' };
            currentSeason.episodeNotes[newVal] = { ...existing, timestamp: Date.now() };
          }
          this.renderEpisodeJournal(false);
        } else {
          this.formEditVersion++;
          this.state.isDirty = true;
        }
      });
    });
  }

  private async handleDeleteEntry(): Promise<void> {
    if (!this.overlay || !this.state || !this.media || this.deletingEntry) return;
    if (
      !window.confirm(
        'Delete this entry from your AniList list and remove its Astra ratings and journal?'
      )
    )
      return;
    const root = this.overlay;
    const state = this.state;
    const scope = this.viewScope;
    const context = this.viewContext;
    const mediaId = this.media.id;
    const current = () => this.overlay === root && this.state === state && (!scope || scope.active);
    this.deletingEntry = true;
    root.inert = true;
    try {
      // Wait for an accepted save; the durable delete then supersedes its
      // queued retry and cannot be followed by an auto-save from this view.
      await this.saveInFlight?.catch(() => undefined);
      if (!current()) return;
      assertApiContext(this.api, context, state.data.ownerId);
      const result = await this.ratingService.deleteEntry(mediaId);
      if (!current()) return;
      assertApiContext(this.api, context, state.data.ownerId);
      this.dispose();
      if (result === 'queued')
        this.toast.info('Deletion queued. It will finish when AniList is available.');
      else {
        this.eventBus.emit(EVENT_TYPES.ASTRA_DATA_UPDATED, { mediaId, timestamp: new Date() });
        this.reloadHost();
      }
    } catch (error) {
      if (current()) {
        logger.error('[AstraRatingModal] Entry deletion failed', error);
        this.toast.error('Unable to delete this entry. Your edits remain open; retry.');
      }
    } finally {
      if (this.overlay === root) {
        root.inert = false;
        this.deletingEntry = false;
      }
    }
  }

  private reportSaveFailure(error: unknown): void {
    // Save and close can be awaiting the same rejected operation.
    if (error instanceof Error) {
      if (this.reportedSaveFailures.has(error)) return;
      this.reportedSaveFailures.add(error);
    }
    this.toast.error(astraSaveFailureMessage(error));
  }

  /**
   * The Astra overall, or the AniList score as a labelled stand-in for the latest season while
   * no section is rated. The stand-in is display-only and is never sent to AniList.
   */
  private overallDisplay(seasonIndex: number): {
    value: number | null;
    fallback: boolean;
    manual: boolean;
  } {
    const season = this.state?.data.seasons[seasonIndex];
    const computed = season ? this.astraService.calcSeasonScore(season) : null;
    // calcSeasonScore already prefers a valid manual score, so the value is the manual one here.
    if (isManualScore(season?.manualScore))
      return { value: computed, fallback: false, manual: true };
    const isLatest = seasonIndex === (this.state?.data.seasons.length ?? 0) - 1;
    const remote = this.remoteOverall;
    if (!computed && isLatest && remote !== null && remote > 0)
      return { value: remote, fallback: true, manual: false };
    return { value: computed, fallback: false, manual: false };
  }

  /**
   * The overall box with its caption, manual marker and reset. With no section configured the
   * box is the only way to set a score, so it is shown with a hint.
   */
  private renderOverallArea(seasonIndex: number): string {
    const { fallback, manual } = this.overallDisplay(seasonIndex);
    const solo = this.scoringLayout() === 'solo';
    const hint = !solo
      ? ''
      : this.astraService.getSections().length === 0
        ? '<p class="astra-overall-hint">No sections configured: set the score manually.</p>'
        : '<p class="astra-overall-hint">Your score</p>';
    return `
      <div class="astra-overall-area${solo ? ' astra-overall-area--solo' : ''}">
        ${hint}
        <div class="astra-overall-box" role="button" tabindex="0" aria-label="Overall score, click to set it manually">
          ${this.overallValueHtml(seasonIndex)}
        </div>
        <div class="astra-overall-meta">
          <span class="astra-overall-caption" ${fallback ? '' : 'hidden'}>AniList</span>
          <span class="astra-overall-caption astra-overall-caption--manual" ${manual ? '' : 'hidden'}>Manual</span>
          <button type="button" class="astra-overall-reset" aria-label="Use the weighted average" title="Use the weighted average" ${manual ? '' : 'hidden'}>↺</button>
        </div>
      </div>`;
  }

  /** Overall box events, delegated on the overlay: click or Enter/Space edits, Enter or blur commits, Escape cancels. */
  private bindOverallScore(): void {
    this.listen(this.overlay, 'click', (event) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const choice = target?.closest<HTMLElement>('[data-scoring-choice]')?.dataset.scoringChoice;
      if (choice === 'detailed' || choice === 'simple') {
        this.chooseScoringMode(choice);
        return;
      }
      if (target?.closest('.astra-overall-reset')) {
        this.applyManualScore(null);
        this.refreshOverallArea();
        return;
      }
      if (target?.closest('.astra-overall-box') && !target.closest('.astra-overall-input'))
        this.beginManualEdit();
    });
    this.listen(this.overlay, 'keydown', (event) => this.onOverallKeydown(event));
    this.listen(this.overlay, 'focusout', (event) => {
      const target = event.target instanceof HTMLInputElement ? event.target : null;
      if (target?.classList.contains('astra-overall-input')) this.commitManualEdit(target, false);
    });
  }

  private onOverallKeydown(event: KeyboardEvent): void {
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target instanceof HTMLInputElement && target.classList.contains('astra-overall-input')) {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.commitManualEdit(target, true);
      } else if (event.key === 'Escape') {
        // Stop here so Escape cancels the edit instead of closing the modal.
        event.preventDefault();
        event.stopPropagation();
        this.endManualEdit(true);
      }
      return;
    }
    if (
      target?.classList.contains('astra-overall-box') &&
      (event.key === 'Enter' || event.key === ' ')
    ) {
      event.preventDefault();
      this.beginManualEdit();
    }
  }

  /** Swaps the overall value for a number input prefilled with the value on screen. */
  private beginManualEdit(): void {
    if (!this.state || !this.overlay || this.overallEditing) return;
    const box = this.overlay.querySelector<HTMLElement>('.astra-overall-box');
    if (!box) return;
    const { value } = this.overallDisplay(this.currentSeasonIdx);
    this.overallEditing = true;
    box.innerHTML =
      '<input type="number" class="astra-overall-input" min="0.1" max="11" step="0.1" inputmode="decimal" aria-label="Manual overall score">';
    const input = box.querySelector<HTMLInputElement>('.astra-overall-input');
    if (!input) return;
    input.value = value === null ? '' : value.toFixed(1);
    input.focus();
    input.select();
  }

  /** Enter or blur commits. A valid value is stored; an invalid one keeps the previous value. */
  private commitManualEdit(input: HTMLInputElement, fromKeyboard: boolean): void {
    if (!this.overallEditing) return;
    const result = parseManualScoreInput(input.value, input.validity.badInput);
    if (!result.valid) {
      if (fromKeyboard) {
        input.classList.add('astra-overall-input--invalid');
        input.setAttribute('aria-invalid', 'true');
        return;
      }
      this.endManualEdit(false);
      return;
    }
    this.applyManualScore(result.value);
    this.endManualEdit(fromKeyboard);
  }

  private endManualEdit(focusBox: boolean): void {
    this.overallEditing = false;
    this.refreshOverallArea(focusBox);
  }

  /** Stores the manual score (null clears it) and marks the work dirty when it changes. */
  private applyManualScore(value: number | null): void {
    if (!this.state) return;
    const season = this.state.data.seasons[this.currentSeasonIdx];
    if (!season || (season.manualScore ?? null) === value) return;
    this.state.updateSeasonField(this.currentSeasonIdx, 'manualScore', value);
  }

  /** Re-renders the overall area in place; an open edit is left alone. */
  private refreshOverallArea(focusBox = false): void {
    if (!this.overlay || this.overallEditing) return;
    const area = this.overlay.querySelector<HTMLElement>('.astra-overall-area');
    if (!area) return;
    const keepFocus = focusBox || area.contains(document.activeElement);
    area.outerHTML = this.renderOverallArea(this.currentSeasonIdx);
    if (keepFocus) this.overlay.querySelector<HTMLElement>('.astra-overall-box')?.focus();
  }

  private overallValueHtml(seasonIndex: number): string {
    const { value, fallback } = this.overallDisplay(seasonIndex);
    const text = value === null ? '—' : value.toFixed(1);
    const color = AstraRadarChart.getScoreColor(value);
    const attributes = fallback
      ? `class="astra-overall-val astra-overall-val--anilist" title="${ANILIST_FALLBACK_TITLE}"`
      : 'class="astra-overall-val"';
    return `<span ${attributes} style="color: ${color}">${text}</span>`;
  }

  /** A background save reports once AniList settles; a queued write is still pending, so say so. */
  private onBackgroundDispatched(result: AstraDispatchOutcome): void {
    if (result === 'queued') this.toast.info(SYNC_QUEUED_NOTICE);
  }

  /** Joins an in-flight save of the same state; a joined save keeps the dispatch mode it started with. */
  private save(
    dispatch: AstraDispatchMode = 'await',
    onDispatched?: (result: AstraDispatchOutcome) => void
  ): Promise<void> {
    if (this.saveInFlight && this.savingState === this.state) return this.saveInFlight;
    const state = this.state;
    const saving = this.persistChanges(dispatch, onDispatched);
    this.saveInFlight = saving;
    this.savingState = state;
    const clear = () => {
      if (this.saveInFlight === saving) {
        this.saveInFlight = null;
        this.savingState = null;
      }
    };
    void saving.then(clear, clear);
    return saving;
  }

  private async persistChanges(
    dispatch: AstraDispatchMode,
    onDispatched?: (result: AstraDispatchOutcome) => void
  ): Promise<void> {
    if (!this.state || !this.overlay) return;

    const scope = this.viewScope;
    const context = this.viewContext;
    if (scope && !scope.active) return;
    assertApiContext(this.api, context, this.state.data.ownerId);

    // Safety check for invalidated context
    if (!chrome.runtime?.id) {
      logger.warn('[AstraRatingModal] Extension context invalidated. Save aborted.');
      throw new Error('Extension context invalidated. Reload the extension before saving.');
    }

    // Only save if there are actual changes
    if (!this.state.isDirty) {
      logger.debug('[AstraRatingModal] Skipping save: no changes detected (isDirty=false)');
      return;
    }

    // A title outside the AniList list is saved in Astra only: no remote write may be queued for it.
    const localOnly = this.needsListStatus;

    try {
      const seasonIndex = this.currentSeasonIdx;
      const originalWork = this.state.data;
      const originalSeason = originalWork.seasons[seasonIndex];
      const reportBaseline = this.initialReportSnapshot || this.reportContentSnapshot(originalWork);
      const scoresBaseline = this.initialScoresSnapshot;
      const notesInput = this.overlay.querySelector<HTMLTextAreaElement>('#astra-general-notes');
      const notesValue = notesInput?.value ?? originalSeason?.notes ?? originalWork.notes ?? '';
      const notesBaseline =
        this.initialSeasonNotes[seasonIndex] ?? originalSeason?.notes ?? originalWork.notes ?? '';
      const notesToSync = notesValue === notesBaseline ? undefined : notesValue;
      const values = this.captureFormInputs();
      const currentWork = this.state.data;
      const syncAstraNotes = this.reportContentSnapshot(currentWork) !== reportBaseline;
      // Unchanged scores must not push a score derived from a local cache back to AniList.
      const syncScore = this.scoresSnapshot(currentWork) !== scoresBaseline;
      const currentSeason = currentWork.seasons[this.currentSeasonIdx];
      const savedStatus = currentWork.status;
      const previousProgress = this.initialProgress;
      const progressVal = values.progress;
      const { repeat, private: privateEntry, hidden, startedAt, completedAt, customLists } = values;
      const overall = this.astraService.calcSeasonScore(currentSeason) || 0;
      const progress = progressVal;
      const state = this.state;
      // Persist dates in the same local commit as the progress edit, even if
      // synchronization fails or the form closes before its event is delivered.
      stampAstraProgress(currentWork, previousProgress, progress);
      const snapshot = JSON.stringify(currentWork);
      const editVersion = this.formEditVersion;
      const draft = structuredClone(currentWork);
      let result;
      let unchanged = false;
      try {
        const saveOptions: AstraSaveOptions = {
          overallScore: overall,
          progress,
          repeat,
          private: privateEntry,
          hidden,
          startedAt,
          completedAt,
          customLists,
          syncAstraNotes,
          syncScore,
          replaceNotes: notesToSync !== undefined,
          ...(notesToSync === undefined ? {} : { notes: notesToSync }),
        };
        result = await this.ratingService.saveAndSync(
          draft,
          localOnly
            ? { ...saveOptions, skipSync: true }
            : { ...saveOptions, dispatch, ...(onDispatched ? { onDispatched } : {}) }
        );
      } finally {
        unchanged =
          JSON.stringify(currentWork) === snapshot && this.formEditVersion === editVersion;
        // A local commit may have succeeded even when remote synchronization
        // fails. Advance only concurrency metadata, preserving edits made while
        // the save was pending and keeping them dirty for the next save.
        if (this.state === state) {
          let belongs = true;
          try {
            assertApiContext(this.api, context, draft.ownerId);
          } catch {
            belongs = false;
          }
          if (belongs) {
            currentWork.updatedAt = draft.updatedAt;
            currentWork.ownerId = draft.ownerId;
          }
        }
      }
      if (this.state !== state || (scope && !scope.active)) return;
      this.savedSinceOpen = true;
      if (notesToSync !== undefined) this.initialSeasonNotes[seasonIndex] = notesToSync;
      this.initialReportSnapshot = this.reportContentSnapshot(draft);
      this.initialScoresSnapshot = this.scoresSnapshot(draft);
      if (unchanged) state.resetDirty();
      // A background save announces its queued state later, once the drain settles.
      if (result === 'queued' && dispatch === 'await') this.toast.info(SYNC_QUEUED_NOTICE);
      if (localOnly) this.toast.info(LOCAL_ONLY_NOTICE);

      // Recheck the view after the optional asynchronous owner lookup.
      const userId = draft.ownerId ?? (await this.api.getCurrentUserId().catch(() => 0));
      if (this.state !== state || (scope && !scope.active)) return;
      this.eventBus.emit(EVENT_TYPES.ASTRA_DATA_UPDATED, {
        mediaId: currentWork.mediaId,
        timestamp: new Date(),
      });

      logger.info('[AstraRatingModal] Emitting PROGRESS_UPDATED', {
        mediaId: currentWork.mediaId,
        progress,
        previousProgress,
        userId,
        status: savedStatus,
      });

      this.eventBus.emit(EVENT_TYPES.PROGRESS_UPDATED, {
        mediaId: currentWork.mediaId,
        progress,
        previousProgress,
        userId,
        status: savedStatus,
      });
      this.initialProgress = progress;
    } catch (err) {
      logger.error('[AstraRatingModal] Failed to sync with AniList', err);
      throw err;
    }
  }

  private updateSliderTrack(slider: HTMLInputElement): void {
    const val = parseFloat(slider.value);
    const min = parseFloat(slider.min || '0');
    const max = parseFloat(slider.max || '10');
    const percent = ((val - min) / (max - min)) * 100;
    slider.style.background = `linear-gradient(to right, var(--astra-accent) 0%, var(--astra-accent) ${percent}%, var(--astra-bg-elev-2) ${percent}%, var(--astra-bg-elev-2) 100%)`;
  }

  private reportContentSnapshot(work: AstraWork): string {
    const season = work.seasons[work.seasons.length - 1];
    return JSON.stringify(
      season
        ? {
            scores: season.scores,
            manualScore: season.manualScore ?? null,
            notes: season.notes ?? '',
            episodeNotes: season.episodeNotes ?? {},
          }
        : null
    );
  }

  /** Scores and the manual overall of the latest season: either one changing makes the score sync. */
  private scoresSnapshot(work: AstraWork): string {
    const season = work.seasons[work.seasons.length - 1];
    return JSON.stringify({
      scores: season?.scores ?? {},
      manualScore: season?.manualScore ?? null,
    });
  }

  private captureFormInputs(): AstraRatingFormValues {
    if (!this.state || !this.overlay) throw new Error('No Astra form open');
    const currentWork = this.state.data;
    const currentSeason = currentWork.seasons[this.currentSeasonIdx];
    if (!currentSeason) throw new Error('No season selected for saving');
    this.formDraft ??= new AstraRatingFormDraft(this.media?.mediaListEntry ?? null, currentWork);
    const values = this.formDraft.read(this.overlay);
    const statusSelect = this.overlay.querySelector<HTMLInputElement>('#astra-status');
    const generalNotes = this.overlay.querySelector<HTMLTextAreaElement>('#astra-general-notes');
    // Update work status and general info
    if (statusSelect?.value)
      this.state.updateField('status', statusSelect.value as MediaListStatus);
    if (generalNotes)
      this.state.updateSeasonField(this.currentSeasonIdx, 'notes', generalNotes.value);

    this.captureEpisodeInputs(currentSeason);
    this.state.updateField('progress', values.progress);
    this.completeProgress(values.progress);
    this.state.updateField('isPrivate', values.private);
    this.state.updateField('isHidden', values.hidden);
    this.state.updateField('customLists', values.customLists);
    return values;
  }

  private completeProgress(progress: number): void {
    if (!this.state || this.needsListStatus) return;
    const work = this.state.data;
    const total =
      work.type === 'anime'
        ? this.media
          ? this.media.episodes
          : work.episodes
        : this.media
          ? this.media.chapters
          : work.chapters;
    const status = statusAfterProgress(work.status, progress, total);
    if (status !== work.status) this.setStatus(status);
  }

  private setStatus(status: MediaListStatus): void {
    if (!this.overlay || !this.state) return;
    const hidden = this.overlay.querySelector<HTMLInputElement>('#astra-status');
    const label = this.overlay.querySelector('#astra-status-label');
    const icon = this.overlay.querySelector('#astra-status-icon');
    if (hidden) hidden.value = status;
    if (label) label.textContent = getStatusLabel(status, this.state.data.type);
    if (icon) {
      // AniList may replace the original <i> with an SVG; replace either node.
      const nextIcon = document.createElement('i');
      nextIcon.id = 'astra-status-icon';
      nextIcon.className = `fa-solid ${this.statusIcon(status)}`;
      nextIcon.setAttribute('aria-hidden', 'true');
      icon.replaceWith(nextIcon);
    }
    this.overlay
      .querySelectorAll<HTMLElement>('.astra-status-option')
      .forEach((option) => option.classList.toggle('active', option.dataset.value === status));
    this.state.updateField('status', status);
  }

  private captureEpisodeInputs(currentSeason: AstraSeason): void {
    if (!this.overlay) return;
    // Update episode notes
    const epTextareas = this.overlay.querySelectorAll('.astra-ep-textarea');
    if (epTextareas.length > 0) {
      if (!currentSeason.episodeNotes) currentSeason.episodeNotes = {};
      epTextareas.forEach((ta) => {
        const epNum = parseInt((ta as HTMLElement).dataset.ep || '0');
        const text = (ta as HTMLTextAreaElement).value;
        if (text) {
          currentSeason.episodeNotes![epNum] = { ...currentSeason.episodeNotes![epNum], text };
        } else if (currentSeason.episodeNotes![epNum]) {
          // If text is cleared, we might want to keep the score but clear the text
          currentSeason.episodeNotes![epNum].text = '';
        }
      });
    }

    // Only dates the user committed or cleared are written back. Untouched pickers keep auto-stamped history,
    // and committed dates apply to any episode, including aired episodes beyond the watched progress.
    const epDates = this.overlay.querySelectorAll<HTMLElement>(
      '.astra-ep-date-picker[data-edited="1"]'
    );
    epDates.forEach((picker) => {
      delete picker.dataset.edited;
      const epNum = parseInt(picker.dataset.ep || '0');
      if (!epNum) return;
      const timestamp = Number(picker.dataset.timestamp || 0);
      const existing = currentSeason.episodeNotes?.[epNum];
      if (!existing && !timestamp) return;
      if (!currentSeason.episodeNotes) currentSeason.episodeNotes = {};
      currentSeason.episodeNotes[epNum] = {
        ...(existing || { text: '' }),
        ...(timestamp ? { timestamp } : { timestamp: undefined }),
      };
    });
  }

  /** Section values shown on the radar: sub-sectioned sections use their computed average, never a stale stored parent. */
  private radarScores(
    scores: Record<string, number | null>,
    sections: AstraSection[]
  ): Record<string, number | null> {
    return Object.fromEntries(
      sections.map((section) => [section.id, this.astraService.calcSectionScore(section, scores)])
    );
  }

  private formatDateForInput(date?: AniListDate | null): string {
    return formatRatingDate(date);
  }

  /** Renders a custom date field: styled trigger + popover calendar, backed by a hidden input. */
  private renderDateField(id: string, label: string, iso: string): string {
    // An AniList fuzzy date the form cannot parse (e.g. 2023-02-30) shows as empty; the hidden input keeps the raw
    // value so an untouched date is not rewritten on save.
    let displayIso = iso;
    try {
      parseRatingDate(iso);
    } catch {
      displayIso = '';
    }
    const date = miniCalendarDateParts(displayIso);
    const display = formatDateDisplay(displayIso);
    return `
      <div class="astra-input-box astra-compact-date-field">
        <span class="astra-label-xs">${label}</span>
        <div class="astra-dropdown astra-datepicker astra-datepicker--compact" data-target="${id}">
          <button type="button" class="astra-dropdown-trigger astra-datepicker-trigger astra-mini-calendar-trigger" aria-label="${label}: ${display}. Click to choose date">
            <span class="astra-mini-calendar-page" aria-hidden="true">
              <span class="astra-mini-calendar-month">${date.month}</span>
              <span class="astra-mini-calendar-day">${date.day}</span>
              <span class="astra-mini-calendar-year">${date.year}</span>
            </span>
            <span class="astra-dropdown-label astra-dp-label visually-hidden">${display}</span>
          </button>
          <div class="astra-dropdown-menu astra-datepicker-menu"></div>
        </div>
        <input type="hidden" id="${id}" value="${iso}">
      </div>
    `;
  }

  private statusIcon(status: MediaListStatus): string {
    switch (status) {
      case MediaListStatus.CURRENT:
        return 'fa-circle-play';
      case MediaListStatus.COMPLETED:
        return 'fa-circle-check';
      case MediaListStatus.PAUSED:
        return 'fa-circle-pause';
      case MediaListStatus.DROPPED:
        return 'fa-circle-stop';
      case MediaListStatus.PLANNING:
        return 'fa-clock';
      case MediaListStatus.REPEATING:
        return 'fa-arrows-rotate';
      default:
        return 'fa-circle-play';
    }
  }

  private bindDatePicker(picker: HTMLElement): void {
    if (!this.viewScope) return;
    bindRatingDatePicker(picker, this.viewScope, () => {
      this.formEditVersion++;
      if (this.state) this.state.isDirty = true;
    });
  }

  private renderEpisodeJournal(capture = true): void {
    const list = this.overlay!.querySelector('.astra-ep-list');
    if (!list || !this.media) return;

    const progressInput = this.overlay!.querySelector('#astra-progress') as HTMLInputElement;
    const progress = parseInt(progressInput.value) || 0;
    if (!this.state) return;
    const season = this.state.data.seasons[this.currentSeasonIdx];
    if (capture) this.captureEpisodeInputs(season);
    this.journalScope?.release();
    this.journalScope = null;

    const isManga = this.media.type === 'MANGA';
    const airedEpisodes = isManga
      ? (this.media.chapters ?? null)
      : this.media.nextAiringEpisode
        ? this.media.nextAiringEpisode.episode - 1
        : this.media.status === 'FINISHED'
          ? this.media.episodes
          : this.media.episodes || 0;

    list.innerHTML = this.renderEpisodeList(
      progress,
      isManga ? this.media.chapters : this.media.episodes,
      season.episodeNotes || {},
      airedEpisodes,
      isManga ? 'CH' : 'EP'
    );
    this.bindEpisodeDatePickers();
  }

  /**
   * Summarizes calendar progress without implying that unreleased episodes are
   * available. The optional middle value is the number already aired.
   */
  private formatProgressCounter(
    progress: number,
    airedEpisodes?: number | null,
    totalEpisodes?: number | null
  ): string {
    const watched = Math.max(0, progress || 0);
    const aired = Math.max(0, airedEpisodes || 0);
    const hasTotal = typeof totalEpisodes === 'number' && totalEpisodes > 0;
    const isBehind = aired > watched;

    if (isBehind) {
      return hasTotal ? ` / ${aired} / ${totalEpisodes}` : ` / ${aired} / ?`;
    }

    // When caught up there is no useful second number. A known total still
    // gives context; an unknown total is intentionally left uncluttered.
    return hasTotal ? ` / ${totalEpisodes}` : ' / ?';
  }
  private renderEpisodeList(
    progress: number,
    total: number | null,
    notes: Record<number, AstraEpisodeNote>,
    airedCount: number | null,
    unitLabel: 'EP' | 'CH' = 'EP'
  ): string {
    const page = journalPage(progress, total, notes, airedCount, this.journalPageIndex);
    this.journalPageIndex = page.pageIndex;
    let html =
      page.pageCount > 1
        ? `
      <div class="astra-journal-pagination">
        <button type="button" class="astra-btn" data-astra-journal-page="previous" ${page.pageIndex === 0 ? 'disabled' : ''}>Previous</button>
        <span aria-live="polite">${unitLabel} ${page.start}–${page.end} / ${page.count}</span>
        <button type="button" class="astra-btn" data-astra-journal-page="next" ${page.pageIndex + 1 >= page.pageCount ? 'disabled' : ''}>Next</button>
        <label>Go to ${unitLabel} <input type="number" min="1" max="${page.count}" step="1" data-astra-journal-jump value="${page.start}" aria-label="Go to ${unitLabel}"></label>
      </div>`
        : '';

    for (let i = page.start; page.count > 0 && i <= page.end; i++) {
      const note = notes[i]?.text || '';
      const timestamp = notes[i]?.timestamp;
      const hasAired = airedCount === null || i <= airedCount;
      const isNotAired = !hasAired;
      const isUnlocked =
        isNotAired &&
        (this.unlockedNotAiredEpisodes.has(`${this.currentSeasonIdx}:${i}`) ||
          note.trim().length > 0);
      const isLocked = isNotAired && !isUnlocked;
      const showDate = hasAired;
      const episodeDate = formatEpisodeDate(timestamp);
      const episodeTime = formatEpisodeTime(timestamp);
      const rowTooltip = isNotAired
        ? isUnlocked
          ? 'Not aired yet. Notes are unlocked; this episode remains marked N/A until your watched progress changes.'
          : 'Not aired yet. Click this episode 3 times quickly to unlock journal notes; this will not mark it as watched.'
        : '';

      html += `
        <div class="astra-ep-row ${isLocked ? 'astra-ep-row--locked' : ''} ${isNotAired ? 'astra-ep-row--not-aired' : ''} ${isUnlocked ? 'astra-ep-row--unlocked' : ''}" data-ep="${i}" ${rowTooltip ? `data-astra-tooltip="${escapeHtml(rowTooltip)}"` : ''}>
          <div class="astra-ep-num">
            <div class="astra-ep-heading">
              <span class="astra-label-sm">${unitLabel}</span>
              <span class="astra-ep-digit">${i}</span>
            </div>
            ${
              showDate
                ? `
              <div class="astra-ep-date-picker${timestamp ? ' has-date' : ''}" data-ep="${i}" data-timestamp="${timestamp || ''}">
                <button type="button" class="astra-ep-date-trigger" title="Edit watched date">
                  ${timestamp ? '' : '<i class="fa-solid fa-calendar"></i>'}
                  <span class="astra-ep-date-values"><span class="astra-ep-date-day">${timestamp ? episodeDate : '-- / --'}</span>${timestamp ? `<span class="astra-ep-date-time">${episodeTime}</span>` : ''}</span>
                </button>
                <div class="astra-ep-date-menu"></div>
              </div>`
                : ''
            }            ${isNotAired ? `<span class="astra-ep-badge astra-ep-badge--not-aired"${isUnlocked ? ` data-astra-tooltip="${escapeHtml(rowTooltip)}" role="note" aria-label="${escapeHtml(rowTooltip)}"` : ''}>N/A</span>` : ''}
          </div>
          <div class="astra-ep-body">
            ${isLocked ? `<span class="astra-ep-lock-indicator" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"></rect><path d="M8 11V7a4 4 0 0 1 8 0v4"></path></svg></span>` : ''}
            <textarea class="astra-ep-textarea" data-ep="${i}"
              placeholder="${isNotAired ? (isUnlocked ? `Notes for episode ${i} (not yet aired)...` : 'Episode not yet aired') : isLocked ? 'Watch this episode to add notes' : `Notes for episode ${i}...`}"
              ${isLocked ? 'disabled' : ''}>${'\n'}${escapeHtml(note)}</textarea>
          </div>
        </div>
      `;
    }
    return html;
  }

  private bindEpisodeDatePickers(): void {
    this.journalScope?.release();
    this.journalScope = null;
    const list = this.overlay?.querySelector<HTMLElement>('.astra-ep-list');
    const parent = this.viewScope;
    if (!list || !parent) return;
    const scope = new AstraRatingViewScope(
      list,
      () => parent.active,
      (error) => {
        logger.error('[AstraRatingModal] Journal action failed', error);
        this.toast.error('The journal action failed. Your edits remain open; retry.');
      }
    );
    this.journalScope = scope;
    list.querySelectorAll<HTMLButtonElement>('[data-astra-journal-page]').forEach((button) => {
      scope.listen(button, 'click', () => {
        this.journalPageIndex += button.dataset.astraJournalPage === 'next' ? 1 : -1;
        this.renderEpisodeJournal();
        const replacement = this.overlay?.querySelector<HTMLButtonElement>(
          `[data-astra-journal-page="${button.dataset.astraJournalPage}"]`
        );
        if (replacement && !replacement.disabled) replacement.focus();
        else this.overlay?.querySelector<HTMLElement>('[data-astra-journal-jump]')?.focus();
      });
    });
    list.querySelectorAll<HTMLElement>('.astra-ep-row--not-aired').forEach((row) => {
      if (row.classList.contains('astra-ep-row--unlocked')) return;
      let tooltip = row.querySelector<HTMLElement>('.astra-journal-tooltip');
      if (!tooltip) {
        tooltip = document.createElement('span');
        tooltip.className = 'astra-journal-tooltip';
        tooltip.setAttribute('aria-hidden', 'true');
        tooltip.textContent = row.dataset.astraTooltip ?? '';
        row.append(tooltip);
      }
      const moveTooltip = (event: PointerEvent) => {
        if (!tooltip) return;
        if (row.classList.contains('astra-ep-row--unlocked')) {
          tooltip.classList.remove('astra-journal-tooltip--visible');
          return;
        }
        const rowRect = row.getBoundingClientRect();
        const tooltipRect = tooltip.getBoundingClientRect();
        const pointerX = event.clientX - rowRect.left;
        const pointerY = event.clientY - rowRect.top;
        const gap = 14;
        let left = pointerX + gap;
        if (left + tooltipRect.width > rowRect.width - 8) left = pointerX - tooltipRect.width - gap;
        left = Math.max(8, Math.min(left, rowRect.width - tooltipRect.width - 8));
        let top = pointerY + gap;
        if (top + tooltipRect.height > rowRect.height - 8)
          top = pointerY - tooltipRect.height - gap;
        top = Math.max(8, Math.min(top, rowRect.height - tooltipRect.height - 8));
        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;
        tooltip.classList.add('astra-journal-tooltip--visible');
      };
      scope.listen(row, 'pointerenter', moveTooltip);
      scope.listen(row, 'pointermove', moveTooltip);
      scope.listen(row, 'pointerleave', () =>
        tooltip?.classList.remove('astra-journal-tooltip--visible')
      );

      let clickCount = 0;
      let lastClickAt = 0;
      scope.listen(row, 'click', () => {
        if (row.classList.contains('astra-ep-row--unlocked')) return;
        const now = Date.now();
        clickCount = now - lastClickAt <= 1100 ? clickCount + 1 : 1;
        lastClickAt = now;
        if (clickCount < 3) return;

        const episode = Number(row.dataset.ep);
        if (!Number.isInteger(episode) || episode < 1) return;
        this.unlockedNotAiredEpisodes.add(`${this.currentSeasonIdx}:${episode}`);
        row.classList.remove('astra-ep-row--locked');
        row.classList.add('astra-ep-row--unlocked');
        row.querySelector('.astra-ep-lock-indicator')?.remove();
        row.dataset.astraTooltip =
          'Not aired yet. Notes are unlocked; this episode remains marked N/A until your watched progress changes.';
        const badge = row.querySelector<HTMLElement>('.astra-ep-badge--not-aired');
        badge?.setAttribute('data-astra-tooltip', row.dataset.astraTooltip);
        badge?.setAttribute('aria-label', row.dataset.astraTooltip);
        tooltip?.remove();
        tooltip = null;

        const textarea = row.querySelector<HTMLTextAreaElement>('.astra-ep-textarea');
        if (textarea) {
          textarea.disabled = false;
          textarea.placeholder = `Notes for episode ${episode} (not yet aired)...`;
          textarea.focus();
        }
      });
    });
    const jump = list.querySelector<HTMLInputElement>('[data-astra-journal-jump]');
    scope.listen(jump, 'change', () => {
      if (!jump) return;
      const episode = Number(jump.value);
      if (!Number.isInteger(episode) || episode < 1 || episode > Number(jump.max)) {
        jump.value = String(this.journalPageIndex * ASTRA_JOURNAL_PAGE_SIZE + 1);
        return;
      }
      this.journalPageIndex = Math.floor((episode - 1) / ASTRA_JOURNAL_PAGE_SIZE);
      this.renderEpisodeJournal();
      this.overlay?.querySelector<HTMLElement>('[data-astra-journal-jump]')?.focus();
    });
    list.querySelectorAll<HTMLElement>('.astra-ep-date-picker').forEach((picker) => {
      bindEpisodeDatePicker(picker, scope, () => {
        this.formEditVersion++;
        if (this.state) this.state.isDirty = true;
      });
    });
  }

  private updateLivePreview(): void {
    // Coalesce rapid calls (e.g. per-pixel slider drag) into one redraw per frame.
    // Rebuilding the radar SVG synchronously on every input event was blocking the
    // main thread and dropping pointer-move events, making sliders stick mid-drag.
    if (this.livePreviewRaf !== null) return;
    this.livePreviewRaf = this.frame(() => {
      this.livePreviewRaf = null;
      this.performLivePreview();
    });
  }

  private setRatingScore(id: string, value: number): void {
    if (!this.state) return;
    const season = this.state.data.seasons[this.currentSeasonIdx];
    this.state.setScore(this.currentSeasonIdx, id, value);
    if (value !== 10 && season) {
      const parent = this.astraService
        .getSections()
        .find((section) => section.subSections?.some((sub) => `${section.id}_${sub.id}` === id));
      if (parent && season.scores[parent.id] === 11)
        this.state.setScore(this.currentSeasonIdx, parent.id, null);
    }
    this.refreshLodeButtons(id);
  }

  private toggleLode(button: HTMLButtonElement): void {
    if (!this.state) return;
    const season = this.state.data.seasons[this.currentSeasonIdx];
    const id = button.dataset.lodeId;
    const kind = button.dataset.lodeKind;
    if (!season || !id) return;

    if (kind === 'main') {
      const section = this.astraService.getSections().find((item) => item.id === id);
      if (!section) return;
      if (season.scores[id] === 11) {
        this.state.setScore(this.currentSeasonIdx, id, section.subSections?.length ? null : 10);
      } else if (this.isMainLodeEligible(section, season.scores)) {
        this.state.setScore(this.currentSeasonIdx, id, 11);
      }
    } else {
      const current = season.scores[id];
      if (current === 11) this.setRatingScore(id, 10);
      else if ((current ?? 0) >= 10) this.setRatingScore(id, 11);
    }

    this.refreshLodeButtons(id);
    this.updateLivePreview();
  }

  private isMainLodeEligible(
    section: AstraSection,
    scores: Record<string, number | null>
  ): boolean {
    const value = this.astraService.calcSectionScore(section, scores);
    return value !== null && value >= 10;
  }

  private refreshLodeButtons(changedId?: string): void {
    if (!this.state || !this.overlay) return;
    const season = this.state.data.seasons[this.currentSeasonIdx];
    if (!season) return;
    const sections = this.astraService.getSections();
    const relatedIds = changedId ? new Set([changedId]) : null;
    if (changedId) {
      const parent = sections.find((section) =>
        section.subSections?.some((sub) => `${section.id}_${sub.id}` === changedId)
      );
      if (parent) relatedIds!.add(parent.id);
    }

    this.overlay.querySelectorAll<HTMLButtonElement>('.astra-lode-btn').forEach((button) => {
      const id = button.dataset.lodeId;
      if (!id) return;
      if (relatedIds && !relatedIds.has(id)) return;
      const active = season.scores[id] === 11;
      let eligible = active;
      if (!active && button.dataset.lodeKind === 'main') {
        const section = sections.find((item) => item.id === id);
        eligible = !!section && this.isMainLodeEligible(section, season.scores);
      } else if (!active && button.dataset.lodeKind === 'sub') {
        eligible = (season.scores[id] ?? 0) >= 10;
      }

      button.disabled = !eligible;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
      button.setAttribute('aria-label', active ? 'Remove lode' : 'Award lode');
      button.title = active ? 'Remove lode' : 'Award lode';
      button.innerHTML = `<i class="fa-${active ? 'solid' : 'regular'} fa-star" aria-hidden="true"></i>`;
    });
  }

  private performLivePreview(): void {
    if (!this.state) return;
    const work = this.state.data;
    const season = work.seasons[this.currentSeasonIdx];
    const sections = this.astraService.getSections();
    this.refreshOverallArea();

    const radarContainer = this.overlay!.querySelector<HTMLElement>('.astra-radar-container');
    if (radarContainer) {
      radarContainer.hidden = !AstraRadarChart.isVisible(sections, season.skip);
      radarContainer.innerHTML = AstraRadarChart.getHTML(
        this.radarScores(season.scores, sections),
        sections,
        season.skip,
        250
      );
    }

    sections.forEach((s) => {
      const val = this.astraService.calcSectionScore(s, season.scores);

      // Update group avg if exists
      const groupAvg = this.findScoreElement(
        '.astra-score-group',
        s.id
      )?.querySelector<HTMLElement>('.astra-group-avg');
      if (groupAvg) {
        groupAvg.textContent = val === null || val === undefined ? '—' : val.toFixed(1);
        groupAvg.style.color = AstraRadarChart.getScoreColor(val);
      }

      const row = this.findScoreElement('.astra-score-input', s.id);
      if (row) {
        const numInput = row.querySelector('.astra-score-num-input') as HTMLInputElement;
        if (numInput) {
          if (document.activeElement !== numInput) {
            numInput.value = val === undefined || val === null ? '0.0' : val.toFixed(1);
          }
          numInput.style.color = AstraRadarChart.getScoreColor(val);
        }
      }

      // Handle sub-sections inputs
      if (s.subSections) {
        s.subSections.forEach((sub) => {
          const subId = `${s.id}_${sub.id}`;
          const subRow = this.findScoreElement('.astra-score-input', subId);
          if (subRow) {
            const subVal = season.scores[subId];
            const subNumInput = subRow.querySelector('.astra-score-num-input') as HTMLInputElement;
            if (subNumInput) {
              if (document.activeElement !== subNumInput) {
                subNumInput.value =
                  subVal === undefined || subVal === null ? '0.0' : subVal.toFixed(1);
              }
              subNumInput.style.color = AstraRadarChart.getScoreColor(subVal);
            }
          }
        });
      }
    });
  }
}
