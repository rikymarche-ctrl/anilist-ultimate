import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CURATED_CHALLENGE_REASON,
  curatedFailureReason,
  isChallenge,
  CURATED_FAILURE_COOLDOWN_MS,
  CURATED_ORDER_TTL_MS,
  CuratedOrderClient,
  parseSitemapSlugs,
} from './CuratedOrderClient';

const SITEMAP = `<?xml version="1.0"?><urlset>
<url><loc>https://www.animechrono.com/franchise/monogatari</loc></url>
<url><loc>https://www.animechrono.com/franchise/a-certain-magical-index/</loc></url>
<url><loc>https://www.animechrono.com/about</loc></url>
<url><loc>https://evil.example/franchise/hijack</loc></url>
<url><loc>https://www.animechrono.com/franchise/Bad_Slug</loc></url>
</urlset>`;

function reply(
  body: string,
  init: { ok?: boolean; status?: number; url?: string; length?: number } = {}
) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    url: init.url ?? '',
    headers: {
      get: (name: string) =>
        name === 'content-length' && init.length !== undefined ? String(init.length) : null,
    },
    text: async () => body,
  };
}

describe('parseSitemapSlugs', () => {
  it('keeps only valid franchise slugs from the official origin', () => {
    expect(parseSitemapSlugs(SITEMAP)).toEqual(['monogatari', 'a-certain-magical-index']);
  });
});

describe('CuratedOrderClient', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('fetches the sitemap anonymously and caches the slug list', async () => {
    fetchMock.mockResolvedValue(reply(SITEMAP));
    const client = new CuratedOrderClient();
    expect(await client.getSlugs()).toEqual(['monogatari', 'a-certain-magical-index']);
    await client.getSlugs();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://www.animechrono.com/sitemap.xml');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
  });
  it('follows child sitemaps of an index, but only on the official origin', async () => {
    const index =
      '<sitemapindex><sitemap><loc>https://www.animechrono.com/sitemap-franchises.xml</loc></sitemap><sitemap><loc>https://evil.example/x.xml</loc></sitemap></sitemapindex>';
    fetchMock.mockResolvedValueOnce(reply(index)).mockResolvedValueOnce(reply(SITEMAP));
    const client = new CuratedOrderClient();
    const pending = client.getSlugs();
    await vi.advanceTimersByTimeAsync(2000);
    expect(await pending).toContain('monogatari');
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      'https://www.animechrono.com/sitemap.xml',
      'https://www.animechrono.com/sitemap-franchises.xml',
    ]);
  });
  it('fetches an order by validated slug only and caches it until the TTL', async () => {
    fetchMock.mockResolvedValue(reply('# Monogatari Watch Order'));
    const client = new CuratedOrderClient();
    await expect(client.getOrder('../secret')).rejects.toThrow('Invalid curated order slug');
    expect(await client.getOrder('monogatari')).toBe('# Monogatari Watch Order');
    await client.getOrder('monogatari');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://www.animechrono.com/franchise/monogatari/order.md'
    );
    vi.setSystemTime(Date.now() + CURATED_ORDER_TTL_MS + 1);
    await client.getOrder('monogatari');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('rejects redirects off-site and oversized bodies', async () => {
    fetchMock.mockResolvedValueOnce(reply('x', { url: 'https://evil.example/order.md' }));
    await expect(new CuratedOrderClient().getOrder('monogatari')).rejects.toThrow(
      'redirected off-site'
    );
    fetchMock.mockResolvedValueOnce(reply('x', { length: 10_000_000 }));
    await expect(new CuratedOrderClient().getOrder('index-franchise')).rejects.toThrow('too large');
  });
  it('pauses all requests after a failure instead of hammering the source', async () => {
    fetchMock.mockResolvedValueOnce(reply('', { ok: false, status: 403 }));
    const client = new CuratedOrderClient();
    await expect(client.getOrder('monogatari')).rejects.toThrow('unavailable');
    await expect(client.getOrder('other-show')).rejects.toThrow('unavailable');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + CURATED_FAILURE_COOLDOWN_MS + 1);
    fetchMock.mockResolvedValueOnce(reply('# Other Watch Order'));
    expect(await client.getOrder('other-show')).toBe('# Other Watch Order');
  });
});

describe('Cloudflare browser check', () => {
  const headers = (entries: Record<string, string>) => new Headers(entries);
  it('recognises the interactive check, not ordinary errors', () => {
    expect(isChallenge({ status: 403, headers: headers({ 'cf-mitigated': 'challenge' }) })).toBe(
      true
    );
    expect(
      isChallenge({
        status: 503,
        headers: headers({ server: 'cloudflare', 'content-type': 'text/html' }),
      })
    ).toBe(true);
    expect(isChallenge({ status: 404, headers: headers({ server: 'cloudflare' }) })).toBe(false);
    expect(isChallenge({ status: 403, headers: headers({ 'content-type': 'text/html' }) })).toBe(
      false
    );
  });
  it('tells the viewer a browser check is needed', () => {
    expect(curatedFailureReason({ statusCode: 403, challenge: true })).toBe(
      CURATED_CHALLENGE_REASON
    );
  });
});

describe('captured orders', () => {
  const memoryStore = () => {
    const data = new Map<string, unknown>();
    return {
      data,
      get: async (k: string) => data.get(k),
      set: async (k: string, v: unknown) => void data.set(k, v),
    };
  };
  const parse = (text: string) => (text.includes('# Order') ? {} : null);
  const blocked = () =>
    vi.fn(
      async () =>
        new Response('Just a moment...', { status: 403, headers: { 'cf-mitigated': 'challenge' } })
    );

  it('keeps a captured order and serves it when the network is blocked', async () => {
    const store = memoryStore();
    vi.stubGlobal('fetch', blocked());
    const client = new CuratedOrderClient(store);
    expect(
      await client.capture({ kind: 'order', slug: 'monogatari', text: '# Order\n1. A' }, parse)
    ).toBe(true);
    expect(await new CuratedOrderClient(store).getOrder('monogatari')).toBe('# Order\n1. A');
  });
  it('serves an old captured order straight away, without touching the network', async () => {
    const store = memoryStore();
    store.data.set('au-curated-order:monogatari', { at: 0, value: '# Order 1. Old' });
    store.data.set('au-curated-slugs', { at: 0, value: ['monogatari'] });
    const fetch = blocked();
    vi.stubGlobal('fetch', fetch);
    const client = new CuratedOrderClient(store);
    expect(await client.getSlugs()).toEqual(['monogatari']);
    expect(await client.getOrder('monogatari')).toBe('# Order 1. Old');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects captures that are not watch orders or carry a bad slug', async () => {
    const client = new CuratedOrderClient(memoryStore());
    expect(await client.capture({ kind: 'order', slug: 'monogatari', text: '<html>' }, parse)).toBe(
      false
    );
    expect(await client.capture({ kind: 'order', slug: '../x', text: '# Order' }, parse)).toBe(
      false
    );
    expect(await client.capture({ kind: 'sitemaps', texts: ['<urlset></urlset>'] }, parse)).toBe(
      false
    );
  });
  it('falls back to captured slugs and asks for a sitemap only when stale', async () => {
    const store = memoryStore();
    vi.stubGlobal('fetch', blocked());
    const client = new CuratedOrderClient(store);
    expect(await client.needsSitemap()).toBe(true);
    expect(await client.capture({ kind: 'sitemaps', texts: [SITEMAP] }, parse)).toBe(true);
    expect(await client.needsSitemap()).toBe(false);
    expect(await new CuratedOrderClient(store).getSlugs()).toContain('monogatari');
  });
});
