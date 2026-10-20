import { describe, expect, it } from 'vitest';
import fixtures from '@/test/fixtures/music-videos.json';
import { findThemeVideo, musicSearchUrl, parseThemeVideoIndex, parseThemeVideoResponse, parseThemeVideoSnapshot, trustedThemeVideoUrl } from './MediaThemeVideos';

describe('identified direct theme videos', () => {
  it('matches both reported anime by MAL identity and exact song variants', () => {
    const seitokai = parseThemeVideoSnapshot(fixtures['4988'], 4988, 61578);
    expect(findThemeVideo('"Kaze no Naka wa Hashiru kkya Nai! (風の中は走るっきゃないっ！)" by Sangatsu no Phantasia', 'OP', seitokai.links))
      .toBe('https://v.animethemes.moe/NamaAnaru-OP1.webm');
    const nia = parseThemeVideoSnapshot(fixtures['5009'], 5009, 63382);
    expect(findThemeVideo('"Respawn!! (リスポーン!!)" by Watame Tsunomaki (eps 2-)', 'OP', nia.links)).toBe('https://v.animethemes.moe/NiaListon-OP1.webm');
    expect(findThemeVideo('2: "Tokimeki Un, Deux, Trois♪ (ときめきアン・ドゥ・トロワ♪)" by Artist (eps 2-)', 'ED', nia.links)).toBe('https://v.animethemes.moe/NiaListon-ED1.webm');
    expect(findThemeVideo('1: "Respawn!!" by Watame Tsunomaki (eps 1)', 'ED', nia.links)).toBeNull();
  });
  it('refuses unrelated, approximate and ambiguous song matches', () => {
    const { links } = parseThemeVideoSnapshot(fixtures['5009'], 5009, 63382);
    expect(findThemeVideo('"Respawn Again" by Artist', 'OP', links)).toBeNull();
    expect(findThemeVideo('"Respawn!!"', 'OP', [...links, { ...links[0], url: 'https://v.animethemes.moe/Other-OP1.webm' }])).toBeNull();
  });
  it.each(['https://v.animethemes.moe.evil.test/x.webm', 'https://v.animethemes.moe@evil.test/x.webm',
    'http://v.animethemes.moe/x.webm', 'https://v.animethemes.moe:444/x.webm', 'https://v.animethemes.moe/x.webm?redirect=evil',
    'https://v.animethemes.moe/x.html', 'javascript:alert(1)', '//v.animethemes.moe/x.webm'])('rejects an untrusted video URL %s', url => {
    expect(trustedThemeVideoUrl(url)).toBeNull();
  });
  it('rejects mismatched snapshot IDs and external MAL mappings', () => {
    expect(() => parseThemeVideoSnapshot(fixtures['5009'], 4988, 63382)).toThrow();
    expect(() => parseThemeVideoSnapshot(fixtures['5009'], 5009, 61578)).toThrow();
  });
  it('chooses a clean high quality version deterministically', () => {
    const raw = structuredClone(fixtures['5009']);
    raw.animethemes[0].animethemeentries[0].videos.nodes.push(
      { link: 'https://v.animethemes.moe/NiaListon-OP1-NCBD1080.webm', nc: true, resolution: 1080 },
      { link: 'https://v.animethemes.moe/NiaListon-OP1-4k.webm', nc: false, resolution: 2160 });
    expect(parseThemeVideoSnapshot(raw, 5009, 63382).links[0].url).toContain('NCBD1080');
  });
  it('does not follow index URLs or ambiguous MAL mappings', () => {
    expect(parseThemeVideoIndex([{ id: 4988, malID: 61578, url: 'https://evil.test' }, ...fixtures.manifest])).toEqual({ 61578: 4988, 63382: 5009 });
    expect(parseThemeVideoIndex([...fixtures.manifest, { id: 6000, malID: 61578 }])).toEqual({ 63382: 5009 });
    expect(() => parseThemeVideoIndex([])).toThrow();
  });
  it('validates and detaches the background response and retains an honest search fallback', () => {
    const data = parseThemeVideoSnapshot(fixtures['5009'], 5009, 63382);
    const links = parseThemeVideoResponse(data, 63382); links[0].titles[0] = 'Changed';
    expect(data.links[0].titles[0]).toBe('RESPAWN!!');
    expect(() => parseThemeVideoResponse(data, 61578)).toThrow();
    expect(decodeURIComponent(musicSearchUrl('1: "Goodbye" by Baby Band (eps 1-12)').split('=')[1])).toBe('Goodbye Baby Band official');
  });
});
