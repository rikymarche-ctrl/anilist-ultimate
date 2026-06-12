/**
 * @file GraphQLBatcher.ts
 * @description Advanced batched GraphQL execution engine
 *
 * PERFORMANCE: Combines multiple queries/mutations into single requests via aliases.
 * ARCHITECTURE: Delegates execution to IApiClient to respect rate limits and auth.
 */

import { singleton, inject } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import type { IApiClient } from '@core/interfaces/IApiClient';
import { log } from '@core/logger';

interface PendingRequest<T = unknown> {
  query: string;
  variables: Record<string, unknown>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  type: 'query' | 'mutation';
}

@singleton()
export class GraphQLBatcher {
  private queryQueue: Map<string, PendingRequest<any>> = new Map();
  private mutationQueue: Map<string, PendingRequest<any>> = new Map();
  private batchTimeout: ReturnType<typeof setTimeout> | null = null;

  private readonly BATCH_WINDOW_MS = 50;
  private readonly MAX_BATCH_SIZE = 25;

  constructor(@inject(TOKENS.ApiClient) private api: IApiClient) {}

  /**
   * Queue a query for batching
   */
  public async query<T = unknown>(
    query: string,
    variables: Record<string, unknown> = {}
  ): Promise<T> {
    return this.enqueue(query, variables, 'query');
  }

  /**
   * Queue a mutation for batching
   */
  public async mutate<T = unknown>(
    mutation: string,
    variables: Record<string, unknown> = {}
  ): Promise<T> {
    return this.enqueue(mutation, variables, 'mutation');
  }

  private enqueue<T>(
    query: string,
    variables: Record<string, unknown>,
    type: 'query' | 'mutation'
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = `req_${Math.random().toString(36).substring(2, 11)}`;
      const queue = type === 'query' ? this.queryQueue : this.mutationQueue;

      queue.set(id, { query, variables, resolve, reject, type });

      if (queue.size >= this.MAX_BATCH_SIZE) {
        this.flush(type);
      } else {
        this.scheduleFlush();
      }
    });
  }

  private scheduleFlush(): void {
    if (this.batchTimeout) return;
    this.batchTimeout = setTimeout(() => {
      this.flush('query');
      this.flush('mutation');
      this.batchTimeout = null;
    }, this.BATCH_WINDOW_MS);
  }

  private async flush(type: 'query' | 'mutation'): Promise<void> {
    const queue = type === 'query' ? this.queryQueue : this.mutationQueue;
    if (queue.size === 0) return;

    const requests = Array.from(queue.entries());
    queue.clear();

    log.debug(`[GraphQLBatcher] Flushing ${requests.length} ${type}s`);

    try {
      const { combinedQuery, aliasMap } = this.combine(requests, type);

      // Delegate to ApiClient for rate limiting and auth
      // Use queryRaw to handle partial errors (e.g. some activities not found)
      const response = await this.api.queryRaw<Record<string, any>>(combinedQuery);
      const { data, errors } = response;

      // Distribute results
      requests.forEach(([id, req]) => {
        const alias = aliasMap.get(id);
        const result = data ? data[alias!] : undefined;

        // Check if this specific alias had an error
        const aliasError = errors?.find((err) => err.path?.includes(alias));

        if (result !== undefined && result !== null) {
          req.resolve(result);
        } else if (aliasError) {
          log.warn(`[GraphQLBatcher] Partial error for alias ${alias}`, aliasError);
          req.reject(new Error(aliasError.message || `Error for alias ${alias}`));
        } else {
          // If no data and no specific error, it might be a general failure or null result
          req.resolve(null as any);
        }
      });
    } catch (error) {
      log.error(`[GraphQLBatcher] Batch ${type} failed completely`, error);
      requests.forEach(([_, req]) => req.reject(error as Error));
    }
  }

  private combine(requests: [string, PendingRequest][], type: 'query' | 'mutation') {
    const aliasMap = new Map<string, string>();
    const parts: string[] = [];

    requests.forEach(([id, req], index) => {
      const alias = `a${index}`;
      aliasMap.set(id, alias);

      // Robust extraction of fields between outer braces
      let fields = req.query.trim();

      // Remove operation header if present (e.g., "query { ... }" -> "{ ... }")
      fields = fields.replace(/^(query|mutation)\s*(\([^)]*\))?\s*\{/, '{');

      // Strip outer braces to get selection set
      const selection = fields.substring(fields.indexOf('{') + 1, fields.lastIndexOf('}')).trim();

      // Inline variables (AniList aliases don't support separate variable blocks per alias)
      let inlinedSelection = selection;
      Object.entries(req.variables).forEach(([key, val]) => {
        const regex = new RegExp(`\\$${key}\\b`, 'g');
        inlinedSelection = inlinedSelection.replace(regex, this.format(val));
      });

      parts.push(`${alias}: ${inlinedSelection}`);
    });

    const combinedQuery = `${type} {\n${parts.join('\n')}\n}`;
    return { combinedQuery, aliasMap };
  }

  /**
   * Formats a value for GraphQL injection.
   * Handles strings, numbers, booleans, arrays, and nested objects.
   *
   * @param val The value to format
   * @returns GraphQL-compatible string representation
   */
  private format(val: any): string {
    if (val === null || val === undefined) return 'null';

    if (typeof val === 'string') {
      // SECURITY: always quote and fully escape. There is NO "$"-passthrough —
      // a value starting with "$" is user data, not a GraphQL variable reference,
      // and must never be injected raw into the query (GraphQL injection).
      const escaped = val
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\t/g, '\\t');
      return `"${escaped}"`;
    }

    if (typeof val === 'number' || typeof val === 'boolean') {
      return String(val);
    }

    if (Array.isArray(val)) {
      return `[${val.map((v) => this.format(v)).join(', ')}]`;
    }

    if (typeof val === 'object') {
      const entries = Object.entries(val)
        .map(([k, v]) => `${k}: ${this.format(v)}`)
        .join(', ');
      return `{ ${entries} }`;
    }

    return String(val);
  }
}
