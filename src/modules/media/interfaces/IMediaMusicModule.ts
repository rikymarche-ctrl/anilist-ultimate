/**
 * @interface JikanThemeData
 * @description Structure of themes returned by Jikan API
 */
export interface JikanThemeData {
  openings: string[];
  endings: string[];
}

/**
 * @interface IMediaMusicModule
 * @description Contract for the module that injects openings/endings into media pages
 */
export interface IMediaMusicModule {
  /**
   * Initializes the music injection logic on media pages
   */
  init(): void;

  /**
   * Fetches and renders themes for a specific media
   * @param mediaId AniList Media ID
   * @param idMal MyAnimeList ID
   */
  renderMusicThemes(idMal: number): Promise<void>;
}
