// ============================================================
// DATA MODEL + MOCK DATA
// ============================================================
// Schema:
//   Work = { id, title, type: 'anime'|'manga',
//            cover?, coverColor?, anilistUrl?,
//            status, tags, seasons: Season[], notes }
//   Season = { id, label, scores: {sectionId: number|null},
//              skip?: sectionId[],        // per-season override: exclude these
//              startDate, endDate, notes, episodes?: Episode[] }
//   Episode = { id, num, scores }
//   Section = { id, name, weight }        // global defaults only — no enabled flag
//
// Weighted score formula (from user):
//   overall = round( sum(score * weight for non-zero, non-skipped scores) /
//                    sum(weight for non-zero, non-skipped scores), 1 )
// ============================================================

// NOTE: `enabled` flag removed from defaults — sections are always in scope
// at the global level. Per-work exclusion happens inside each season's
// `skip` set (see Season schema below).
const DEFAULT_SECTIONS = [
  { id: 'story',      name: 'Story',      weight: 3 },
  { id: 'characters', name: 'Characters', weight: 3 },
  { id: 'visuals',    name: 'Visuals',    weight: 2 },
  { id: 'audio',      name: 'Audio',      weight: 1 },
  { id: 'enjoyment',  name: 'Enjoyment',  weight: 3 },
  { id: 'finale',     name: 'Finale',     weight: 2 },
  { id: 'bullshit',   name: 'Bullshit',   weight: 1 },
];

