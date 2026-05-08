/**
 * @file CalendarDomService.ts
 * @description DOM injection and container management for the calendar UI
 *
 * Locates the AniList home page content area, injects (or re-uses)
 * the calendar container element, and delegates rendering to CalendarGrid.
 * Uses multiple fallback selectors to handle AniList DOM variations.
 *
 * @see CalendarGrid.ts for the rendered calendar component
 * @see CalendarModule.ts for the orchestration layer
 * @see docs/MODULES.md#1-calendar-module
 */

import { injectable, DependencyContainer } from 'tsyringe';
import { log } from '@core/logger';
import { CSS_CLASSES } from '@core/constants';
import { container } from '@core/di/container';
import { CalendarGrid } from '../components/CalendarGrid';

@injectable()
export class CalendarDomService {
  private containerElement: HTMLElement | null = null;
  private calendarGrid: CalendarGrid | null = null;
  /** Reference to the child container for proper disposal (BUG-FIX: Memory Leak) */
  private childContainer: DependencyContainer | null = null;

  constructor() { }

  /**
   * Inject the calendar container into the AniList DOM
   */
  public async injectCalendar(
    onSettingsClick: () => void,
    onMarkWatched: (mediaId: number) => Promise<void>,
    astraEnabled: boolean
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

    // Prepare header (re-using the native H2/H3)
    const actualHeader = headerElement.tagName.toLowerCase() === 'h2' || headerElement.tagName.toLowerCase() === 'h3'
      ? headerElement
      : headerElement.querySelector<HTMLElement>('h2, h3');

    if (actualHeader && !actualHeader.classList.contains('au-calendar-title')) {
      actualHeader.innerHTML = 'AU - Calendar';
      actualHeader.classList.add('au-calendar-title');
    }

    // Add settings buttons to the header
    const parentHeader = (headerElement.closest('.section-header') || headerElement.parentElement) as HTMLElement;
    if (parentHeader) {
      this.injectSettingsButton(parentHeader, onSettingsClick, astraEnabled);
    }

    // ATOMIC SWAP PREPARATION: Create new container first
    const calendarContainer = document.createElement('div');
    calendarContainer.id = CSS_CLASSES.CALENDAR;
    calendarContainer.className = 'anilist-calendar';

    const gridContainer = document.createElement('div');
    gridContainer.className = 'calendar-grid-container';
    calendarContainer.appendChild(gridContainer);

    // Clean up existing instance (unmount first)
    if (this.calendarGrid) {
      log.debug('[CalendarDomService] Unmounting previous grid instance');
      this.calendarGrid.unmount();
      this.calendarGrid = null;
    }

    // Find existing container in DOM to swap
    const existingContainer = document.getElementById(CSS_CLASSES.CALENDAR);

    // Ensure target container is visible (beat the hider)
    targetContainer.style.display = 'block';
    targetContainer.style.opacity = '1';
    targetContainer.style.visibility = 'visible';

    // Swap or Insert
    if (existingContainer) {
      log.debug('[CalendarDomService] Swapping existing calendar container');
      existingContainer.replaceWith(calendarContainer);
    } else {
      // Clear native content only if we are injecting for the first time
      this.clearNativeAiringContent(targetContainer, headerElement);

      const sectionHeader = headerElement.closest('.section-header');
      if (sectionHeader && sectionHeader.parentNode === targetContainer) {
        log.debug('[CalendarDomService] Inserting after section header');
        targetContainer.insertBefore(calendarContainer, sectionHeader.nextSibling);
      } else {
        log.debug('[CalendarDomService] Appending to target container');
        // Final fallback: if targetContainer is null (shouldn't happen due to check at line 46), use body
        const target = targetContainer || document.body || document.documentElement;
        if (target) target.appendChild(calendarContainer);
      }
    }

    this.containerElement = calendarContainer;

    // Resolve and mount the grid component
    try {
      // 1. Dispose of previous container to prevent memory leaks
      if (this.childContainer) {
        log.debug('[CalendarDomService] Disposing previous DI child container');
        this.childContainer.dispose();
      }

      // 2. Create new specialized child container for this render cycle
      this.childContainer = container.createChildContainer();
      this.childContainer.register('CalendarGridProps', { useValue: { onMarkWatched, astraEnabled } });
      
      this.calendarGrid = this.childContainer.resolve(CalendarGrid);
      this.calendarGrid.mount(gridContainer);
    } catch (error) {
      log.error('[CalendarDomService] Failed to initialize CalendarGrid component', error);
      calendarContainer.innerHTML = `<div class="calendar-error" style="padding: 20px; text-align: center; color: var(--au-error);">Failed to load calendar components.</div>`;
    }

    return calendarContainer;
  }

