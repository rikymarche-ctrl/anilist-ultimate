/**
 * Review Enhancer Module
 * Adds numeric ratings to review cards in the "Recent Reviews" section
 */

import { log } from '@core/logger';
import { ReviewService } from './ReviewService';

export class ReviewEnhancerModule {
  private observer: MutationObserver | null = null;
  private processedReviews: Set<string> = new Set();
  private reviewService!: ReviewService;

  /**
   * Initialize the module
   */
  public async init(): Promise<void> {
    log.info('ReviewEnhancer: Initializing');

    // Get review service instance
    this.reviewService = ReviewService.getInstance();

    // Wait for page to load
    await this.waitForPage();

    // Wait for Recent Reviews section to appear
    await this.waitForRecentReviews();

    // Process existing reviews
    await this.processReviews();

    // Start observing for new reviews
    this.startObserving();

    log.success('ReviewEnhancer: Initialized');
  }

  /**
   * Wait for the Recent Reviews section to appear
   */
  private waitForRecentReviews(): Promise<void> {
    return new Promise((resolve) => {
      // Check if section already exists
      if (this.findRecentReviewsSection()) {
        log.info('ReviewEnhancer: Recent Reviews section already present');
        resolve();
        return;
      }

      log.info('ReviewEnhancer: Waiting for Recent Reviews section to load...');

      // Create observer to watch for the section
      let checkCount = 0;
      const maxChecks = 60; // 30 seconds max wait (500ms * 60)

      const interval = setInterval(() => {
        checkCount++;

        const section = this.findRecentReviewsSection();
        if (section) {
          log.info('ReviewEnhancer: Recent Reviews section found!');
          clearInterval(interval);
          resolve();
          return;
        }

        if (checkCount >= maxChecks) {
          log.warn('ReviewEnhancer: Recent Reviews section not found after waiting');
          clearInterval(interval);
          resolve(); // Resolve anyway to not block initialization
        }
      }, 500);
    });
  }

  /**
   * Wait for the page to be ready
   */
  private waitForPage(): Promise<void> {
    return new Promise((resolve) => {
      if (document.readyState === 'complete') {
        setTimeout(resolve, 1000);
      } else {
        window.addEventListener('load', () => {
          setTimeout(resolve, 1000);
        });
      }
    });
  }

