import { AstraView } from './base/AstraView';
import { wrappedDate, wrappedPeriod, type WrappedPeriod } from '../services/AstraWrapped';
import { buildYearReview } from '../services/year/YearReview';
import type { YearReviewData, YearReviewService } from '../services/year/YearReviewService';
import type { YearReviewReport } from '../services/year/YearReviewTypes';
import { drawWrappedImage, loadWrappedPictures, type WrappedPictures } from './AstraWrappedImage';
import { html } from '@core/utils/Template';
import { LIQUID_PALETTES, LiquidBackground } from './wrapped/LiquidBackground';
import { WrappedStory } from './wrapped/WrappedStory';
import { yearSlides } from './wrapped/YearSlides';
import { formatRange, periodTitle } from './wrapped/WrappedFormat';

/** Live backdrop seed; exports derive their own from the period. */
const LIVE_SEED = 42;
const MAX_YEARS = 100;
let panelIds = 0;

export class AstraWrappedView extends AstraView {
  private data: YearReviewData | null = null;
  private period: WrappedPeriod = wrappedPeriod('year');
  private report: YearReviewReport | null = null;
  private pictures: Promise<WrappedPictures> = Promise.resolve(new Map());
  private loadedPictures: WrappedPictures = new Map();
  private requestVersion = 0;
  private loading = false;
  private includePrivate = false;
  private downloadUrls = new Set<string>();
  private downloadTimers = new Set<ReturnType<typeof setTimeout>>();
  private liquid: LiquidBackground | null = null;
  private story: WrappedStory | null = null;
  private storyIndex = 0;
  private storyLabel = '';
  private storyPeriod = '';

  constructor(
    private years: YearReviewService | undefined,
    private back: () => void
  ) {
    super({});
  }

  protected template(): HTMLElement {
    const panelId = `astra-wrapped-panel-${++panelIds}`;
    return html`<section class="astra-wrapped aw-shell" tabindex="-1">
      <canvas class="aw-liquid" aria-hidden="true"></canvas>
      <div class="aw-scrim" aria-hidden="true"></div>
      <div class="aw-head">
        <header class="aw-topbar">
          <button type="button" class="aw-chip" data-wrapped-back>
            <i class="fa-solid fa-arrow-left" aria-hidden="true"></i>
            <span class="aw-chip-text">Wrapped</span>
          </button>
          <div class="aw-brand">
            <h2>Astra Wrapped</h2>
            <p data-wrapped-status role="status" aria-live="polite"></p>
          </div>
          <div class="aw-actions">
            <button
              type="button"
              class="aw-chip"
              data-wrapped-customize
              aria-expanded="false"
              aria-controls="${panelId}"
            >
              <i class="fa-solid fa-sliders" aria-hidden="true"></i>
              <span data-wrapped-period-label>This year</span>
            </button>
            <button type="button" class="aw-chip aw-chip--solid" data-wrapped-export disabled>
              <i class="fa-solid fa-download" aria-hidden="true"></i>
              <span class="aw-chip-text">Download PNG</span>
            </button>
          </div>
        </header>
        <form class="aw-panel astra-wrapped-controls" id="${panelId}" hidden>
          <label
            >Period<select name="period">
              <option value="year">This year</option>
              <option value="month">This month</option>
              <option value="custom">Custom dates</option>
            </select></label
          >
          <label>From<input type="date" name="start" required /></label>
          <label>To<input type="date" name="end" required /></label>
          <button type="submit">Update recap</button>
          <label class="astra-wrapped-privacy"
            ><input type="checkbox" name="private" /> Include private and hidden titles</label
          >
          <p class="astra-wrapped-notice">
            Built from your AniList list activity in this period. Progress counts on the day you
            logged it; completing a title adds the episodes after your last logged progress. AniList
            returns at most 5,000 updates per period.
          </p>
        </form>
      </div>
      <div class="aw-stage" data-wrapped-results></div>
    </section>`;
  }

  protected onMount(): void {
    this.liquid = new LiquidBackground(
      this.$<HTMLCanvasElement>('.aw-liquid')!,
      this.element,
      LIQUID_PALETTES.nebula,
      LIVE_SEED
    );
    this.syncDates();
    void this.load();
  }

  protected onUnmount(): void {
    this.requestVersion++;
    this.data = null;
    this.report = null;
    this.loading = false;
    this.loadedPictures = new Map();
    this.disposeStory();
    this.liquid?.dispose();
    this.liquid = null;
    for (const url of this.downloadUrls) URL.revokeObjectURL(url);
    this.downloadUrls.clear();
    for (const timer of this.downloadTimers) clearTimeout(timer);
    this.downloadTimers.clear();
  }

  private syncDates(): void {
    this.$<HTMLInputElement>('[name="start"]')!.value = this.period.start;
    this.$<HTMLInputElement>('[name="end"]')!.value = this.period.end;
    this.syncLabel();
  }

