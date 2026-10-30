import { describe, expect, it } from 'vitest';
import { validateApiRequest } from './ApiBoundary';
import { NOTIFICATION_ACTIVITY_QUERY } from '@/modules/notifications/services/NotificationActivityResponse';
import { TOGGLE_LIKE_MUTATION } from '@/modules/activity/shared/ActivityRenderer';

const request = (query: string, method = 'query', variables: unknown = {}) =>
  validateApiRequest({ query, method, variables });
describe('privileged API boundary', () => {
  it('supports aliased, variable-based batching and valid root fragments', () => {
    expect(
      request(
        'query($id:Int){ a:Media(id:$id){id} ...UserDetails } fragment UserDetails on Query { Viewer { id } }',
        'queryRaw',
        { id: 1 }
      ).method
    ).toBe('queryRaw');
    expect(
      request(
        'mutation($id:Int,$notes:String){ SaveMediaListEntry(mediaId:$id,notes:$notes){id} }',
        'mutate',
        { id: 1, notes: 'Notes containing $id' }
      ).variables.notes
    ).toBe('Notes containing $id');
  });
  it('accepts only a boolean priority hint and defaults it to background', () => {
    expect(
      validateApiRequest({
        query: 'query { Viewer { id } }',
        method: 'query',
        variables: {},
        priority: true,
      }).priority
    ).toBe(true);
    expect(
      validateApiRequest({ query: 'query { Viewer { id } }', method: 'query', variables: {} })
        .priority
    ).toBe(false);
    expect(() =>
      validateApiRequest({
        query: 'query { Viewer { id } }',
        method: 'query',
        variables: {},
        priority: 'yes',
      })
    ).toThrow('Invalid API request');
  });
  it('allows the activity union discriminator required by notification enrichment', () => {
    expect(request(NOTIFICATION_ACTIVITY_QUERY, 'queryRaw', { id: 7 }).query).toBe(
      NOTIFICATION_ACTIVITY_QUERY
    );
    expect(
      request('query { Activity(id:7) { kind:__typename ... on ListActivity { id } } }')
    ).toBeDefined();
  });
  it('allows the activity like toggle mutation', () => {
    expect(
      validateApiRequest({ method: 'mutate', query: TOGGLE_LIKE_MUTATION, variables: { id: 1 } })
        .method
    ).toBe('mutate');
  });
  it('accepts the non-retried mutation channel only for allowlisted mutation roots', () => {
    const toggle = 'mutation ($id: Int) { ToggleLikeV2(id: $id, type: ACTIVITY) { ... on TextActivity { id } } }';
    expect(validateApiRequest({ method: 'mutateOnce', query: toggle, variables: { id: 1 } }).method).toBe('mutateOnce');
    expect(() => validateApiRequest({ method: 'mutateOnce', query: 'query { Viewer { id } }', variables: {} })).toThrow('kind mismatch');
    expect(() => validateApiRequest({ method: 'mutateOnce', query: 'mutation { DeleteUser(id:1) { id } }', variables: {} })).toThrow('root field not allowed');
  });
  it.each([
    'query { __schema { types { name } } }',
    'query { Activity(id:7) { __schema { types { name } } } }',
    'query { __typename }',
    'query { ...Secret } fragment Secret on Query { __type(name:"Mutation") { name } }',
    'mutation { DeleteUser(id:1) { id } }',
    'query { Evil { id } }',
    'query { ...Cycle } fragment Cycle on Query { ...Cycle }',
    'query { Viewer { id } } query { Media(id:1) { id } }',
  ])('rejects introspection, unknown operations or invalid fragments: %s', (query) => {
    expect(() => request(query, query.startsWith('mutation') ? 'mutate' : 'query')).toThrow();
  });
  it('rejects a mutation hidden in the query channel and unexpected variables', () => {
    expect(() => request('mutation { SaveMediaListEntry(mediaId:1){id} }')).toThrow(
      'kind mismatch'
    );
    expect(() =>
      request('query { Viewer { id } }', 'query', { Authorization: 'attacker' })
    ).toThrow('Unexpected API variables');
    expect(() => request('query { Viewer { id } }', 'query', [])).toThrow('Invalid API request');
  });
  it('bounds fragment expansion and payload size', () => {
    const fragments = Array.from(
      { length: 15 },
      (_, i) =>
        `fragment F${i} on Query { ${i === 14 ? 'Viewer{id}' : `...F${i + 1} ...F${i + 1}`} }`
    ).join(' ');
    expect(() => request(`query { ...F0 } ${fragments}`)).toThrow('expansion too large');
    expect(() =>
      request('query($id:String){ Viewer { id } }', 'query', { id: 'x'.repeat(600000) })
    ).toThrow('Invalid API request');
  });
});
