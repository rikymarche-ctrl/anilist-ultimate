/**
 * @file ThemeRatingControl.ts
 * @description Compact Astra-scale slider (0.1-10, 0 = unrated) for one opening or ending.
 *
 * Shared by the song cards on the anime page and by the progress toast. Saves on release
 * (change), not on every input step, and reverts the value if the save fails.
 */

export interface ThemeRatingControlOptions {
  /** Accessible name, e.g. 'Rate "Guren no Yumiya"'. */
  label: string;
  score: number | null;
  onRate: (score: number | null) => Promise<void>;
  /** Called when the user starts interacting (the toast pauses its timer). */
  onInteract?: () => void;
  /** False: the rating fills no Astra section; a small tag says so. */
  counted?: boolean;
}

const format = (score: number | null) => (score === null ? '—' : score.toFixed(1));
const toScore = (value: string): number | null => {
  const score = Math.round(Number(value) * 10) / 10;
  return Number.isFinite(score) && score >= 0.1 ? Math.min(10, score) : null;
};

export function createThemeRatingControl(options: ThemeRatingControlOptions): HTMLElement {
  const root = document.createElement('div');
  root.className = 'au-theme-rate';
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.className = 'au-theme-rate__slider';
  slider.min = '0';
  slider.max = '10';
  slider.step = '0.1';
  slider.value = String(options.score ?? 0);
  slider.setAttribute('aria-label', options.label);
  const value = document.createElement('output');
  value.className = 'au-theme-rate__value';
  value.textContent = format(options.score);

  let saved = options.score;
  let pending: Promise<void> = Promise.resolve();
  const show = (score: number | null) => {
    value.textContent = format(score);
    // Filled part left of the thumb, like Astra's own sliders.
    slider.style.setProperty('--au-theme-fill', `${(score ?? 0) * 10}%`);
    root.classList.toggle('au-theme-rate--set', score !== null);
    slider.setAttribute(
      'aria-valuetext',
      score === null ? 'Not rated' : `${format(score)} out of 10`
    );
  };
  show(saved);

  slider.addEventListener('pointerdown', () => options.onInteract?.());
  slider.addEventListener('focus', () => options.onInteract?.());
  slider.addEventListener('input', () => {
    root.classList.remove('au-theme-rate--error');
    show(toScore(slider.value));
  });
  slider.addEventListener('change', () => {
    const score = toScore(slider.value);
    if (score === saved) return;
    pending = pending.then(async () => {
      root.classList.add('au-theme-rate--saving');
      try {
        await options.onRate(score);
        saved = score;
        root.removeAttribute('title');
      } catch {
        slider.value = String(saved ?? 0);
        show(saved);
        root.classList.add('au-theme-rate--error');
        root.title = 'Could not save this rating. Try again.';
      } finally {
        root.classList.remove('au-theme-rate--saving');
      }
    });
  });
  root.append(slider, value);
  if (options.counted === false) {
    const tag = document.createElement('span');
    tag.className = 'au-theme-rate__tag';
    tag.textContent = 'Not counted';
    tag.title = 'Saved with Astra, but not part of any score section (Astra settings)';
    root.append(tag);
  }
  return root;
}
