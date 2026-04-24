import { injectable, inject } from 'tsyringe';
import { BaseModule } from '@core/modules/BaseModule';
import { log } from '@core/logger';
import { TOKENS } from '@core/di/tokens';
import { container } from '@core/di/container';
import { AstraService } from './AstraService';
import { AstraDashboard } from './ui/AstraDashboard';
import { calendarStore } from '../calendar/CalendarStore';

@injectable()
export class AstraModule extends BaseModule {
  constructor(
    @inject(TOKENS.AstraService) private service: AstraService,
    @inject(TOKENS.AstraDashboard) private dashboard: AstraDashboard,
    @inject(TOKENS.ApiClient) private apiClient: any,
    @inject(TOKENS.ToastService) private toast: any
  ) {
    super();
  }

  public async init(): Promise<void> {
    log.group('Astra Module Initialization');
    
    // Do not await service init to avoid blocking other modules (like Calendar)
    this.service.init().then(() => {
      log.success('[Astra] Service data loaded');
    });

    this.onPageChange(async (event) => {
      const path = event?.path || window.location.pathname;
      
      // Handle Profile Injection
      if (path.match(/\/user\/[^\/]+\/$/) || path.match(/\/user\/[^\/]+\/animelist/) || path.match(/\/user\/[^\/]+\/astra/)) {
        this.injectAstraTab();
      }

      // Handle Astra Dashboard Rendering
      if (path.includes('/astra')) {
        this.renderDashboard();
      }
    });

    // Listen for global open event (from Calendar or other modules)
    const eventBus = container.resolve<any>(TOKENS.EventBus);
    eventBus.on('astra:open', () => {
      this.dashboard.open();
    });

    log.success('[Astra] Module initialized');
    
    // Initialize Progress Enhancer for home page cards
    this.initProgressEnhancer();

    log.groupEnd();
  }

  private injectAstraTab(): void {

    const nav = document.querySelector('.user .nav');
    if (!nav || nav.querySelector('.astra-tab')) return;

    const username = window.location.pathname.split('/')[2];
    const astraLink = document.createElement('a');
    astraLink.className = 'link astra-tab';
    astraLink.href = `/user/${username}/astra`;
    astraLink.innerText = 'Astra';
    
    // Add active class if we are on the astra page
    if (window.location.pathname.includes('/astra')) {
      astraLink.classList.add('router-link-exact-active', 'router-link-active');
      // Hide standard content
      const content = document.querySelector('.user .content');
      if (content) (content as HTMLElement).style.display = 'none';
    }

    nav.appendChild(astraLink);
  }

  private renderDashboard(): void {
    const container = document.querySelector('.user .content');
    if (!container) return;

    // Clear existing content for the custom view
    container.innerHTML = '';
    (container as HTMLElement).style.display = 'block';

    const dashboard = new AstraDashboard();
    dashboard.mount(container as HTMLElement);
  }

  public getName(): string {
    return 'astra';
  }

  private initProgressEnhancer(): void {
    const observerName = 'astra-progress-enhancer';
    
    // Register observer to handle dynamically loaded cards (lazy loading/scroll)
    this.registerObserver(observerName, document.body, { childList: true, subtree: true }, () => {
      this.enhanceNativeCards();
    });

    // Initial run
    this.enhanceNativeCards();
  }

