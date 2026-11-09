/**
 * @file MediaThemeRatings.ts
 * @description Mounts a per-song rating slider in each opening/ending card of the anime page.
 */

import type { IThemeRatingPrompt, ThemePromptSong } from '@core/interfaces/IThemeRatingPrompt';
import { createThemeRatingControl } from '@ui/components/ThemeRatingControl';
import type { JikanThemeData } from './interfaces/IMediaMusicModule';
import { parseThemeSongs } from './MediaThemeSongs';

/** Cards carry `data-au-theme-card="OP:0"` (kind + list index) and a `.au-theme-rate-slot`. */
export async function mountThemeRatings(container: HTMLElement, mediaId: number, themes: JikanThemeData,
  prompt: IThemeRatingPrompt, isCurrent: () => boolean): Promise<void> {
  const { enabled, kinds } = await prompt.availability();
  if (!enabled || !isCurrent() || !container.isConnected) return;
  const songs: ThemePromptSong[] = parseThemeSongs(themes, mediaId)
    .map(({ id, kind, title, artist }) => ({ id, kind, title, artist }));
  const indexed = { OP: songs.filter(song => song.kind === 'OP'), ED: songs.filter(song => song.kind === 'ED') };
  const scores = await prompt.getScores(mediaId, songs);
  if (!isCurrent() || !container.isConnected) return;
  for (const card of container.querySelectorAll<HTMLElement>('[data-au-theme-card]')) {
    const [kind, index] = (card.dataset.auThemeCard ?? '').split(':');
    const song = (kind === 'OP' || kind === 'ED') ? indexed[kind][Number(index)] : undefined;
    const slot = card.querySelector('.au-theme-rate-slot');
    if (!song || !slot || slot.childElementCount) continue;
    if (kinds[song.kind] === 'unset') {
      // One reminder per list, on its first card, until the kind is set up in the settings.
      if (index === '0') slot.append(linkReminder(song.kind));
      continue;
    }
    slot.append(createThemeRatingControl({
      label: `Rate ${song.kind === 'OP' ? 'opening' : 'ending'} "${song.title}"`,
      score: scores[song.id] ?? null,
      onRate: score => prompt.rate(mediaId, song, score),
      counted: kinds[song.kind] === 'linked',
    }));
  }
}

function linkReminder(kind: 'OP' | 'ED'): HTMLElement {
  const note = document.createElement('p');
  note.className = 'au-theme-rate-hint';
  const what = kind === 'OP' ? 'Openings' : 'Endings';
  note.textContent = `To rate these songs, choose a score section for ${what} (or "Not counted") in Astra settings → Global Preferences → Rate openings and endings.`;
  return note;
}