  /**
   * Inject settings and dashboard buttons into the header
   */
  private injectSettingsButton(parentHeader: HTMLElement, onSettingsClick: () => void, astraEnabled: boolean): void {
    if (parentHeader.querySelector('.calendar-header__actions')) return;

    const actionsContainer = document.createElement('div');
    actionsContainer.className = 'calendar-header__actions';
    actionsContainer.innerHTML = `
      <button class="calendar-header__settings" title="Calendar settings">
        <i class="fa fa-cog"></i>
      </button>
    `;
    if (parentHeader) {
      parentHeader.appendChild(actionsContainer);
    }

    // Hide native view switchers often present in list headers
    parentHeader.querySelectorAll('.view-selector, .grid-icon, .list-icon, [class*="view-selector"]')
      .forEach(el => (el as HTMLElement).style.display = 'none');

    // Also hide header actions if Astra is enabled
    if (astraEnabled) {
      parentHeader.classList.add('au-calendar-header-managed');
    }

    actionsContainer.querySelector('.calendar-header__settings')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onSettingsClick();
    });
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
        log.debug('[CalendarDomService] Hiding native grid element');
        (child as HTMLElement).style.display = 'none';
      } else if (container.classList.contains('list-preview-wrap') || container.tagName === 'SECTION') {
        // If we are in a wrap or section, be more aggressive but careful
        log.debug('[CalendarDomService] Hiding non-header child from section');
        (child as HTMLElement).style.display = 'none';
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

      let airing = findText('h2', 'Airing')[0] ||
        findText('h2', 'AU - Calendar')[0] ||
        findText('.au-calendar-title', 'AU - Calendar')[0] ||
        Array.from(document.querySelectorAll<HTMLElement>('.section-header')).find(h => h.textContent?.includes('Airing') || h.textContent?.includes('AU - Calendar')) ||
        Array.from(document.querySelectorAll<HTMLElement>('.home section')).find(s => s.textContent?.includes('Airing') || s.textContent?.includes('AU - Calendar'))?.querySelector<HTMLElement>('h2, h3, .section-header');

      // If AniList didn't render an Airing section (e.g., user has no airing anime), create one
      if (!airing) {
        // Prevent creating multiple artificial sections
        const existingArtificial = document.querySelector('[data-au-artificial="true"]');
        if (existingArtificial) {
          resolve(existingArtificial.querySelector('h2') as HTMLElement || null);
          return;
        }

        log.info('[CalendarDomService] Native Airing section not found, creating a new container');
        const homeContainer = document.querySelector('.home');
        if (homeContainer) {
          const newSection = document.createElement('div');
          newSection.className = 'list-preview-wrap au-artificial-section';
          newSection.setAttribute('data-au-artificial', 'true');
          newSection.style.marginBottom = '40px';
          newSection.innerHTML = `<div class="section-header"><h2>Airing</h2></div>`;
          homeContainer.insertBefore(newSection, homeContainer.firstChild);
          airing = newSection.querySelector('h2') as HTMLElement;
        }
      }

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

  /**
   * Aggressively mask native "Airing" sections to prevent duplication with the AU Calendar.
   */
  public maskNativeSections(): void {
    const path = window.location.pathname;
    if (path !== '/' && path !== '/home') return;
    
    const calendarExists = !!document.querySelector(`#${CSS_CLASSES.CALENDAR}`);
    if (!calendarExists) return;

    const headers = Array.from(document.querySelectorAll('h2, h3, .section-header'));
    headers.forEach(h => {
      const text = h.textContent?.trim().toLowerCase() || '';
      if (text === 'airing' && !h.classList.contains('au-calendar-title') && !h.hasAttribute('data-au-artificial')) {
        const section = h.closest('section') || h.closest('.list-preview-wrap') || h.closest('.list-preview') || h.parentElement;
        if (section && !(section as HTMLElement).classList.contains('au-native-airing-hidden')) {
          const el = section as HTMLElement;
          // Check if this section ALREADY contains our calendar (don't hide our own)
          if (el.contains(document.getElementById(CSS_CLASSES.CALENDAR))) return;
          
          // AGGRESSIVE HIDING
          el.style.display = 'none';
          el.style.visibility = 'hidden';
          el.style.height = '0';
          el.style.overflow = 'hidden';
          el.classList.add('au-native-airing-hidden');
          log.debug('[CalendarDomService] Native airing section HIDDEN');
        }
      }
    });
  }

  public showAuthPrompt(onLoginClick: () => void): void {
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

    // Aggiungi event listener al bottone
    const loginBtn = this.containerElement.querySelector('.calendar-auth-prompt__btn');
    if (loginBtn) {
      loginBtn.addEventListener('click', () => {
        log.info('[CalendarDom] Login button clicked');
        onLoginClick();
      });
    }
  }

  public getGrid(): CalendarGrid | null { return this.calendarGrid; }
  
  /**
   * Force the current grid instance to refresh itself
   */
  public refreshGrid(): void {
    if (this.calendarGrid) {
      log.info('[CalendarDomService] Manually refreshing grid instance');
      this.calendarGrid.refresh();
    }
  }

  public cleanup(): void {
    this.calendarGrid?.unmount();
    this.calendarGrid = null;

    if (this.childContainer) {
      log.debug('[CalendarDomService] Disposing child container during cleanup');
      this.childContainer.dispose();
      this.childContainer = null;
    }

    this.containerElement?.remove();
    this.containerElement = null;
  }
}
