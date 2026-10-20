/** Complete synthetic response for the exact Astra initial-form selection. */
export function ratingResponse(mediaId = 1, userId = 42) {
  return {
    Viewer: { id: userId, mediaListOptions: { animeList: { customLists: ['Favorites'] }, mangaList: { customLists: ['Manga'] } } },
    Media: {
      id: mediaId, type: 'ANIME', format: 'TV', status: 'RELEASING', title: { userPreferred: 'Test' },
      episodes: 12, chapters: null, countryOfOrigin: 'JP', nextAiringEpisode: { episode: 5 },
      coverImage: { large: 'https://example.com/cover.jpg', extraLarge: null, color: null },
      mediaListEntry: { id: 1001, mediaId, userId, status: 'CURRENT', progress: 3, score: 5,
        notes: 'Remote text', repeat: 0, private: false, hiddenFromStatusLists: false,
        startedAt: { year: 2026, month: null, day: null }, completedAt: null, customLists: { Favorites: true } },
    },
  };
}

/** Exercise view replacement and retained inputs without relying on a UI mode. */
export function rerenderRatingModal(modal: unknown): void {
  const view = modal as { captureFormInputs(): void; render(media: unknown, lists: string[]): void; media: unknown; overlay: HTMLElement };
  const lists = Array.from(view.overlay.querySelectorAll<HTMLInputElement>('.astra-custom-list-cb')).map(input => input.dataset.name!);
  view.captureFormInputs(); view.render(view.media, lists);
}
