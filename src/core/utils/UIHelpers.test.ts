import { describe, expect, it } from 'vitest';
import { MediaListStatus } from '@/api/AnilistTypes';
import { getStatusLabel } from './UIHelpers';

describe('getStatusLabel', () => {
  it.each([
    [MediaListStatus.CURRENT, 'novel', 'Reading'],
    [MediaListStatus.CURRENT, 'manga', 'Reading'],
    [MediaListStatus.REPEATING, 'novel', 'Rereading'],
    [MediaListStatus.REPEATING, 'manga', 'Rereading'],
  ] as const)('uses written-media labels for %s %s entries', (status, type, expected) => {
    expect(getStatusLabel(status, type)).toBe(expected);
  });
});
