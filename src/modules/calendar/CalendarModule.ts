/**
 * Calendar Module
 * Main orchestrator for the calendar feature
 */

import { anilistClient } from '@/api/AnilistClient';
import { calendarService } from './CalendarService';
import { calendarStore } from './CalendarStore';
import { CalendarGrid } from './components/CalendarGrid';
import { SettingsPanel } from './components/SettingsPanel';
import { log } from '@core/logger';
import { CSS_CLASSES } from '@core/constants';

export class CalendarModule {
  private calendarGrid: CalendarGrid | null = null;
  private containerElement: HTMLElement | null = null;
  private userId: number | null = null;
  private observer: MutationObserver | null = null;

  /**
   * Initialize the calendar module
   */
  public async init(): Promise<void> {
    try {
      log.group('Calendar Module Initialization');

      // Check if user is authenticated
      if (!anilistClient.isAuthenticated()) {
        log.warn('User not authenticated, calendar module disabled');
        this.showAuthPrompt();
        return;
      }

      // Get current user ID
      this.userId = await anilistClient.getCurrentUserId();
      log.info('Calendar initialized for user', { userId: this.userId });

      // Wait for Anilist page to load
      await this.waitForAnilistPage();

      // Find and replace the Airing section
      await this.replaceAiringSection();

      // Load calendar data
      await this.loadCalendarData();

      // Setup page navigation observer
      this.setupNavigationObserver();

      log.success('Calendar module initialized successfully');
    } catch (error) {
      log.error('Failed to initialize calendar module', error);
      this.showError('Failed to load calendar');
    } finally {
      log.groupEnd();
    }
  }

  /**
   * Wait for Anilist page to be ready
   */
  private waitForAnilistPage(): Promise<void> {
    return new Promise((resolve) => {
      if (document.readyState === 'complete') {
        resolve();
        return;
      }

      window.addEventListener('load', () => resolve());
    });
  }

  /**
   * Replace the native Airing section with our calendar
   * Follows v1 approach: modifies existing header, clears container, adds calendar
   */
  private async replaceAiringSection(): Promise<void> {
    // Find the Airing header element
    const headerElement = await this.findAiringSection();

    if (!headerElement) {
      log.warn('Airing section not found, cannot replace');
      return;
    }

    log.info('Found Airing header, replacing with calendar');

    // Find the inner header element if we're dealing with a container
    const actualHeader = headerElement.tagName.toLowerCase() === 'h2' || headerElement.tagName.toLowerCase() === 'h3'
      ? headerElement
      : headerElement.querySelector<HTMLElement>('h2, h3');

    // Replace the header text (keep Anilist's original header structure)
    if (actualHeader) {
      actualHeader.innerHTML = 'AU - Calendar';
      actualHeader.className = 'au-calendar-title';
      log.info('Replaced header text with "AU - Calendar"');
    }

    // Add settings button to the header area
    const parentHeader = headerElement.closest('.section-header') || headerElement.parentElement;
    if (parentHeader) {
      // Create actions container
      const actionsContainer = document.createElement('div');
      actionsContainer.className = 'calendar-header__actions';
      actionsContainer.innerHTML = `
        <button class="calendar-header__settings" title="Calendar settings">
          <i class="fa fa-cog"></i>
        </button>
      `;
      parentHeader.appendChild(actionsContainer);

      // Hide Anilist's default view switcher icons/buttons if they exist
      const anilistActions = parentHeader.querySelectorAll('.view-selector, .grid-icon, .list-icon, [class*="view-selector"]');
      anilistActions.forEach(el => (el as HTMLElement).style.display = 'none');

      // Attach event listener
      const settingsBtn = actionsContainer.querySelector('.calendar-header__settings');
      settingsBtn?.addEventListener('click', () => this.handleSettingsClick());
    }

    // Find the container that holds the anime cards
    const container = this.findAiringContainer(headerElement);

    if (!container) {
      log.error('Container for Airing section not found');
      return;
    }

    log.info('Found container, replacing content with calendar');

    // Find the section header
    const sectionHeader = headerElement.closest('.section-header');

    // Keep the header, remove everything else
    const children = Array.from(container.children);
    for (const child of children) {
      if (child !== sectionHeader && child.querySelector('.section-header') !== sectionHeader) {
        child.remove();
      }
    }

    // Create our calendar container
    const calendarContainer = document.createElement('div');
    calendarContainer.id = CSS_CLASSES.CALENDAR;
    calendarContainer.className = `${CSS_CLASSES.CONTAINER} ${CSS_CLASSES.CALENDAR}`;

    // Add calendar grid container
    const gridContainer = document.createElement('div');
    gridContainer.className = 'calendar-grid-container';
    calendarContainer.appendChild(gridContainer);

    // Add our calendar after the header
    if (sectionHeader && sectionHeader.parentNode === container) {
      container.insertBefore(calendarContainer, sectionHeader.nextSibling);
    } else {
      container.appendChild(calendarContainer);
    }

    this.containerElement = calendarContainer;

    // Create and mount calendar grid
    this.calendarGrid = new CalendarGrid({
      onMarkWatched: (mediaId) => this.handleMarkWatched(mediaId),
    });

    this.calendarGrid.mount(gridContainer);

    log.success('Calendar successfully mounted');
  }

