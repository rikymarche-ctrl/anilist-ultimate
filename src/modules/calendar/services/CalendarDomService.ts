import { injectable } from 'tsyringe';
import { log } from '@core/logger';
import { CSS_CLASSES } from '@core/constants';
import { container } from '@core/di/container';
import { CalendarGrid } from '../components/CalendarGrid';

@injectable()
export class CalendarDomService {
  private containerElement: HTMLElement | null = null;
  private calendarGrid: CalendarGrid | null = null;

  /**
   * Inject the calendar container into the AniList DOM
   */
  public async injectCalendar(
    onSettingsClick: () => void,
    onAstraClick: () => void,
    onMarkWatched: (mediaId: number) => Promise<void>
  ): Promise<HTMLElement | null> {
    log.debug('[CalendarDomService] Starting injection flow...');

    const headerElement = await this.findAiringSection();
    if (!headerElement) {
      log.warn('[CalendarDomService] Native Airing section not found in DOM');
      return null;
    }

    const targetContainer = this.findAiringContainer(headerElement);
    if (!targetContainer) {
      log.warn('[CalendarDomService] Could not find a suitable container for the calendar');
      return null;
    }

    log.info('[CalendarDomService] Found target container', {
      tag: targetContainer.tagName,
      id: targetContainer.id,
      classes: targetContainer.className
    });

    // Clean up existing instance if any
    if (this.calendarGrid) {
      log.debug('[CalendarDomService] Unmounting previous grid instance');
      this.calendarGrid.unmount();
      this.calendarGrid = null;
    }

    // Prepare header (re-using the native H2/H3)
    const actualHeader = headerElement.tagName.toLowerCase() === 'h2' || headerElement.tagName.toLowerCase() === 'h3'
      ? headerElement
      : headerElement.querySelector<HTMLElement>('h2, h3');
    
    if (actualHeader) {
      actualHeader.innerHTML = 'AU - Calendar';
      actualHeader.className = 'au-calendar-title';
    }

    // Add settings buttons to the header
    const parentHeader = (headerElement.closest('.section-header') || headerElement.parentElement) as HTMLElement;
    if (parentHeader) {
      this.injectSettingsButton(parentHeader, onSettingsClick, onAstraClick);
    }

    // Clear native content from the container
    this.clearNativeAiringContent(targetContainer, headerElement);

    // Create our calendar wrapper
    const calendarContainer = document.createElement('div');
    calendarContainer.id = CSS_CLASSES.CALENDAR;
    calendarContainer.className = 'anilist-calendar';

    // Grid container where components will mount
    const gridContainer = document.createElement('div');
    gridContainer.className = 'calendar-grid-container';
    calendarContainer.appendChild(gridContainer);

    // Insert into DOM
    const sectionHeader = headerElement.closest('.section-header');
    if (sectionHeader && sectionHeader.parentNode === targetContainer) {
      log.debug('[CalendarDomService] Inserting after section header');
      targetContainer.insertBefore(calendarContainer, sectionHeader.nextSibling);
    } else {
      log.debug('[CalendarDomService] Appending to target container');
      targetContainer.appendChild(calendarContainer);
    }

    this.containerElement = calendarContainer;
    
    // Resolve and mount the grid component
    try {
      log.debug('[CalendarDomService] Resolving CalendarGrid from child container');
      const child = container.createChildContainer();
      child.register('CalendarGridProps', { useValue: { onMarkWatched } });
      this.calendarGrid = child.resolve(CalendarGrid);
      
      log.debug('[CalendarDomService] Mounting CalendarGrid');
      this.calendarGrid.mount(gridContainer);
    } catch (error) {
      log.error('[CalendarDomService] Failed to initialize CalendarGrid component', error);
      calendarContainer.innerHTML = `<div class="calendar-error" style="padding: 20px; text-align: center; color: var(--au-error);">Failed to load calendar components. Check console for details.</div>`;
    }

    return calendarContainer;
  }

