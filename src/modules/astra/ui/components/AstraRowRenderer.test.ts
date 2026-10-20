import { describe, expect, it, vi } from 'vitest';
import { AstraRowRenderer } from './AstraRowRenderer';
import type { AstraSection, AstraWorkSummary } from '../../AstraInterfaces';

const sections: AstraSection[] = [{ id: 'story', name: 'Story', weight: 1 }];
function work(overrides: Partial<AstraWorkSummary> = {}): AstraWorkSummary {
  return {
    id: 'work_1',
    mediaId: 42,
    title: 'Sample',
    type: 'anime',
    status: 'CURRENT',
    updatedAt: 1,
    currentScore: 8,
    progress: 3,
    episodes: 12,
    chapters: 0,
    sectionScores: { story: 8 },
    cover: 'https://img.example/cover.jpg',
    ...overrides,
  } as AstraWorkSummary;
}

describe('AstraRowRenderer', () => {
  it('keeps an http(s) cover as the image source', () => {
    const row = AstraRowRenderer.render(work(), sections, vi.fn());
    expect(row.querySelector('img')!.getAttribute('src')).toBe('https://img.example/cover.jpg');
  });

  it('renders a non-web cover without src instead of aborting the row, and the row stays clickable', () => {
    const onEdit = vi.fn();
    const row = AstraRowRenderer.render(work({ cover: 'javascript:alert(1)' }), sections, onEdit);
    expect(row.querySelector('img')!.hasAttribute('src')).toBe(false);
    expect(row.querySelector('.astra-table-title')).not.toBeNull();
    document.body.replaceChildren(row);
    row.querySelector<HTMLElement>('.astra-col-title')!.click();
    document.body.replaceChildren();
    expect(onEdit).toHaveBeenCalledWith(42);
  });

  it('links light novels to the AniList manga page instead of a non-existent novel path', () => {
    const row = AstraRowRenderer.render(
      work({ type: 'novel' as AstraWorkSummary['type'] }),
      sections,
      vi.fn()
    );
    expect(row.querySelector<HTMLAnchorElement>('.astra-table-title')!.getAttribute('href')).toBe(
      'https://anilist.co/manga/42'
    );
  });

  it('links anime and manga to their own AniList paths', () => {
    const anime = AstraRowRenderer.render(work(), sections, vi.fn());
    const manga = AstraRowRenderer.render(work({ type: 'manga' }), sections, vi.fn());
    expect(anime.querySelector<HTMLAnchorElement>('.astra-table-title')!.getAttribute('href')).toBe(
      'https://anilist.co/anime/42'
    );
    expect(manga.querySelector<HTMLAnchorElement>('.astra-table-title')!.getAttribute('href')).toBe(
      'https://anilist.co/manga/42'
    );
  });
});
