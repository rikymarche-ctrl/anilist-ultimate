/**
 * @file ProfileCompareView.ts
 * @description Full-screen liquid story comparing the viewer with another profile.
 *
 * Owns loading, the honest failure screens (private list, missing user, nothing logged) and the
 * PNG download. An epoch guards every await, so a late response never renders into a closed view.
 */

import { html } from '@core/utils/Template';
import { logger } from '@core/logger';
import { AstraView } from '@modules/astra/ui/base/AstraView';
import { LiquidBackground } from '@modules/astra/ui/wrapped/LiquidBackground';
import { formatNumber } from '@modules/astra/ui/wrapped/WrappedFormat';
import { WrappedStory } from '@modules/astra/ui/wrapped/WrappedStory';
import { drawCompareImage } from './ProfileCompareImage';
import { buildComparison, type CompareMedia, type CompareReport } from './ProfileCompareModel';
import {
  CompareError,
  type CompareFailure,
  type ProfileCompareService,
} from './ProfileCompareService';
import { COMPARE_LOADING_PALETTE, compareSlides } from './ProfileCompareSlides';

const LIVE_SEED = 112;
const URL_REVOKE_MS = 1000;

interface StageMessage {
  icon: string;
  title: string;
  body: string;
  retry?: boolean;
}

/** What each failure means to the reader; none of them is an error dump. */
export function failureMessage(kind: CompareFailure, name: string): StageMessage {
  switch (kind) {
    case 'private':
      return {
        icon: 'fa-circle-info',
        title: `${name}'s list is private`,
        body: 'AniList only shares it with its owner, so there is nothing to compare. Your own list was not read.',
      };
    case 'not-found':
      return {
        icon: 'fa-circle-xmark',
        title: 'Profile not found',
        body: `AniList has no user called ${name} any more.`,
      };
    case 'signed-out':
      return {
        icon: 'fa-arrow-right-to-bracket',
        title: 'Connect your account',
        body: 'Comparing lists needs your AniList account connected to the extension.',
      };
    case 'self':
      return {
        icon: 'fa-user-group',
        title: 'This is you',
        body: "Open someone else's profile to compare.",
      };
    case 'unavailable':
      return {
        icon: 'fa-triangle-exclamation',
        title: 'The lists could not be loaded',
        body: 'AniList did not answer. It may be rate limiting or down, so give it a minute.',
        retry: true,
      };
  }
}