  /**
   * Start observing for new review cards
   */
  private startObserving(): void {
    // Observe the entire document for new review cards
    this.observer = new MutationObserver(() => {
      this.processReviews();
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    log.info('ReviewEnhancer: Started observing for new reviews');
  }

  /**
   * Process all review cards on the page
   */
  private async processReviews(): Promise<void> {
    // Find the Recent Reviews section
    const recentReviewsSection = this.findRecentReviewsSection();
    if (!recentReviewsSection) {
      log.warn('ReviewEnhancer: Recent Reviews section not found');
      return;
    }

    log.info('ReviewEnhancer: Recent Reviews section found, looking for cards...');

    // Try multiple selectors for review cards
    const selectors = [
      '.review-card',
      '[class*="review-card"]',
      '[class*="Review"]',
      'a[href*="/review/"]',
      '.activity-entry', // Sometimes reviews are shown as activities
    ];

    let reviewCards: Element[] = [];

    for (const selector of selectors) {
      const cards = Array.from(recentReviewsSection.querySelectorAll(selector));
      if (cards.length > 0) {
        log.info(`ReviewEnhancer: Found ${cards.length} elements with selector: ${selector}`);
        reviewCards = cards;
        break;
      }
    }

    if (reviewCards.length === 0) {
      log.warn('ReviewEnhancer: No review cards found with any selector');
      log.debug('Section HTML:', recentReviewsSection.innerHTML.substring(0, 500));
      return;
    }

    log.info(`ReviewEnhancer: Processing ${reviewCards.length} review cards`);

    // Process cards sequentially to avoid rate limiting
    for (const card of reviewCards) {
      await this.enhanceReviewCard(card as HTMLElement);
    }
  }

  /**
   * Find the Recent Reviews section on the page
   */
  private findRecentReviewsSection(): HTMLElement | null {
    // Method 1: Look for section header with "Recent Reviews" text
    const headers = Array.from(document.querySelectorAll('.section-header, h2, .section-name'));
    for (const header of headers) {
      if (header.textContent?.includes('Recent Reviews') || header.textContent?.includes('recent reviews')) {
        log.debug('ReviewEnhancer: Found section header', header);

        // Try to find the container with review cards
        // Check next sibling
        let container = header.nextElementSibling as HTMLElement;
        if (container && container.querySelector('.review-card, [class*="review"]')) {
          log.debug('ReviewEnhancer: Found container via nextElementSibling', container);
          return container;
        }

        // Check parent's next sibling
        container = header.parentElement?.nextElementSibling as HTMLElement;
        if (container && container.querySelector('.review-card, [class*="review"]')) {
          log.debug('ReviewEnhancer: Found container via parent nextElementSibling', container);
          return container;
        }

        // Check siblings of parent
        const parent = header.closest('.section, .home-section, [class*="section"]');
        if (parent) {
          const reviewContainer = parent.querySelector('[class*="review"]');
          if (reviewContainer) {
            log.debug('ReviewEnhancer: Found container via parent section', reviewContainer);
            return reviewContainer as HTMLElement;
          }
        }
      }
    }

    // Method 2: Look for any container with review cards
    const reviewContainers = document.querySelectorAll('[class*="review-wrap"], [class*="review-container"]');
    if (reviewContainers.length > 0) {
      log.debug('ReviewEnhancer: Found review container directly', reviewContainers[0]);
      return reviewContainers[0] as HTMLElement;
    }

    // Method 3: Look for review-card elements and get their parent
    const reviewCards = document.querySelectorAll('.review-card');
    if (reviewCards.length > 0) {
      const container = reviewCards[0].parentElement;
      if (container) {
        log.debug('ReviewEnhancer: Found container via review cards parent', container);
        return container;
      }
    }

    return null;
  }

  /**
   * Enhance a single review card with rating
   */
  private async enhanceReviewCard(card: HTMLElement): Promise<void> {
    // Generate unique ID for this card
    const cardId = this.getCardId(card);

    // Skip if already processed
    if (this.processedReviews.has(cardId)) {
      log.debug('ReviewEnhancer: Card already processed, skipping');
      return;
    }

    log.debug('ReviewEnhancer: Processing card', card);

    // Extract rating from the card DOM
    let rating = this.extractRating(card);

    // If rating not in DOM, try to fetch via API
    if (rating === null) {
      log.debug('ReviewEnhancer: No rating in DOM, trying API...');
      const reviewId = this.extractReviewId(card);

      if (reviewId) {
        log.info(`ReviewEnhancer: Found review ID ${reviewId}, fetching from API...`);
        const reviewData = await this.reviewService.getReview(reviewId);
        if (reviewData && reviewData.score) {
          rating = reviewData.score;
          log.info(`ReviewEnhancer: Got rating ${rating} from API`);
        } else {
          log.warn(`ReviewEnhancer: Could not get rating from API for review ${reviewId}`);
        }
      } else {
        log.warn('ReviewEnhancer: Could not extract review ID from card');
      }
    } else {
      log.info(`ReviewEnhancer: Found rating ${rating} in DOM`);
    }

    if (rating === null) {
      log.warn('ReviewEnhancer: No rating found for card after trying all methods');
      return;
    }

    // Add rating display to the card
    this.addRatingDisplay(card, rating);

    // Mark as processed
    this.processedReviews.add(cardId);

    log.success(`ReviewEnhancer: Enhanced review card with rating ${rating}`);
  }

  /**
   * Generate unique ID for a review card
   */
  private getCardId(card: HTMLElement): string {
    // Try to find a review link
    const link = card.querySelector('a[href*="/review/"]');
    if (link) {
      return link.getAttribute('href') || '';
    }

    // Fallback: use card's position and text content
    const text = card.textContent?.substring(0, 50) || '';
    return `${text}-${Array.from(card.parentElement?.children || []).indexOf(card)}`;
  }

  /**
   * Extract review ID from a review card
   */
  private extractReviewId(card: HTMLElement): number | null {
    // Check if the card itself is a link
    let link: HTMLAnchorElement | null = null;

    if (card.tagName === 'A' && card.hasAttribute('href')) {
      link = card as HTMLAnchorElement;
    } else {
      // Look for a link with /review/ inside the card
      link = card.querySelector('a[href*="/review/"]') as HTMLAnchorElement;
    }

    if (!link) {
      return null;
    }

    // Get the href attribute (could be relative like /review/123)
    const href = link.getAttribute('href');
    if (!href) {
      return null;
    }

    // Extract ID from URL: /review/123456 or https://anilist.co/review/123456
    const match = href.match(/\/review\/(\d+)/);
    if (match && match[1]) {
      return parseInt(match[1], 10);
    }

    return null;
  }

  /**
   * Extract rating from a review card (from DOM)
   */
  private extractRating(card: HTMLElement): number | null {
    // AniList reviews use a score out of 100
    // The rating might be in different places depending on the card structure

    // Method 1: Look for explicit rating elements
    const ratingElement = card.querySelector('.rating, .score, [class*="rating"], [class*="score"]');
    if (ratingElement) {
      const ratingText = ratingElement.textContent?.trim();
      if (ratingText) {
        const rating = parseInt(ratingText, 10);
        if (!isNaN(rating)) {
          return rating;
        }
      }
    }

    // Method 2: Look in data attributes
    const dataRating = card.getAttribute('data-rating') || card.getAttribute('data-score');
    if (dataRating) {
      const rating = parseInt(dataRating, 10);
      if (!isNaN(rating)) {
        return rating;
      }
    }

    return null;
  }

  /**
   * Add rating display to a review card
   */
  private addRatingDisplay(card: HTMLElement, rating: number): void {
    // Check if rating display already exists
    if (card.querySelector('.au-review-rating')) {
      return;
    }

    // Create rating display element
    const ratingDisplay = document.createElement('div');
    ratingDisplay.className = 'au-review-rating';
    ratingDisplay.textContent = `${rating}`;

    // Add rating category class for styling (IMDb-style scale with gradual green shades)
    if (rating >= 95) {
      ratingDisplay.classList.add('au-review-rating--perfect');
    } else if (rating >= 85) {
      ratingDisplay.classList.add('au-review-rating--excellent');
    } else if (rating >= 75) {
      ratingDisplay.classList.add('au-review-rating--high');
    } else if (rating >= 65) {
      ratingDisplay.classList.add('au-review-rating--good');
    } else if (rating >= 60) {
      ratingDisplay.classList.add('au-review-rating--decent');
    } else if (rating >= 50) {
      ratingDisplay.classList.add('au-review-rating--medium');
    } else if (rating >= 40) {
      ratingDisplay.classList.add('au-review-rating--poor');
    } else if (rating >= 30) {
      ratingDisplay.classList.add('au-review-rating--bad');
    } else {
      ratingDisplay.classList.add('au-review-rating--terrible');
    }

    // Find the best place to insert the rating
    // Usually we want it in the top-right corner or near the title
    const insertionPoint = this.findRatingInsertionPoint(card);

    if (insertionPoint) {
      insertionPoint.appendChild(ratingDisplay);
    } else {
      // Fallback: prepend to the card
      card.insertBefore(ratingDisplay, card.firstChild);
    }
  }

  /**
   * Find the best place to insert the rating display
   * We want to place it over the image/banner, not over the text
   */
  private findRatingInsertionPoint(card: HTMLElement): HTMLElement | null {
    // Look for image/banner/cover containers first (we want to place the rating over the image)
    const imageContainers = [
      card.querySelector('.cover'),
      card.querySelector('.banner'),
      card.querySelector('.image'),
      card.querySelector('[class*="cover"]'),
      card.querySelector('[class*="banner"]'),
      card.querySelector('[class*="image"]'),
      card.querySelector('img')?.parentElement,
    ];

    for (const container of imageContainers) {
      if (container) {
        log.debug('ReviewEnhancer: Inserting rating into image container', container);
        return container as HTMLElement;
      }
    }

    // Fallback: use the card itself
    log.debug('ReviewEnhancer: No image container found, using card itself');
    return card;
  }

  /**
   * Cleanup
   */
  public destroy(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    this.processedReviews.clear();
    log.info('ReviewEnhancer: Destroyed');
  }
}
