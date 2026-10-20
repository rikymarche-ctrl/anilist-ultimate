import { AstraView } from './base/AstraView';
import { html } from '@core/utils/Template';
import { logger } from '@core/logger';
import { AstraCalculator } from '../utils/AstraCalculator';
import type { SeasonalData, SeasonalWrappedService } from '../services/SeasonalWrappedService';
import {
  SEASONS,
  buildSeasonalReport,
  currentSeason,
  emptySeasonalChoices,
  latestReleasedSeason,
  seasonKey,
  seasonLabel,
  seasonBounds,
  type SeasonalAward,
  type SeasonalChoices,
  type SeasonalPeriod,
  type SeasonalReport,
} from '../services/SeasonalWrappedModel';
import { drawSeasonalImage } from './SeasonalWrappedImage';
import { LiquidBackground } from './wrapped/LiquidBackground';
import { WrappedStory } from './wrapped/WrappedStory';
import { SEASON_PALETTES, seasonalSlides } from './wrapped/SeasonalWrappedSlides';
import { formatRange } from './wrapped/WrappedFormat';

/** Live backdrop seed; exports derive their own from the season. */
const LIVE_SEED = 64;
const MIN_YEAR = 1900;
const MAX_YEAR = 2199;
const FOCUS_SWAPS: Record<string, string> = {
  award: 'award',
  confirm: 'unconfirm',
  unconfirm: 'confirm',
};
let panelIds = 0;

export class SeasonalWrappedView extends AstraView {
  private period: SeasonalPeriod;
  private data: SeasonalData | null = null;
  private choices: SeasonalChoices = emptySeasonalChoices();
  private report: SeasonalReport | null = null;
  private epoch = 0;
  private saving = false;
  private saveFailed = false;
  private includePrivate = false;
  private urls = new Map<string, ReturnType<typeof setTimeout>>();
  private liquid: LiquidBackground | null = null;
  private story: WrappedStory | null = null;
  private storyIndex = 0;
  private storyLabel = '';
  private storyPeriod = '';
  /** Control to refocus after the post-save re-render (it may have moved to another list). */
  private pendingFocus: string | null = null;

  constructor(
    private service: SeasonalWrappedService | undefined,
    private back: () => void,
    initialPeriod: SeasonalPeriod = currentSeason()
  ) {
    super({});
    this.period = { ...initialPeriod };
  }

  protected template(): HTMLElement {
    const panelId = `seasonal-wrapped-panel-${++panelIds}`;
    return html`<section class="astra-wrapped seasonal-wrapped aw-shell" tabindex="-1">
      <canvas class="aw-liquid" aria-hidden="true"></canvas>
      <div class="aw-scrim" aria-hidden="true"></div>
      <div class="aw-head">
        <header class="aw-topbar">
          <button type="button" class="aw-chip" data-seasonal-back>
            <i class="fa-solid fa-arrow-left" aria-hidden="true"></i>
            <span class="aw-chip-text">Wrapped</span>
          </button>
          <div class="aw-brand">
            <h2>Seasonal Wrapped</h2>
            <p class="seasonal-status" role="status" aria-live="polite" data-seasonal-status></p>
          </div>
          <div class="aw-actions seasonal-header-actions">
            <div class="aw-stepper">
              <button
                type="button"
                class="aw-chip aw-chip--icon"
                data-seasonal-step="-1"
                aria-label="Previous season"
              >
                <i class="fa-solid fa-chevron-left" aria-hidden="true"></i>
              </button>
              <button
                type="button"
                class="aw-chip"
                data-seasonal-customize
                aria-expanded="false"
                aria-controls="${panelId}"
              >
                <i class="fa-solid fa-sliders" aria-hidden="true"></i>
                <span data-seasonal-period-label></span>
              </button>
              <button
                type="button"
                class="aw-chip aw-chip--icon"
                data-seasonal-step="1"
                aria-label="Next season"
              >
                <i class="fa-solid fa-chevron-right" aria-hidden="true"></i>
              </button>
            </div>
            <a
              class="aw-chip"
              data-seasonal-chart
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open AniChart"
              ><span class="aw-chip-text">AniChart</span>
              <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i
            ></a>
            <button type="button" class="aw-chip aw-chip--solid" data-seasonal-export disabled>
              <i class="fa-solid fa-download" aria-hidden="true"></i>
              <span class="aw-chip-text">Download PNG</span>
            </button>
          </div>
        </header>
        <form class="aw-panel astra-wrapped-controls" data-seasonal-controls id="${panelId}" hidden>
          <label>Season<select name="season"></select></label
          ><label>Year<input type="number" name="year" min="1900" max="2199" required /></label>
          <button type="submit">Refresh data</button
          ><label class="astra-wrapped-privacy"
            ><input name="private" type="checkbox" /> Include private and hidden titles</label
          >
        </form>
      </div>
      <div class="seasonal-save-retry aw-glass" hidden>
        <button type="button" data-seasonal-retry>Retry saving picks</button
        ><button type="button" data-seasonal-discard>Discard unsaved picks</button>
      </div>
      <div class="aw-stage" data-seasonal-results></div>
    </section>`;
  }

