/**
 * @file UserListStrategy.ts
 * @description Strategy for user anime/manga list pages.
 */

import { ICardEnhancementStrategy } from './ICardEnhancementStrategy';

export class UserListStrategy implements ICardEnhancementStrategy {
  public readonly name = 'user-list';

  public canHandle(_path: string): boolean {
    // DISABLED: User requested pills only in calendar and home progress sections
    return false;
  }

  public getCards(): HTMLElement[] {
    return Array.from(document.querySelectorAll('.media-preview-card, .media-card')) as HTMLElement[];
  }

  public shouldEnhanceCard(_card: HTMLElement): boolean {
    // All cards on list pages are candidates for the Astra pill
    return true;
  }
}
