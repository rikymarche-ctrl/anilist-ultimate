/**
 * @file ICardEnhancementStrategy.ts
 * @description Interface for card enhancement strategies.
 */

export interface ICardEnhancementStrategy {
  /**
   * Unique name of the strategy
   */
  readonly name: string;

  /**
   * Determines if this strategy can handle the current page context
   */
  canHandle(path: string): boolean;

  /**
   * Identifies cards that should be enhanced by this strategy
   */
  getCards(): HTMLElement[];

  /**
   * Determines if a specific card should be enhanced (e.g., checking if it's in a progress section)
   */
  shouldEnhanceCard(card: HTMLElement): boolean;
}
