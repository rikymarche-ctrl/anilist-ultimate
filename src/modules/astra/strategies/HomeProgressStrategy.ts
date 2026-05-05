/**
 * @file HomeProgressStrategy.ts
 * @description Strategy for home page 'In Progress' and 'Airing' sections.
 */

import { ICardEnhancementStrategy } from './ICardEnhancementStrategy';

export class HomeProgressStrategy implements ICardEnhancementStrategy {
  public readonly name = 'home-progress';

  public canHandle(path: string): boolean {
    return path === '/' || path === '/home';
  }

  public getCards(): HTMLElement[] {
    return Array.from(document.querySelectorAll('.media-preview-card, .media-card')) as HTMLElement[];
  }

  public shouldEnhanceCard(card: HTMLElement): boolean {
    let current = card.parentElement;
    let header: HTMLElement | null = null;

    for (let i = 0; i < 5 && current && current !== document.body; i++) {
      header = current.querySelector('h2, .section-header');
      if (header) break;
      
      const siblingHeader = Array.from(current.parentElement?.children || [])
        .find(el => el.classList.contains('section-header') || el.tagName === 'H2') as HTMLElement;
      
      if (siblingHeader) {
        header = siblingHeader;
        break;
      }

      current = current.parentElement;
    }

    if (!header) {
      return false;
    }

    const headerText = header.textContent?.toLowerCase() || '';
    const shouldEnhance = headerText.includes('in progress') || 
           headerText.includes('airing') || 
           headerText.includes('schedule') || 
           headerText.includes('watching');
           
    if (shouldEnhance) {
      console.info(`[Astra-Debug] Found enhancement target: "${headerText}"`);
    }
    
    return shouldEnhance;
  }
}