  private enhanceNativeCards(): void {
    // Only enhance on home page or user lists
    const path = window.location.pathname;
    const isHome = path === '/' || path === '/home';
    const isUserList = path.includes('/animelist') || path.includes('/mangalist');
    
    if (!isHome && !isUserList) return;

    const cards = document.querySelectorAll('.media-preview-card, .media-card');
    cards.forEach(card => {
      if (card.querySelector('.au-pill-wrapper') || card.hasAttribute('data-astra-processed')) return;
      card.setAttribute('data-astra-processed', 'true');

      // Extract media ID from link
      const link = card.querySelector('a.cover')?.getAttribute('href') || (card as HTMLAnchorElement).href;
      if (!link) return;

      const match = link.match(/\/(anime|manga)\/(\d+)/);
      if (!match) return;

      const mediaId = parseInt(match[2]);

      // Check Social Rules (same as Calendar)
      const { socialEnabled, socialShowAvatars } = calendarStore.getState().preferences;
      const showPillSocial = socialEnabled && !socialShowAvatars;

      const socialSectionHTML = showPillSocial ? `
        <div class="pill-separator"></div>
        <div class="pill-section" data-action="social-activity" title="Social Activity">
          <i class="fa fa-users"></i>
        </div>
      ` : '';

      // Find cover container for injection
      const cover = card.querySelector('.cover') || card.querySelector('.image');
      if (!cover) return;

      const wrapper = document.createElement('div');
      wrapper.className = 'au-pill-wrapper';
      wrapper.innerHTML = `
        <div class="action-pill" style="${showPillSocial ? 'width: 130px;' : ''}">
          <div class="pill-section" data-action="mark-watched" title="Increment Progress">
            <i class="fa fa-plus"></i>
          </div>
          <div class="pill-separator"></div>
          <div class="pill-section" data-action="edit-entry" title="Quick Rate (Astra)">
            <i class="fa fa-pencil"></i>
          </div>
          ${socialSectionHTML}
        </div>
      `;

      cover.appendChild(wrapper);

      // Attach Event Handlers
      const markWatched = wrapper.querySelector('[data-action="mark-watched"]');
      const editEntry = wrapper.querySelector('[data-action="edit-entry"]');
      const socialBtn = wrapper.querySelector('[data-action="social-activity"]');

      markWatched?.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        const icon = markWatched.querySelector('i');
        if (icon) {
          icon.className = 'fa fa-spinner fa-spin';
          (markWatched as HTMLElement).style.pointerEvents = 'none';
        }

        try {
          const userId = await this.apiClient.getCurrentUserId();
          
          // Fetch current progress
          const data = await this.apiClient.query(`
            query ($mediaId: Int, $userId: Int) {
              MediaList(mediaId: $mediaId, userId: $userId) {
                id
                progress
                media { title { romaji } }
              }
            }
          `, { mediaId, userId });

          if (data?.MediaList) {
            const entry = data.MediaList;
            const newProgress = entry.progress + 1;
            
            await this.apiClient.mutate(`
              mutation ($id: Int, $progress: Int) {
                SaveMediaListEntry(id: $id, progress: $progress) {
                  id
                  progress
                }
              }
            `, { id: entry.id, progress: newProgress });
            
            this.toast.success(`Updated ${entry.media.title.romaji} to Ep ${newProgress}`);
            
            // 3. Update the native UI text robustly
            // Strategy A: Look for .progress element (standard on some pages)
            const progressEl = card.querySelector('.progress');
            if (progressEl) {
              progressEl.textContent = `${newProgress}`;
            }

            // Strategy B: Look for "Progress: X/Y" text nodes (common on home page)
            // We look for the parent of the native plus button or just scan .info
            const infoContainer = card.querySelector('.info');
            if (infoContainer) {
              const html = infoContainer.innerHTML;
              if (html.includes('Progress:')) {
                // Regex to find "Progress: [number]" and replace with new progress
                // We use a group to capture the possible "/" part too
                infoContainer.innerHTML = html.replace(/Progress: (\d+)/, `Progress: ${newProgress}`);
              }
            }
          }
        } catch (err) {
          log.error('[Astra] Failed to increment progress', err);
          this.toast.error('Failed to update progress');
        } finally {
          if (icon) {
            icon.className = 'fa fa-plus';
            (markWatched as HTMLElement).style.pointerEvents = 'auto';
          }
        }
      });

      editEntry?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const modal = container.resolve<any>(TOKENS.AstraRatingModal);
        modal.open(mediaId);
      });

      socialBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        const titleEl = card.querySelector('.title');
        const title = titleEl ? titleEl.textContent?.trim() || 'Anime' : 'Anime';

        window.dispatchEvent(new CustomEvent('au-open-social-sidebar', {
          detail: { mediaId, title, element: card }
        }));
      });
    });
  }
}
