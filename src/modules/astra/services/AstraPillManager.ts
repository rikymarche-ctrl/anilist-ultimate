import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import { AstraService } from '../AstraService';
import { AstraRatingModal } from '../ui/AstraRatingModal';
import type { ToastService } from '@core/services/ToastService';
import { logger } from '@core/logger';
import type { IConfigManager } from '@core/interfaces/IConfigManager';
import { openNativeListEditor } from '@core/navigation/NativeListEditor';

/**
 * Manager responsible for global click delegation of Astra UI elements (pills).
 */
@injectable()
export class AstraPillManager {
  private clickListener: ((e: MouseEvent) => void) | null = null;

  constructor(
    @inject(AstraService) private service: AstraService,
    @inject(AstraRatingModal) private ratingModal: AstraRatingModal,
    @inject(TOKENS.ToastService) private toast: ToastService,
    @inject(TOKENS.Config) private config: IConfigManager,
  ) {}

  /**
   * Starts the global click listener for pills.
   */
  public start(): void {
    if (this.clickListener) return;

    this.clickListener = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const section = target?.closest<HTMLElement>('[data-action]');
      const wrapper = section?.closest<HTMLElement>('.au-pill-wrapper');

      if (!section || !wrapper) return;

      // Defensive: never treat a click as a pill action if the pill ended up inside
      // the navbar or live-search dropdown. Pills shouldn't be injected there (see
      // AstraEnhancementService), but if a stray one slips through we must not hijack
      // a click meant to open a search result and pop the quick-edit instead.
      if (wrapper.closest('.nav, nav, [role="search"]')) {
        return;
      }

      const mediaId = parseInt(wrapper.getAttribute('data-au-media-id') || '0', 10);
      const action = section.getAttribute('data-action');
      if (!mediaId || !action) return;

      e.preventDefault();
      e.stopImmediatePropagation();

      void this.handleAction(section, mediaId, action).catch((error: unknown) =>
        logger.error('[AstraPillManager] Pill action failed', error)
      );
    };

    window.addEventListener('click', this.clickListener, { capture: true });
    logger.debug('[Astra] Pill Manager started');
  }

  /**
   * Stops the global click listener.
   */
  public stop(): void {
    if (this.clickListener) {
      window.removeEventListener('click', this.clickListener, { capture: true });
      this.clickListener = null;
    }
  }

  /**
   * Routes pill actions to handlers.
   */
  private async handleAction(section: HTMLElement, mediaId: number, action: string): Promise<void> {
    section.classList.add('au-pill-pressed');
    setTimeout(() => section.classList.remove('au-pill-pressed'), 300);

    logger.info(`[Astra] Pill action triggered: ${action} for media ${mediaId}`);

    if (action === 'mark-watched') {
      try {
        const result = await this.service.incrementProgress(mediaId);
        if (result) {
          this.toast.success(`✓ ${result.title} → Ep ${result.progress}`, {
            mediaId: result.mediaId,
            progress: result.progress,
          });
        }
      } catch (err) {
        const message = typeof err === 'object' && err !== null && 'message' in err
          && typeof err.message === 'string' && err.message
          ? err.message : 'Failed to update progress';
        this.toast.error(message);
      }
    } else if (action === 'edit-entry') {
      if (this.config.isFeatureEnabled('astra')) await this.ratingModal.open(mediaId);
      else {
        try { openNativeListEditor(mediaId); }
        catch { this.toast.error('AniList editor is unavailable. Reload the page and try again.'); }
      }
    } else if (action === 'social-activity') {
      const card = section.closest<HTMLElement>('.au-astra-card');
      const title = card?.querySelector('.title')?.textContent?.trim() || 'Media';
      // The card's own AniList link is the only reliable source of the media type.
      const href = card?.querySelector<HTMLAnchorElement>('a[href*="/anime/"], a[href*="/manga/"]')?.getAttribute('href') ?? '';
      const type = href.includes('/manga/') ? 'MANGA' : 'ANIME';
      window.dispatchEvent(new CustomEvent('au-open-social-sidebar', {
        detail: { mediaId, title, element: card, type }
      }));
    }
  }
}
