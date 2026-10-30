import { inject, injectable } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import type { IApiClient, ApiRequestOptions } from '@core/interfaces/IApiClient';
import type { IEventBus, EventSubscription } from '@core/interfaces/IEventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { ApiError } from '@core/errors/ErrorTypes';
import { BackgroundOperationError } from '@core/errors/OperationFailure';
import type { AuthStateClient } from '@core/auth/AuthStateClient';
import { VIEWER_QUERY, viewerResponse, sameViewerContext, type ViewerCache } from './ViewerResponse';
import type { AniListUser } from './AnilistTypes';
import { MSG } from '@shared/messages';
import { isRecord, validateGraphQLResponse, type GraphQLResponse } from './GraphQLResponse';
import { diagnosticError } from '@core/errors/DiagnosticPrivacy';

@injectable()
export class AnilistClientProxy implements IApiClient {
  private epoch = 0;
  private pending = new Set<(error: Error) => void>();
  private viewer: ViewerCache | null = null;
  private authSubscription: EventSubscription;
  private destroyed = false;
  constructor(
    @inject(TOKENS.AuthTokenService) private auth: AuthStateClient,
    @inject(TOKENS.EventBus) private bus: IEventBus,
  ) {
    this.authSubscription = bus.on(EVENT_TYPES.AUTH_STATE_CHANGED, () => { this.viewer = null; this.clearQueue(); });
  }
  getContext() { return { sessionId: this.auth.getSessionId() ?? '', userId: this.auth.getUserCache()?.userId ?? null }; }
  async ensureContext() { await this.auth.ensureInitialized(); return this.getContext(); }
  isAuthenticated(): boolean { return this.auth.hasToken(); }
  query<T>(query: string, variables: Record<string, unknown> = {}, silent = false, options: ApiRequestOptions = {}): Promise<T> { return this.request('query', query, variables, silent, options.priority === true); }
  async queryRaw<T>(query: string, variables: Record<string, unknown> = {}, options: ApiRequestOptions = {}): Promise<GraphQLResponse<T>> {
    return validateGraphQLResponse(await this.request<unknown>('queryRaw', query, variables, true, options.priority === true)) as GraphQLResponse<T>;
  }
  mutate<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> { return this.request('mutate', query, variables, false); }
  mutateOnce<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> { return this.request('mutateOnce', query, variables, false); }
  private async request<T>(method: string, query: string, variables: Record<string, unknown>, silent: boolean, priority = false): Promise<T> {
    if (this.destroyed) throw new Error('API proxy destroyed');
    const copied = structuredClone(variables);
    const session = this.auth.getSessionId();
    await this.auth.ensureInitialized();
    if (this.destroyed) throw new Error('API proxy destroyed');
    if (session && session !== this.auth.getSessionId()) throw new Error('Request account changed');
    const epoch = this.epoch;
    return new Promise<T>((resolve, reject) => {
      this.pending.add(reject);
      void chrome.runtime.sendMessage({ type: MSG.API_REQUEST, method, query, variables: copied, silent, priority, sessionId: this.auth.getSessionId() }).then(async (response: unknown) => {
        if (epoch !== this.epoch) throw new Error('Request account changed');
        if (isRecord(response) && response.code === 'ACCOUNT_CHANGED') { await this.auth.refresh(); throw new Error('Request account changed'); }
        if (!isRecord(response) || response.success !== true) {
          const status = isRecord(response) ? response.statusCode : undefined;
          const failureCode = isRecord(response) ? response.failureCode : undefined;
          if (typeof failureCode === 'string') {
            throw new BackgroundOperationError('AniList background request failed', failureCode, undefined, status);
          }
          throw new ApiError('AniList background request failed', typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined);
        }
        resolve(response.data as T);
      }).catch((error: unknown) => {
        const failure = error instanceof Error ? error : new Error('AniList background request failed');
        if (!silent && epoch === this.epoch) this.bus.emit(EVENT_TYPES.API_ERROR, { error: diagnosticError(failure), context: 'AniList background API', statusCode: failure instanceof ApiError ? failure.statusCode : undefined, severity: 'medium', timestamp: new Date() });
        reject(failure);
      }).finally(() => this.pending.delete(reject));
    });
  }
  async getCurrentUser(): Promise<AniListUser> {
    await this.auth.ensureInitialized();
    if (this.destroyed) throw new Error('API proxy destroyed');
    const context = this.getContext();
    if (this.viewer && sameViewerContext(this.viewer.context, context)) return structuredClone(this.viewer.user);
    this.viewer = null;
    const epoch = this.epoch;
    const result = await this.query<unknown>(VIEWER_QUERY, {}, false, { priority: true });
    if (this.destroyed || epoch !== this.epoch || !sameViewerContext(context, this.getContext())) throw new Error('Viewer context changed');
    const user = viewerResponse(result, context.userId);
    this.viewer = { context, user };
    return structuredClone(user);
  }
  async getCurrentUserId(): Promise<number> { return (await this.getCurrentUser()).id; }
  destroy(): void { this.destroyed = true; this.authSubscription?.unsubscribe(); this.viewer = null; this.clearQueue(); }
  clearQueue(): void {
    this.epoch++;
    this.viewer = null;
    const pending = [...this.pending];
    this.pending.clear();
    pending.forEach(reject => reject(new ApiError('Request queue cleared')));
  }
  getQueueStatus(): { queueLength: number; activeRequests: number; isRateLimited: boolean } {
    // Scheduling and rate limiting belong to the shared background client.
    return { queueLength: this.pending.size, activeRequests: 0, isRateLimited: false };
  }
}
