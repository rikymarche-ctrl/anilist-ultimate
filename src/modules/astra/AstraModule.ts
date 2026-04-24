import { injectable, inject } from 'tsyringe';
import { BaseModule } from '@core/modules/BaseModule';
import { log } from '@core/logger';
import { TOKENS } from '@core/di/tokens';
import { container } from '@core/di/container';
import { AstraService } from './AstraService';
import { AstraDashboard } from './ui/AstraDashboard';

@injectable()
export class AstraModule extends BaseModule {
  constructor(
    @inject(TOKENS.AstraService) private service: AstraService,
    @inject(TOKENS.AstraDashboard) private dashboard: AstraDashboard
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
}
