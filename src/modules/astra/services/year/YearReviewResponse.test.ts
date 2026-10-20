import { describe, expect, it } from 'vitest';
import { YEAR_MEDIA_QUERY } from '@/api/queries/year-review';
import {
  parseProgress,
  yearActivityPage,
  yearMediaPage,
  yearPriorPage,
  yearSocialPage,
} from './YearReviewResponse';

const owner = 7;
const activity = (patch: Record<string, unknown> = {}) => ({
  id: 1,
  userId: owner,
  status: 'watched episode',
  progress: '4 - 10',
  createdAt: 1704239840,
  likeCount: 2,
  replyCount: 1,
  likes: [{ id: 9, name: 'Fan', avatar: { medium: 'https://s4.anilist.co/a.png' } }],
  media: { id: 5 },
  ...patch,
});
const media = (patch: Record<string, unknown> = {}) => ({
  id: 5,
  type: 'ANIME',
  format: 'TV',
  episodes: 12,
  chapters: null,
  duration: 24,
  countryOfOrigin: 'JP',
  source: 'MANGA',
  seasonYear: null,
  startDate: { year: 2019 },
  title: { userPreferred: 'Title' },
  coverImage: { large: 'https://s4.anilist.co/c.jpg', color: '#e4a15d' },
  genres: ['Drama', null],
  meanScore: 81,
  popularity: 1234,
  tags: [
    { name: 'Iyashikei', rank: 80, isMediaSpoiler: false },
    { name: 'Twist', rank: 90, isMediaSpoiler: true },
  ],
  studios: { nodes: [{ id: 3, name: 'Madhouse' }] },
  staff: {
    edges: [
      {
        role: 'Director',
        node: { id: 11, name: { userPreferred: 'Someone' }, image: { large: null } },
      },
    ],
  },
  characters: {
    edges: [
      {
        role: 'MAIN',
        node: {
          id: 21,
          name: { userPreferred: 'Hero' },
          image: { large: 'https://s4.anilist.co/h.png' },
          favourites: 40,
        },
        voiceActors: [{ id: 31, name: { userPreferred: 'Actor' }, image: null }],
      },
    ],
  },
  stats: { scoreDistribution: [{ score: 80, amount: 10 }] },
  mediaListEntry: { score: 8.5, status: 'COMPLETED', private: false, hiddenFromStatusLists: false },
  ...patch,
});

