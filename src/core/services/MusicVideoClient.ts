import { isRecord } from '@/api/GraphQLResponse';
import { isMusicMediaId } from '@/modules/media/MediaMusicResponse';
import { parseThemeVideoIndex, parseThemeVideoSnapshot, type ThemeVideoResponse } from '@/modules/media/MediaThemeVideos';
import { PublicMediaClient } from './PublicMediaClient';

// Public metadata only, published daily; media stay on AnimeThemes' own CDN.
// https://github.com/ToshY/animethemes-moe-tracker
export const MUSIC_VIDEO_INDEX_BASE_URL = 'https://toshy.github.io/animethemes-moe-tracker';
const INDEX_KEY = 'media_theme_video_index_v1';
const INDEX_TTL = 24 * 60 * 60 * 1000;
const LINKS_TTL = 60 * 60 * 1000;

export class MusicVideoClient {
  private readonly client = new PublicMediaClient(MUSIC_VIDEO_INDEX_BASE_URL);
  private index?: { cachedAt: number; ids: Record<string, number> };
  private loadingIndex?: Promise<Record<string, number>>;
  private pending = new Map<number, Promise<ThemeVideoResponse>>();
  private cached = new Map<number, { cachedAt: number; value: ThemeVideoResponse }>();

  public async get(idMal: number): Promise<ThemeVideoResponse> {
    if (!isMusicMediaId(idMal)) throw new Error('Invalid music video MAL ID');
    const cached = this.cached.get(idMal);
    if (cached && Date.now() - cached.cachedAt < LINKS_TTL) return structuredClone(cached.value);
    let request = this.pending.get(idMal);
    if (!request) {
      request = this.load(idMal).then(value => {
        if (this.cached.size >= 128) this.cached.delete(this.cached.keys().next().value!);
        this.cached.set(idMal, { cachedAt: Date.now(), value }); return value;
      }).finally(() => { this.pending.delete(idMal); });
      this.pending.set(idMal, request);
    }
    return structuredClone(await request);
  }

  private async load(idMal: number): Promise<ThemeVideoResponse> {
    const ids = await this.getIndex();
    const snapshotId = ids[String(idMal)];
    if (!snapshotId) return { idMal, links: [] };
    return parseThemeVideoSnapshot(await this.client.get(`/${snapshotId}.json`), snapshotId, idMal);
  }

  private getIndex(): Promise<Record<string, number>> {
    if (this.index && Date.now() - this.index.cachedAt < INDEX_TTL) return Promise.resolve(this.index.ids);
    this.loadingIndex ??= this.loadIndex().finally(() => { this.loadingIndex = undefined; });
    return this.loadingIndex;
  }

  private async loadIndex(): Promise<Record<string, number>> {
    // Session storage keeps the compact MAL->snapshot index across worker restarts.
    // It never crosses the content-script storage bridge and contains no account data.
    try {
      const raw: unknown = (await chrome.storage.session?.get(INDEX_KEY))?.[INDEX_KEY];
      if (isRecord(raw) && typeof raw.cachedAt === 'number' && Number.isSafeInteger(raw.cachedAt)
        && raw.cachedAt <= Date.now() && Date.now() - raw.cachedAt < INDEX_TTL && isRecord(raw.ids)
        && Object.keys(raw.ids).length <= 20000 && Object.entries(raw.ids).every(([key, id]) => /^[1-9]\d*$/.test(key) && isMusicMediaId(Number(key)) && isMusicMediaId(id))) {
        this.index = { cachedAt: raw.cachedAt, ids: raw.ids as Record<string, number> }; return this.index.ids;
      }
    } catch { /* Optional disposable cache; network remains available. */ }
    const ids = parseThemeVideoIndex(await this.client.get('/manifest.json'));
    this.index = { cachedAt: Date.now(), ids };
    try { await chrome.storage.session?.set({ [INDEX_KEY]: this.index }); } catch { /* Optional disposable cache. */ }
    return ids;
  }
}