// Pulled from the uploaded sheets — keep as mock, user clears when ready
const MOCK_WORKS = [
  {
    id: 'w1', title: 'Mars of Destruction', type: 'anime',
    status: 'completed', tags: ['ova', 'horror'], notes: '',
    seasons: [{
      id: 's1', label: 'Season 1',
      scores: { story: 3, characters: 1, visuals: 3, audio: 4, enjoyment: 2, finale: 4, bullshit: 2 },
      startDate: '2024-10-19', endDate: '2024-10-19', notes: '',
    }],
  },
  {
    id: 'w2', title: 'Uzumaki', type: 'anime',
    status: 'completed', tags: ['horror', 'junji ito'], notes: '',
    seasons: [{
      id: 's1', label: 'Season 1',
      scores: { story: 2, characters: 2, visuals: 5, audio: 7, enjoyment: 3, finale: 4, bullshit: 1 },
      startDate: '2024-09-30', endDate: '2024-10-23', notes: '',
    }],
  },
  {
    id: 'w3', title: 'Seirei Gensouki: Spirit Chronicles', type: 'anime',
    status: 'completed', tags: ['isekai'], notes: '',
    seasons: [{
      id: 's2', label: 'Season 2',
      scores: { story: 3, characters: 2.2, visuals: 3.5, audio: 4.2, enjoyment: 3.2, finale: 4, bullshit: 1 },
      startDate: '2024-10-07', endDate: '2024-12-23', notes: '',
    }],
  },
  {
    id: 'w4', title: 'Your Forma', type: 'anime',
    status: 'completed', tags: ['sci-fi', 'mystery'], notes: '',
    seasons: [{
      id: 's1', label: 'Season 1',
      scores: { story: 4.2, characters: 4, visuals: 7, audio: 6, enjoyment: 3.5, finale: 5, bullshit: 4 },
      startDate: '2025-04-02', endDate: '2025-06-25', notes: '',
    }],
  },
  {
    id: 'w5', title: 'Bye Bye, Earth', type: 'anime',
    status: 'watching', tags: ['fantasy'], notes: '',
    seasons: [{
      id: 's1', label: 'Season 1',
      scores: { story: 3.5, characters: 4.5, visuals: 6.5, audio: 8, enjoyment: 3.8, finale: 7, bullshit: null },
      startDate: '2024-07-12', endDate: '', notes: '',
    }],
  },
  {
    id: 'w6', title: 'The Rising of the Shield Hero', type: 'anime',
    status: 'completed', tags: ['isekai', 'action'], notes: '',
    seasons: [{
      id: 's4', label: 'Season 4',
      scores: { story: 2.5, characters: 4.2, visuals: 5, audio: 6.8, enjoyment: 3.8, finale: 6, bullshit: 1 },
      startDate: '2025-07-09', endDate: '2025-09-24', notes: '',
    }],
  },
  {
    id: 'w7', title: 'The Healer Who Was Banished From His Party, Is, in Fact, the Strongest', type: 'anime',
    status: 'completed', tags: ['isekai'], notes: '',
    seasons: [{
      id: 's1', label: 'Season 1',
      scores: { story: 3.5, characters: 3.5, visuals: 4.2, audio: 5, enjoyment: 3.8, finale: 4, bullshit: 6 },
      startDate: '2024-10-05', endDate: '2024-12-21', notes: '',
    }],
  },
  {
    id: 'w8', title: 'Übel Blatt', type: 'anime',
    status: 'completed', tags: ['dark fantasy'], notes: '',
    seasons: [{
      id: 's1', label: 'Season 1',
      scores: { story: 3.8, characters: 3.8, visuals: 4, audio: 4, enjoyment: 4, finale: 5, bullshit: 6 },
      startDate: '2025-01-11', endDate: '2025-03-21', notes: '',
    }],
  },
  {
    id: 'w9', title: 'Blue Miburo', type: 'anime',
    status: 'watching', tags: ['historical'], notes: '',
    seasons: [{
      id: 's1', label: 'Season 1',
      scores: { story: 4.5, characters: 3.5, visuals: 4.8, audio: 5, enjoyment: 4, finale: null, bullshit: 1 },
      startDate: '2024-10-19', endDate: '', notes: '',
    }],
  },
  {
    id: 'w10', title: 'Please Put Them On, Takamine-san', type: 'anime',
    status: 'completed', tags: ['romcom'], notes: '',
    seasons: [{
      id: 's1', label: 'Season 1',
      scores: { story: 5, characters: 3, visuals: 5, audio: 6.2, enjoyment: 5, finale: 5, bullshit: null },
      startDate: '2025-04-02', endDate: '2025-06-18', notes: '',
    }],
  },
  {
    id: 'w11', title: 'Pyramid Game', type: 'anime',
    status: 'completed', tags: ['psychological'], notes: '',
    seasons: [{
      id: 's1', label: 'Season 1',
      scores: { story: 3.5, characters: 3, visuals: 4, audio: 5, enjoyment: 4, finale: 0.1, bullshit: 3 },
      startDate: '2025-06-17', endDate: '2025-08-28', notes: '',
    }],
  },
  // Monogatari — demonstrates multi-part / multi-season
  {
    id: 'w12', title: 'Monogatari', type: 'anime',
    status: 'watching', tags: ['dialogue', 'mystery'], notes: 'SHAFT goat',
    seasons: [
      { id: 'p1', label: 'Film pt.1', scores: { story: 8, characters: 7.8, visuals: 8, audio: null, enjoyment: 8.2, finale: null, bullshit: 10 }, startDate: '2025-11-03', endDate: '2025-11-03', notes: 'did not vote audio' },
      { id: 'p2', label: 'Film pt.2', scores: { story: 8, characters: 8, visuals: 8, audio: null, enjoyment: 8.2, finale: null, bullshit: 10 }, startDate: '2025-11-03', endDate: '2025-11-03', notes: '' },
      { id: 'p3', label: 'Film pt.3', scores: { story: 8.5, characters: 8.5, visuals: 9, audio: 8, enjoyment: 9.2, finale: 8, bullshit: 10 }, startDate: '2025-11-04', endDate: '2025-11-04', notes: '' },
      { id: 'neko', label: 'Nekomonogatari', scores: { story: 7.5, characters: 7.5, visuals: 7.8, audio: 8, enjoyment: 8, finale: 8, bullshit: 10 }, startDate: '2025-11-04', endDate: '2025-11-05', notes: '' },
      { id: 'bake', label: 'Bakemonogatari', scores: { story: 8, characters: 8, visuals: 7.8, audio: 8.2, enjoyment: 8.8, finale: 8.8, bullshit: 9.5 }, startDate: '2025-11-06', endDate: '2025-11-11', notes: '' },
      { id: 'nise', label: 'Nisemonogatari', scores: { story: 8, characters: 8, visuals: 7.8, audio: 8.2, enjoyment: 8.8, finale: 8.5, bullshit: 10 }, startDate: '2025-11-12', endDate: '2025-11-16', notes: '' },
    ],
  },
  {
    id: 'w13', title: 'Clevatess', type: 'anime',
    status: 'watching', tags: ['fantasy'], notes: '',
    seasons: [
      { id: 's1', label: 'Season 1', scores: { story: 8, characters: 8, visuals: 8.2, audio: 8, enjoyment: 10, finale: null, bullshit: null }, startDate: '2025-09-27', endDate: '2025-09-29', notes: '' },
    ],
  },
  // A manga example
  {
    id: 'w14', title: 'Vagabond', type: 'manga',
    status: 'paused', tags: ['historical', 'seinen'], notes: 'Inoue please come back',
    seasons: [
      { id: 's1', label: 'Vol. 1–37', scores: { story: 9.5, characters: 9.8, visuals: 10, audio: null, enjoyment: 9.5, finale: null, bullshit: 10 }, startDate: '2024-03-01', endDate: '', notes: '' },
    ],
  },
  // Film example — now classified as anime
  {
    id: 'w15', title: 'A Silent Voice', type: 'anime',
    status: 'completed', tags: ['drama', 'kyoani', 'film'], notes: '',
    seasons: [
      { id: 's1', label: 'Film', scores: { story: 9, characters: 9.2, visuals: 9.5, audio: 8.8, enjoyment: 9, finale: 9, bullshit: 10 }, startDate: '2024-12-20', endDate: '2024-12-20', notes: '' },
    ],
  },
];

