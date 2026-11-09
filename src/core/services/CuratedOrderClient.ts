import { CURATED_ORIGIN, isValidSlug } from '@/modules/watchorder/CuratedOrderMatch';
import { MAX_CURATED_BYTES } from '@/modules/watchorder/CuratedOrderParser';

/**
 * Curated watch orders (AnimeChrono). Public pages only: the sitemap, which robots.txt
 * advertises, and the per-franchise Markdown the site publishes at /franchise/<slug>/order.md.
 * Requests are anonymous, sent without credentials or referrer, paced, size-capped and cached;
 * a failure pauses further requests for a while instead of retrying.
 *
 * The site sits behind a Cloudflare browser check that background requests cannot pass. When the
 * viewer opens a franchise page on animechrono.com themselves, the capture content script hands
 * that page's own order (and the sitemap) to `capture()`; it is validated and kept in extension
 * storage, and served from there whenever the network refuses.
 */
export const CURATED_SITEMAP_URL = `${CURATED_ORIGIN}/sitemap.xml`;
export const CURATED_TIMEOUT_MS = 12_000;
export const CURATED_REQUEST_INTERVAL_MS = 1_000;
export const CURATED_FAILURE_COOLDOWN_MS = 5 * 60 * 1000;
export const CURATED_SLUGS_TTL_MS = 24 * 60 * 60 * 1000;
export const CURATED_ORDER_TTL_MS = 6 * 60 * 60 * 1000;
/** Shown to the viewer when the site wants a browser check that only they can pass. */
export const CURATED_CHALLENGE_REASON = 'browser check required';
const STORED_SLUGS_KEY = 'au-curated-slugs';
const STORED_ORDER_PREFIX = 'au-curated-order:';
const MAX_CAPTURED_SITEMAPS = 4;

/** Durable key/value store (chrome.storage.local in the worker, a Map in tests). */
export interface CuratedStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

interface Stamped<T> {
  at: number;
  value: T;
}

function isStamped(value: unknown): value is Stamped<unknown> {
  return !!value && typeof value === 'object' && typeof (value as Stamped<unknown>).at === 'number';
}

/** What the animechrono.com content script may hand over. Anything else is rejected. */
export type CuratedCapture =
  | { kind: 'order'; slug: string; text: string }
  | { kind: 'sitemaps'; texts: string[] };
const MAX_SITEMAP_BYTES = 2 * 1024 * 1024;
const MAX_SLUGS = 5000;
const MAX_CHILD_SITEMAPS = 3;
const MAX_ORDER_CACHE = 64;

const FRANCHISE_LOC =
  /<loc>\s*https:\/\/www\.animechrono\.com\/franchise\/([a-z0-9-]+)\/?\s*<\/loc>/g;
const ANY_LOC = /<loc>\s*(https:\/\/www\.animechrono\.com\/[^<\s]+\.xml)\s*<\/loc>/g;

/** Slugs of every franchise listed in a sitemap document. */
export function parseSitemapSlugs(xml: string): string[] {
  const slugs = new Set<string>();
  for (const match of xml.matchAll(FRANCHISE_LOC)) {
    if (isValidSlug(match[1])) slugs.add(match[1]);
    if (slugs.size >= MAX_SLUGS) break;
  }
  return [...slugs];
}

export class CuratedOrderClient {
  constructor(private readonly store?: CuratedStore) {}

  private nextRequestAt = 0;
  private blockedUntil = 0;
  private blockedError: unknown = null;
  private slugs?: { at: number; value: string[] };
  private loadingSlugs?: Promise<string[]>;
  private readonly orders = new Map<string, { at: number; value: string }>();
  private readonly pending = new Map<string, Promise<string>>();

  /**
   * Slugs: memory, then the list captured on animechrono.com (whatever its age), and the network
   * only when nothing was ever captured. A capture is refreshed by the next visit to the site.
   */
  public async getSlugs(): Promise<string[]> {
    if (this.slugs && Date.now() - this.slugs.at < CURATED_SLUGS_TTL_MS)
      return [...this.slugs.value];
    const stored = await this.readStored<string[]>(STORED_SLUGS_KEY);
    if (stored?.value.length) {
      this.slugs = stored;
      return [...stored.value];
    }
    return this.networkSlugs();
  }

  /** One franchise order: memory, captured copy (whatever its age), then the network. */
  public async getOrder(slug: string): Promise<string> {
    if (!isValidSlug(slug)) throw new Error('Invalid curated order slug');
    const cached = this.orders.get(slug);
    if (cached && Date.now() - cached.at < CURATED_ORDER_TTL_MS) return cached.value;
    const stored = await this.readStored<string>(`${STORED_ORDER_PREFIX}${slug}`);
    if (stored) {
      this.remember(slug, stored);
      return stored.value;
    }
    return this.networkOrder(slug);
  }

  /** Slugs known without touching the network (memory, then any captured list). */
  public async knownSlugs(): Promise<string[]> {
    if (this.slugs) return [...this.slugs.value];
    return [...((await this.readStored<string[]>(STORED_SLUGS_KEY))?.value ?? [])];
  }

  /** Whether the sitemap captured from animechrono.com is missing or stale. */
  public async needsSitemap(): Promise<boolean> {
    const stored = await this.readStored<string[]>(STORED_SLUGS_KEY);
    return !stored || Date.now() - stored.at >= CURATED_SLUGS_TTL_MS;
  }

