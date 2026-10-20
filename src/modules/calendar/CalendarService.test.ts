import { describe, expect, it, vi } from 'vitest';
import { CalendarService } from './CalendarService';
import { EVENT_TYPES } from '@core/events/EventTypes';

function fixture() {
  let session = 'one';
  const context = () => ({ sessionId: session, userId: session === 'one' ? 1 : 2 });
  const api = { getContext: context, ensureContext: async () => context(), query: vi.fn(async () => ({ Media: { mediaListEntry: { notes: 'Keep existing text' } } })) };
  const queue = { appendNote: vi.fn(async () => {}) };
  const rating = { updateProgress: vi.fn(async () => ({ previousProgress: 10, userId: 1, status: 'CURRENT' })) };
  const bus = { emit: vi.fn() };
  const service = new CalendarService(api as never, bus as never, rating as never, queue as never);
  return { service, api, queue, rating, bus, switchAccount: () => { session = 'two'; } };
}
describe('calendar durable note and progress updates', () => {
  it('preserves remote notes and binds the durable update/journal event to the original account', async () => {
    const { service, queue, bus } = fixture();
    await service.updateNotes(3, 2, 'Episode note');
    expect(queue.appendNote).toHaveBeenCalledWith(3, 2, 'Episode note', 'one');
    expect(bus.emit).toHaveBeenCalledWith(EVENT_TYPES.ASTRA_SAVE_NOTE, { mediaId: 3, episode: 2, notes: 'Episode note', ownerId: 1 });
  });
  it('does not overwrite notes after a read failure or account switch', async () => {
    const { service, queue, bus, switchAccount } = fixture();
    queue.appendNote.mockRejectedValueOnce(new Error('Offline'));
    await expect(service.updateNotes(3, 2, 'Episode note')).rejects.toThrow('Offline');
    queue.appendNote.mockImplementationOnce(async () => { switchAccount(); });
    await expect(service.updateNotes(3, 2, 'Episode note')).rejects.toThrow('account changed');
    expect(bus.emit).not.toHaveBeenCalled();
  });
  it('delegates progress updates and uses the real previous progress and owner', async () => {
    const { service, rating, api, bus } = fixture();
    expect(await service.updateProgress(3, 12)).toBe(true);
    expect(rating.updateProgress).toHaveBeenCalledWith(3, 12);
    expect(api.query).not.toHaveBeenCalled();
    expect(bus.emit).toHaveBeenCalledWith(EVENT_TYPES.PROGRESS_UPDATED, { mediaId: 3, progress: 12, previousProgress: 10, userId: 1, status: 'CURRENT' });
  });
});