  protected onMount(): void {
    for (const season of SEASONS)
      this.$('[name="season"]')!.append(
        html`<option value="${season}">${season[0] + season.slice(1).toLowerCase()}</option>`
      );
    this.$<HTMLSelectElement>('[name="season"]')!.value = this.period.season;
    this.$<HTMLInputElement>('[name="year"]')!.value = String(this.period.year);
    this.liquid = new LiquidBackground(
      this.$<HTMLCanvasElement>('.aw-liquid')!,
      this.element,
      SEASON_PALETTES[this.period.season].deep,
      LIVE_SEED
    );
    this.updateChart();
    void this.load();
  }

  protected onUnmount(): void {
    this.epoch++;
    this.report = null;
    this.data = null;
    this.saving = false;
    this.disposeStory();
    this.liquid?.dispose();
    this.liquid = null;
    for (const [url, timer] of this.urls) {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
    }
    this.urls.clear();
  }

  private status(message: string): void {
    this.$('[data-seasonal-status]')!.textContent = message;
  }
  private current(epoch: number): boolean {
    return this.mounted && epoch === this.epoch;
  }
  private updateChart(): void {
    this.$<HTMLAnchorElement>('[data-seasonal-chart]')!.href =
      `https://anichart.net/${seasonLabel(this.period).replace(' ', '-')}`;
    this.$('[data-seasonal-period-label]')!.textContent = seasonLabel(this.period);
  }
  private busy(value: boolean): void {
    this.$$<HTMLInputElement>(
      'input, select, [data-seasonal-controls] button, [data-seasonal-step], [data-unconfirm], [data-seasonal-retry], [data-seasonal-discard]'
    ).forEach((element) => {
      element.disabled = value || element.hasAttribute('data-locked');
    });
    const exportDisabled =
      value || this.saveFailed || !this.report || !this.report.concluded.length;
    this.$<HTMLButtonElement>('[data-seasonal-export]')!.disabled = exportDisabled;
    const download = this.$<HTMLButtonElement>('[data-seasonal-download]');
    if (download) download.disabled = exportDisabled;
  }
  private disposeStory(): void {
    this.story?.dispose();
    this.story = null;
  }
  private clearResults(): void {
    this.disposeStory();
    this.$('[data-seasonal-results]')!.replaceChildren();
  }
  private setPanel(open: boolean, focus = false): void {
    if (open) this.story?.pause();
    this.$<HTMLFormElement>('[data-seasonal-controls]')!.hidden = !open;
    this.$('[data-seasonal-customize]')!.setAttribute('aria-expanded', String(open));
    if (open && focus) this.$<HTMLSelectElement>('[name="season"]')!.focus();
  }
  private stageMessage(icon: string, title: string, message: string, action: boolean): void {
    const card = html`<div class="aw-empty aw-glass">
      <i class="${`fa-solid ${icon}`}" aria-hidden="true"></i>
      <h3>${title}</h3>
      <p>${message}</p>
    </div>`;
    if (action)
      card.append(
        html`<button type="button" class="aw-cta" data-seasonal-open-panel>Choose a season</button>`
      );
    this.disposeStory();
    this.$('[data-seasonal-results]')!.replaceChildren(card);
  }

