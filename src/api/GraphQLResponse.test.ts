import { describe, expect, it } from 'vitest';
import { getResponseStatus, parseGraphQLErrors, validateGraphQLResponse } from './GraphQLResponse';

describe('GraphQL transport validation', () => {
  it('preserves valid numeric paths, locations and optional extensions', () => {
    const errors = [{ message: 'Unavailable', status: 404, path: ['a0', 'nodes', 0], locations: [{ line: 1, column: 2 }], extensions: { code: 'NOT_FOUND' } }];
    const parsed = parseGraphQLErrors(errors)!; expect(parsed).toEqual(errors);
    parsed[0].extensions!.code = 'changed'; expect(errors[0].extensions.code).toBe('NOT_FOUND');
    expect(validateGraphQLResponse({ data: null, errors }).data).toBeNull();
  });
  it.each([null, {}, 'error', [null], [{ message: 1 }], [{ message: 'x', path: 'a0' }], [{ message: 'x', path: [-1] }], [{ message: 'x', path: [1.5] }], [{ message: 'x', locations: [{ line: 0, column: 1 }] }], [{ message: 'x', extensions: [] }]])('rejects malformed errors without leaking their contents: %j', errors => {
    expect(() => validateGraphQLResponse({ data: {}, errors })).toThrow(/Invalid GraphQL/);
  });
  it('ignores nonnumeric HTTP status values and accepts a valid status', () => {
    expect(getResponseStatus({ response: { status: '429' } })).toBeUndefined();
    expect(getResponseStatus({ response: { status: 429 } })).toBe(429);
    expect(getResponseStatus(null)).toBeUndefined();
  });
  it.each(['404', 0, 600, 404.5])('rejects an invalid provider error status %j', status => {
    expect(() => parseGraphQLErrors([{ message: 'Not Found.', status }])).toThrow('Invalid GraphQL error');
  });
});
