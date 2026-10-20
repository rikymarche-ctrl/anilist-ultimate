import { describe, expect, it } from 'vitest';
import { Kind, parse } from 'graphql';
import { isReviewId, parseReview, parseReviewBatch, reviewBatchQuery } from './ReviewResponse';

const review = (id = 7) => ({ id, score: 80, summary: 'Summary', body: 'Body', rating: 3, ratingAmount: 4,
  user: { id: 1, name: 'Reviewer' }, media: { id: 9, title: { romaji: 'Title', english: null } } });
const badge = (id = 7) => ({ id, score: 80 });
describe('review domain boundary', () => {
  it('projects only the badge fields and drops bodies, authors and media', () => {
    const raw = { ...review(), extra: { private: true } }; const copy = parseReview(raw, 7);
    expect(copy).toEqual(badge()); expect(copy).not.toHaveProperty('extra'); expect(copy).not.toHaveProperty('body');
  });
  it('maps null and boundary scores to badge results without extra fields', () => {
    expect(parseReview({ ...review(), score: null }, 7)).toBeUndefined(); expect(parseReview(null, 7)).toBeUndefined();
    expect(parseReview({ ...review(), score: 0 }, 7)).toEqual({ id: 7, score: 0 });
    expect(parseReview({ ...review(), score: 100 }, 7)?.score).toBe(100);
  });
  it.each([undefined, {}, { ...review(), id: 8 }, { ...review(), id: '7' }, { ...review(), score: undefined }, { ...review(), score: '80' },
    { ...review(), score: -1 }, { ...review(), score: 101 }, { ...review(), score: 1.5 }, { ...review(), score: Infinity },
    { id: 7 }, { score: 80 }])('rejects wrong identity or malformed score: %j', value => {
    expect(() => parseReview(value, 7)).toThrow('Invalid review response');
  });
  it.each([0, -1, NaN, Infinity, 1.5, 2147483648])('rejects invalid requested identity: %j', id => {
    expect(isReviewId(id)).toBe(false); expect(() => parseReview(null, id)).toThrow();
  });
  it('validates the complete requested alias set and emits results in request order', () => {
    expect(parseReviewBatch({ data: { r8: review(8), r7: review() } }, [7, 8])).toEqual([badge(), badge(8)]);
    expect(parseReviewBatch({ data: { r7: null, r8: review(8) } }, [7, 8])).toEqual([badge(8)]);
    expect(parseReviewBatch({ data: { r7: { ...review(), score: null } } }, [7])).toEqual([]);
  });
  it('skips only errored aliases, handles global errors, and never accepts their plausible data', () => {
    expect(parseReviewBatch({ data: { r7: review(), r8: review(8) }, errors: [{ message: 'denied', path: ['r7', 'score'] }] }, [7, 8])).toEqual([badge(8)]);
    expect(parseReviewBatch({ data: { r7: review() }, errors: [{ message: 'denied' }] }, [7])).toEqual([]);
    expect(parseReviewBatch({ data: null, errors: [{ message: 'denied' }] }, [7])).toEqual([]);
  });
  it.each([null, {}, { data: null }, { data: [] }, { data: {} }, { data: { r7: review(), r8: review(8) } },
    { data: { r7: review(8) } }, { data: { r7: review() }, errors: 'error' },
    { data: { r7: review() }, errors: [{ message: 'denied', path: ['r8'] }] },
  ])('rejects malformed, missing, extra, or mismatched response aliases: %j', value => {
    expect(() => parseReviewBatch(value, [7])).toThrow();
  });
  it('uses variable values and selects only id and score for each alias', () => {
    const { query, variables } = reviewBatchQuery([7, 2147483647]); expect(variables).toEqual({ id7: 7, id2147483647: 2147483647 });
    const operation = parse(query).definitions[0]; if (operation.kind !== Kind.OPERATION_DEFINITION) throw new Error('operation');
    expect(operation.selectionSet.selections).toHaveLength(2);
    for (const field of operation.selectionSet.selections) {
      if (field.kind !== Kind.FIELD) throw new Error('field');
      expect(field.name.value).toBe('Review'); expect(field.arguments?.[0].value.kind).toBe(Kind.VARIABLE);
      expect(field.selectionSet?.selections.map(item => item.kind === Kind.FIELD && item.name.value)).toEqual(['id', 'score']);
    }
    expect(() => reviewBatchQuery([])).toThrow(); expect(() => reviewBatchQuery([7, 7])).toThrow();
  });
});
