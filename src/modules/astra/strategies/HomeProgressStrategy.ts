/**
 * @file HomeProgressStrategy.ts
 * @description Strategy for home page 'In Progress' and 'Airing' sections.
 */

import { injectable } from 'tsyringe';
import { ICardEnhancementStrategy } from './ICardEnhancementStrategy';

@injectable()
export class HomeProgressStrategy implements ICardEnhancementStrategy {
  public readonly name = 'home-progress';

  public canHandle(path: string): boolean {
    return path === '/' || path.startsWith('/home');
  }

  public getCards(): HTMLElement[] {
    // These are AniList's individual media cards. Avoid the broader preview
    // wrappers and nested covers: a wrapper may contain several titles and
    // would bind its pill to whichever media link happens to come first.
    return Array.from(document.querySelectorAll('.media-preview-card, .media-card')) as HTMLElement[];
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
