import { describe, expect, it } from 'vitest';
import { AstraRatingFormDraft, steppedCount } from './AstraRatingFormDraft';
import type { AstraWork } from '../AstraInterfaces';
import { MediaListStatus } from '@/api/AnilistTypes';
import { ratingResponse } from '@/test/astra-rating-fixtures';
import { ratingInitialResponse } from '../services/AstraRatingResponse';

const work = (): AstraWork => ({ id: 'draft', mediaId: 1, title: 'Local', type: 'anime', status: MediaListStatus.CURRENT,
  customLists: [], tags: [], notes: '', updatedAt: 1, seasons: [],
  startedAt: { year: 2024, month: null, day: 5 }, completedAt: null });

describe('Astra form date sources', () => {
  it('keeps detached local dates when a remote entry does not exist', () => {
    const local = work(); const draft = new AstraRatingFormDraft(null, local);
    local.startedAt!.year = 2000;
    expect(draft.values).toMatchObject({ startedAt: { year: 2024, month: null, day: 5 }, completedAt: null });
    expect(draft.read(document.createElement('div')).startedAt?.year).toBe(2024);
  });

  it('honors a confirmed remote Clear without falling back to older local dates', () => {
    const entry = ratingInitialResponse(ratingResponse(), 1, 42)!.media.mediaListEntry!;
    entry.startedAt = null;
    expect(new AstraRatingFormDraft(entry, work()).values.startedAt).toBeNull();
  });

  it('gives copied durable edits precedence over local data without inventing an entry', () => {
    const pending = { startedAt: null, completedAt: { year: 2028, month: null, day: null } };
    const draft = new AstraRatingFormDraft(null, work(), pending);
    pending.completedAt.year = 2000;
    expect(draft.values).toMatchObject({ startedAt: null, completedAt: { year: 2028, month: null, day: null } });
  });

  it('uses queued list fields while a newly queued AniList entry has no remote identity yet', () => {
    const draft = new AstraRatingFormDraft(null, work(), {}, {
      status: MediaListStatus.PLANNING, progress: 0, repeat: 2,
      private: true, hidden: true, customLists: [],
    });
    expect(draft.values).toMatchObject({
      progress: 0, repeat: 2, private: true, hidden: true, customLists: [],
    });
  });
});

describe('Astra quick-edit count fields', () => {
  const countRoot = (progress: string, repeat: string): HTMLElement => {
    const root = document.createElement('div');
    root.innerHTML = `<input id="astra-progress" value="${progress}"><input id="astra-repeat" value="${repeat}">`;
    return root;
  };
  const workWithProgress = (progress: number) => ({ progress, customLists: [], isPrivate: false, isHidden: false }) as unknown as AstraWork;

  it('keeps the previous progress and repeat when a count field is emptied instead of saving zero', () => {
    const draft = new AstraRatingFormDraft(null, workWithProgress(5));
    draft.values.repeat = 2;
    expect(draft.read(countRoot('', ''))).toMatchObject({ progress: 5, repeat: 2 });
  });

  it('still reads a typed zero as an explicit value', () => {
    const draft = new AstraRatingFormDraft(null, workWithProgress(5));
    expect(draft.read(countRoot('0', '0'))).toMatchObject({ progress: 0, repeat: 0 });
  });

  it('steps from the last valid count when the typed value is empty', () => {
    expect(steppedCount('', 5, 1)).toBe(6);
    expect(steppedCount('', 0, -1)).toBe(0);
    expect(steppedCount('3', 5, -1)).toBe(2);
  });
});
