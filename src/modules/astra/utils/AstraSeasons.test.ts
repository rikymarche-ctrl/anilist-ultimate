import { describe, it, expect } from 'vitest';
import { isManualScore, MANUAL_SCORE_MAX, MANUAL_SCORE_MIN } from './AstraSeasons';

describe('isManualScore', () => {
  it('accepts the bounds and values in between', () => {
    expect(MANUAL_SCORE_MIN).toBe(0.1);
    expect(MANUAL_SCORE_MAX).toBe(11);
    expect([0.1, 3, 7.3, 10, 11].every(isManualScore)).toBe(true);
  });

  it.each([0, -1, 11.5, Number.NaN, Number.POSITIVE_INFINITY, '7', null, undefined, true])(
    'rejects %s',
    (value) => {
      expect(isManualScore(value)).toBe(false);
    }
  );
});
