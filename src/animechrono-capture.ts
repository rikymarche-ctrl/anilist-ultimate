/**
 * @file animechrono-capture.ts
 * @description Content script for www.animechrono.com franchise pages. When the viewer opens a
 * franchise page themselves, it reads that page's published watch order (/franchise/<slug>/order.md)
 * and, at most once a day, the public sitemap, from the viewer's own session, and hands them to the
 * extension. No hidden tabs and no background traffic: one visit, at most a few same-site requests.
 */
import { MSG } from '@shared/messages';

const FRANCHISE_PATH = /^\/franchise\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_CHILD_SITEMAPS = 3;
const CHILD_SITEMAP = /<loc>\s*(https:\/\/www\.animechrono\.com\/[^<\s]+\.xml)\s*<\/loc>/g;

async function readText(path: string): Promise<string | null> {
  try {
    const response = await fetch(path, {
      credentials: 'same-origin',
      headers: { Accept: 'text/markdown, text/xml, text/plain' },
    });
    if (!response.ok || new URL(response.url).origin !== location.origin) return null;
    const text = await response.text();
    return text.length <= MAX_BYTES ? text : null;
  } catch {
    return null;
  }
}

async function captureSitemaps(): Promise<void> {
  const root = await readText('/sitemap.xml');
  if (!root) return;
  const texts = [root];
  for (const match of root.matchAll(CHILD_SITEMAP)) {
    if (texts.length > MAX_CHILD_SITEMAPS) break;
    const child = await readText(new URL(match[1]).pathname);
    if (child) texts.push(child);
  }
  await chrome.runtime.sendMessage({ type: MSG.WATCH_ORDER_CAPTURE, kind: 'sitemaps', texts });
}

interface Status {
  needsSitemap: boolean;
  /** This tab was opened by a click on AniList and closes itself once the order is stored. */
  job: boolean;
}

async function ask(kind: string): Promise<Record<string, unknown>> {
  const reply: unknown = await chrome.runtime.sendMessage({ type: MSG.WATCH_ORDER_CAPTURE, kind });
  return reply && typeof reply === 'object' ? (reply as Record<string, unknown>) : {};
}

async function status(): Promise<Status> {
  const reply = await ask('status');
  return { needsSitemap: !!reply.needsSitemap, job: !!reply.job };
}

/** The order file is the page itself when the capture tab opened it directly. */
function pageText(path: string): string | null {
  if (location.pathname !== path || !/^text\/(plain|markdown)/.test(document.contentType)) return null;
  const text = document.body?.innerText ?? '';
  return text && text.length <= MAX_BYTES ? text : null;
}

async function captureOrder(slug: string): Promise<boolean> {
  const path = `/franchise/${slug}/order.md`;
  const text = pageText(path) ?? (await readText(path));
  if (!text) return false;
  const reply: unknown = await chrome.runtime.sendMessage({
    type: MSG.WATCH_ORDER_CAPTURE,
    kind: 'order',
    slug,
    text,
  });
  return !!reply && typeof reply === 'object' && (reply as { success?: unknown }).success === true;
}

/** Capture tab: read the candidate orders the worker ranked, then let it close the tab. */
async function runJob(state: Status): Promise<void> {
  if (state.needsSitemap) await captureSitemaps();
  const reply = await ask('candidates');
  const slugs = Array.isArray(reply.slugs) ? reply.slugs.filter((s) => typeof s === 'string') : [];
  let stored = false;
  for (const slug of slugs as string[]) {
    if (FRANCHISE_PATH.test(`/franchise/${slug}`) && (await captureOrder(slug))) stored = true;
  }
  // If the site is still checking the browser, nothing is stored yet: the page reloads after the
  // check and this runs again. The tab only closes once something was actually read.
  if (stored || (slugs.length === 0 && !state.needsSitemap)) await ask('done');
}

const captured = new Set<string>();
let started = false;

async function captureCurrent(): Promise<void> {
  if (!started) {
    started = true;
    const state = await status();
    if (state.job) return runJob(state);
    if (state.needsSitemap) await captureSitemaps();
  }
  const slug = FRANCHISE_PATH.exec(location.pathname)?.[1];
  if (!slug || captured.has(slug)) return;
  captured.add(slug);
  if (!(await captureOrder(slug))) captured.delete(slug); // Try again on the next visit.
}

// The site navigates without page loads, so watch the address as well as the first load.
let lastPath = '';
const check = () => {
  if (location.pathname === lastPath) return;
  lastPath = location.pathname;
  void captureCurrent().catch(() => undefined);
};
check();
setInterval(check, 1000);
