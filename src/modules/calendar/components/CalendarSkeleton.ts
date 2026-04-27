import { BaseComponent } from '@/ui/components/BaseComponent';

/**
 * @file CalendarSkeleton.ts
 * @description Loading placeholder component that mimics the calendar grid layout
 */
export class CalendarSkeleton extends BaseComponent {
  protected render(): HTMLElement {
    const container = this.createElement('div', { 
      class: 'calendar-grid calendar-grid--skeleton' 
    });

    // Render 7 columns (one for each day)
    for (let i = 0; i < 7; i++) {
      const column = this.createElement('div', { class: 'day-column' });
      
      const header = this.createElement('div', { class: 'day-header' });
      header.appendChild(this.createElement('div', { class: 'au-skeleton au-skeleton--text', style: 'width: 60px; height: 14px;' }));
      header.appendChild(this.createElement('div', { class: 'au-skeleton au-skeleton--text', style: 'width: 40px; height: 10px;' }));
      
      column.appendChild(header);

      // Render a random number of skeleton cards (2-4)
      const cardCount = 2 + Math.floor(Math.random() * 3);
      for (let j = 0; j < cardCount; j++) {
        column.appendChild(this.renderSkeletonCard());
      }

      container.appendChild(column);
    }

    return container;
  }

  /**
   * Renders a single skeleton anime card
   */
  private renderSkeletonCard(): HTMLElement {
    const card = this.createElement('div', { class: 'anime-card anime-card--skeleton' });
    
    // Image placeholder
    const imagePlaceholder = this.createElement('div', { 
      class: 'au-skeleton au-skeleton--rect',
      style: 'height: 120px; margin-bottom: 8px;' 
    });
    card.appendChild(imagePlaceholder);

    // Title placeholder
    const titlePlaceholder = this.createElement('div', { 
      class: 'au-skeleton au-skeleton--text',
      style: 'width: 90%;' 
    });
    card.appendChild(titlePlaceholder);

    // Subtitle/Info placeholder
    const infoPlaceholder = this.createElement('div', { 
      class: 'au-skeleton au-skeleton--text',
      style: 'width: 60%; font-size: 0.8em;' 
    });
    card.appendChild(infoPlaceholder);

    return card;
  }
}