describe('Astra Wrapped responses', () => {
  it('parses progress text conservatively', () => {
    expect(parseProgress('4 - 10')).toEqual({ from: 4, to: 10 });
    expect(parseProgress('7')).toEqual({ from: 7, to: 7 });
    for (const value of ['10 - 4', '0', 'abc', null, '1 - 2 - 3'])
      expect(parseProgress(value)).toBeNull();
  });
  it('reads list activity and normalizes verbs', () => {
    const { activities, hasNextPage } = yearActivityPage(
      {
        Page: {
          pageInfo: { hasNextPage: true },
          activities: [
            activity(),
            activity({ id: 2, status: 'plans to read', progress: null, likes: null }),
          ],
        },
      },
      owner
    );
    expect(hasNextPage).toBe(true);
    expect(activities[0]).toEqual({
      id: 1,
      mediaId: 5,
      kind: 'progress',
      progress: { from: 4, to: 10 },
      createdAt: 1704239840,
      likeCount: 2,
      replyCount: 1,
      likers: [{ id: 9, name: 'Fan', avatar: 'https://s4.anilist.co/a.png' }],
    });
    expect(activities[1]).toMatchObject({ kind: 'planning', progress: null, likers: [] });
  });
  it('rejects activity from another account or with a bad shape', () => {
    expect(() =>
      yearActivityPage(
        { Page: { pageInfo: { hasNextPage: false }, activities: [activity({ userId: 8 })] } },
        owner
      )
    ).toThrow('Invalid');
    expect(() =>
      yearActivityPage(
        { Page: { pageInfo: { hasNextPage: false }, activities: [activity({ createdAt: -1 })] } },
        owner
      )
    ).toThrow('Invalid');
    expect(() => yearActivityPage({ Page: null }, owner)).toThrow('Invalid');
  });
  it('reads posts, received messages and all-time genres', () => {
    const social = yearSocialPage(
      {
        posts: {
          pageInfo: { hasNextPage: false },
          activities: [
            { id: 3, userId: owner, createdAt: 1704239840, likeCount: 4, replyCount: 0, likes: [] },
          ],
        },
        messages: {
          pageInfo: { hasNextPage: false },
          activities: [
            {
              id: 4,
              recipientId: owner,
              createdAt: 1704239841,
              messenger: { id: 9, name: 'Fan', avatar: null },
            },
            {
              id: 5,
              recipientId: 99,
              createdAt: 1704239841,
              messenger: { id: 9, name: 'Fan', avatar: null },
            },
          ],
        },
        User: { id: owner, statistics: { anime: { genres: [{ genre: 'Action', count: 3 }] } } },
      },
      owner
    );
    expect(social).toEqual({
      posts: [{ createdAt: 1704239840, likeCount: 4, replyCount: 0, likers: [] }],
      messages: [{ createdAt: 1704239841, sender: { id: 9, name: 'Fan', avatar: null } }],
      genres: [{ name: 'Action', count: 3 }],
      hasNextPage: false,
    });
  });
  it('reads media details, drops spoiler tags and keeps the viewer entry', () => {
    const [item] = yearMediaPage({ Page: { media: [media()] } }, [5]);
    expect(item).toMatchObject({
      id: 5,
      title: 'Title',
      releaseYear: 2019,
      genres: ['Drama'],
      tags: [{ name: 'Iyashikei', rank: 80 }],
      studios: [{ id: 3, name: 'Madhouse' }],
      staff: [{ id: 11, role: 'Director', image: null }],
      characters: [
        {
          id: 21,
          role: 'MAIN',
          favourites: 40,
          voiceActor: { id: 31, name: 'Actor', image: null },
        },
      ],
      entry: { score: 8.5, status: 'COMPLETED', private: false, hidden: false },
    });
  });
  it('prefers extraLarge covers, falls back to large and keeps only http(s) URLs', () => {
    expect(YEAR_MEDIA_QUERY).toContain('coverImage { extraLarge large color }');
    const cover = (coverImage: unknown) =>
      yearMediaPage({ Page: { media: [media({ coverImage })] } }, [5])[0].cover;
    expect(
      cover({
        extraLarge: 'https://s4.anilist.co/xl.jpg',
        large: 'https://s4.anilist.co/c.jpg',
        color: null,
      })
    ).toBe('https://s4.anilist.co/xl.jpg');
    expect(cover({ extraLarge: null, large: 'https://s4.anilist.co/c.jpg', color: null })).toBe(
      'https://s4.anilist.co/c.jpg'
    );
    expect(
      cover({
        extraLarge: 'javascript:alert(1)',
        large: 'https://s4.anilist.co/c.jpg',
        color: null,
      })
    ).toBe('https://s4.anilist.co/c.jpg');
    expect(
      cover({ extraLarge: 'ftp://s4.anilist.co/xl.jpg', large: null, color: null })
    ).toBeNull();
    expect(cover(null)).toBeNull();
    expect(() => cover({ extraLarge: 7, large: null, color: null })).toThrow('Invalid');
  });
  it('rejects unrequested media and invalid scores', () => {
    expect(() => yearMediaPage({ Page: { media: [media({ id: 6 })] } }, [5])).toThrow('Invalid');
    expect(() =>
      yearMediaPage(
        {
          Page: {
            media: [
              media({
                mediaListEntry: {
                  score: 11,
                  status: 'X',
                  private: false,
                  hiddenFromStatusLists: false,
                },
              }),
            ],
          },
        },
        [5]
      )
    ).toThrow('Invalid');
  });
  it('finds the last unit logged before the period for each alias', () => {
    const prior = yearPriorPage(
      {
        m0: {
          activities: [
            { userId: owner, status: 'paused watching', progress: null, media: { id: 5 } },
            { userId: owner, status: 'watched episode', progress: '3 - 6', media: { id: 5 } },
          ],
        },
        m1: {
          activities: [{ userId: owner, status: 'completed', progress: null, media: { id: 6 } }],
        },
        m2: { activities: [] },
      },
      owner,
      [5, 6, 7]
    );
    expect([...prior]).toEqual([
      [5, 6],
      [6, 'complete'],
    ]);
    expect(() =>
      yearPriorPage(
        { m0: { activities: [{ userId: owner, status: 'completed', media: { id: 8 } }] } },
        owner,
        [5]
      )
    ).toThrow('Invalid');
  });
});
