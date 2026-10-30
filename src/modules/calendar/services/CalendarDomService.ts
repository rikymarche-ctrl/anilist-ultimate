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

import { injectable, inject } from 'tsyringe';
import type { DependencyContainer } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import { logger } from '@core/logger';
import { CSS_CLASSES } from '@core/constants';
import { container } from '@core/di/container';
import { CalendarGrid } from '../components/CalendarGrid';
import { CalendarAuthPrompt } from '../components/CalendarAuthPrompt';

@injectable()
export class CalendarDomService {
  private generation = 0;
  private containerElement: HTMLElement | null = null;
  private calendarGrid: CalendarGrid | null = null;
  /** Reference to the child container for proper disposal (BUG-FIX: Memory Leak) */
  private childContainer: DependencyContainer | null = null;
  private headerActionsCleanup: (() => void) | null = null;
  private promptCleanup: (() => void) | null = null;
  private headerTitles = new Map<HTMLElement, Node[]>();
  private artificialSection: HTMLElement | null = null;
  private nativeStyles = new Map<HTMLElement, Map<string, { value: string; priority: string; assigned: string }>>();
  private nativeClasses = new Map<HTMLElement, Set<string>>();

  constructor(@inject(TOKENS.ComponentScope) private scope: DependencyContainer = container) {}

  /**
   * Inject the calendar container into the AniList DOM
   */
  public async injectCalendar(
    onSettingsClick: () => void,
    onMarkWatched: (mediaId: number) => Promise<void>,
    astraEnabled: boolean,
    isCurrent: () => boolean = () => true,
    onRetry?: () => Promise<void>,
    onAddPersonalPlan?: () => void,
    onManagePersonalPlan?: (mediaId: number) => void
  ): Promise<HTMLElement | null> {
    const generation = this.generation;
    if (!isCurrent()) return null;
    logger.debug('[CalendarDomService] Starting injection flow...');

    const headerElement = await this.findAiringSection();
    if (generation !== this.generation || !isCurrent()) return null;
    if (!headerElement) {
      logger.warn('[CalendarDomService] Native Airing section not found in DOM');
      return null;
    }

    if (!headerElement.isConnected) return null;
    const targetContainer = this.findAiringContainer(headerElement);
    if (!targetContainer) {
      logger.warn('[CalendarDomService] Could not find a suitable container for the calendar');
      return null;
    }

    logger.info('[CalendarDomService] Found target container', {
      tag: targetContainer.tagName,
      id: targetContainer.id,
      classes: targetContainer.className
    });

    // Prepare header (re-using the native H2/H3)
    const actualHeader = headerElement.tagName.toLowerCase() === 'h2' || headerElement.tagName.toLowerCase() === 'h3'
      ? headerElement
      : headerElement.querySelector<HTMLElement>('h2, h3');

    if (actualHeader && !actualHeader.classList.contains('au-calendar-title')) {
      this.headerTitles.set(actualHeader, [...actualHeader.childNodes]);
      actualHeader.textContent = 'AU - Calendar';
      this.addNativeClass(actualHeader, 'au-calendar-title');
    }

    // Add settings buttons to the header
    const parentHeader = (headerElement.closest('.section-header') || headerElement.parentElement) as HTMLElement;
    if (parentHeader) {
      this.injectSettingsButton(parentHeader, onSettingsClick, astraEnabled, onAddPersonalPlan);
    }

    // ATOMIC SWAP PREPARATION: Create new container first
    const calendarContainer = document.createElement('div');
    calendarContainer.id = CSS_CLASSES.CALENDAR;
    calendarContainer.className = 'anilist-calendar';

    const gridContainer = document.createElement('div');
    gridContainer.className = 'calendar-grid-container';
    calendarContainer.appendChild(gridContainer);

    this.releaseGrid();
    this.promptCleanup?.(); this.promptCleanup = null;

    // Find existing container in DOM to swap
    const existingContainer = document.getElementById(CSS_CLASSES.CALENDAR);

    // Ensure target container is visible (beat the hider)
    this.setNativeStyle(targetContainer, 'display', 'block');
    this.setNativeStyle(targetContainer, 'opacity', '1');
    this.setNativeStyle(targetContainer, 'visibility', 'visible');

    // Swap or Insert
    if (existingContainer) {
      logger.debug('[CalendarDomService] Swapping existing calendar container');
      existingContainer.replaceWith(calendarContainer);
    } else {
      // Clear native content only if we are injecting for the first time
      this.clearNativeAiringContent(targetContainer, headerElement);

      const sectionHeader = headerElement.closest('.section-header');
      if (sectionHeader && sectionHeader.parentNode === targetContainer) {
        logger.debug('[CalendarDomService] Inserting after section header');
        targetContainer.insertBefore(calendarContainer, sectionHeader.nextSibling);
      } else {
        logger.debug('[CalendarDomService] Appending to target container');
        // Final fallback: if targetContainer is null (shouldn't happen due to check at line 46), use body
        const target = targetContainer || document.body || document.documentElement;
        if (target) target.appendChild(calendarContainer);
      }
    }

    this.containerElement = calendarContainer;

    // Resolve and mount the grid component
    try {
      // 2. Create new specialized child container for this render cycle
      this.childContainer = this.scope.createChildContainer();
      this.childContainer.register('CalendarGridProps', { useValue: { onMarkWatched, astraEnabled, onRetry, onManagePersonalPlan } });
      
      this.calendarGrid = this.childContainer.resolve(CalendarGrid);
      this.calendarGrid.mount(gridContainer);
    } catch (error) {
      logger.error('[CalendarDomService] Failed to initialize CalendarGrid component', error);
      calendarContainer.innerHTML = `<div class="calendar-error" style="padding: 20px; text-align: center; color: var(--au-error);">Failed to load calendar components.</div>`;
    }

    return calendarContainer;
  }