export class ProfileCompareView extends AstraView {
  private epoch = 0;
  private liquid: LiquidBackground | null = null;
  private story: WrappedStory | null = null;
  private report: CompareReport | null = null;
  private revokeTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly service: ProfileCompareService,
    private readonly profileName: string,
    private readonly media: CompareMedia,
    private readonly close: () => void
  ) {
    super({});
  }

  protected template(): HTMLElement {
    const root = html`<section
      class="astra-wrapped versus-wrapped aw-shell"
      tabindex="-1"
      role="dialog"
      aria-modal="true"
    >
      <canvas class="aw-liquid" aria-hidden="true"></canvas>
      <div class="aw-scrim" aria-hidden="true"></div>
      <div class="aw-head">
        <header class="aw-topbar">
          <button type="button" class="aw-chip" data-versus-close>
            <i class="fa-solid fa-xmark" aria-hidden="true"></i>
            <span class="aw-chip-text">Close</span>
          </button>
          <div class="aw-brand">
            <h2>Astra compare</h2>
            <p role="status" aria-live="polite" data-versus-status></p>
          </div>
          <div class="aw-actions">
            <button type="button" class="aw-chip aw-chip--solid" data-versus-export disabled>
              <i class="fa-solid fa-download" aria-hidden="true"></i>
              <span class="aw-chip-text">Download PNG</span>
            </button>
          </div>
        </header>
      </div>
      <div class="aw-stage" data-versus-results></div>
    </section>`;
    root.setAttribute('aria-label', `Comparison with ${this.profileName}`);
    return root;
  }

  protected onMount(): void {
    this.liquid = new LiquidBackground(
      this.$<HTMLCanvasElement>('.aw-liquid')!,
      this.element,
      COMPARE_LOADING_PALETTE,
      LIVE_SEED
    );
    this.element.focus({ preventScroll: true });
    void this.load();
  }

  protected onUnmount(): void {
    this.epoch++;
    this.report = null;
    this.story?.dispose();
    this.story = null;
    this.liquid?.dispose();
    this.liquid = null;
    for (const [url, timer] of this.revokeTimers) {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
    }
    this.revokeTimers.clear();
    super.onUnmount();
  }

  protected bindEvents(): void {
    this.addEventListener(this.$('[data-versus-close]')!, 'click', () => this.close());
    this.addEventListener(this.$('[data-versus-export]')!, 'click', () => this.download());
    this.addEventListener(this.$('[data-versus-results]')!, 'click', (event) => {
      if (!(event.target instanceof Element)) return;
      if (event.target.closest('[data-versus-download]')) this.download();
      else if (event.target.closest('[data-versus-retry]')) void this.load();
    });
    this.addEventListener(this.element, 'keydown', (event) => {
      const key = event as KeyboardEvent;
      if (key.key === 'Escape') {
        key.preventDefault();
        key.stopPropagation();
        this.close();
        return;
      }
      this.story?.handleKey(key);
    });
  }

  private isCurrent(epoch: number): boolean {
    return this.mounted && epoch === this.epoch;
  }

  private status(message: string): void {
    this.$('[data-versus-status]')!.textContent = message;
  }

  private showMessage({ icon, title, body, retry }: StageMessage): void {
    const card = html`<div class="aw-empty aw-glass" data-versus-message>
      <i class="${`fa-solid ${icon}`}" aria-hidden="true"></i>
      <h3>${title}</h3>
      <p>${body}</p>
    </div>`;
    if (retry)
      card.append(html`<button type="button" class="aw-cta" data-versus-retry>Try again</button>`);
    this.story?.dispose();
    this.story = null;
    this.$('[data-versus-results]')!.replaceChildren(card);
  }

  private async load(): Promise<void> {
    const epoch = ++this.epoch;
    this.report = null;
    this.$<HTMLButtonElement>('[data-versus-export]')!.disabled = true;
    this.showMessage({
      icon: 'fa-wand-magic-sparkles',
      title: `You × ${this.profileName}`,
      body: 'Reading both lists. Long lists take a moment, because AniList limits requests per minute.',
    });
    this.status('Reading both lists…');
    try {
      const data = await this.service.load(this.profileName, this.media, (progress) => {
        if (!this.isCurrent(epoch)) return;
        const owner = progress.isViewer ? 'your' : `${progress.name}'s`;
        this.status(`Reading ${owner} list · ${formatNumber(progress.loaded)} titles`);
      });
      if (!this.isCurrent(epoch)) return;
      const report = buildComparison(this.media, data.viewer,
        data.other,
        data.viewerEntries,
        data.otherEntries
      );
      if (!report.otherSeen || !report.viewerSeen) {
        this.showEmptyList(report);
        return;
      }
      this.showStory(report);
    } catch (error) {
      if (!this.isCurrent(epoch)) return;
      if (!(error instanceof CompareError)) logger.warn('[ProfileCompareView] Load failed', error);
      this.status('');
      this.showMessage(
        failureMessage(error instanceof CompareError ? error.kind : 'unavailable', this.profileName)
      );
    }
  }

  private showEmptyList(report: CompareReport): void {
    this.status('');
    const empty = report.otherSeen ? 'You have' : `${report.other.name} has`;
    this.showMessage({
      icon: 'fa-hourglass-half',
      title: 'Nothing to compare yet',
      body: `${empty} no ${report.media === 'ANIME' ? 'anime' : 'manga'} logged yet.`,
    });
  }

  private showStory(report: CompareReport): void {
    this.report = report;
    this.status(`You and ${report.other.name} · ${formatNumber(report.shared)} shared titles`);
    this.story = new WrappedStory(
      compareSlides(report, { preview: () => drawCompareImage(report) }),
      this.liquid
    );
    this.$('[data-versus-results]')!.replaceChildren(this.story.element);
    this.story.go(0);
    this.$<HTMLButtonElement>('[data-versus-export]')!.disabled = false;
  }

  private download(): void {
    const report = this.report;
    const epoch = this.epoch;
    if (!report) return;
    try {
      drawCompareImage(report).toBlob((blob) => {
        if (!this.isCurrent(epoch)) return;
        if (!blob) {
          this.status('Could not export the image. Please retry.');
          return;
        }
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `astra-compare-${report.media.toLowerCase()}-${report.other.name}.png`;
        this.element.append(anchor);
        anchor.click();
        anchor.remove();
        this.revokeTimers.set(
          url,
          setTimeout(() => {
            this.revokeTimers.delete(url);
            URL.revokeObjectURL(url);
          }, URL_REVOKE_MS)
        );
      }, 'image/png');
    } catch {
      this.status('Could not export the image. Please retry.');
    }
  }
}
