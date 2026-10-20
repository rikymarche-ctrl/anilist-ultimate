import { describe, expect, it, vi } from 'vitest';
import { CalendarSocialService } from './CalendarSocialService';
describe('calendar social stale data', () => {
  it.each(['entries', 'disabled'])('ignores pending results after %s changes', async mode => {
    let resolve!: (value: Map<number, never[]>) => void;
    const state = { entries: [{ mediaId: 1 }], preferences: { socialEnabled: true } };
    const store = { subscribeToSelector: vi.fn(), getState: () => state, updateEntriesBatch: vi.fn() };
    const service = new CalendarSocialService({ getFriendActivityBatch: () => new Promise(r => { resolve = r; }) } as never, store as never);
    const pending = service.loadFriendActivity();
    if (mode === 'entries') state.entries = [{ mediaId: 2 }]; else state.preferences.socialEnabled = false;
    resolve(new Map([[1, []]])); await pending; expect(store.updateEntriesBatch).not.toHaveBeenCalled();
  });
});
