/** Weekday column; child cards belong to the mounted column lifecycle. */
import { injectable, inject } from 'tsyringe';
import type { DependencyContainer } from 'tsyringe';
import { BaseComponent } from '@ui/components/BaseComponent';
import { container } from '@core/di/container';
import { AnimeCard } from './AnimeCard';
import { CalendarStore } from '../CalendarStore';
import { TOKENS } from '@core/di/tokens';
import { ABBREVIATED_DAYS, DAYS_OF_WEEK } from '@core/constants';
import type { AnimeEntry, CardOptions, DayOfWeek } from '@core/types';
import { logger } from '@core/logger';

export interface DayColumnProps {
  day: DayOfWeek; entries: AnimeEntry[]; cardOptions: CardOptions;
  isToday?: boolean; isExpanded?: boolean;
}

@injectable()
export class DayColumn extends BaseComponent<DayColumnProps> {
  private animeCards: { card: AnimeCard; index: number }[] = [];
  constructor(
    @inject('DayColumnProps') props: DayColumnProps,
    @inject(TOKENS.CalendarStore) private store: CalendarStore,
    @inject(TOKENS.ComponentScope) private scope: DependencyContainer = container,
  ) { super(props); this.element = this.render(); }

  protected render(): HTMLElement {
    const { day, entries, isToday, cardOptions, isExpanded } = this.props;
    const column = this.createElement('div', { class: 'calendar-day-column' });
    column.classList.toggle('calendar-day-column--expanded', !!isExpanded);
    column.classList.toggle('calendar-day-column--today', !!isToday);
    column.classList.toggle('calendar-day-column--empty', entries.length === 0);
    column.classList.toggle('calendar-day-column--center-justify', cardOptions.columnJustify === 'center');
    column.dataset.day = day;
    const dayIndex = DAYS_OF_WEEK.findIndex(candidate => candidate === day);
    const today = new Date();
    const dayDiff = dayIndex < 0 ? 0 : (dayIndex - today.getDay() + 7) % 7;
    const date = new Date(today); date.setDate(today.getDate() + dayDiff);
    const header = this.createElement('div', { class: 'calendar-day-column__header' });
    const title = this.createElement('h2', { class: 'calendar-day-column__title' });
    const labels = [
      ['day-name', day], ['day-abbr', dayIndex >= 0 ? ABBREVIATED_DAYS[dayIndex] : day.slice(0, 3)],
      ['day-separator', '|'], ['day-number', String(date.getDate())],
    ];
    for (const [name, value] of labels) {
      const label = this.createElement('span', { class: `calendar-day-column__${name}` });
      label.textContent = value; title.append(label);
    }
    header.append(title); column.append(header);
    const content = this.createElement('div', { class: 'calendar-day-column__entries' });
    if (!entries.length) content.innerHTML = '<div class="calendar-day-column__empty-state"><p>No anime airing</p></div>';
    column.append(content); return column;
  }

  public override mount(parent: HTMLElement): void {
    if (this.mounted) return;
    this.element = this.render(); super.mount(parent);
  }

  protected onMount(): void {
    const content = this.element.querySelector<HTMLElement>('.calendar-day-column__entries')!;
    if (!this.props.entries.length) return;
    content.replaceChildren();
    this.props.entries.forEach((anime, index) => {
      let card: AnimeCard | undefined;
      try {
        const child = this.scope.createChildContainer();
        child.registerInstance('AnimeCardProps', { anime, options: this.props.cardOptions });
        card = child.resolve(AnimeCard); card.mount(content);
        this.animeCards.push({ card, index });
      } catch (error) {
        card?.unmount();
        logger.error('[DayColumn] Failed to mount card', error, { mediaId: anime.mediaId });
        const placeholder = this.createElement('div', { class: 'anime-card-error-placeholder' });
        placeholder.style.cssText = 'padding: 10px; background: rgba(255,0,0,0.1); border-radius: 4px; font-size: 10px; color: #ff8888; margin-bottom: 4px;';
        const icon = this.createElement('i', { class: 'fa-solid fa-bug' });
        placeholder.append(icon, document.createTextNode(` Card Error: ${error instanceof Error ? error.message : 'Unknown'}`));
        content.append(placeholder);
      }
    });
    this.syncVisibility();
  }

  private syncVisibility(): void {
    const { maxCardsPerDay } = this.props.cardOptions;
    this.animeCards.forEach(({ card, index }) => {
      if (maxCardsPerDay > 0 && index >= maxCardsPerDay && !this.props.isExpanded) card.hide();
      else card.show();
    });
    const content = this.element.querySelector<HTMLElement>('.calendar-day-column__entries')!;
    let toggle = content.querySelector<HTMLButtonElement>('.calendar-day-column__toggle');
    if (!(maxCardsPerDay > 0 && this.props.entries.length > maxCardsPerDay)) { toggle?.remove(); return; }
    if (!toggle) {
      toggle = this.createElement('button', { class: 'calendar-day-column__toggle', type: 'button', 'data-toggle': 'expand' });
      content.append(toggle);
    }
    const remaining = this.props.entries.length - maxCardsPerDay;
    toggle.setAttribute('aria-expanded', String(!!this.props.isExpanded));
    toggle.setAttribute('aria-label', this.props.isExpanded ? 'Show fewer anime' : `Show ${remaining} more anime`);
    toggle.textContent = this.props.isExpanded ? 'Show less' : `+${remaining} more`;
  }

  protected attachEvents(): void {
    this.addEventListener(this.element, 'click', event => {
      if (!this.mounted || !this.element.isConnected || !(event.target instanceof Element)) return;
      const toggle = event.target.closest('.calendar-day-column__toggle');
      if (!toggle || !this.element.contains(toggle)) return;
      event.preventDefault(); event.stopPropagation(); this.store.toggleExpandedDay(this.props.day);
    });
  }

  protected override shouldUpdate(prev: DayColumnProps, next: DayColumnProps): boolean {
    return prev.day !== next.day || prev.entries !== next.entries || prev.cardOptions !== next.cardOptions
      || prev.isExpanded !== next.isExpanded || prev.isToday !== next.isToday;
  }

  protected override onUpdate(prev: DayColumnProps): boolean {
    if (!this.mounted || prev.day !== this.props.day || prev.entries.length !== this.props.entries.length
      || this.animeCards.length !== this.props.entries.length
      || prev.entries.some((entry, index) => entry.mediaId !== this.props.entries[index].mediaId)) return false;
    this.element.classList.toggle('calendar-day-column--expanded', !!this.props.isExpanded);
    this.element.classList.toggle('calendar-day-column--today', !!this.props.isToday);
    this.element.classList.toggle('calendar-day-column--center-justify', this.props.cardOptions.columnJustify === 'center');
    this.animeCards.forEach(({ card, index }) => card.update({ anime: this.props.entries[index], options: this.props.cardOptions }));
    this.syncVisibility(); return true;
  }

  public updateCardTimes(timeFormat: 'release' | 'countdown'): void {
    if (!this.mounted || !this.element.isConnected) return;
    this.animeCards.forEach(({ card }) => card.updateTime(timeFormat));
  }
  public getDay(): string { return this.props.day; }
  public getEntryCount(): number { return this.props.entries.length; }
  public isEmpty(): boolean { return this.props.entries.length === 0; }
  protected onUnmount(): void {
    this.animeCards.forEach(({ card }) => card.unmount()); this.animeCards = [];
  }
}