  private async load(): Promise<void> {
    if (this.saving || this.saveFailed) return;
    const epoch = ++this.epoch;
    this.data = null;
    this.report = null;
    this.stageMessage(
      'fa-wand-magic-sparkles',
      'Unwrapping your season…',
      'Reading your anime list and broadcast dates.',
      false
    );
    this.status('Loading your anime list and broadcast dates…');
    this.busy(true);
    try {
      if (!this.service)
        throw new Error('Seasonal Wrapped is unavailable. Reload the extension and this page.');
      const data = await this.service.load(() => this.current(epoch));
      if (!this.current(epoch)) return;
      this.data = data;
      this.choices = this.service.getChoices(data, this.period);
      await this.rememberReleaseSeen(this.period, epoch);
      if (!this.current(epoch)) return;
      this.renderReport();
    } catch (error) {
      if (!this.current(epoch)) return;
      const message =
        error instanceof Error && error.message.startsWith('Sign in')
          ? error.message
          : 'Could not load the complete recap. Sign in and use Refresh data to retry.';
      this.status(message);
      this.stageMessage(
        'fa-triangle-exclamation',
        'This season could not be loaded',
        message,
        true
      );
    } finally {
      if (this.current(epoch)) this.busy(false);
    }
  }

  private async rememberReleaseSeen(period: SeasonalPeriod, epoch: number): Promise<void> {
    const data = this.data;
    const service = this.service;
    if (!data || !service || this.saving) return;
    const latest = latestReleasedSeason();
    if (period.year !== latest.year || period.season !== latest.season) return;
    const stored = service.getChoices(data, period);
    if (stored.releaseSeenAt) return;
    this.saving = true;
    this.busy(true);
    try {
      const saved = await service.saveChoices(data, period,
        { ...stored, releaseSeenAt: Date.now() }, () => this.current(epoch));
      if (this.current(epoch) && this.period.year === period.year && this.period.season === period.season) this.choices = saved;
    } catch (error) {
      if (this.current(epoch)) logger.warn('[SeasonalWrappedView] Could not remember the released season', error);
    } finally {
      if (this.current(epoch)) { this.saving = false; this.busy(false); }
    }
  }

