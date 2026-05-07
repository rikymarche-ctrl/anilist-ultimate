/**
 * @file HomeProgressStrategy.ts
 * @description Strategy for home page 'In Progress' and 'Airing' sections.
 */

import { ICardEnhancementStrategy } from './ICardEnhancementStrategy';

export class HomeProgressStrategy implements ICardEnhancementStrategy {
  public readonly name = 'home-progress';

  public canHandle(path: string): boolean {
    return path === '/' || path.startsWith('/home');
  }

  public getCards(): HTMLElement[] {
    const selectors = [
      '.media-preview-card',
      '.media-card',
      '.media-preview',
      '.list-preview-item',
      '[class*="media-card"]'
    ];
    return Array.from(document.querySelectorAll(selectors.join(', '))) as HTMLElement[];
  }

  public shouldEnhanceCard(card: HTMLElement): boolean {
    // 1. EXCLUDE Activity Cards: We don't want pills in any activity feed
    const isActivity = !!card.closest('.activity-feed, .activity-item, .activity-entry, .activity-anime, .activity-manga, .activity');
    if (isActivity) return false;

    // 2. ALLOW 'In Progress' sections on Home Page
    // Look for any ancestor that might be a section container
    const section = card.closest('section, .section, .home .media-preview-card-wrap, .media-preview-card-wrap, .list-preview-wrap');
    if (!section) return false;

    // Check for "In Progress" in headers or titles within this section or its siblings
    // We check several potential header locations used by AniList
    const possibleHeaders = [
      section.querySelector('h2, h3, .section-header, .title'),
      section.parentElement?.querySelector('h2, h3, .section-header, .title'),
      section.previousElementSibling?.matches('h2, h3, .section-header, .title') ? section.previousElementSibling : null
    ];

    for (const header of possibleHeaders) {
      if (header) {
        const text = header.textContent?.toLowerCase() || '';
        if (text.includes('in progress')) {
          return true;
        }
      }
    }

    // Fallback: check if any ancestor has a class or data attribute related to progress
    if (card.closest('.in-progress, [data-type="progress"]')) return true;

    return false;
  }
}