  /**
   * Find the Airing section header on the page
   * Uses the robust multi-strategy approach from v1
   * Returns the header element, not the container
   */
  private findAiringSection(): Promise<HTMLElement | null> {
    return new Promise((resolve) => {
      log.info('Attempting to find Airing section...');

      let airingElement: HTMLElement | null = null;

      // Helper function to find elements by text content
      const findElementsContainingText = (selector: string, text: string): HTMLElement[] => {
        const elements = document.querySelectorAll<HTMLElement>(selector);
        return Array.from(elements).filter(el => el.textContent?.trim().includes(text));
      };

      // Strategy 1: Direct approach with h2 elements
      const airingH2Elements = findElementsContainingText('h2', 'Airing');
      log.debug(`Found ${airingH2Elements.length} h2 elements containing "Airing" text`);

      if (airingH2Elements.length > 0) {
        // Filter for exact matches
        const exactAiringH2 = airingH2Elements.filter(el => el.textContent?.trim() === 'Airing');

        if (exactAiringH2.length > 0) {
          airingElement = exactAiringH2[0];
          log.debug('Found exact "Airing" h2 element');
        } else {
          airingElement = airingH2Elements[0];
          log.debug('Found h2 element containing "Airing"');
        }
      }

      // Strategy 2: Look for section headers if not found yet
      if (!airingElement) {
        const sectionHeaders = document.querySelectorAll<HTMLElement>('.section-header');
        log.debug(`Found ${sectionHeaders.length} section headers to check`);

        for (const header of sectionHeaders) {
          if (header.textContent?.includes('Airing')) {
            airingElement = header;
            log.debug('Found section header containing "Airing"');
            break;
          }
        }
      }

      // Strategy 3: Look in the home sections
      if (!airingElement) {
        const homeSections = document.querySelectorAll<HTMLElement>('.home section');
        log.debug(`Found ${homeSections.length} home sections to check`);

        for (const section of homeSections) {
          if (section.textContent?.includes('Airing')) {
            // Find the header within this section
            const headerInSection = section.querySelector<HTMLElement>('h2, h3, .section-header');
            if (headerInSection) {
              airingElement = headerInSection;
              log.debug('Found header in home section containing "Airing"');
              break;
            }
          }
        }
      }

      // Strategy 4: Look for any elements with class containing "airing"
      if (!airingElement) {
        const airingClassElements = document.querySelectorAll<HTMLElement>('[class*="airing" i], [class*="Airing" i]');
        log.debug(`Found ${airingClassElements.length} elements with class containing "airing"`);

        if (airingClassElements.length > 0) {
          // Find a header near these elements
          for (const el of airingClassElements) {
            const nearbyHeader = el.querySelector<HTMLElement>('h2, h3, .section-header') ||
              el.closest('.section-header') ||
              el.closest('section')?.querySelector<HTMLElement>('h2, h3, .section-header');

            if (nearbyHeader) {
              airingElement = nearbyHeader;
              log.debug('Found header near element with class containing "airing"');
              break;
            }
          }

          // If still not found, use the first element itself
          if (!airingElement && airingClassElements[0].tagName.toLowerCase() === 'section') {
            airingElement = airingClassElements[0].querySelector<HTMLElement>('h2, h3, .section-header') || airingClassElements[0];
            log.debug('Using element with class containing "airing" itself');
          }
        }
      }

      if (!airingElement) {
        log.warn('Airing section not found in this page pass - will retry on DOM changes');
        resolve(null);
        return;
      }

      log.success('Found Airing header element');
      resolve(airingElement);
    });
  }