  private renderReport(): void {
    if (!this.data) return;
    const backup = this.data.backup;
    const report = buildSeasonalReport(
      this.data.entries,
      Object.values(backup.works),
      this.period,
      this.choices,
      (work) => AstraCalculator.calcSeriesOverall(work, backup.sections, backup.settings),
      this.includePrivate
    );
    this.report = report;
    this.clearResults();
    const bounds = seasonBounds(this.period);
    this.status(
      `${formatRange(bounds.start, bounds.end)} · ${this.includePrivate ? 'Private titles included' : 'Private titles excluded'} · Refreshed ${new Date(this.data.loadedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    );
    const key = seasonKey(this.period);
    const restore = key === this.storyPeriod;
    this.storyPeriod = key;
    this.story = new WrappedStory(
      seasonalSlides(report, this.choices, { preview: () => drawSeasonalImage(report) }),
      this.liquid,
      (index, label) => {
        this.storyIndex = index;
        this.storyLabel = label;
      }
    );
    this.$('[data-seasonal-results]')!.append(this.story.element);
    // Slides can appear or disappear after a save (spotlight, dates to confirm): restore by label first.
    const same = restore ? this.story.find(this.storyLabel) : 0;
    this.story.go(same >= 0 ? same : this.storyIndex, !restore);
    this.updateChart();
    this.busy(false);
    this.restoreFocus();
  }

  /** Remembers the control being used so the re-render after saving can return focus to it. */
  private rememberFocus(element: HTMLElement): void {
    for (const [name, target] of Object.entries(FOCUS_SWAPS)) {
      const value = element.dataset[name];
      // Award ids and media ids only; anything else is not worth a selector.
      if (value && /^[\w-]+$/.test(value)) {
        this.pendingFocus = `[data-${target}="${value}"]`;
        return;
      }
    }
  }

  private restoreFocus(): void {
    const selector = this.pendingFocus;
    this.pendingFocus = null;
    if (!selector) return;
    const target = this.$<HTMLElement>(selector);
    if (target && !target.closest('[inert]')) target.focus({ preventScroll: true });
    else this.story?.element.focus({ preventScroll: true });
  }

  protected bindEvents(): void {
    this.addEventListener(this.$('[data-seasonal-back]')!, 'click', () => {
      if (this.mounted) this.back();
    });
    this.addEventListener(this.$('[data-seasonal-controls]')!, 'submit', (event) => {
      event.preventDefault();
      if (this.readPeriod()) {
        this.setPanel(false);
        void this.load();
      }
    });
    for (const name of ['season', 'year'])
      this.addEventListener(this.$(`[name="${name}"]`)!, 'change', () => {
        this.applyPeriod();
      });
    this.addEventListener(this.$('[data-seasonal-customize]')!, 'click', () => {
      this.setPanel(this.$<HTMLFormElement>('[data-seasonal-controls]')!.hidden, true);
    });
    this.$$('[data-seasonal-step]').forEach((button) =>
      this.addEventListener(button, 'click', () => {
        this.stepSeason(Number(button.dataset.seasonalStep));
      })
    );
    this.addEventListener(this.$('[name="private"]')!, 'change', () => {
      if (this.saving || this.saveFailed) return;
      this.includePrivate = this.$<HTMLInputElement>('[name="private"]')!.checked;
      this.renderReport();
    });
    this.addEventListener(this.$('[data-seasonal-results]')!, 'change', (event) => {
      if (this.saving || this.saveFailed || !this.report) return;
      const input = event.target;
      if (input instanceof HTMLSelectElement && input.dataset.award) {
        const award = input.dataset.award as SeasonalAward;
        const id = Number(input.value);
        const eligible = this.report.concluded.some(
          (title) =>
            title.mediaId === id && (award === 'disappointment' || title.status === 'COMPLETED')
        );
        if (input.value && !eligible) return;
        if (input.value) this.choices.awards[award] = id;
        else delete this.choices.awards[award];
        this.rememberFocus(input);
        void this.save();
      } else if (input instanceof HTMLInputElement && input.dataset.confirm && input.checked) {
        const id = Number(input.dataset.confirm);
        if (
          !this.report.uncertain.some(
            (title) => title.mediaId === id && title.reason === 'viewing-dates'
          )
        )
          return;
        this.choices.confirmedMediaIds = [...new Set([...this.choices.confirmedMediaIds, id])];
        this.rememberFocus(input);
        void this.save();
      }
    });
    this.addEventListener(this.$('[data-seasonal-results]')!, 'click', (event) => {
      if (!(event.target instanceof Element)) return;
      if (event.target.closest('[data-seasonal-download]')) {
        this.download();
        return;
      }
      if (event.target.closest('[data-seasonal-open-panel]')) {
        this.setPanel(true, true);
        return;
      }
      if (this.saving || this.saveFailed) return;
      const button = event.target.closest<HTMLElement>('[data-unconfirm]');
      if (!button) return;
      const id = Number(button.dataset.unconfirm);
      if (!this.choices.confirmedMediaIds.includes(id)) return;
      this.choices.confirmedMediaIds = this.choices.confirmedMediaIds.filter(
        (value) => value !== id
      );
      this.rememberFocus(button);
      void this.save();
    });
    this.addEventListener(this.$('[data-seasonal-retry]')!, 'click', () => {
      void this.save();
    });
    this.addEventListener(this.$('[data-seasonal-discard]')!, 'click', () => {
      if (!this.data || !this.service || this.saving) return;
      this.choices = this.service.getChoices(this.data, this.period);
      this.saveFailed = false;
      this.$<HTMLElement>('.seasonal-save-retry')!.hidden = true;
      this.renderReport();
    });
    this.addEventListener(this.$('[data-seasonal-export]')!, 'click', () => {
      this.download();
    });
    this.addEventListener(this.element, 'keydown', (event) => {
      const key = event as KeyboardEvent;
      if (key.key === 'Escape' && !this.$<HTMLFormElement>('[data-seasonal-controls]')!.hidden) {
        key.preventDefault();
        key.stopPropagation();
        this.setPanel(false);
        this.$<HTMLButtonElement>('[data-seasonal-customize]')!.focus();
        return;
      }
      this.story?.handleKey(key);
    });
  }

  /** Season/year inputs changed: re-render from the loaded list (no network). */
  private applyPeriod(): void {
    if (!this.readPeriod()) return;
    if (this.data && this.service) {
      this.choices = this.service.getChoices(this.data, this.period);
      this.renderReport();
      void this.rememberReleaseSeen({ ...this.period }, this.epoch);
    }
  }

  private stepSeason(delta: number): void {
    if (this.saving || this.saveFailed || !Number.isInteger(delta)) return;
    const index = SEASONS.indexOf(this.period.season) + delta;
    const year = this.period.year + Math.floor(index / SEASONS.length);
    if (year < MIN_YEAR || year > MAX_YEAR) return;
    this.$<HTMLSelectElement>('[name="season"]')!.value =
      SEASONS[((index % SEASONS.length) + SEASONS.length) % SEASONS.length];
    this.$<HTMLInputElement>('[name="year"]')!.value = String(year);
    this.applyPeriod();
  }

  private readPeriod(): boolean {
    if (this.saving || this.saveFailed) return false;
    const year = Number(this.$<HTMLInputElement>('[name="year"]')!.value);
    if (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR) {
      this.status('Choose a year from 1900 to 2199.');
      this.report = null;
      this.stageMessage(
        'fa-calendar-xmark',
        'Check the year',
        'Choose a year from 1900 to 2199.',
        true
      );
      this.$<HTMLButtonElement>('[data-seasonal-export]')!.disabled = true;
      return false;
    }
    this.period = {
      year,
      season: this.$<HTMLSelectElement>('[name="season"]')!.value as SeasonalPeriod['season'],
    };
    this.updateChart();
    return true;
  }

  private async save(): Promise<void> {
    if (!this.data || !this.service || this.saving || !this.mounted) return;
    const epoch = this.epoch;
    this.saving = true;
    this.saveFailed = false;
    this.busy(true);
    this.status('Saving your personal picks…');
    try {
      const saved = await this.service.saveChoices(
        this.data,
        this.period,
        structuredClone(this.choices),
        () => this.current(epoch)
      );
      if (!this.current(epoch)) return;
      this.choices = saved;
      this.$<HTMLElement>('.seasonal-save-retry')!.hidden = true;
      this.renderReport();
      this.status('Personal picks saved to Astra.');
    } catch {
      if (!this.current(epoch)) return;
      this.saveFailed = true;
      this.busy(true);
      this.$<HTMLElement>('.seasonal-save-retry')!.hidden = false;
      for (const selector of ['[data-seasonal-retry]', '[data-seasonal-discard]'])
        this.$<HTMLButtonElement>(selector)!.disabled = false;
      this.status(
        'Could not confirm saved picks. Retry, or discard these edits and refresh if another tab changed this season.'
      );
    } finally {
      if (this.current(epoch)) {
        this.saving = false;
        if (!this.saveFailed) this.busy(false);
      }
    }
  }

  private download(): void {
    const report = this.report;
    const epoch = this.epoch;
    if (!this.mounted || this.saving || this.saveFailed || !report?.concluded.length) return;
    try {
      drawSeasonalImage(report).toBlob((blob) => {
        if (!this.current(epoch) || this.report !== report || this.saving || this.saveFailed)
          return;
        if (!blob) {
          this.status('Could not export the image. Please retry.');
          return;
        }
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `astra-seasonal-${report.period.year}-${report.period.season.toLowerCase()}.png`;
        this.element.append(anchor);
        anchor.click();
        anchor.remove();
        const timer = setTimeout(() => {
          if (this.urls.delete(url)) URL.revokeObjectURL(url);
        }, 1000);
        this.urls.set(url, timer);
      }, 'image/png');
    } catch {
      this.status('Could not export the image. Please retry.');
    }
  }
}
