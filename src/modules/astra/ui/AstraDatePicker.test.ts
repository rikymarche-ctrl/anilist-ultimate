import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bindEpisodeDatePicker, bindRatingDatePicker, miniCalendarDateParts } from './AstraDatePicker';
import { AstraRatingViewScope } from './AstraRatingViewScope';

const scopes: AstraRatingViewScope[] = [];
function setup(episode = false, value = '') {
  const root = document.createElement('div'); document.body.appendChild(root);
  root.innerHTML = episode
    ? '<div class="astra-ep-date-picker"><button class="astra-ep-date-trigger"></button><span class="astra-ep-date-day"></span><span class="astra-ep-date-time"></span><div class="astra-ep-date-menu"></div></div>'
    : '<div class="astra-dropdown astra-datepicker" data-target="date"><button class="astra-dropdown-trigger"><span class="astra-mini-calendar-month"></span><span class="astra-mini-calendar-day"></span><span class="astra-mini-calendar-year"></span><span class="astra-dp-label"></span></button><div class="astra-datepicker-menu"></div></div><input id="date" type="hidden">';
  const picker = root.firstElementChild as HTMLElement;
  const input = root.querySelector<HTMLInputElement>('input');
  if (episode) picker.dataset.timestamp = value; else input!.value = value;
  const changed = vi.fn(); const failed = vi.fn();
  const scope = new AstraRatingViewScope(root, () => true, failed); scopes.push(scope);
  if (episode) bindEpisodeDatePicker(picker, scope, changed); else bindRatingDatePicker(picker, scope, changed);
  const click = (selector: string) => picker.querySelector<HTMLButtonElement>(selector)!.click();
  const open = () => click(episode ? '.astra-ep-date-trigger' : '.astra-dropdown-trigger');
  return { root, picker, input, changed, failed, scope, click, open };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 0, 15, 10, 30)); document.body.innerHTML = ''; });
afterEach(() => { for (const scope of scopes.splice(0)) scope.release(); document.body.innerHTML = ''; vi.useRealTimers(); });

