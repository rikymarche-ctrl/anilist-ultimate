import { describe, it, expect } from 'vitest';
import { AstraParserService } from './AstraParserService';
import type { AstraSection, AstraWork } from '../AstraInterfaces';

const sections: AstraSection[] = [
  { id: 'story', name: 'Story', weight: 1, subSections: [{ id: 'pacing', name: 'Pacing', weight: 1 }] },
  { id: 'art', name: 'Art', weight: 1 },
] as any;

function makeWork(seasonOver: Record<string, any> = {}): AstraWork {
  return {
    id: 'w',
    mediaId: 1,
    title: 'Test',
    type: 'anime',
    status: 'COMPLETED',
    tags: [],
    notes: '',
    updatedAt: 0,
    seasons: [
      { id: 's', label: 'S1', scores: {}, skip: [], episodeNotes: {}, ...seasonOver },
    ],
  } as any;
}

describe('AstraParserService — serialize/parse round-trip', () => {
  const parser = new AstraParserService();

  it('round-trips section and sub-section scores', () => {
    const work = makeWork({ scores: { story: 8, story_pacing: 7, art: 9 } });
    const text = parser.serialize(work, sections);
    const parsed = parser.parse(text, sections);

    expect(parsed).not.toBeNull();
    expect(parsed!.sectionScores.story).toBe(8);
    expect(parsed!.sectionScores.art).toBe(9);
    expect(parsed!.subSectionScores['story_pacing']).toBe(7);
  });

  it('round-trips journal entries', () => {
    const work = makeWork({
      scores: { art: 8 },
      episodeNotes: { 1: { text: 'great opener' }, 2: { text: 'slow but fine' } },
    });
    const text = parser.serialize(work, sections);
    const parsed = parser.parse(text, sections);

    expect(parsed!.journal[1]).toBe('great opener');
    expect(parsed!.journal[2]).toBe('slow but fine');
  });

  it('round-trips the rating notes', () => {
    const work = makeWork({ scores: { art: 8 }, notes: 'A masterpiece of pacing.' });
    const text = parser.serialize(work, sections);
    const parsed = parser.parse(text, sections);

    const notes = `${parsed!.ratingNotes ?? ''} ${parsed!.generalNotes ?? ''}`;
    expect(notes).toContain('A masterpiece of pacing.');
  });

  it('returns null when the text has no Astra block', () => {
    expect(parser.parse('Just a normal AniList comment.', sections)).toBeNull();
  });

  it('returns an empty string when serializing a work with no data', () => {
    expect(parser.serialize(makeWork(), sections)).toBe('');
  });
});

describe('AstraParserService — decompose / inject preserve user text', () => {
  const parser = new AstraParserService();

  it('keeps the user comment above the block as "top"', () => {
    const work = makeWork({ scores: { art: 8 } });
    const text = `My personal comment\n${parser.serialize(work, sections)}`;
    const { top } = parser.decompose(text);
    expect(top).toContain('My personal comment');
  });

  it('inject() replaces the block while preserving surrounding text', () => {
    const work = makeWork({ scores: { art: 8 } });
    const original = `Hello\n${parser.serialize(work, sections)}\nGoodbye`;

    const updated = makeWork({ scores: { art: 5 } });
    const injected = parser.inject(original, updated, sections);

    expect(injected).toContain('Hello');
    expect(injected).toContain('Goodbye');

    const reparsed = parser.parse(injected, sections);
    expect(reparsed!.sectionScores.art).toBe(5);
  });
});

describe('AstraParserService.merge', () => {
  const parser = new AstraParserService();

  it('applies parsed section scores to the latest season and reports a change', () => {
    const work = makeWork();
    const changed = parser.merge(work, {
      sectionScores: { story: 8 },
      subSectionScores: {},
      journal: {},
      cleanText: '',
    } as any);

    expect(changed).toBe(true);
    expect(work.seasons[0].scores.story).toBe(8);
  });

  it('reports no change when parsed data matches the current state', () => {
    // notes:'' so the season's notes already match the parsed empty cleanText.
    const work = makeWork({ scores: { story: 8 }, notes: '' });
    const changed = parser.merge(work, {
      sectionScores: { story: 8 },
      subSectionScores: {},
      journal: {},
      cleanText: '',
    } as any);

    expect(changed).toBe(false);
  });
});