// ============================================================
// CORE CALCULATION
// ============================================================
// Overall for a single season.
// `skip` is an optional array of section IDs to exclude from THIS season's
// calculation (per-work override — e.g. "this season has no finale").
function calcOverall(scores, sections, skip) {
  const skipSet = new Set(skip || []);
  let num = 0, den = 0;
  for (const s of sections) {
    if (skipSet.has(s.id)) continue;
    const v = scores?.[s.id];
    if (v === null || v === undefined || v === 0 || Number.isNaN(v)) continue;
    num += v * s.weight;
    den += s.weight;
  }
  if (den === 0) return null;
  return Math.round((num / den) * 10) / 10;
}

function calcSeriesOverall(work, sections) {
  const subs = work.seasons
    .map(s => calcOverall(s.scores, sections, s.skip))
    .filter(v => v !== null);
  if (!subs.length) return null;
  return Math.round((subs.reduce((a, b) => a + b, 0) / subs.length) * 10) / 10;
}

// ============================================================
// ANILIST — fetch cover image from a page URL
// URL shape: https://anilist.co/anime/181444/Slug  or /manga/ID/Slug
// ============================================================
async function fetchAnilistCover(url) {
  const m = String(url).match(/anilist\.co\/(anime|manga)\/(\d+)/i);
  if (!m) throw new Error('Not an AniList URL');
  const type = m[1].toUpperCase();
  const id = parseInt(m[2], 10);
  const query = `query ($id: Int, $type: MediaType) {
    Media(id: $id, type: $type) {
      id
      title { romaji english native }
      coverImage { large extraLarge color }
      bannerImage
      format
      episodes
      chapters
      startDate { year month day }
      genres
      siteUrl
    }
  }`;
  const res = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ query, variables: { id, type } }),
  });
  if (!res.ok) throw new Error('AniList API error');
  const data = await res.json();
  const media = data?.data?.Media;
  if (!media) throw new Error('Not found');
  return {
    cover: media.coverImage?.extraLarge || media.coverImage?.large,
    coverColor: media.coverImage?.color,
    banner: media.bannerImage,
    title: media.title?.english || media.title?.romaji,
    genres: media.genres || [],
    anilistUrl: media.siteUrl || url,
    anilistType: type.toLowerCase(), // 'anime' | 'manga'
  };
}

Object.assign(window, {
  DEFAULT_SECTIONS, MOCK_WORKS, calcOverall, calcSeriesOverall, fetchAnilistCover,
});
