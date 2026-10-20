import { describe, expect, it } from 'vitest';
import { ScoreFormatter } from './ScoreFormatter';
import type { ScoreFormat } from '@core/types';
describe('normalized AniList score formats', () => {
  it.each<[ScoreFormat, string]>([
    ['POINT_100', '85'], ['POINT_10_DECIMAL', '8.5'], ['POINT_10', '8'], ['POINT_5', '★★★★'], ['POINT_3', '🙂'],
  ])('formats POINT_100 input as %s', (format, expected) => { expect(ScoreFormatter.format(85, format)).toBe(expected); });
  it('keeps a low POINT_100 score low and distinguishes zero from a positive score', () => {
    expect(ScoreFormatter.format(6, 'POINT_10_DECIMAL')).toBe('0.6'); expect(ScoreFormatter.format(0, 'POINT_100')).toBe('');
  });
  it.each([NaN, Infinity, -1, 101, 10000000])('rejects invalid %s before constructing glyph strings', value => {
    expect(ScoreFormatter.format(value, 'POINT_5')).toBe('');
  });
});
