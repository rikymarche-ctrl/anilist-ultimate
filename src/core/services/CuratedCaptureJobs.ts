/**
 * @file CuratedCaptureJobs.ts
 * @description One-click curated-order loading. The viewer presses a button on AniList; a
 * visible AnimeChrono tab opens on the matching franchise, the capture content script reads the
 * order from the viewer's own session, and the tab closes once it is stored. Tabs are only ever
 * opened from that click, never automatically.
 */

import {
  CURATED_ORIGIN,
  isValidSlug,
  rankSlugsByTitles,
} from '@/modules/watchorder/CuratedOrderMatch';
import { MSG } from '@shared/messages';
import type { CuratedOrderClient } from './CuratedOrderClient';

const MAX_TITLES = 80;
const MAX_TITLE_LENGTH = 200;
/** A tab still open after this is left alone (the viewer may be answering a check). */
const JOB_TIMEOUT_MS = 2 * 60 * 1000;

interface Job {
  opener: number;
  titles: string[];
  startedAt: number;
}

export function validTitles(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.length) return null;
  const titles = value
    .filter((title): title is string => typeof title === 'string' && title.length > 0)
    .map((title) => title.slice(0, MAX_TITLE_LENGTH))
    .slice(0, MAX_TITLES);
  return titles.length ? titles : null;
}

export class CuratedCaptureJobs {
  private readonly jobs = new Map<number, Job>();

  constructor(private readonly client: CuratedOrderClient) {}

  /** Open the AnimeChrono page that best matches `titles` for the AniList tab `opener`. */
  public async open(titles: string[], opener: number): Promise<void> {
    const [best] = rankSlugsByTitles(await this.client.knownSlugs(), titles);
    const tab = await chrome.tabs.create({
      // The franchise page itself: content scripts reliably run there (a bare Markdown file
      // may be downloaded or shown without them).
      url: best ? `${CURATED_ORIGIN}/franchise/${best}` : `${CURATED_ORIGIN}/`,
      active: true,
      openerTabId: opener,
    });
    if (tab.id !== undefined) this.jobs.set(tab.id, { opener, titles, startedAt: Date.now() });
  }

  /** Whether the tab is a capture tab opened by a click on AniList (and not timed out). */
  public isJob(tabId: number | undefined): boolean {
    const job = tabId === undefined ? undefined : this.jobs.get(tabId);
    if (!job) return false;
    if (Date.now() - job.startedAt > JOB_TIMEOUT_MS) {
      this.jobs.delete(tabId as number);
      return false;
    }
    return true;
  }

  /** Franchise slugs worth reading for this job, ranked against the AniList titles. */
  public async candidates(tabId: number | undefined): Promise<string[]> {
    const job = tabId === undefined ? undefined : this.jobs.get(tabId);
    if (!job) return [];
    return rankSlugsByTitles(await this.client.knownSlugs(), job.titles).filter(isValidSlug);
  }

  /** The order is stored: close the tab and tell the AniList tab to look again. */
  public async finish(tabId: number | undefined): Promise<void> {
    const job = tabId === undefined ? undefined : this.jobs.get(tabId);
    if (!job || tabId === undefined) return;
    this.jobs.delete(tabId);
    await chrome.tabs.update(job.opener, { active: true }).catch(() => undefined);
    await chrome.tabs.remove(tabId).catch(() => undefined);
    await chrome.tabs
      .sendMessage(job.opener, { type: MSG.WATCH_ORDER_READY })
      .catch(() => undefined);
  }
}
