import type { ApiContext, IApiClient } from '@core/interfaces/IApiClient';

export async function captureApiContext(api: IApiClient): Promise<ApiContext | undefined> {
  return api.ensureContext?.();
}
export function assertApiContext(api: IApiClient, expected: ApiContext | undefined, ownerId?: number | null): void {
  if (!expected) return; // An unscoped API operation has no account snapshot to compare.
  const current = api.getContext?.();
  if (current?.sessionId !== expected.sessionId || current.userId !== expected.userId
    || (ownerId !== undefined && ownerId !== expected.userId)) throw new Error('Astra account changed');
}