  /**
   * Find the container that holds the anime cards
   * Based on v1's findAiringContainer logic
   */
  private findAiringContainer(headerElement: HTMLElement): HTMLElement | null {
    try {
      log.debug('Finding container for Airing header element');

      // Method 1: Try to find via section-header and list-preview-wrap
      const sectionHeader = headerElement.closest('.section-header');
      if (sectionHeader) {
        log.debug('Found section header container');

        const listPreviewWrap = sectionHeader.closest('.list-preview-wrap');
        if (listPreviewWrap) {
          log.debug('Found container via list-preview-wrap');
          return listPreviewWrap as HTMLElement;
        }

        const listPreview = sectionHeader.closest('.list-preview');
        if (listPreview) {
          log.debug('Found container via list-preview');
          return listPreview as HTMLElement;
        }

        // If the section header has a nextSibling, that might be our container
        if (sectionHeader.nextElementSibling &&
            (sectionHeader.nextElementSibling.classList.contains('list-wrap') ||
             sectionHeader.nextElementSibling.classList.contains('content-wrap'))) {
          log.debug('Found container via next sibling');
          return sectionHeader.nextElementSibling as HTMLElement;
        }
      }

      // Method 2: Find the section containing both the header and anime cards
      let currentElement: HTMLElement | null = headerElement;
      for (let i = 0; i < 5; i++) {
        // Go up the DOM tree
        currentElement = currentElement.parentElement;
        if (!currentElement) break;

        log.debug(`Checking container at level ${i}`);

        // Check if this element contains media preview cards
        const mediaCards = currentElement.querySelectorAll('.media-preview-card');
        if (mediaCards.length > 0) {
          log.debug(`Found container with ${mediaCards.length} media cards`);
          return currentElement;
        }

        // Check for other common container classes
        if (currentElement.classList.contains('list-wrap') ||
            currentElement.classList.contains('content-wrap') ||
            currentElement.classList.contains('list-preview-wrap') ||
            currentElement.classList.contains('list-preview') ||
            currentElement.classList.contains('airing-content')) {
          log.debug('Found container via class name');
          return currentElement;
        }
      }

      // Method 3: Find container by searching siblings of the header's parent
      if (headerElement.parentElement?.parentElement) {
        const siblings = headerElement.parentElement.parentElement.children;
        for (let i = 0; i < siblings.length; i++) {
          const sibling = siblings[i];

          // Skip the header element itself
          if (sibling === headerElement.parentElement) continue;

          // Check if this sibling contains media cards
          const mediaCards = sibling.querySelectorAll('.media-preview-card');
          if (mediaCards.length > 0) {
            log.debug(`Found container in sibling with ${mediaCards.length} media cards`);
            return sibling as HTMLElement;
          }
        }
      }

      // Method 4: Look for the nearest parent section
      const parentSection = headerElement.closest('section');
      if (parentSection) {
        log.debug('Using parent section as container');
        return parentSection as HTMLElement;
      }

      // Method 5: Last resort - use a generic container higher up
      if (headerElement.parentElement?.parentElement) {
        log.debug('Using generic parent container as fallback');
        return headerElement.parentElement.parentElement;
      }

      log.warn('No suitable container found');
      return null;
    } catch (err) {
      log.error('Error finding container', err);
      return null;
    }
  }

