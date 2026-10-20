/**
 * @file GraphQLBatcher.ts
 * @description Advanced batched GraphQL execution engine
 *
 * PERFORMANCE: Combines multiple queries/mutations into single requests via aliases.
 * ARCHITECTURE: Delegates execution to IApiClient to respect rate limits and auth.
 */

import { singleton, inject } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import type { ApiContext, IApiClient } from '@core/interfaces/IApiClient';
import { logger } from '@core/logger';
import { assertApiContext } from '@/api/ApiContext';
import { isRecord, parseGraphQLErrors, validateGraphQLResponse, type GraphQLError } from '@/api/GraphQLResponse';
import { Kind, parse, print, visit, getLocation, type FieldNode, type FragmentDefinitionNode,
  type VariableDefinitionNode, type DocumentNode, OperationTypeNode } from 'graphql';

interface PendingRequest {
  query: string;
  variables: Record<string, unknown>;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  type: 'query' | 'mutation';
  sessionId?: string;
}

/** A batch-wide GraphQL failure may hide otherwise readable aliases. */
export class GraphQLBatchGlobalError extends Error {
  public readonly name = 'GraphQLBatchGlobalError';
}

/** Only a provider-confirmed root resource 404 may be remembered as missing. */
export class GraphQLResourceNotFoundError extends Error {
  public readonly name = 'GraphQLResourceNotFoundError';
  public readonly statusCode = 404;
}

