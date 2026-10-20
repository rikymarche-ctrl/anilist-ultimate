/**
 * Public MAL data. Jikan's original hosted API closed on 2026-10-01:
 * https://github.com/jikan-me/jikan-rest/issues/613
 * Edge uses /v1, camelCase identities and structured theme objects.
 */
export const PUBLIC_MEDIA_BASE_URL = 'https://jikan.lucashdo.com/v1';
// Edge can omit opening themes on current MAL pages; use Tenrai's catalogue for music.
export const MUSIC_THEMES_BASE_URL = 'https://api.tenrai.org/v1';
export const PUBLIC_MEDIA_TIMEOUT_MS = 12_000;
const FAILURE_COOLDOWN_MS = 15_000;

export class PublicMediaClient {
  private pending = new Map<string, Promise<unknown>>();
  private failures = new Map<string, { until: number; error: unknown }>();
  private nextRequestAt = 0;

  constructor(private readonly baseUrl = PUBLIC_MEDIA_BASE_URL, private readonly requestIntervalMs = 0) {}

  public async get(path: string): Promise<unknown> {
    const failed = this.failures.get(path);
    if (failed && failed.until > Date.now()) throw failed.error;
    this.failures.delete(path);
    let request = this.pending.get(path);
    if (!request) {
      request = this.fetchPublic(path).catch((error: unknown) => {
        // Observer ticks in many tabs must not hammer an unavailable provider.
        if (this.failures.size >= 128) this.failures.delete(this.failures.keys().next().value!);
        this.failures.set(path, { until: Date.now() + FAILURE_COOLDOWN_MS, error });
        throw error;
      }).finally(() => { this.pending.delete(path); });
      this.pending.set(path, request);
    }
    // Every tab receives its own public response; there is no account state here.
    return structuredClone(await request);
  }

  private async fetchPublic(path: string): Promise<unknown> {
    // One worker coordinates distinct works too: Tenrai allows 4/s and 120/min.
    const now = Date.now();
    const startAt = Math.max(now, this.nextRequestAt);
    this.nextRequestAt = startAt + this.requestIntervalMs;
    if (startAt > now) await new Promise(resolve => setTimeout(resolve, startAt - now));
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('Public media request timed out'));
      }, PUBLIC_MEDIA_TIMEOUT_MS);
    });
    try {
      return await Promise.race([deadline, (async () => {
        const response = await fetch(`${this.baseUrl}${path}`, {
          signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer',
        });
        if (!response.ok) throw Object.assign(new Error('Public media unavailable'), { statusCode: response.status });
        return await response.json() as unknown;
      })()]);
    } finally { clearTimeout(timer); }
  }
}
