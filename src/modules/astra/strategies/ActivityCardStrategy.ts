/**
 * @file ActivityCardStrategy.ts
 * @description Adds Astra actions to media covers in AniList activity entries.
 */

import { injectable } from 'tsyringe';
import type { ICardEnhancementStrategy } from './ICardEnhancementStrategy';

@injectable()
export class ActivityCardStrategy implements ICardEnhancementStrategy {
  public readonly name = 'activity-card';

  public canHandle(_path: string): boolean {
    return true;
  }

  public getCards(): HTMLElement[] {
    // AniList activity cards vary between generic entries and media-type-only
    // elements. `shouldEnhanceCard` filters these down to entries with a media cover.
    return Array.from(document.querySelectorAll('.activity-entry, .activity-anime, .activity-manga'));
  }

  public shouldEnhanceCard(card: HTMLElement): boolean {
    return Boolean(card.querySelector('a.cover[href*="/anime/"], a.cover[href*="/manga/"]'));
  }
}