  /**
   * Inject settings and dashboard buttons into the header
   */
  private injectSettingsButton(parentHeader: HTMLElement, onSettingsClick: () => void, astraEnabled: boolean, onAddPersonalPlan?: () => void): void {
    this.headerActionsCleanup?.(); this.headerActionsCleanup = null;
    if (parentHeader.querySelector('.calendar-header__actions')) return;

    const actionsContainer = document.createElement('div');
    actionsContainer.className = 'calendar-header__actions';
    actionsContainer.innerHTML = `
      <button type="button" class="calendar-header__size" hidden></button>
      <button type="button" class="calendar-header__add" title="Add a title to the calendar" aria-label="Add a title to the calendar">
        <i class="fa-solid fa-plus" aria-hidden="true"></i>
      </button>
      <button type="button" class="calendar-header__settings" title="Calendar settings" aria-label="Calendar settings">
        <i class="fa-solid fa-gear"></i>
      </button>
    `;
    if (parentHeader) {
      parentHeader.appendChild(actionsContainer);
    }

    // Hide native view switchers often present in list headers
    parentHeader.querySelectorAll('.view-selector, .grid-icon, .list-icon, [class*="view-selector"]')
      .forEach(el => this.setNativeStyle(el as HTMLElement, 'display', 'none'));

    // Also hide header actions if Astra is enabled
    if (astraEnabled) {
      this.addNativeClass(parentHeader, 'au-calendar-header-managed');
    } else if (this.nativeClasses.get(parentHeader)?.delete('au-calendar-header-managed')) {
      parentHeader.classList.remove('au-calendar-header-managed');
    }

    const button = actionsContainer.querySelector<HTMLButtonElement>('.calendar-header__settings')!;
    const addButton = actionsContainer.querySelector<HTMLButtonElement>('.calendar-header__add')!;
    addButton.disabled = !onAddPersonalPlan;
    if (addButton.disabled) addButton.title = 'Sign in to add personal calendar plans';
    const click = (event: MouseEvent) => {
      if (!actionsContainer.isConnected || !parentHeader.contains(actionsContainer)) return;
      event.preventDefault(); event.stopPropagation(); onSettingsClick();
    };
    button.addEventListener('click', click);
    const addClick = (event: MouseEvent) => {
      if (!actionsContainer.isConnected || !parentHeader.contains(actionsContainer)) return;
      event.preventDefault(); event.stopPropagation(); onAddPersonalPlan?.();
    };
    addButton.addEventListener('click', addClick);
    const sizeCleanup = this.wireSizeToggle(parentHeader, actionsContainer);
    this.headerActionsCleanup = () => { button.removeEventListener('click', click); addButton.removeEventListener('click', addClick); sizeCleanup(); actionsContainer.remove(); };
  }

  /**
   * AniList's own expand/compress control moves the section between the side column and full width.
   * The managed header hides it, so a matching button forwards clicks to it. The native control stays
   * the single source of truth: its icon tells the current size, and AniList saves the choice.
   */
  private wireSizeToggle(parentHeader: HTMLElement, actions: HTMLElement): () => void {
    const button = actions.querySelector<HTMLButtonElement>('.calendar-header__size')!;
    const native = (): SVGElement | null => parentHeader.querySelector<SVGElement>('.size-toggle');
    const sync = () => {
      const toggle = native();
      button.hidden = !toggle;
      const compress = toggle?.getAttribute('data-icon') === 'compress';
      const label = compress ? 'Show the calendar in the side column' : 'Show the calendar at full width';
      button.title = label;
      button.setAttribute('aria-label', label);
      // AniList's own icon, copied: same shape as the native control in either state.
      const icon = toggle?.cloneNode(true) as SVGElement | undefined;
      icon?.classList.remove('size-toggle');
      icon?.setAttribute('aria-hidden', 'true');
      button.replaceChildren(...(icon ? [icon] : []));
    };
    const click = (event: MouseEvent) => {
      event.preventDefault(); event.stopPropagation();
      native()?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      sync();
    };
    sync();
    button.addEventListener('click', click);
    return () => button.removeEventListener('click', click);
  }

