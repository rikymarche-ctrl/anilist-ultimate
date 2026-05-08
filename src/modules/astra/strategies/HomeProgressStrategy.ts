/**
 * @file HomeProgressStrategy.ts
 * @description Strategy for home page 'In Progress' and 'Airing' sections.
 */

import { injectable } from 'tsyringe';
import { log } from '@core/logger';
import { ICardEnhancementStrategy } from './ICardEnhancementStrategy';

@injectable()
export class HomeProgressStrategy implements ICardEnhancementStrategy {
  public readonly name = 'home-progress';

  public canHandle(path: string): boolean {
    const handle = path === '/' || path.startsWith('/home');
    if (handle) log.debug(`[HomeProgressStrategy] Handling path: ${path}`);
    return handle;
  }

  public getCards(): HTMLElement[] {
    const selectors = [
      '.media-preview-card',
      '.media-card',
      '.media-preview',
      '.list-preview-item',
      '.media-preview-card-wrap',
      '.media-preview-card .cover',
      '[class*="media-card"]',
      '[class*="MediaCard"]',
      '[class*="media-preview"]'
    ];
    return Array.from(document.querySelectorAll(selectors.join(', '))) as HTMLElement[];
  }

  public shouldEnhanceCard(card: HTMLElement): boolean {
    // 1. EXCLUDE Activity Cards: We don't want pills in any activity feed
    const isActivity = !!card.closest('.activity-feed, .activity-item, .activity-entry, .activity-anime, .activity-manga, .activity');
    if (isActivity) return false;

    // 2. If we are on the Home page, we want ALL media cards to have pills
    // except for sidebar elements that are too small or irrelevant.
    const path = window.location.pathname;
    if (path === '/' || path === '/home') {
      const isSidebar = !!card.closest('.sidebar, aside, .users');
      if (isSidebar) return false;
      return true;
    }

    // 3. Fallback for other contexts: check keywords in headers
    // This handles cases like 'In Progress' sections on other pages
    const section = card.closest('section, .section, .media-preview-card-wrap, .list-preview-wrap');
    if (!section) return false;

    const possibleHeaders = [
      section.querySelector('h2, h3, .section-header, .title'),
      section.parentElement?.querySelector('h2, h3, .section-header, .title'),
      section.previousElementSibling?.matches('h2, h3, .section-header, .title') ? section.previousElementSibling : null
    ];

    const keywords = [
      'progress', 'corso', 'onda', 'airing', 'updated', 'aggiornati', 
      'continuing', 'prosecuzione', 'visione', 'lettura', 'watching', 'reading'
    ];
    
    for (const header of possibleHeaders) {
      if (header) {
        const text = header.textContent?.toLowerCase() || '';
        if (keywords.some(k => text.includes(k))) return true;
      }
    }

    // Check if any ancestor has a class or data attribute related to progress
    return card.closest('.in-progress, [data-type="progress"]') !== null;
  }
}
