import type { AstraEpisodeNote } from '../AstraInterfaces';

export const ASTRA_JOURNAL_PAGE_SIZE = 100;
const MAX_GRAPHQL_INT = 2147483647;

export interface AstraJournalPage {
  start: number;
  end: number;
  count: number;
  pageIndex: number;
  pageCount: number;
}

function episodeCount(value: number | null): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_GRAPHQL_INT ? value : 0;
}

/** Plan one bounded journal page; saved history remains reachable beyond metadata totals. */
export function journalPage(progress: number, total: number | null, notes: Record<number, AstraEpisodeNote>,
  aired: number | null, requestedPage = 0): AstraJournalPage {
  let count = Math.max(episodeCount(progress), episodeCount(total), episodeCount(aired));
  for (const key of Object.keys(notes)) {
    // Canonical positive integer keys are the indices used by the journal editor.
    if (!/^[1-9]\d*$/.test(key)) continue;
    count = Math.max(count, episodeCount(Number(key)));
  }
  const pageCount = Math.max(1, Math.ceil(count / ASTRA_JOURNAL_PAGE_SIZE));
  const normalizedPage = Number.isFinite(requestedPage) ? Math.trunc(requestedPage) : 0;
  const pageIndex = Math.max(0, Math.min(pageCount - 1, normalizedPage));
  return { start: count === 0 ? 0 : pageIndex * ASTRA_JOURNAL_PAGE_SIZE + 1,
    end: Math.min(count, (pageIndex + 1) * ASTRA_JOURNAL_PAGE_SIZE), count, pageIndex, pageCount };
}
