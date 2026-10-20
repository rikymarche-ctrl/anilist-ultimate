import { describe, expect, it } from 'vitest';
import { ASTRA_JOURNAL_PAGE_SIZE, journalPage } from './AstraJournalPage';

describe('Astra journal page planning', () => {
  it('returns a bounded first page and preserves a short final page', () => {
    expect(ASTRA_JOURNAL_PAGE_SIZE).toBe(100);
    expect(journalPage(3, 240, {}, 120)).toEqual({ start: 1, end: 100, count: 240, pageIndex: 0, pageCount: 3 });
    expect(journalPage(3, 240, {}, 120, 2)).toEqual({ start: 201, end: 240, count: 240, pageIndex: 2, pageCount: 3 });
  });

  it('keeps sparse notes and history beyond the provider total reachable', () => {
    const notes = { 120: { text: 'History beyond the current provider total' } };
    expect(journalPage(3, null, notes, null, 1)).toEqual({ start: 101, end: 120, count: 120, pageIndex: 1, pageCount: 2 });
    expect(journalPage(3, 12, notes, 4, 1).count).toBe(120);
    expect(journalPage(125, 12, {}, 200).count).toBe(200);
  });

  it('handles the largest valid GraphQL Int with constant-size arithmetic', () => {
    const count = 2147483647;
    const page = journalPage(0, count, {}, null, Number.MAX_SAFE_INTEGER);
    expect(page).toEqual({ start: 2147483601, end: count, count, pageIndex: 21474836, pageCount: 21474837 });
    expect(page.end - page.start + 1).toBeLessThanOrEqual(ASTRA_JOURNAL_PAGE_SIZE);
    expect(journalPage(count, null, {}, null).end).toBe(100);
    expect(journalPage(0, null, { [count]: { text: 'Last episode' } }, null).count).toBe(count);
  });

  it('normalizes malformed counters and note indices without inflating the journal', () => {
    const notes = Object.fromEntries(['-1', '0', '1.5', 'NaN', 'Infinity', '2147483648', '001', '1e2', 'garbage']
      .map(key => [key, { text: 'Invalid historical index' }]));
    expect(journalPage(Number.NaN, Number.POSITIVE_INFINITY, notes, -4)).toEqual({ start: 0, end: 0, count: 0, pageIndex: 0, pageCount: 1 });
    expect(journalPage(0.5, 2147483648, {}, null).count).toBe(0);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -9])('clamps invalid or negative page %s to the start', page => {
    expect(journalPage(0, 240, {}, null, page).pageIndex).toBe(0);
  });

  it('clamps a page after the journal shrinks and normalizes fractional requests', () => {
    expect(journalPage(0, 12, {}, null, 99).pageIndex).toBe(0);
    expect(journalPage(0, 240, {}, null, 1.9).pageIndex).toBe(1);
  });
});
