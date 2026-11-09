/**
 * @file AstraThemeLinks.ts
 * @description Rating-form block for sections linked to opening/ending ratings.
 *
 * A linked (sub-)section shows its songs, each with its own slider. Its own score is the
 * plain mean of the rated songs (unrated songs are skipped, not counted as 0), applied
 * through the form's own slider input path so state, live preview and save stay unchanged.
 * Song votes are saved right away; the Astra entry is saved with the form, as usual.
 */

import type { ThemePromptSong } from '@core/interfaces/IThemeRatingPrompt';
import { createThemeRatingControl } from '@ui/components/ThemeRatingControl';
import type { AstraScoreSource, AstraSection } from '../AstraInterfaces';
import { themeAverages, type ThemeMediaRatings } from '../store/AstraThemeRatings';
import { linkedScoreKeys, type LinkedScoreKey } from '../utils/AstraThemeScores';
import { findThemeValue } from '@/modules/media/MediaThemeSongs';

export interface AstraThemeLinkSource {
  getRatings(mediaId: number): Promise<ThemeMediaRatings>;
  /** Null when the song list could not be loaded. */
  getSongs(mediaId: number): Promise<ThemePromptSong[] | null>;
  saveSongScore(
    mediaId: number,
    song: ThemePromptSong,
    score: number | null
  ): Promise<ThemeMediaRatings>;
}

interface LinkBlock {
  link: LinkedScoreKey;
  list: HTMLElement;
  update(ratings: ThemeMediaRatings, mean: number | null): void;
}

const KIND_LABEL: Record<AstraScoreSource, string> = { OP: 'openings', ED: 'endings' };

export async function decorateThemeLinks(
  overlay: HTMLElement,
  mediaId: number,
  sections: AstraSection[],
  source: AstraThemeLinkSource,
  isCurrent: () => boolean,
  applyLinks = true
): Promise<void> {
  const [initial, songs] = await Promise.all([
    source.getRatings(mediaId),
    source.getSongs(mediaId),
  ]);
  if (!isCurrent()) return;
  let ratings = initial;
  const blocks = (applyLinks ? linkedScoreKeys(sections) : [])
    .map((link) => mountLink(overlay, link, songs))
    .filter((block): block is LinkBlock => block !== null);
  const refresh = () => {
    const averages = themeAverages(ratings.ratings);
    showMeans(overlay, averages);
    for (const block of blocks) block.update(ratings, averages[block.link.source]);
  };
  for (const block of blocks) {
    for (const song of (songs ?? []).filter((item) => item.kind === block.link.source)) {
      block.list.append(
        songRow(song, findThemeValue(ratings.ratings, song)?.score ?? null, async (score) => {
          ratings = await source.saveSongScore(mediaId, song, score);
          if (isCurrent()) refresh();
        })
      );
    }
  }
  refresh();
}

function mountLink(
  overlay: HTMLElement,
  link: LinkedScoreKey,
  songs: ThemePromptSong[] | null
): LinkBlock | null {
  const holder = [
    ...overlay.querySelectorAll<HTMLElement>(
      '.astra-score-input--sub[data-id], .astra-score-group[data-id]'
    ),
  ].find((element) => element.dataset.id === link.key);
  const slider = holder?.querySelector<HTMLInputElement>('.astra-slider');
  if (!holder || !slider) return null;
  holder.classList.add('astra-theme-linked');
  holder.querySelector<HTMLInputElement>('.astra-score-num-input')?.setAttribute('readonly', '');
  const note = document.createElement('span');
  note.className = 'astra-theme-linked-note';
  holder.querySelector('.astra-label-left')?.append(note);
  const list = document.createElement('div');
  list.className = 'astra-theme-songs';
  const total = songs?.filter((song) => song.kind === link.source).length ?? 0;
  if (!songs) list.textContent = `Could not load the ${KIND_LABEL[link.source]} for this anime. Try again later.`;
  else if (!total) list.textContent = `No ${KIND_LABEL[link.source]} listed for this anime.`;
  (slider.closest('.astra-slider-row, .astra-main-section') ?? slider).after(list);
  return {
    link,
    list,
    update(ratings, mean) {
      const rated = Object.values(ratings.ratings).filter(
        (rating) => rating.kind === link.source
      ).length;
      note.textContent = total
        ? `mean of ${KIND_LABEL[link.source]} · ${rated}/${total} rated`
        : `mean of ${KIND_LABEL[link.source]}`;
      const value = mean ?? 0;
      if (Math.abs(Number(slider.value) - value) < 0.05) return;
      slider.value = String(value);
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    },
  };
}

function songRow(
  song: ThemePromptSong,
  score: number | null,
  onRate: (score: number | null) => Promise<void>
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'astra-theme-song';
  const label = document.createElement('div');
  label.className = 'astra-theme-song__title';
  label.textContent = song.title;
  label.title = song.artist ? `${song.title} — ${song.artist}` : song.title;
  row.append(
    label,
    createThemeRatingControl({
      label: `Rate ${song.kind === 'OP' ? 'opening' : 'ending'} "${song.title}"`,
      score,
      onRate,
    })
  );
  return row;
}

function showMeans(overlay: HTMLElement, averages: Record<AstraScoreSource, number | null>): void {
  overlay.querySelector('.astra-theme-means')?.remove();
  const area = overlay.querySelector('.astra-overall-area');
  if (!area || (averages.OP === null && averages.ED === null)) return;
  const means = document.createElement('div');
  means.className = 'astra-theme-means';
  means.title = 'Mean of your opening and ending ratings';
  means.textContent = (['OP', 'ED'] as const)
    .filter((kind) => averages[kind] !== null)
    .map((kind) => `${kind} ${averages[kind]!.toFixed(1)}`)
    .join(' · ');
  area.after(means);
}
