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
      '.activity-anime',
      '.activity-manga',
      '.activity-entry',
      '.list-preview-item',
      '[class*="media-card"]'
    ];
    return Array.from(document.querySelectorAll(selectors.join(', '))) as HTMLElement[];
  }

  public shouldEnhanceCard(_card: HTMLElement): boolean {
    // On the home page, we enhance all media cards to ensure consistent Astra UI
    return true;
  }
}