  /**
   * Load calendar data from API
   */
  private async loadCalendarData(): Promise<void> {
    if (!this.userId) {
      log.error('Cannot load calendar data: userId is null');
      return;
    }

    try {
      calendarStore.setLoading(true);
      this.calendarGrid?.showLoading();

      const entries = await calendarService.fetchAiringSchedule(this.userId);
      calendarStore.setEntries(entries);

      this.calendarGrid?.hideLoading();

      log.success(`Loaded ${entries.length} anime entries`);
    } catch (error) {
      log.error('Failed to load calendar data', error);
      calendarStore.setError(error as Error);
      this.showError('Failed to load anime schedule');
    } finally {
      calendarStore.setLoading(false);
    }
  }

  /**
   * Handle marking anime as watched
   */
  private async handleMarkWatched(mediaId: number): Promise<void> {
    try {
      log.info('Marking episode as watched', { mediaId });

      // Find the anime entry
      const entry = calendarStore
        .getState()
        .entries.find((e) => e.mediaId === mediaId);

      if (!entry) {
        log.error('Anime entry not found', { mediaId });
        return;
      }

      // Update progress by 1 episode (standard increment behavior)
      const newProgress = entry.progress + 1;
      await calendarService.updateProgress(mediaId, newProgress);

      // Update local state
      calendarStore.updateEntry(mediaId, { progress: newProgress });
      log.success('Episode marked as watched');
    } catch (error) {
      log.error('Failed to mark episode as watched', error);
      alert('Failed to update progress. Please try again.');
    }
  }

  /**
   * Handle settings button click
   */
  private handleSettingsClick(): void {
    log.info('Opening settings panel');

    // Create and show settings panel
    const settingsPanel = new SettingsPanel({
      onClose: () => {
        log.info('Settings panel closed');
      },
    });

    settingsPanel.mount(document.body);
  }

  /**
   * Show authentication prompt
   */
  private showAuthPrompt(): void {
    if (!this.containerElement) return;

    const prompt = document.createElement('div');
    prompt.className = 'calendar-auth-prompt';
    prompt.innerHTML = `
      <div class="calendar-auth-prompt__content">
        <i class="fa fa-lock"></i>
        <h3>Authentication Required</h3>
        <p>Please log in to Anilist to use the calendar feature.</p>
        <button class="calendar-auth-prompt__btn">Log In</button>
      </div>
    `;

    this.containerElement.appendChild(prompt);

    const btn = prompt.querySelector('.calendar-auth-prompt__btn');
    btn?.addEventListener('click', () => {
      window.open(anilistClient.getAuthUrl(), '_blank');
    });
  }

  /**
   * Show error message
   */
  private showError(message: string): void {
    this.calendarGrid?.showError(message);
  }

  /**
   * Setup navigation observer to reinitialize on page changes
   */
  private setupNavigationObserver(): void {
    // Observe URL and DOM changes for SPA navigation/re-renders
    let lastUrl = location.href;

    const checkAndReinject = () => {
      const currentUrl = location.href;
      const isHomePage = currentUrl.includes('/home') || currentUrl === location.origin + '/';
      const calendarMissing = !document.querySelector(`#${CSS_CLASSES.CALENDAR}`);

      if (isHomePage && calendarMissing) {
        log.debug('Calendar missing or page changed, attempting re-injection');
        this.replaceAiringSection();
      }
    };

    // Observer for DOM mutations (covers navigation and re-renders)
    this.observer = new MutationObserver(() => {
      const currentUrl = location.href;
      if (currentUrl !== lastUrl) {
        lastUrl = currentUrl;
        log.debug('URL changed, checking for re-injection');
        setTimeout(checkAndReinject, 500);
      } else {
        // Even if URL hasn't changed, check if calendar was removed by React
        checkAndReinject();
      }
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    // Fallback for resize events which often trigger Anilist layout changes
    window.addEventListener('resize', () => {
      checkAndReinject();
    });
  }

  /**
   * Destroy the module and clean up
   */
  public destroy(): void {
    log.info('Destroying calendar module');

    // Stop observer
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }

    // Unmount calendar grid
    if (this.calendarGrid) {
      this.calendarGrid.unmount();
      this.calendarGrid = null;
    }

    // Remove container
    if (this.containerElement) {
      this.containerElement.remove();
      this.containerElement = null;
    }

    // Clear store
    calendarStore.stopCountdownInterval();
  }
}