  /**
   * Keep what the viewer's own visit to animechrono.com fetched. Validated like a network reply:
   * a valid slug, size caps, and Markdown that parses as a watch order. Returns false if rejected.
   */
  public async capture(
    input: CuratedCapture,
    parse: (markdown: string) => unknown
  ): Promise<boolean> {
    if (input.kind === 'order') {
      if (!isValidSlug(input.slug) || typeof input.text !== 'string') return false;
      if (input.text.length > MAX_CURATED_BYTES || !parse(input.text)) return false;
      const entry = { at: Date.now(), value: input.text };
      this.remember(input.slug, entry);
      await this.store?.set(`${STORED_ORDER_PREFIX}${input.slug}`, entry);
    } else {
      if (!Array.isArray(input.texts) || input.texts.length > MAX_CAPTURED_SITEMAPS) return false;
      const slugs = new Set<string>();
      for (const xml of input.texts) {
        if (typeof xml !== 'string' || xml.length > MAX_SITEMAP_BYTES) return false;
        for (const slug of parseSitemapSlugs(xml)) if (slugs.size < MAX_SLUGS) slugs.add(slug);
      }
      if (!slugs.size) return false;
      this.slugs = { at: Date.now(), value: [...slugs] };
      await this.store?.set(STORED_SLUGS_KEY, this.slugs);
    }
    this.resetCooldown();
    return true;
  }

  private remember(slug: string, entry: Stamped<string>): void {
    if (this.orders.size >= MAX_ORDER_CACHE) this.orders.delete(this.orders.keys().next().value!);
    this.orders.set(slug, entry);
  }

  private async readStored<T>(key: string): Promise<Stamped<T> | null> {
    if (!this.store) return null;
    try {
      const value = await this.store.get(key);
      return isStamped(value) ? (value as Stamped<T>) : null;
    } catch {
      return null;
    }
  }

  private async networkSlugs(): Promise<string[]> {
    if (this.slugs && Date.now() - this.slugs.at < CURATED_SLUGS_TTL_MS)
      return [...this.slugs.value];
    this.loadingSlugs ??= this.loadSlugs().finally(() => {
      this.loadingSlugs = undefined;
    });
    return [...(await this.loadingSlugs)];
  }

  private async networkOrder(slug: string): Promise<string> {
    const cached = this.orders.get(slug);
    if (cached && Date.now() - cached.at < CURATED_ORDER_TTL_MS) return cached.value;
    let request = this.pending.get(slug);
    if (!request) {
      request = this.fetchText(`${CURATED_ORIGIN}/franchise/${slug}/order.md`, MAX_CURATED_BYTES)
        .then((value) => {
          this.remember(slug, { at: Date.now(), value });
          return value;
        })
        .finally(() => {
          this.pending.delete(slug);
        });
      this.pending.set(slug, request);
    }
    return request;
  }

  private async loadSlugs(): Promise<string[]> {
    const root = await this.fetchText(CURATED_SITEMAP_URL, MAX_SITEMAP_BYTES);
    let slugs = parseSitemapSlugs(root);
    if (!slugs.length) {
      // A sitemap index points at child sitemaps on the same origin; follow only a few.
      const children = [...root.matchAll(ANY_LOC)]
        .map((match) => match[1])
        .slice(0, MAX_CHILD_SITEMAPS);
      for (const child of children)
        slugs = [
          ...new Set([
            ...slugs,
            ...parseSitemapSlugs(await this.fetchText(child, MAX_SITEMAP_BYTES)),
          ]),
        ];
    }
    if (!slugs.length) throw new Error('Curated sitemap lists no franchises');
    this.slugs = { at: Date.now(), value: slugs.slice(0, MAX_SLUGS) };
    return this.slugs.value;
  }

  /** Forget a previous failure, e.g. after the viewer passed the browser check. */
  public resetCooldown(): void {
    this.blockedUntil = 0;
    this.blockedError = null;
  }

  private async fetchText(url: string, maxBytes: number): Promise<string> {
    if (this.blockedUntil > Date.now()) throw this.blockedError;
    const now = Date.now();
    const startAt = Math.max(now, this.nextRequestAt);
    this.nextRequestAt = startAt + CURATED_REQUEST_INTERVAL_MS;
    if (startAt > now) await new Promise((resolve) => setTimeout(resolve, startAt - now));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CURATED_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        headers: { Accept: 'text/markdown, text/xml, text/plain' },
      });
      if (!response.ok)
        throw Object.assign(new Error('Curated source unavailable'), {
          statusCode: response.status,
          challenge: isChallenge(response),
        });
      // A redirect to another origin is not the source we agreed to read.
      if (new URL(response.url || url).origin !== CURATED_ORIGIN)
        throw new Error('Curated source redirected off-site');
      const declared = Number(response.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > maxBytes)
        throw new Error('Curated source too large');
      const text = await response.text();
      if (text.length > maxBytes) throw new Error('Curated source too large');
      return text;
    } catch (error) {
      this.blockedUntil = Date.now() + CURATED_FAILURE_COOLDOWN_MS;
      this.blockedError = error;
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Cloudflare marks its interactive check; older setups only show it as a 403/503 HTML page. */
export function isChallenge(response: Pick<Response, 'status' | 'headers'>): boolean {
  if (response.headers.get('cf-mitigated') === 'challenge') return true;
  return (
    (response.status === 403 || response.status === 503) &&
    response.headers.get('server')?.toLowerCase() === 'cloudflare' &&
    (response.headers.get('content-type') ?? '').includes('text/html')
  );
}

/** Short, non-sensitive reason for a failed request, safe to show to the viewer. */
export function curatedFailureReason(error: unknown): string {
  if (error && typeof error === 'object' && 'challenge' in error && error.challenge === true)
    return CURATED_CHALLENGE_REASON;
  if (
    error &&
    typeof error === 'object' &&
    'statusCode' in error &&
    typeof error.statusCode === 'number'
  )
    return `HTTP ${error.statusCode}`;
  if (error instanceof DOMException && error.name === 'AbortError') return 'timed out';
  return error instanceof Error ? error.message.slice(0, 80) : 'unknown error';
}
