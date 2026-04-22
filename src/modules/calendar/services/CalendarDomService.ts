import { injectable } from 'tsyringe';
import { log } from '@core/logger';
import { CSS_CLASSES } from '@core/constants';
import { CalendarGrid } from '../components/CalendarGrid';

@injectable()
export class CalendarDomService {
  private containerElement: HTMLElement | null = null;
  private calendarGrid: CalendarGrid | null = null;

  /**
   * Inject the calendar into the AniList page
   */
  public async injectCalendar(
    onSettingsClick: () => void,
    onMarkWatched: (mediaId: number) => Promise<void>
  ): Promise<HTMLElement | null> {
    const headerElement = await this.findAiringSection();

    if (!headerElement) {
      log.warn('[CalendarDom] Airing section not found, cannot replace');
      return null;
    }

    // Replace header text
    const actualHeader = headerElement.tagName.toLowerCase() === 'h2' || headerElement.tagName.toLowerCase() === 'h3'
      ? headerElement
      : headerElement.querySelector<HTMLElement>('h2, h3');

    if (actualHeader) {
      actualHeader.innerHTML = 'AU - Calendar';
      actualHeader.className = 'au-calendar-title';
    }

    // Add settings button
    const parentHeader = (headerElement.closest('.section-header') || headerElement.parentElement) as HTMLElement;
    if (parentHeader) {
      this.injectSettingsButton(parentHeader, onSettingsClick);
    }

    // Find and clear container
    const container = this.findAiringContainer(headerElement);
    if (!container) {
      log.error('[CalendarDom] Container for Airing section not found');
      return null;
    }

    this.clearNativeAiringContent(container, headerElement);

    // Create and mount calendar
    const calendarContainer = document.createElement('div');
    calendarContainer.id = CSS_CLASSES.CALENDAR;
    calendarContainer.className = `${CSS_CLASSES.CONTAINER} ${CSS_CLASSES.CALENDAR}`;

    const gridContainer = document.createElement('div');
    gridContainer.className = 'calendar-grid-container';
    calendarContainer.appendChild(gridContainer);

    const sectionHeader = headerElement.closest('.section-header');
    if (sectionHeader && sectionHeader.parentNode === container) {
      container.insertBefore(calendarContainer, sectionHeader.nextSibling);
    } else {
      container.appendChild(calendarContainer);
    }

    this.containerElement = calendarContainer;
    this.calendarGrid = new CalendarGrid({ onMarkWatched });
    this.calendarGrid.mount(gridContainer);

    return calendarContainer;
  }

  private injectSettingsButton(parentHeader: HTMLElement, onClick: () => void): void {
    if (parentHeader.querySelector('.calendar-header__actions')) return;

    const actionsContainer = document.createElement('div');
    actionsContainer.className = 'calendar-header__actions';
    actionsContainer.innerHTML = `
      <button class="calendar-header__settings" title="Calendar settings">
        <i class="fa fa-cog"></i>
      </button>
    `;
    parentHeader.appendChild(actionsContainer);

    // Hide native view switchers
    parentHeader.querySelectorAll('.view-selector, .grid-icon, .list-icon, [class*="view-selector"]')
      .forEach(el => (el as HTMLElement).style.display = 'none');

    actionsContainer.querySelector('.calendar-header__settings')?.addEventListener('click', onClick);
  }

  private clearNativeAiringContent(container: HTMLElement, headerElement: HTMLElement): void {
    const sectionHeader = headerElement.closest('.section-header');
    Array.from(container.children).forEach(child => {
      if (child !== sectionHeader && child.querySelector('.section-header') !== sectionHeader) {
        child.remove();
      }
    });
  }

  public findAiringSection(): Promise<HTMLElement | null> {
    return new Promise((resolve) => {
      // Robust multi-strategy search (from original code)
      const findText = (s: string, t: string) => 
        Array.from(document.querySelectorAll<HTMLElement>(s)).filter(el => el.textContent?.trim().includes(t));

      let airing = findText('h2', 'Airing')[0] || 
                   Array.from(document.querySelectorAll<HTMLElement>('.section-header')).find(h => h.textContent?.includes('Airing')) ||
                   Array.from(document.querySelectorAll<HTMLElement>('.home section')).find(s => s.textContent?.includes('Airing'))?.querySelector<HTMLElement>('h2, h3, .section-header');

      resolve(airing || null);
    });
  }

  private findAiringContainer(headerElement: HTMLElement): HTMLElement | null {
    const sectionHeader = headerElement.closest('.section-header');
    if (sectionHeader) {
      const wrap = sectionHeader.closest('.list-preview-wrap') || sectionHeader.closest('.list-preview');
      if (wrap) return wrap as HTMLElement;
    }

    let current = headerElement.parentElement;
    for (let i = 0; i < 5 && current; i++) {
      if (current.querySelectorAll('.media-preview-card').length > 0) return current;
      current = current.parentElement;
    }
    return headerElement.closest('section') || headerElement.parentElement?.parentElement || null;
  }

  public showAuthPrompt(): void {
    if (!this.containerElement) return;
    this.containerElement.innerHTML = `
      <div class="calendar-auth-prompt">
        <div class="calendar-auth-prompt__content">
          <i class="fa fa-lock"></i>
          <h3>Authentication Required</h3>
          <p>Please log in to Anilist to use the calendar feature.</p>
          <button class="calendar-auth-prompt__btn">Log In</button>
        </div>
      </div>
    `;
    this.containerElement.querySelector('.calendar-auth-prompt__btn')?.addEventListener('click', () => {
       // Note: anilistClient call will be handled by orchestrator/AuthService
    });
  }

  public getGrid(): CalendarGrid | null { return this.calendarGrid; }

  public cleanup(): void {
    this.calendarGrid?.unmount();
    this.calendarGrid = null;
    this.containerElement?.remove();
    this.containerElement = null;
  }
}