  private validPeriod(): string | null {
    try {
      const start = wrappedDate(this.period.start);
      const end = wrappedDate(this.period.end);
      if (start > end) return 'The end date must follow the start date.';
      if (end.getFullYear() - start.getFullYear() > MAX_YEARS)
        return 'Choose a period of up to 100 years.';
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : 'Choose valid start and end dates.';
    }
  }

  private syncLabel(): void {
    this.$('[data-wrapped-period-label]')!.textContent = this.validPeriod()
      ? 'Choose period'
      : periodTitle(this.period.start, this.period.end);
  }

  private disposeStory(): void {
    this.story?.dispose();
    this.story = null;
  }

  private setPanel(open: boolean, focus = false): void {
    if (open) this.story?.pause();
    this.$<HTMLFormElement>('.aw-panel')!.hidden = !open;
    this.$('[data-wrapped-customize]')!.setAttribute('aria-expanded', String(open));
    if (open && focus) this.$<HTMLSelectElement>('[name="period"]')!.focus();
  }

  private stageMessage(icon: string, title: string, message: string, action: boolean): void {
    const card = html`<div class="aw-empty aw-glass">
      <i class="${`fa-solid ${icon}`}" aria-hidden="true"></i>
      <h3>${title}</h3>
      <p data-wrapped-stage-text>${message}</p>
    </div>`;
    if (action)
      card.append(
        html`<button type="button" class="aw-cta" data-wrapped-open-panel>Choose a period</button>`
      );
    this.$('[data-wrapped-results]')!.replaceChildren(card);
  }

  private setStatus(text: string): void {
    this.$('[data-wrapped-status]')!.textContent = text;
  }

  private async load(): Promise<void> {
    const version = ++this.requestVersion;
    const current = () => this.mounted && version === this.requestVersion;
    this.data = null;
    this.report = null;
    this.disposeStory();
    this.$<HTMLButtonElement>('[data-wrapped-export]')!.disabled = true;
    const invalid = this.validPeriod();
    if (invalid) {
      this.loading = false;
      this.setStatus(invalid);
      this.stageMessage('fa-calendar-xmark', 'Check the dates', invalid, true);
      return;
    }
    if (!this.years) {
      this.loading = false;
      this.setStatus('Sign in to AniList to open Astra Wrapped.');
      this.stageMessage(
        'fa-circle-info',
        'Sign in to unwrap',
        'Astra Wrapped reads your AniList activity, so it needs you to be signed in.',
        false
      );
      return;
    }
    this.loading = true;
    this.stageMessage(
      'fa-wand-magic-sparkles',
      'Unwrapping your year…',
      'Reading your AniList activity.',
      false
    );
    this.setStatus('Loading your AniList activity…');
    try {
      const data = await this.years.load({ ...this.period }, current, (step) => {
        if (!current()) return;
        this.setStatus(step);
        const text = this.$('[data-wrapped-stage-text]');
        if (text) text.textContent = step;
      });
      if (!current()) return;
      this.data = data;
      this.loading = false;
      this.refresh();
    } catch (error) {
      if (!current()) return;
      this.loading = false;
      const message =
        error instanceof Error && error.message.startsWith('Sign in')
          ? error.message
          : 'Could not load your AniList activity. Use Update recap to retry.';
      this.setStatus(message);
      this.stageMessage('fa-triangle-exclamation', 'Your year could not be read', message, true);
    }
  }

