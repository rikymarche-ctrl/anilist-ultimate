import { afterEach, describe, expect, it, vi } from 'vitest';
import { AstraWrappedView } from './AstraWrappedView';
import { localDateKey } from '../services/AstraWrapped';
import * as imageExport from './AstraWrappedImage';
import { HOSTILE_TITLE, PRIVATE_TITLE, yearReviewData } from '@/test/year-review-fixtures';
import type { YearReviewData } from '../services/year/YearReviewService';

const views: AstraWrappedView[] = [];
afterEach(() => {
  for (const view of views.splice(0)) view.unmount();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const flush = async () => {
  for (let index = 0; index < 6; index++) await Promise.resolve();
};

function fixture(data: YearReviewData = yearReviewData()) {
  const years = {
    load: vi.fn(
      async (_period: unknown, _current: () => boolean, progress: (step: string) => void) => {
        progress('Reading your activity');
        return data;
      }
    ),
  };
  const back = vi.fn();
  const view = new AstraWrappedView(years as never, back);
  views.push(view);
  const mount = async () => {
    view.mount(document.body);
    await flush();
  };
  const root = () => view.getElement();
  const input = (name: string) => root().querySelector<HTMLInputElement>(`[name="${name}"]`)!;
  const slides = () => [...root().querySelectorAll<HTMLElement>('.aw-slide')];
  return { data, years, back, view, mount, root, input, slides };
}

describe('Astra Wrapped view', () => {
  it('loads this year from AniList and renders hostile titles as text', async () => {
    const f = fixture();
    await f.mount();
    expect(f.years.load).toHaveBeenCalledWith(
      { start: `${new Date().getFullYear()}-01-01`, end: localDateKey(new Date()) },
      expect.any(Function),
      expect.any(Function)
    );
    expect(f.root().querySelector('img')).toBeNull();
    expect(f.root().textContent).toContain(HOSTILE_TITLE.trim().slice(0, 30));
    expect(f.root().querySelector<HTMLButtonElement>('[data-wrapped-export]')!.disabled).toBe(
      false
    );
  });
  it('tells the story across the new chapters', async () => {
    const f = fixture();
    await f.mount();
    const labels = f.slides().map((slide) => slide.getAttribute('aria-label') ?? '');
    for (const chapter of [
      'Episodes watched',
      'Chapters read',
      'Your rhythm',
      'Your clock',
      'Your journey',
      'Top anime',
      'Top manga',
      'Your genres',
      'Your themes',
      'Your mix',
      'Your eras',
      'You vs AniList',
      'Popularity',
      'Top voice actor',
      'Top studio',
      'Top director',
      'Top composer',
      'Top author',
      'Your community',
      'Your persona',
      'Summary',
    ]) {
      expect(labels.some((label) => label.endsWith(chapter))).toBe(true);
    }
    expect(f.root().querySelector('[data-wrapped-characters]')!.children).toHaveLength(3);
    f.root().dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(f.slides().at(-1)!.classList.contains('is-active')).toBe(true);
  });
  it('excludes private titles until requested, without reloading', async () => {
    const f = fixture();
    await f.mount();
    expect(f.root().textContent).not.toContain(PRIVATE_TITLE);
    f.input('private').checked = true;
    f.input('private').dispatchEvent(new Event('change'));
    expect(f.root().textContent).toContain(PRIVATE_TITLE);
    expect(f.years.load).toHaveBeenCalledOnce();
  });
  it('validates custom dates locally and reloads only on Update recap or a preset', async () => {
    const f = fixture();
    await f.mount();
    f.input('start').value = '2030-01-01';
    f.input('start').dispatchEvent(new Event('change'));
    expect(f.root().querySelector<HTMLSelectElement>('[name="period"]')!.value).toBe('custom');
    expect(f.root().querySelector('[data-wrapped-status]')!.textContent).toContain('end date');
    expect(f.root().querySelector<HTMLButtonElement>('[data-wrapped-export]')!.disabled).toBe(true);
    expect(f.years.load).toHaveBeenCalledOnce();
    f.input('start').value = '1000-01-01';
    f.input('start').dispatchEvent(new Event('change'));
    f.root()
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    expect(f.root().querySelector('[data-wrapped-status]')!.textContent).toContain('100 years');
    expect(f.years.load).toHaveBeenCalledOnce();
    const period = f.root().querySelector<HTMLSelectElement>('[name="period"]')!;
    period.value = 'month';
    period.dispatchEvent(new Event('change'));
    await flush();
    expect(f.input('start').value.slice(0, 7)).toBe(localDateKey(new Date()).slice(0, 7));
    expect(f.years.load).toHaveBeenCalledTimes(2);
  });
  it('offers retry after a failed load and ignores a late result after unmount', async () => {
    const f = fixture();
    f.years.load.mockRejectedValueOnce(new Error('Offline'));
    await f.mount();
    expect(f.root().textContent).toContain('retry');
    let finish!: (data: YearReviewData) => void;
    f.years.load.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    f.root()
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { cancelable: true }));
    f.view.unmount();
    finish(f.data);
    await flush();
    expect(f.root().querySelector('.aw-story')).toBeNull();
  });
  it('explains sign-in when AniList is unavailable', async () => {
    const view = new AstraWrappedView(undefined, vi.fn());
    views.push(view);
    view.mount(document.body);
    await flush();
    expect(view.getElement().textContent).toContain('Sign in');
  });
  it('shows an empty stage with a shortcut to the period panel', async () => {
    const data = yearReviewData();
    data.input.activities = [];
    const f = fixture(data);
    await f.mount();
    expect(f.root().querySelector('.aw-story')).toBeNull();
    f.root().querySelector<HTMLButtonElement>('[data-wrapped-open-panel]')!.click();
    expect(f.root().querySelector<HTMLFormElement>('.aw-panel')!.hidden).toBe(false);
  });
  it('cancels pending PNG downloads when privacy changes or the view closes', async () => {
    const f = fixture();
    await f.mount();
    const callbacks: BlobCallback[] = [];
    vi.spyOn(imageExport, 'drawWrappedImage').mockReturnValue({
      toBlob: (callback: BlobCallback) => {
        callbacks.push(callback);
      },
    } as HTMLCanvasElement);
    const createObjectURL = vi.fn(() => 'blob:synthetic');
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });
    f.root().querySelector<HTMLButtonElement>('[data-wrapped-export]')!.click();
    await flush();
    f.input('private').checked = true;
    f.input('private').dispatchEvent(new Event('change'));
    callbacks[0](new Blob(['stale']));
    expect(createObjectURL).not.toHaveBeenCalled();
    f.root().querySelector<HTMLButtonElement>('[data-wrapped-export]')!.click();
    await flush();
    f.view.unmount();
    callbacks[1](new Blob(['closed']));
    expect(createObjectURL).not.toHaveBeenCalled();
  });
  it('returns through the dashboard control and toggles the period panel with Escape', async () => {
    const f = fixture();
    await f.mount();
    const toggle = f.root().querySelector<HTMLButtonElement>('[data-wrapped-customize]')!;
    const panel = f.root().querySelector<HTMLFormElement>('.aw-panel')!;
    toggle.click();
    expect(panel.hidden).toBe(false);
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    f.input('start').dispatchEvent(escape);
    expect(panel.hidden).toBe(true);
    expect(escape.defaultPrevented).toBe(true);
    const back = f.root().querySelector<HTMLButtonElement>('[data-wrapped-back]')!;
    back.click();
    expect(f.back).toHaveBeenCalledOnce();
    f.view.unmount();
    back.click();
    expect(f.back).toHaveBeenCalledOnce();
  });
});
