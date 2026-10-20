import { describe, it, expect } from 'vitest';
import { parseManualScoreInput } from './AstraManualScore';

describe('parseManualScoreInput', () => {
  it('clears the manual score for a blank value', () => {
    expect(parseManualScoreInput('')).toEqual({ valid: true, value: null });
    expect(parseManualScoreInput('   ')).toEqual({ valid: true, value: null });
  });

  it.each([
    ['10', 10],
    ['3', 3],
    ['7.25', 7.3],
    ['0.05', 0.1],
    ['11', 11],
    ['11.04', 11],
  ])('accepts %s as %s, rounded to one decimal', (raw, expected) => {
    expect(parseManualScoreInput(raw)).toEqual({ valid: true, value: expected });
  });

  it.each(['0', '0.04', '11.5', '-2', 'abc', 'Infinity', '12'])('rejects %s', (raw) => {
    expect(parseManualScoreInput(raw)).toEqual({ valid: false });
  });

  it('rejects input the browser flagged as bad, even when the text reads blank', () => {
    expect(parseManualScoreInput('', true)).toEqual({ valid: false });
  });
});
