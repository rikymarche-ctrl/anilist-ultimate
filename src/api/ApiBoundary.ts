import { Kind, parse, visit, type DocumentNode, type SelectionSetNode } from 'graphql';

const queryRoots = new Set([
  'Viewer',
  'User',
  'Media',
  'MediaList',
  'MediaListCollection',
  'Page',
  'Review',
  'Activity',
  'Thread',
  'ThreadComment',
  'Character',
  'Staff',
  'Studio',
  'SiteStatistics',
]);
const mutationRoots = new Set(['SaveMediaListEntry', 'ToggleLikeV2']);

/** Fixed AniList endpoint and a bounded operation allowlist; no URL/header forwarding. */
export function validateApiRequest(input: Record<string, unknown>): {
  query: string;
  variables: Record<string, unknown>;
  method: 'query' | 'queryRaw' | 'mutate' | 'mutateOnce';
  silent: boolean;
  priority: boolean;
} {
  if (
    !['query', 'queryRaw', 'mutate', 'mutateOnce'].includes(input.method as string) ||
    typeof input.query !== 'string' ||
    input.query.length > 128 * 1024 ||
    !input.variables ||
    typeof input.variables !== 'object' ||
    Array.isArray(input.variables) ||
    JSON.stringify(input.variables).length > 512 * 1024 ||
    (input.silent !== undefined && typeof input.silent !== 'boolean') ||
    (input.priority !== undefined && typeof input.priority !== 'boolean')
  ) {
    throw new Error('Invalid API request');
  }
  const doc: DocumentNode = parse(input.query);
  const operations = doc.definitions.filter((def) => def.kind === Kind.OPERATION_DEFINITION);
  if (
    operations.length !== 1 ||
    doc.definitions.some(
      (def) => def.kind !== Kind.OPERATION_DEFINITION && def.kind !== Kind.FRAGMENT_DEFINITION
    )
  )
    throw new Error('Invalid API operation');
  const operation = operations[0];
  const mutation = input.method === 'mutate' || input.method === 'mutateOnce';
  if (operation.operation !== (mutation ? 'mutation' : 'query'))
    throw new Error('API operation kind mismatch');
  const fragments = new Map(
    doc.definitions
      .filter((def) => def.kind === Kind.FRAGMENT_DEFINITION)
      .map((def) => [def.name.value, def])
  );
  let fields = 0;
  let expandedSelections = 0;
  visit(doc, {
    Field(node) {
      // Union responses need their discriminator. Schema introspection stays blocked.
      if (++fields > 2500 || (node.name.value.startsWith('__') && node.name.value !== '__typename'))
        throw new Error('API selection not allowed');
    },
  });
  const check = (set: SelectionSetNode, depth: number, root: boolean, seen: Set<string>) => {
    if (depth > 25) throw new Error('API selection too deep');
    for (const node of set.selections) {
      if (++expandedSelections > 5000) throw new Error('API selection expansion too large');
      if (node.kind === Kind.FIELD) {
        if (root && !(mutation ? mutationRoots : queryRoots).has(node.name.value))
          throw new Error('API root field not allowed');
        if (node.selectionSet) check(node.selectionSet, depth + 1, false, seen);
      } else if (node.kind === Kind.INLINE_FRAGMENT)
        check(node.selectionSet, depth + 1, root, seen);
      else {
        const fragment = fragments.get(node.name.value);
        if (!fragment || seen.has(node.name.value)) throw new Error('Invalid API fragment');
        check(fragment.selectionSet, depth + 1, root, new Set([...seen, node.name.value]));
      }
    }
  };
  check(operation.selectionSet, 0, true, new Set());
  const allowedVariables = new Set(
    operation.variableDefinitions?.map((def) => def.variable.name.value)
  );
  if (
    !Object.keys(input.variables).every(
      (key) => allowedVariables.has(key) && !['__proto__', 'constructor', 'prototype'].includes(key)
    )
  )
    throw new Error('Unexpected API variables');
  return {
    query: input.query,
    variables: input.variables as Record<string, unknown>,
    method: input.method as 'query' | 'queryRaw' | 'mutate' | 'mutateOnce',
    silent: input.silent === true,
    priority: input.priority === true,
  };
}