  private refresh(): void {
    if (this.loading || !this.data) return;
    this.report = null;
    this.disposeStory();
    this.$('[data-wrapped-results]')!.replaceChildren();
    this.$<HTMLButtonElement>('[data-wrapped-export]')!.disabled = true;
    let report: YearReviewReport;
    try {
      report = buildYearReview(this.data.input, {
        includePrivate: this.includePrivate,
        local: this.data.local,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not calculate this recap.';
      this.setStatus(message);
      this.stageMessage('fa-calendar-xmark', 'Check the dates', message, true);
      return;
    }
    const { start, end } = this.data.input.period;
    if (!report.titles.length) {
      this.setStatus(
        'No AniList activity in this period. Try another period or include private titles.'
      );
      this.stageMessage(
        'fa-hourglass-half',
        'Nothing to unwrap yet',
        'There is no list activity in this period yet.',
        true
      );
      return;
    }
    this.report = report;
    this.setStatus(
      `${formatRange(start, end)} · ${this.includePrivate ? 'Private and hidden titles included' : 'Private and hidden titles excluded'}`
    );
    const version = this.requestVersion;
    this.loadedPictures = new Map();
    this.pictures = loadWrappedPictures(report).then((pictures) => {
      if (!this.mounted || version !== this.requestVersion || this.report !== report)
        return pictures;
      this.loadedPictures = pictures;
      if (pictures.size) this.redrawPreview(report);
      return pictures;
    });
    const key = `${start}|${end}`;
    const restore = key === this.storyPeriod;
    this.storyPeriod = key;
    this.story = new WrappedStory(
      yearSlides(report, { preview: () => drawWrappedImage(report, this.loadedPictures) }),
      this.liquid,
      (index, label) => {
        this.storyIndex = index;
        this.storyLabel = label;
      }
    );
    this.$('[data-wrapped-results]')!.append(this.story.element);
    const same = restore ? this.story.find(this.storyLabel) : 0;
    this.story.go(same >= 0 ? same : this.storyIndex, !restore);
    this.$<HTMLButtonElement>('[data-wrapped-export]')!.disabled = false;
  }

  /** The summary preview may have been drawn before the pictures arrived. */
  private redrawPreview(report: YearReviewReport): void {
    const current = this.$<HTMLCanvasElement>('.aw-card-canvas');
    if (!current) return;
    try {
      const canvas = drawWrappedImage(report, this.loadedPictures);
      for (const name of ['class', 'role', 'aria-label'])
        canvas.setAttribute(name, current.getAttribute(name) ?? '');
      current.replaceWith(canvas);
    } catch {
      // Keep the existing preview; Download reports its own errors.
    }
  }

  protected bindEvents(): void {
    this.addEventListener(this.$('[data-wrapped-back]')!, 'click', () => {
      if (this.mounted) this.back();
    });
    this.addEventListener(this.$('[data-wrapped-customize]')!, 'click', () => {
      this.setPanel(this.$<HTMLFormElement>('.aw-panel')!.hidden, true);
    });
    this.addEventListener(this.$('[name="period"]')!, 'change', () => {
      const kind = this.$<HTMLSelectElement>('[name="period"]')!.value;
      if (kind !== 'year' && kind !== 'month') return;
      this.period = wrappedPeriod(kind);
      this.syncDates();
      void this.load();
    });
    // Dates apply with Update recap: each load spends AniList requests.
    for (const name of ['start', 'end'])
      this.addEventListener(this.$(`[name="${name}"]`)!, 'change', () => {
        this.$<HTMLSelectElement>('[name="period"]')!.value = 'custom';
        this.readControls();
        const invalid = this.validPeriod();
        if (invalid) {
          this.setStatus(invalid);
          this.$<HTMLButtonElement>('[data-wrapped-export]')!.disabled = true;
        } else this.setStatus('Use Update recap to load these dates.');
      });
    this.addEventListener(this.$('form')!, 'submit', (event) => {
      event.preventDefault();
      this.readControls();
      this.setPanel(false);
      void this.load();
    });
    this.addEventListener(this.$('[name="private"]')!, 'change', () => {
      this.includePrivate = this.$<HTMLInputElement>('[name="private"]')!.checked;
      this.refresh();
    });
    this.addEventListener(this.$('[data-wrapped-export]')!, 'click', () => {
      void this.exportImage();
    });
    this.addEventListener(this.$('[data-wrapped-results]')!, 'click', (event) => {
      if (!(event.target instanceof Element)) return;
      if (event.target.closest('[data-wrapped-download]')) void this.exportImage();
      else if (event.target.closest('[data-wrapped-open-panel]')) this.setPanel(true, true);
    });
    this.addEventListener(this.element, 'keydown', (event) => {
      const key = event as KeyboardEvent;
      if (key.key === 'Escape' && !this.$<HTMLFormElement>('.aw-panel')!.hidden) {
        key.preventDefault();
        key.stopPropagation();
        this.setPanel(false);
        this.$<HTMLButtonElement>('[data-wrapped-customize]')!.focus();
        return;
      }
      this.story?.handleKey(key);
    });
  }

  private readControls(): void {
    this.period = {
      start: this.$<HTMLInputElement>('[name="start"]')!.value,
      end: this.$<HTMLInputElement>('[name="end"]')!.value,
    };
    this.includePrivate = this.$<HTMLInputElement>('[name="private"]')!.checked;
    this.syncLabel();
  }

  private async exportImage(): Promise<void> {
    const report = this.report;
    if (!report || !this.mounted) return;
    const version = this.requestVersion;
    const stale = () => !this.mounted || version !== this.requestVersion || this.report !== report;
    try {
      const pictures = await this.pictures;
      if (stale()) return;
      drawWrappedImage(report, pictures).toBlob((blob) => {
        if (stale()) return;
        if (!blob) {
          this.setStatus('Image export failed. Please retry.');
          return;
        }
        const url = URL.createObjectURL(blob);
        this.downloadUrls.add(url);
        const link = document.createElement('a');
        link.href = url;
        link.download = `astra-wrapped-${report.period.start}-${report.period.end}.png`;
        this.element.append(link);
        link.click();
        link.remove();
        // Keep the URL alive for the browser download; unmount revokes it too.
        const timer = setTimeout(() => {
          this.downloadTimers.delete(timer);
          if (this.downloadUrls.delete(url)) URL.revokeObjectURL(url);
        }, 1000);
        this.downloadTimers.add(timer);
      }, 'image/png');
    } catch {
      this.setStatus('Image export failed. Please retry.');
    }
  }
}
