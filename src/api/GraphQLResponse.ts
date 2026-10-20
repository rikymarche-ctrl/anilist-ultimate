/** Transport envelope only: each caller still validates its domain data. */
export interface GraphQLError {
  message: string;
  /** AniList's semantic HTTP status, also present on errors in a batch. */
  status?: number;
  locations?: ReadonlyArray<{ line: number; column: number }>;
  path?: readonly (string | number)[];
  extensions?: Record<string, unknown>;
}

export interface GraphQLResponse<T> {
  data: T;
  errors?: readonly GraphQLError[];
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseGraphQLErrors(value: unknown): GraphQLError[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error('Invalid GraphQL errors');
  return value.map((item: unknown) => {
    if (!isRecord(item) || typeof item.message !== 'string'
      || (item.status !== undefined && (typeof item.status !== 'number' || !Number.isInteger(item.status) || item.status < 100 || item.status > 599))
      || (item.path !== undefined && (!Array.isArray(item.path) || !item.path.every(
        (part: unknown) => typeof part === 'string' || (typeof part === 'number' && Number.isSafeInteger(part) && part >= 0))))
      || (item.locations !== undefined && (!Array.isArray(item.locations) || !item.locations.every(
        (location: unknown) => isRecord(location) && Number.isSafeInteger(location.line) && Number(location.line) > 0
          && Number.isSafeInteger(location.column) && Number(location.column) > 0)))
      || (item.extensions !== undefined && !isRecord(item.extensions))) throw new Error('Invalid GraphQL error');
    return { message: item.message, ...(item.status === undefined ? {} : { status: item.status as number }),
      ...(item.path === undefined ? {} : { path: [...item.path as (string | number)[]] }),
      ...(item.locations === undefined ? {} : { locations: structuredClone(item.locations as { line: number; column: number }[]) }),
      ...(item.extensions === undefined ? {} : { extensions: structuredClone(item.extensions as Record<string, unknown>) }) };
  });
}

export function validateGraphQLResponse(value: unknown): GraphQLResponse<unknown> {
  if (!isRecord(value)) throw new Error('Invalid GraphQL response');
  parseGraphQLErrors(value.errors);
  // Preserve transport metadata for raw callers; absence/null of data is valid
  // for failed execution and remains distinguishable from a domain payload.
  return value as unknown as GraphQLResponse<unknown>;
}

export function getErrorResponse(error: unknown): Record<string, unknown> | undefined {
  return isRecord(error) && isRecord(error.response) ? error.response : undefined;
}

export function getResponseStatus(error: unknown): number | undefined {
  const status = getErrorResponse(error)?.status;
  return typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined;
}