  /**
   * Inject settings and dashboard buttons into the header
   */
  private injectSettingsButton(parentHeader: HTMLElement, onSettingsClick: () => void, onAstraClick: () => void): void {
    if (parentHeader.querySelector('.calendar-header__actions')) return;

    const actionsContainer = document.createElement('div');
    actionsContainer.className = 'calendar-header__actions';
    actionsContainer.innerHTML = `
      <button class="calendar-header__settings calendar-header__astra" title="Astra Dashboard">
        <svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" style="width: 16px; height: 16px;">
          <path d="M12 4L4 20H8L12 12L16 20H20L12 4Z" />
        </svg>
      </button>
      <button class="calendar-header__settings" title="Calendar settings">
        <i class="fa fa-cog"></i>
      </button>
    `;
    parentHeader.appendChild(actionsContainer);

    // Hide native view switchers often present in list headers
    parentHeader.querySelectorAll('.view-selector, .grid-icon, .list-icon, [class*="view-selector"]')
      .forEach(el => (el as HTMLElement).style.display = 'none');

    actionsContainer.querySelector('.calendar-header__settings:not(.calendar-header__astra)')?.addEventListener('click', onSettingsClick);
    actionsContainer.querySelector('.calendar-header__astra')?.addEventListener('click', onAstraClick);
  }

  /**
   * Remove native AniList airing grid content
   */
  private clearNativeAiringContent(container: HTMLElement, headerElement: HTMLElement): void {
    const sectionHeader = headerElement.closest('.section-header');
    
    log.debug('[CalendarDomService] Clearing native content from container', {
      childCount: container.children.length
    });

    Array.from(container.children).forEach(child => {
      // Don't remove the section header
      if (child === sectionHeader || child.querySelector('.section-header') === sectionHeader) {
        return;
      }
      
      // Don't remove our own calendar if it was already there
      if ((child as HTMLElement).id === CSS_CLASSES.CALENDAR) {
        return;
      }

      // Check if it's a native card grid or list
      const isNativeGrid = child.classList.contains('grid-wrap') || 
                           child.classList.contains('list-preview') ||
                           child.querySelectorAll('.media-preview-card').length > 0;
      
      if (isNativeGrid) {
        log.debug('[CalendarDomService] Removing native grid element');
        child.remove();
      } else if (container.classList.contains('list-preview-wrap') || container.tagName === 'SECTION') {
        // If we are in a wrap or section, be more aggressive but careful
        log.debug('[CalendarDomService] Removing non-header child from section');
        child.remove();
      }
    });
  }

  /**
   * Find the "Airing" section header on the home page
   */
  public findAiringSection(): Promise<HTMLElement | null> {
    return new Promise((resolve) => {
      const findText = (s: string, t: string) => 
        Array.from(document.querySelectorAll<HTMLElement>(s)).filter(el => el.textContent?.trim().includes(t));

      const airing = findText('h2', 'Airing')[0] || 
                   Array.from(document.querySelectorAll<HTMLElement>('.section-header')).find(h => h.textContent?.includes('Airing')) ||
                   Array.from(document.querySelectorAll<HTMLElement>('.home section')).find(s => s.textContent?.includes('Airing'))?.querySelector<HTMLElement>('h2, h3, .section-header');

      resolve(airing || null);
    });
  }

  /**
   * Find the container element that holds the airing grid
   */
  private findAiringContainer(headerElement: HTMLElement): HTMLElement | null {
    const sectionHeader = headerElement.closest('.section-header');
    
    // Strategy 1: Look for the list wrapper (most common)
    if (sectionHeader) {
      const wrap = sectionHeader.closest('.list-preview-wrap') || sectionHeader.closest('.list-preview');
      if (wrap) return wrap as HTMLElement;
      
      // Strategy 2: Use the parent of the header if it looks like a section
      const parent = sectionHeader.parentElement;
      if (parent && (parent.tagName === 'SECTION' || parent.classList.contains('home'))) {
        return parent;
      }
    }

    // Strategy 3: Ancestor with cards
    let current = headerElement.parentElement;
    for (let i = 0; i < 5 && current; i++) {
      if (current.querySelectorAll('.media-preview-card').length > 0) return current;
      current = current.parentElement;
    }

    // Strategy 4: Closest section
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
  }

  public getGrid(): CalendarGrid | null { return this.calendarGrid; }

  public cleanup(): void {
    this.calendarGrid?.unmount();
    this.calendarGrid = null;
    this.containerElement?.remove();
    this.containerElement = null;
  }
}