  /**
   * Remove native AniList airing grid content
   */
  private clearNativeAiringContent(container: HTMLElement, headerElement: HTMLElement): void {
    const sectionHeader = headerElement.closest('.section-header');

    logger.debug('[CalendarDomService] Clearing native content from container', {
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
        logger.debug('[CalendarDomService] Hiding native grid element');
        this.setNativeStyle(child as HTMLElement, 'display', 'none');
      } else if (container.classList.contains('list-preview-wrap') || container.tagName === 'SECTION') {
        // If we are in a wrap or section, be more aggressive but careful
        logger.debug('[CalendarDomService] Hiding non-header child from section');
        this.setNativeStyle(child as HTMLElement, 'display', 'none');
      }
    });
  }

  /**
   * Find the "Airing" section header on the home page
   */
  public findAiringSection(): Promise<HTMLElement | null> {
    if (!['/', '/home'].includes(window.location.pathname)) return Promise.resolve(null);
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

        logger.info('[CalendarDomService] Native Airing section not found, creating a new container');
        const homeContainer = document.querySelector('.home');
        if (homeContainer) {
          const newSection = document.createElement('div');
          newSection.className = 'list-preview-wrap au-artificial-section';
          newSection.setAttribute('data-au-artificial', 'true');
          newSection.style.marginBottom = '40px';
          newSection.innerHTML = `<div class="section-header"><h2>Airing</h2></div>`;
          this.artificialSection = newSection;
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
          this.setNativeStyle(el, 'display', 'none');
          this.setNativeStyle(el, 'visibility', 'hidden');
          this.setNativeStyle(el, 'height', '0px');
          this.setNativeStyle(el, 'overflow', 'hidden');
          this.addNativeClass(el, 'au-native-airing-hidden');
          logger.debug('[CalendarDomService] Native airing section HIDDEN');
        }
      }
    });
  }

  public showAuthPrompt(onLoginClick: () => void | Promise<void>): void {
    if (!this.containerElement) return;
    this.releaseGrid(); this.promptCleanup?.(); this.promptCleanup = null;
    this.containerElement.replaceChildren();
    const prompt = new CalendarAuthPrompt({ onLogin: onLoginClick });
    prompt.mount(this.containerElement);
    this.promptCleanup = () => prompt.unmount();
  }

  public getGrid(): CalendarGrid | null { return this.calendarGrid; }
  
  /**
   * Force the current grid instance to refresh itself
   */
  public refreshGrid(): void {
    if (this.calendarGrid) {
      logger.info('[CalendarDomService] Manually refreshing grid instance');
      this.calendarGrid.refresh();
    }
  }

  private setNativeStyle(element: HTMLElement, property: string, assigned: string): void {
    let changes = this.nativeStyles.get(element);
    if (!changes) { changes = new Map(); this.nativeStyles.set(element, changes); }
    const original = changes.get(property);
    const current = element.style.getPropertyValue(property);
    const priority = element.style.getPropertyPriority(property);
    const owned = original && current === original.assigned && priority === '';
    changes.set(property, { value: owned ? original.value : current, priority: owned ? original.priority : priority, assigned });
    element.style.setProperty(property, assigned);
  }

  private addNativeClass(element: HTMLElement, name: string): void {
    if (element.classList.contains(name)) return;
    let classes = this.nativeClasses.get(element);
    if (!classes) { classes = new Set(); this.nativeClasses.set(element, classes); }
    classes.add(name); element.classList.add(name);
  }

  private releaseGrid(): void {
    const grid = this.calendarGrid; this.calendarGrid = null;
    grid?.unmount();
    const child = this.childContainer; this.childContainer = null;
    if (child) void Promise.resolve().then(() => child.dispose()).catch(error => logger.error('[CalendarDom] Child scope disposal failed', error));
  }

  public cleanup(): void {
    this.generation++;
    this.releaseGrid();
    this.headerActionsCleanup?.(); this.headerActionsCleanup = null;
    this.promptCleanup?.(); this.promptCleanup = null;
    this.containerElement?.remove(); this.containerElement = null;
    for (const [element, nodes] of this.headerTitles) {
      if (element.textContent === 'AU - Calendar') element.replaceChildren(...nodes);
    }
    this.headerTitles.clear();
    for (const [element, changes] of this.nativeStyles) {
      for (const [property, original] of changes) {
        if (element.style.getPropertyValue(property) === original.assigned && element.style.getPropertyPriority(property) === '') {
          element.style.setProperty(property, original.value, original.priority);
        }
      }
    }
    this.nativeStyles.clear();
    for (const [element, classes] of this.nativeClasses) classes.forEach(name => element.classList.remove(name));
    this.nativeClasses.clear();
    this.artificialSection?.remove(); this.artificialSection = null;
  }
}
