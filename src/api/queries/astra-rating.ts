export const ASTRA_RATING_QUERY = `query($id: Int!) {
  Viewer { id mediaListOptions { animeList { customLists } mangaList { customLists } } }
  Media(id: $id) {
    id title { userPreferred } type format episodes chapters status countryOfOrigin
    nextAiringEpisode { episode }
    coverImage { large extraLarge color }
    mediaListEntry {
      id mediaId userId status progress score(format: POINT_100) notes
      repeat private hiddenFromStatusLists
      startedAt { year month day } completedAt { year month day } customLists
    }
  }
}`;
