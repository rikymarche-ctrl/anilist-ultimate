import { parseRatingDate } from './AstraRatingFormDraft';
import type { AstraRatingViewScope } from './AstraRatingViewScope';

const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const weekdays = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const isoDate = (year: number, month: number, day: number): string =>
  `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

export function formatDateDisplay(iso: string): string {
  const date = parseRatingDate(iso);
  if (!date) return 'Not set';
  if (!date.month) return String(date.year);
  const month = monthNames[date.month - 1].slice(0, 3);
  return date.day ? `${date.day} ${month} ${date.year}` : `${month} ${date.year}`;
}

export interface MiniCalendarDateParts { month: string; day: string; year: string }

export function miniCalendarDateParts(iso: string): MiniCalendarDateParts {
  const date = parseRatingDate(iso);
  if (!date) return { month: 'DATE', day: '+', year: 'Set' };
  return {
    month: date.month ? monthNames[date.month - 1].slice(0, 3).toUpperCase() : 'YEAR',
    day: date.day ? String(date.day) : '—',
    year: String(date.year),
  };
}

export function formatEpisodeDate(timestamp?: number): string {
  if (!timestamp) return '-- / --';
  const date = new Date(timestamp);
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getFullYear()).slice(-2)}`;
}

export function formatEpisodeTime(timestamp?: number): string {
  if (!timestamp) return '--:--';
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

interface CalendarMonth { year: number; month: number }
function monthFor(iso: string, now: Date): CalendarMonth {
  // An invalid DOM value remains untouched so the form's save validation can reject it.
  try {
    const date = parseRatingDate(iso);
    if (date) return { year: date.year!, month: date.month ? date.month - 1 : 0 };
  } catch { /* Only the calendar view falls back. */ }
  return { year: now.getFullYear(), month: now.getMonth() };
}

/** A browsed month only lives for one open session; closing or reopening starts from the selected value. */
function clearBrowsedMonth(picker: HTMLElement): void {
  delete picker.dataset.viewYear; delete picker.dataset.viewMonth;
}

function viewMonth(picker: HTMLElement, selected: string, now: Date): CalendarMonth {
  const year = Number(picker.dataset.viewYear); const month = Number(picker.dataset.viewMonth);
  return picker.dataset.viewYear && picker.dataset.viewMonth !== undefined && Number.isInteger(year) && year >= 1 && year <= 2147483647
    && Number.isInteger(month) && month >= 0 && month <= 11 ? { year, month } : monthFor(selected, now);
}

function calendarHtml({ year, month }: CalendarMonth, selectedIso: string, now: Date): string {
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  // Gregorian arithmetic also handles fuzzy years outside the native Date range,
  // without Date's special interpretation of years 0–99 as 1900–1999.
  const previousYear = year - 1;
  const elapsed = 365 * previousYear + Math.floor(previousYear / 4) - Math.floor(previousYear / 100) + Math.floor(previousYear / 400);
  const startDow = (elapsed + days.slice(0, month).reduce((sum, value) => sum + value, 0) + 1) % 7;
  const today = isoDate(now.getFullYear(), now.getMonth(), now.getDate());
  let cells = '<span class="astra-cal-day astra-cal-day--empty"></span>'.repeat(startDow);
  for (let day = 1; day <= days[month]; day++) {
    const iso = isoDate(year, month, day);
    const classes = ['astra-cal-day', ...(iso === selectedIso ? ['astra-cal-day--selected'] : []), ...(iso === today ? ['astra-cal-day--today'] : [])];
    cells += `<button type="button" class="${classes.join(' ')}" data-day="${iso}">${day}</button>`;
  }
  return `
    <div class="astra-cal-header">
      <span class="astra-cal-title">${monthNames[month]} ${year}</span>
      <div class="astra-cal-nav">
        <button type="button" class="astra-cal-nav-btn" data-nav="prev"><i class="fa-solid fa-chevron-left"></i></button>
        <button type="button" class="astra-cal-nav-btn" data-nav="next"><i class="fa-solid fa-chevron-right"></i></button>
      </div>
    </div>
    <div class="astra-cal-grid astra-cal-dow">${weekdays.map(day => `<span class="astra-cal-dow-cell">${day}</span>`).join('')}</div>
    <div class="astra-cal-grid astra-cal-days">${cells}</div>
    <div class="astra-cal-footer">
      <button type="button" class="astra-cal-action" data-clear>Clear</button>
      <button type="button" class="astra-cal-action astra-cal-action--accent" data-today>Today</button>
    </div>`;
}

interface DatePickerBinding {
  picker: HTMLElement;
  trigger: HTMLElement;
  menu: HTMLElement;
  scope: AstraRatingViewScope;
  activeSelector: string;
  selectedIso(): string;
  extraHtml?(): string;
  select(iso: string): void;
  resetViewOnToday?: boolean;
}

/** All listeners are owned by the supplied rendered view; no global resources. */
function bindCalendar(options: DatePickerBinding): void {
  const { picker, trigger, menu, scope } = options;
  const render = (view = viewMonth(picker, options.selectedIso(), new Date())) => {
    picker.dataset.viewYear = String(view.year); picker.dataset.viewMonth = String(view.month);
    menu.innerHTML = calendarHtml(view, options.selectedIso(), new Date()) + (options.extraHtml?.() ?? '');
  };
  scope.listen(trigger, 'click', event => {
    event.stopPropagation();
    const wasActive = picker.classList.contains('active');
    // Journal and form controls retain their existing independent dropdown groups.
    scope.root.querySelectorAll(options.activeSelector).forEach(other => other.classList.remove('active'));
    clearBrowsedMonth(picker);
    if (!wasActive) { render(); picker.classList.add('active'); }
  });
  scope.listen(menu, 'click', event => {
    event.stopPropagation();
    if (!(event.target instanceof Element)) return;
    const action = event.target.closest<HTMLElement>('[data-nav], [data-day], [data-clear], [data-today]');
    if (!action || !menu.contains(action)) return;
    if (action.dataset.nav !== undefined) {
      if (action.dataset.nav !== 'next' && action.dataset.nav !== 'prev') return;
      let { year, month } = viewMonth(picker, options.selectedIso(), new Date());
      month += action.dataset.nav === 'next' ? 1 : -1;
      if (month < 0) { month = 11; year--; } else if (month > 11) { month = 0; year++; }
      if (year >= 1 && year <= 2147483647) render({ year, month });
      return;
    }
    let iso: string;
    if (action.hasAttribute('data-clear')) iso = '';
    else if (action.hasAttribute('data-today')) {
      const now = new Date(); iso = isoDate(now.getFullYear(), now.getMonth(), now.getDate());
    } else {
      iso = action.dataset.day ?? '';
      try { if (!parseRatingDate(iso)?.day) return; } catch { return; }
    }
    options.select(iso);
    if (action.hasAttribute('data-today') && options.resetViewOnToday) {
      clearBrowsedMonth(picker);
    }
    picker.classList.remove('active');
  });
}

export function bindRatingDatePicker(picker: HTMLElement, scope: AstraRatingViewScope, changed: () => void): void {
  const trigger = picker.querySelector<HTMLElement>('.astra-dropdown-trigger');
  const menu = picker.querySelector<HTMLElement>('.astra-datepicker-menu');
  const hidden = [...scope.root.querySelectorAll<HTMLInputElement>('input')].find(input => input.id === picker.dataset.target);
  const label = picker.querySelector<HTMLElement>('.astra-dp-label');
  if (!trigger || !menu || !hidden || !label) return;
  const updateDatePresentation = (iso: string) => {
    const display = formatDateDisplay(iso);
    label.textContent = display;
    const parts = miniCalendarDateParts(iso);
    const month = picker.querySelector<HTMLElement>('.astra-mini-calendar-month');
    const day = picker.querySelector<HTMLElement>('.astra-mini-calendar-day');
    const year = picker.querySelector<HTMLElement>('.astra-mini-calendar-year');
    if (month) month.textContent = parts.month;
    if (day) day.textContent = parts.day;
    if (year) year.textContent = parts.year;
    const fieldLabel = picker.closest('.astra-input-box')?.querySelector('.astra-label-xs')?.textContent?.trim() || 'Date';
    trigger.setAttribute('aria-label', `${fieldLabel}: ${formatDateDisplay(iso)}. Click to choose date`);
  };
  bindCalendar({ picker, trigger, menu, scope, activeSelector: '.astra-dropdown.active', selectedIso: () => hidden.value,
    resetViewOnToday: true, select: iso => {
      hidden.value = iso; hidden.dataset.dateEdited = 'true'; updateDatePresentation(iso); changed();
    } });
}

export function bindEpisodeDatePicker(picker: HTMLElement, scope: AstraRatingViewScope, changed: () => void): void {
  const trigger = picker.querySelector<HTMLElement>('.astra-ep-date-trigger');
  const menu = picker.querySelector<HTMLElement>('.astra-ep-date-menu');
  if (!trigger || !menu) return;
  const timestamp = () => {
    const value = Number(picker.dataset.timestamp || 0);
    return value && Number.isFinite(value) && !Number.isNaN(new Date(value).getTime()) ? value : undefined;
  };
  bindCalendar({ picker, trigger, menu, scope, activeSelector: '.astra-ep-date-picker.active',
    selectedIso: () => {
      const value = timestamp(); if (!value) return '';
      const date = new Date(value); return isoDate(date.getFullYear(), date.getMonth(), date.getDate());
    }, extraHtml: () => {
      const selected = new Date(timestamp() ?? Date.now());
      return `<label class="astra-ep-time-field">Time <input type="time" value="${formatEpisodeTime(selected.getTime())}"></label>`;
    }, select: iso => {
      let value: number | undefined;
      if (iso) {
        const date = parseRatingDate(iso)!;
        const [hours, minutes] = (menu.querySelector<HTMLInputElement>('input[type="time"]')?.value || '00:00').split(':').map(Number);
        const local = new Date(0); local.setFullYear(date.year!, date.month! - 1, date.day!); local.setHours(hours, minutes, 0, 0);
        value = local.getTime();
      }
      picker.dataset.timestamp = value ? String(value) : '';
      // Only a committed or cleared date may overwrite the episode's stored timestamp on save.
      picker.dataset.edited = '1';
      const day = picker.querySelector('.astra-ep-date-day'); const time = picker.querySelector('.astra-ep-date-time');
      if (day) day.textContent = formatEpisodeDate(value);
      if (time) time.textContent = formatEpisodeTime(value);
      changed();
    } });
}