describe('shared Astra date picker contracts', () => {
  it.each([
    ['2026-10-14', { month: 'OCT', day: '14', year: '2026' }],
    ['2026-03', { month: 'MAR', day: '—', year: '2026' }],
    ['2026', { month: 'YEAR', day: '—', year: '2026' }],
    ['', { month: 'DATE', day: '+', year: 'Set' }],
  ])('renders a compact date tile for %s', (iso, parts) => {
    expect(miniCalendarDateParts(iso)).toEqual(parts);
  });

  it.each([['2026', 'January 2026'], ['2026-03', 'March 2026'], ['2028-02-29', 'February 2028'], ['', 'January 2026']])(
    'opens %s without rewriting its fuzzy/absent value', (value, title) => {
      const f = setup(false, value); f.open();
      expect(f.picker.querySelector('.astra-cal-title')?.textContent).toBe(title);
      expect(f.input!.value).toBe(value); expect(f.input!.dataset.dateEdited).toBeUndefined(); expect(f.changed).not.toHaveBeenCalled();
      expect(f.picker.querySelectorAll('.astra-cal-day--selected')).toHaveLength(value === '2028-02-29' ? 1 : 0);
    });

  it('rolls December forward and January backward while preserving selected day and focus', () => {
    const f = setup(false, '2026-12-31'); f.open();
    f.click('[data-nav="next"] i');
    expect(f.picker.querySelector('.astra-cal-title')?.textContent).toBe('January 2027');
    f.click('[data-nav="prev"] i');
    expect(f.picker.querySelector('.astra-cal-title')?.textContent).toBe('December 2026');
    expect(f.input!.value).toBe('2026-12-31'); expect(f.changed).not.toHaveBeenCalled();
    const day = f.picker.querySelector<HTMLButtonElement>('[data-day="2026-12-30"]')!; day.focus(); day.click();
    expect(document.activeElement).toBe(day); expect(f.input!.value).toBe('2026-12-30');
    expect(f.input!.dataset.dateEdited).toBe('true'); expect(f.picker.querySelector('.astra-dp-label')?.textContent).toBe('30 Dec 2026');
    expect(f.picker.querySelector('.astra-mini-calendar-month')?.textContent).toBe('DEC');
    expect(f.picker.querySelector('.astra-mini-calendar-day')?.textContent).toBe('30');
    expect(f.picker.querySelector('.astra-mini-calendar-year')?.textContent).toBe('2026');
    expect(f.changed).toHaveBeenCalledOnce(); expect(f.picker.classList.contains('active')).toBe(false);
  });

  it('distinguishes opening an absent field from explicitly clearing it and resets Today navigation', () => {
    const f = setup(); f.open(); f.click('[data-clear]'); expect(f.changed).toHaveBeenCalledOnce();
    expect(f.input!.dataset.dateEdited).toBe('true'); expect(f.picker.querySelector('.astra-dp-label')?.textContent).toBe('Not set');
    expect(f.picker.querySelector('.astra-mini-calendar-month')?.textContent).toBe('DATE');
    expect(f.picker.querySelector('.astra-mini-calendar-day')?.textContent).toBe('+');
    expect(f.picker.querySelector('.astra-mini-calendar-year')?.textContent).toBe('Set');
    f.open(); f.click('[data-nav="next"]'); f.click('[data-today]');
    expect(f.input!.value).toBe('2026-01-15'); expect(f.picker.dataset.viewYear).toBeUndefined(); expect(f.picker.dataset.viewMonth).toBeUndefined();
    f.open(); expect(f.picker.querySelector('.astra-cal-day--selected')?.textContent).toBe('15');
  });

  it.each([['NaN', '3'], ['2027', '12'], ['0', '0'], ['2027.2', '1'], ['', ''], ['2027', 'oops']])(
    'ignores malformed view metadata %s/%s without changing the stored date', (year, month) => {
      const f = setup(false, '2028-02'); f.picker.dataset.viewYear = year; f.picker.dataset.viewMonth = month; f.open();
      expect(f.picker.querySelector('.astra-cal-title')?.textContent).toBe('February 2028'); expect(f.input!.value).toBe('2028-02');
      expect(f.picker.querySelectorAll('[data-day]')).toHaveLength(29); expect(f.failed).not.toHaveBeenCalled();
    });

  it.each(['invalid', '2026-02-31'])('does not repair invalid hidden date %s merely by opening the view', value => {
    const f = setup(false, value); f.open();
    expect(f.picker.querySelector('.astra-cal-title')?.textContent).toBe('January 2026'); expect(f.input!.value).toBe(value);
    expect(f.changed).not.toHaveBeenCalled(); expect(f.failed).not.toHaveBeenCalled();
  });

  it.each([['0004-02', 29], ['0100-02', 28], ['0400-02', 29], ['2147483647-02', 28]])(
    'renders Gregorian fuzzy year %s without Date rollover or a new year limit', (value, count) => {
      const f = setup(false, value); f.open(); expect(f.picker.querySelectorAll('[data-day]')).toHaveLength(count);
      expect(f.input!.value).toBe(value); expect(f.picker.querySelector('[data-day]')?.getAttribute('data-day')).toBe(value + '-01');
    });

  it('uses January 1 year 1 weekday and cannot navigate outside the accepted date range', () => {
    const f = setup(false, '0001-01'); f.open(); expect(f.picker.querySelectorAll('.astra-cal-day--empty')).toHaveLength(1);
    f.click('[data-nav="prev"]'); expect(f.picker.querySelector('.astra-cal-title')?.textContent).toBe('January 1');
    f.picker.dataset.viewYear = '2147483647'; f.picker.dataset.viewMonth = '10'; f.click('[data-nav="next"]');
    expect(f.picker.querySelector('.astra-cal-title')?.textContent).toBe('December 2147483647');
    f.click('[data-nav="next"]');
    expect(f.picker.querySelector('.astra-cal-title')?.textContent).toBe('December 2147483647');
  });

  it('closes only the existing form dropdown group when another form date opens', () => {
    const f = setup(); const other = document.createElement('div'); other.className = 'astra-dropdown active'; f.root.appendChild(other);
    const journal = document.createElement('div'); journal.className = 'astra-ep-date-picker active'; f.root.appendChild(journal);
    f.open(); expect(other.classList.contains('active')).toBe(false); expect(journal.classList.contains('active')).toBe(true);
    f.open(); expect(f.picker.classList.contains('active')).toBe(false);
  });

  it('preserves local time while choosing journal dates, and uses midnight if the time is explicitly empty', () => {
    const initial = new Date(2026, 11, 31, 23, 45).getTime(); const f = setup(true, String(initial)); f.open();
    expect(f.picker.querySelector('.astra-cal-day--selected')?.textContent).toBe('31');
    expect(f.picker.querySelector<HTMLInputElement>('input[type="time"]')?.value).toBe('23:45');
    f.click('[data-nav="next"]'); f.click('[data-day="2027-01-02"]');
    expect(Number(f.picker.dataset.timestamp)).toBe(new Date(2027, 0, 2, 23, 45).getTime());
    expect(f.picker.querySelector('.astra-ep-date-day')?.textContent).toBe('02/01/27');
    expect(f.picker.querySelector('.astra-ep-date-time')?.textContent).toBe('23:45');
    f.open(); f.picker.querySelector<HTMLInputElement>('input[type="time"]')!.value = ''; f.click('[data-day="2027-01-03"]');
    expect(Number(f.picker.dataset.timestamp)).toBe(new Date(2027, 0, 3, 0, 0).getTime()); expect(f.changed).toHaveBeenCalledTimes(2);
  });

  it('keeps journal Today time and Clear absence conventions', () => {
    const f = setup(true); f.open(); f.picker.querySelector<HTMLInputElement>('input[type="time"]')!.value = '07:12'; f.click('[data-today]');
    expect(Number(f.picker.dataset.timestamp)).toBe(new Date(2026, 0, 15, 7, 12).getTime());
    f.open(); f.click('[data-clear]'); expect(f.picker.dataset.timestamp).toBe('');
    expect(f.picker.querySelector('.astra-ep-date-day')?.textContent).toBe('-- / --'); expect(f.picker.querySelector('.astra-ep-date-time')?.textContent).toBe('--:--');
  });

  it('opens invalid journal timestamps safely without mutating them', () => {
    const f = setup(true, 'NaN'); f.open(); expect(f.picker.querySelector('.astra-cal-title')?.textContent).toBe('January 2026');
    expect(f.picker.dataset.timestamp).toBe('NaN'); expect(f.changed).not.toHaveBeenCalled();
  });

  it.each([false, true])('makes both calendar listeners inert after their scope is released (episode=%s)', episode => {
    const f = setup(episode, episode ? String(new Date(2026, 0, 1).getTime()) : '2026-01-01'); f.open();
    const select = f.picker.querySelector<HTMLButtonElement>('[data-day="2026-01-02"]')!;
    f.scope.release(); select.click(); f.open(); expect(f.changed).not.toHaveBeenCalled();
    expect(episode ? f.picker.dataset.timestamp : f.input!.value).toBe(episode ? String(new Date(2026, 0, 1).getTime()) : '2026-01-01');
  });

  it('rejects stale individual controls and malformed forged day/nav actions', () => {
    const f = setup(); f.open();
    const day = f.picker.querySelector<HTMLButtonElement>('[data-day]')!; day.dataset.day = '2026-02-31'; day.click();
    const nav = f.picker.querySelector<HTMLButtonElement>('[data-nav]')!; nav.dataset.nav = 'unknown'; nav.click();
    expect(f.changed).not.toHaveBeenCalled(); expect(f.failed).not.toHaveBeenCalled();
    f.picker.querySelector('.astra-datepicker-menu')!.remove(); day.dataset.day = '2026-01-01'; day.click(); expect(f.changed).not.toHaveBeenCalled();
  });

  it('does not bind incomplete form or journal markup', () => {
    const f = setup(); f.scope.release(); const scope = new AstraRatingViewScope(f.root, () => true, f.failed); scopes.push(scope);
    f.picker.querySelector('.astra-dp-label')!.remove(); bindRatingDatePicker(f.picker, scope, f.changed);
    bindEpisodeDatePicker(f.picker, scope, f.changed); f.open(); expect(f.picker.querySelector('[data-day]')).toBeNull();
  });
});

describe('Astra date picker browsing state', () => {
  it('discards a browsed but unselected month when the menu closes or reopens', () => {
    const f = setup(); f.open(); f.click('[data-nav="next"]');
    expect(f.picker.querySelector('.astra-cal-title')?.textContent).toBe('February 2026');
    f.open();
    expect(f.picker.dataset.viewYear).toBeUndefined(); expect(f.picker.dataset.viewMonth).toBeUndefined();
    f.open(); expect(f.picker.querySelector('.astra-cal-title')?.textContent).toBe('January 2026');
    f.click('[data-nav="next"]'); f.picker.classList.remove('active');
    f.open(); expect(f.picker.querySelector('.astra-cal-title')?.textContent).toBe('January 2026');
  });

  it('marks an episode date as edited only after the user commits it', () => {
    const f = setup(true, ''); f.open();
    expect(f.picker.dataset.edited).toBeUndefined();
    f.click('[data-day="2026-01-10"]');
    expect(f.picker.dataset.edited).toBe('1');
  });
});