@singleton()
export class GraphQLBatcher {
  private queryQueue: Map<string, PendingRequest> = new Map();
  private mutationQueue: Map<string, PendingRequest> = new Map();
  private inFlight = new Set<PendingRequest>();
  private generation = 0;
  private destroyed = false;
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
    if (this.destroyed) return Promise.reject(new Error('Batcher destroyed'));
    return new Promise<T>((resolve, reject) => {
      const id = crypto.randomUUID();
      const queue = type === 'query' ? this.queryQueue : this.mutationQueue;

      queue.set(id, { query, variables: structuredClone(variables), resolve: value => resolve(value as T), reject, type, sessionId: this.api.getContext?.().sessionId });

      if (queue.size >= this.MAX_BATCH_SIZE) {
        void this.flush(type).catch((error: unknown) => logger.error('[GraphQLBatcher] Batch flush failed', error));
      } else {
        this.scheduleFlush();
      }
    });
  }

  private scheduleFlush(): void {
    if (this.batchTimeout) return;
    this.batchTimeout = setTimeout(() => {
      void this.flush('query').catch((error: unknown) => logger.error('[GraphQLBatcher] Scheduled flush failed', error));
      void this.flush('mutation').catch((error: unknown) => logger.error('[GraphQLBatcher] Scheduled flush failed', error));
      this.batchTimeout = null;
    }, this.BATCH_WINDOW_MS);
  }

  private async flush(type: 'query' | 'mutation'): Promise<void> {
    const queue = type === 'query' ? this.queryQueue : this.mutationQueue;
    if (queue.size === 0) return;

    let requests = Array.from(queue.entries());
    queue.clear();
    const allRequests = requests.map(([, request]) => request);
    allRequests.forEach(request => this.inFlight.add(request));
    const generation = this.generation;

    logger.debug(`[GraphQLBatcher] Flushing ${requests.length} ${type}s`);

    try {
      const context = await this.api.ensureContext?.();
      if (generation !== this.generation || this.destroyed) throw new Error('Batcher destroyed');
      if (context) {
        requests = requests.filter(([, request]) => {
          if (request.sessionId && request.sessionId !== context.sessionId) { request.reject(new Error('Batch account changed')); return false; }
          return true;
        });
        if (!requests.length) return;
      }
      await this.executeBatch(requests, type, generation, context);
    } catch (error) {
      logger.error(`[GraphQLBatcher] Batch ${type} failed completely`, error);
      requests.forEach(([_, req]) => req.reject(error instanceof Error ? error : new Error('Batch request failed')));
    } finally {
      allRequests.forEach(request => this.inFlight.delete(request));
    }
  }

  private async executeBatch(requests: [string, PendingRequest][], type: 'query' | 'mutation', generation: number, context: ApiContext | undefined): Promise<void> {
    const assertCurrent = () => {
      if (generation !== this.generation || this.destroyed) throw new Error('Batcher destroyed');
      assertApiContext(this.api, context);
    };
    try {
      assertCurrent();
      const { combinedQuery, combinedVariables, aliasMap, locationAliases } = this.combine(requests, type);
      const response = type === 'mutation'
        ? { data: await this.api.mutate<Record<string, unknown>>(combinedQuery, combinedVariables), errors: undefined }
        : await this.api.queryRaw<Record<string, unknown>>(combinedQuery, combinedVariables);
      assertCurrent();
      const envelope = validateGraphQLResponse(response);
      const data = envelope.data; const errors = parseGraphQLErrors(envelope.errors) ?? [];
      if (data !== undefined && data !== null && !isRecord(data)) throw new Error('Invalid GraphQL batch data');

      const knownAliases = new Set(aliasMap.values());
      const errorAlias = (error: GraphQLError): string | undefined => {
        if (error.path?.length) return typeof error.path[0] === 'string' && knownAliases.has(error.path[0]) ? error.path[0] : undefined;
        const aliases = new Set(error.locations?.map(location => locationAliases.get(`${location.line}:${location.column}`)));
        return aliases.size === 1 && !aliases.has(undefined) ? [...aliases][0] : undefined;
      };
      const aliasesWithErrors = new Map<string, GraphQLError[]>();
      for (const error of errors) {
        const alias = errorAlias(error);
        if (alias) {
          const scoped = aliasesWithErrors.get(alias) ?? [];
          scoped.push(error); aliasesWithErrors.set(alias, scoped);
        }
      }
      const globalErrors = errors.filter(error => errorAlias(error) === undefined);
      const recover404 = type === 'query' && errors.length > 0 && errors.every(error => error.status === 404
        && ((!error.path?.length && !error.locations?.length) || errorAlias(error) !== undefined));
      const retry: [string, PendingRequest][] = [];
      for (const entry of requests) {
        const [id, request] = entry; const alias = aliasMap.get(id)!;
        const result = isRecord(data) && Object.prototype.hasOwnProperty.call(data, alias) ? data[alias] : undefined;
        const fieldErrors = aliasesWithErrors.get(alias);
        if (fieldErrors) {
          const rootMissing = type === 'query' && fieldErrors.every(error => error.status === 404 && (!error.path?.length || error.path.length === 1));
          request.reject(rootMissing ? new GraphQLResourceNotFoundError(fieldErrors[0].message) : new Error(fieldErrors[0].message));
        } else if (result !== null && result !== undefined) {
          request.resolve(result);
        } else if (recover404) {
          retry.push(entry);
        } else if (globalErrors.length || ((data === undefined || data === null) && errors.length)) {
          request.reject(new GraphQLBatchGlobalError((globalErrors[0] ?? errors[0]).message));
        } else if (result !== undefined) {
          request.resolve(result);
        } else {
          request.reject(new Error(`Missing result for alias ${alias}`));
        }
      }
      if (!retry.length) return;
      assertCurrent();
      if (retry.length < requests.length) {
        // Error locations identify the deleted root even when AniList nulls all
        // aliases. Retry every remaining readable root together in one request.
        await this.executeBatch(retry, type, generation, context);
      } else if (retry.length === 1) {
        retry[0][1].reject(new GraphQLResourceNotFoundError(errors[0].message));
      } else {
        // Older/unscoped 404s need bounded binary isolation, never N blind
        // individual retries. All branches still use the shared API scheduler.
        const middle = Math.ceil(retry.length / 2);
        await Promise.all([this.executeBatch(retry.slice(0, middle), type, generation, context),
          this.executeBatch(retry.slice(middle), type, generation, context)]);
      }
    } catch (error) {
      logger.error(`[GraphQLBatcher] Batch ${type} failed`, error);
      requests.forEach(([, request]) => request.reject(error instanceof Error ? error : new Error('Batch request failed')));
    }
  }

  public destroy(): void {
    this.destroyed = true;
    this.generation++;
    if (this.batchTimeout !== null) clearTimeout(this.batchTimeout);
    this.batchTimeout = null;
    for (const request of [...this.queryQueue.values(), ...this.mutationQueue.values(), ...this.inFlight]) request.reject(new Error('Batcher destroyed'));
    this.queryQueue.clear();
    this.mutationQueue.clear();
    this.inFlight.clear();
  }

  private combine(requests: [string, PendingRequest][], type: 'query' | 'mutation') {
    const aliasMap = new Map<string, string>();
    const fields: FieldNode[] = [];
    const fragments: FragmentDefinitionNode[] = [];
    const variableDefinitions: VariableDefinitionNode[] = [];
    const combinedVariables: Record<string, unknown> = {};

    requests.forEach(([id, req], index) => {
      const alias = `a${index}`;
      aliasMap.set(id, alias);

      // Namespace variable and fragment identifiers, keeping values out of query text.
      // This preserves enums, defaults and literal strings containing "$" or braces.
      const document = visit(parse(req.query), {
        Variable: node => ({ ...node, name: { ...node.name, value: `${alias}_${node.name.value}` } }),
        FragmentDefinition: node => ({ ...node, name: { ...node.name, value: `${alias}_${node.name.value}` } }),
        FragmentSpread: node => ({ ...node, name: { ...node.name, value: `${alias}_${node.name.value}` } }),
      });
      const operations = document.definitions.filter(node => node.kind === Kind.OPERATION_DEFINITION);
      if (operations.length !== 1) throw new Error('Batch requests must contain one operation');
      const operation = operations[0];
      if (operation.operation !== type || operation.directives?.length) {
        throw new Error('Unsupported batch operation');
      }
      const selections = operation.selectionSet.selections;
      if (selections.length !== 1 || selections[0].kind !== Kind.FIELD) {
        throw new Error('Batch requests must contain one root field');
      }
      fields.push({ ...selections[0], alias: { kind: Kind.NAME, value: alias } });
      variableDefinitions.push(...operation.variableDefinitions ?? []);
      fragments.push(...document.definitions.filter(node => node.kind === Kind.FRAGMENT_DEFINITION));
      for (const [key, value] of Object.entries(req.variables)) {
        if (value !== undefined) combinedVariables[`${alias}_${key}`] = value;
      }
    });

    const document: DocumentNode = {
      kind: Kind.DOCUMENT,
      definitions: [{
        kind: Kind.OPERATION_DEFINITION,
        operation: type === 'query' ? OperationTypeNode.QUERY : OperationTypeNode.MUTATION,
        variableDefinitions,
        selectionSet: { kind: Kind.SELECTION_SET, selections: fields },
      }, ...fragments],
    };
    const combinedQuery = print(document);
    const printed = parse(combinedQuery); const operation = printed.definitions[0];
    const locationAliases = new Map<string, string>();
    if (operation.kind === Kind.OPERATION_DEFINITION) {
      for (const field of operation.selectionSet.selections) {
        if (field.kind !== Kind.FIELD || !field.alias) continue;
        for (const location of [field.loc, field.name.loc]) {
          if (!location) continue;
          const position = getLocation(location.source, location.start);
          locationAliases.set(`${position.line}:${position.column}`, field.alias.value);
        }
      }
    }
    return { combinedQuery, combinedVariables, aliasMap, locationAliases };
  }
}
