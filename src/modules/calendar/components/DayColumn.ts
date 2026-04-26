/**
 * Day Column Component
 * Displays all anime airing on a specific day
 */

import { injectable, inject } from 'tsyringe';
import { BaseComponent } from '@ui/components/BaseComponent';
import { container } from '@core/di/container';
import { AnimeCard } from './AnimeCard';
import { ABBREVIATED_DAYS, DAYS_OF_WEEK } from '@core/constants';
import type { AnimeEntry, CardOptions } from '@core/types';

interface DayColumnProps {
  day: string;
  entries: AnimeEntry[];
  cardOptions: CardOptions;
  isToday?: boolean;
}

@injectable()
export class DayColumn extends BaseComponent<DayColumnProps> {
  private animeCards: AnimeCard[] = [];
  private isExpanded: boolean = false;

  constructor(
    @inject('DayColumnProps') props: DayColumnProps
  ) {
    super(props);
  }

  protected render(): HTMLElement {
    const { day, entries, isToday, cardOptions } = this.props;

    const column = this.createElement('div', {
      class: 'calendar-day-column',
    });

    if (isToday) {
      column.classList.add('calendar-day-column--today');
    }

    if (entries.length === 0) {
      column.classList.add('calendar-day-column--empty');
    }

    // Apply column justify
    if (cardOptions.columnJustify === 'center') {
      column.classList.add('calendar-day-column--center-justify');
    }

    column.setAttribute('data-day', day);

    // Day header
    const dayIndex = DAYS_OF_WEEK.indexOf(day as any);
    const abbreviation = dayIndex >= 0 ? ABBREVIATED_DAYS[dayIndex] : day.slice(0, 3);

    const header = this.createElement('div', { class: 'calendar-day-column__header' });

    // Calculate the actual date for this day column
    const today = new Date();
    const todayDayIndex = today.getDay();
    const thisDayIndex = DAYS_OF_WEEK.indexOf(day as any);
    let dayDiff = thisDayIndex - todayDayIndex;
    if (dayDiff < 0) dayDiff += 7;
    const columnDate = new Date(today);
    columnDate.setDate(today.getDate() + dayDiff);
    const dayNumber = columnDate.getDate();

    // Only show count if there are more than 5 entries
    const countHTML = entries.length > 5
      ? `<span class="calendar-day-column__count">${entries.length}</span>`
      : '';

    header.innerHTML = `
      <h2 class="calendar-day-column__title">
        <span class="calendar-day-column__day-name">${day}</span>
        <span class="calendar-day-column__day-abbr">${abbreviation}</span>
        <span class="calendar-day-column__day-separator">|</span>
        <span class="calendar-day-column__day-number">${dayNumber}</span>
        ${countHTML}
      </h2>
    `;

    column.appendChild(header);

    // Entries container
    const entriesContainer = this.createElement('div', { class: 'calendar-day-column__entries' });

    if (entries.length === 0) {
      entriesContainer.innerHTML = `
        <div class="calendar-day-column__empty-state">
          <p>No anime airing</p>
        </div>
      `;
    } else {
      // Create all anime cards
      this.animeCards = entries.map((anime, index) => {
        try {
          const props = {
            anime,
            options: this.props.cardOptions,
          };
          
          const child = container.createChildContainer();
          child.register('AnimeCardProps', { useValue: props });
          const card = child.resolve(AnimeCard);
          
          card.mount(entriesContainer);

          // Hide cards beyond maxCardsPerDay limit (if not expanded)
          const maxCards = this.props.cardOptions.maxCardsPerDay;
          if (maxCards > 0 && index >= maxCards && !this.isExpanded) {
            card.hide();
          }

          return card;
        } catch (error: unknown) {
          console.error('[DayColumn] Failed to resolve AnimeCard', error, anime);
          const errorPlaceholder = document.createElement('div');
          errorPlaceholder.className = 'anime-card-error-placeholder';
          errorPlaceholder.style.cssText = 'padding: 10px; background: rgba(255,0,0,0.1); border-radius: 4px; font-size: 10px; color: #ff8888; margin-bottom: 4px;';

          const icon = document.createElement('i');
          icon.className = 'fa fa-bug';
          errorPlaceholder.appendChild(icon);

          const errorMessage = error instanceof Error ? error.message : 'Unknown';
          const errorText = document.createTextNode(` Card Error: ${errorMessage}`);
          errorPlaceholder.appendChild(errorText);

          entriesContainer.appendChild(errorPlaceholder);
          return null;
        }
      }).filter((c): c is AnimeCard => c !== null);

      // Show expand/collapse button if we're limiting
      const maxCards = this.props.cardOptions.maxCardsPerDay;
      if (maxCards > 0 && entries.length > maxCards) {
        const remaining = entries.length - maxCards;
        const toggleBtn = this.createElement('button', { class: 'calendar-day-column__toggle' });
        toggleBtn.setAttribute('data-toggle', 'expand');
        toggleBtn.setAttribute('aria-expanded', this.isExpanded ? 'true' : 'false');
        toggleBtn.setAttribute('aria-label', this.isExpanded ? 'Show fewer anime' : `Show ${remaining} more anime`);
        toggleBtn.textContent = this.isExpanded ? 'Show less' : `+${remaining} more`;
        entriesContainer.appendChild(toggleBtn);
      }
    }

    column.appendChild(entriesContainer);

    return column;
  }

  protected attachEvents(): void {
    // Expand/collapse toggle
    const toggleBtn = this.element.querySelector('.calendar-day-column__toggle');
    if (toggleBtn) {
      this.addEventListener(toggleBtn as HTMLElement, 'click', () => {
        this.toggleExpand();
      });
    }
  }

  /**
   * Toggle expand/collapse for max cards limit
   */
  private toggleExpand(): void {
    this.isExpanded = !this.isExpanded;

    const maxCards = this.props.cardOptions.maxCardsPerDay;
    const toggleBtn = this.element.querySelector('.calendar-day-column__toggle') as HTMLButtonElement;

    if (this.isExpanded) {
      // Show all cards
      this.animeCards.forEach((card) => {
        card.show();
      });

      if (toggleBtn) {
        toggleBtn.textContent = 'Show less';
      }
    } else {
      // Hide cards beyond limit
      this.animeCards.forEach((card, index) => {
        if (maxCards > 0 && index >= maxCards) {
          card.hide();
        }
      });

      if (toggleBtn) {
        const remaining = this.props.entries.length - maxCards;
        toggleBtn.textContent = `+${remaining} more`;
      }
    }
  }

  /**
   * Update all anime cards (for countdown updates)
   */
  public updateCardTimes(timeFormat: 'release' | 'countdown'): void {
    this.animeCards.forEach((card) => card.updateTime(timeFormat));
  }

  /**
   * Get the day name
   */
  public getDay(): string {
    return this.props.day;
  }

  /**
   * Get number of entries
   */
  public getEntryCount(): number {
    return this.props.entries.length;
  }

  /**
   * Check if column is empty
   */
  public isEmpty(): boolean {
    return this.props.entries.length === 0;
  }

  protected onUnmount(): void {
    // Clean up anime cards
    this.animeCards.forEach((card) => card.unmount());
    this.animeCards = [];
  }
}
