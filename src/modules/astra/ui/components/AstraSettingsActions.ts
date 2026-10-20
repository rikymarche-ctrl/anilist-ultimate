import type { ApiContext, IApiClient } from '@core/interfaces/IApiClient';
import { logger } from '@core/logger';

export interface AstraSettingsScope {
  readonly version: number;
  readonly context?: ApiContext;
}

/** Owns async work/resources for one mounted configuration view. The background
 * remains the durable writer; this queue orders UI read-modify-write commands. */
export class AstraSettingsActions {
  private version = 0;
  private active = false;
  private tail: Promise<void> = Promise.resolve();
  private cleanups = new Set<() => void>();

  constructor(private api: Pick<IApiClient, 'getContext'>) {}

  activate(): void { this.invalidate(); this.active = true; }
  invalidate(): void {
    this.active = false;
    this.version++;
    this.tail = Promise.resolve();
    for (const cleanup of [...this.cleanups]) cleanup();
  }
  capture(): AstraSettingsScope {
    const context = this.api.getContext?.();
    return { version: this.version, ...(context ? { context: { ...context } } : {}) };
  }
  current(scope: AstraSettingsScope): boolean {
    if (!this.active || scope.version !== this.version) return false;
    if (!scope.context) return true; // An unscoped view has no account snapshot to compare.
    const current = this.api.getContext?.();
    return current?.sessionId === scope.context.sessionId && current.userId === scope.context.userId;
  }
  run<T>(scope: AstraSettingsScope, action: () => Promise<T>, completed: (value: T) => void,
    failed: (error: unknown) => void, serialized = true): Promise<void> {
    const task = (serialized ? this.tail : Promise.resolve()).then(async () => {
      if (!this.current(scope)) return;
      let result: T;
      try { result = await action(); }
      catch (error) { if (this.current(scope)) failed(error); return; }
      if (this.current(scope)) completed(result);
    }).catch(error => logger.error('[AstraSettings] Action callback failed', error));
    if (serialized) this.tail = task;
    return task;
  }
  track(scope: AstraSettingsScope, dispose: () => void): () => void {
    let released = false;
    const cleanup = () => {
      if (released) return;
      released = true;
      this.cleanups.delete(cleanup);
      try { dispose(); } catch (error) { logger.error('[AstraSettings] Cleanup failed', error); }
    };
    this.cleanups.add(cleanup);
    if (!this.current(scope)) cleanup();
    return cleanup;
  }
  schedule(scope: AstraSettingsScope, callback: () => void, milliseconds: number): void {
    const timer = window.setTimeout(() => {
      release();
      if (this.current(scope)) {
        try { callback(); } catch (error) { logger.error('[AstraSettings] Scheduled callback failed', error); }
      }
    }, milliseconds);
    const release = this.track(scope, () => clearTimeout(timer));
  }
}
