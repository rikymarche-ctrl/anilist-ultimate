/**
 * @file IThemeRatingPrompt.ts
 * @description Contract between the progress toast and per-song OP/ED ratings.
 */

export interface ThemePromptSong {
  id: string;
  kind: 'OP' | 'ED';
  title: string;
  artist: string;
  /** False when the rating fills no Astra section ("Not counted" in the settings). */
  counted?: boolean;
}

/** Per kind: fills a section, rated without counting, or never set up in the settings. */
export type ThemeKindState = 'linked' | 'uncounted' | 'unset';

/** Song ratings are on, and how each kind was set up in the Astra settings. */
export interface ThemeRatingAvailability {
  enabled: boolean;
  kinds: Record<'OP' | 'ED', ThemeKindState>;
}

export interface IThemeRatingPrompt {
  /** Whether to show sliders (set-up kinds) or a reminder to set them up (unset kinds). */
  availability(): Promise<ThemeRatingAvailability>;
  /** Unrated songs that start within (previous, next]; reads cached data only, never the network. */
  findNewThemes(mediaId: number, previous: number, next: number): Promise<ThemePromptSong[]>;
  /** Current scores by song id (matched by id, or by kind + title after a renumbering). */
  getScores(mediaId: number, songs: ThemePromptSong[]): Promise<Record<string, number | null>>;
  /** Saves one song's score (0.1-10), or clears it with null. */
  rate(mediaId: number, song: ThemePromptSong, score: number | null): Promise<void>;
}
