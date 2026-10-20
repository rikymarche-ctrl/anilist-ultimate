import { describe, it, expect } from 'vitest';
import { AstraParserService } from './AstraParserService';
import { MediaListStatus } from '@/api/AnilistTypes';
import type { AstraSection, AstraSeason, AstraWork } from '../AstraInterfaces';
import { ASTRA_MARKERS } from '../utils/AstraConstants';

const sections: AstraSection[] = [
  {
    id: 'story',
    name: 'Story',
    weight: 1,
    subSections: [{ id: 'pacing', name: 'Pacing', weight: 1 }],
  },
  { id: 'art', name: 'Art', weight: 1 },
];

function makeWork(seasonOver: Partial<AstraSeason> = {}): AstraWork {
  return {
    id: 'w',
    mediaId: 1,
    title: 'Test',
    type: 'anime',
    status: MediaListStatus.COMPLETED,
    customLists: [],
    tags: [],
    notes: '',
    updatedAt: 0,
    seasons: [{ id: 's', name: 'S1', scores: {}, skip: [], episodeNotes: {}, ...seasonOver }],
  };
}

describe('AstraParserService — serialize/parse round-trip', () => {
  const parser = new AstraParserService();

  it('round-trips section and sub-section scores', () => {
    const work = makeWork({ scores: { story: 8, story_pacing: 7, art: 9 } });
    const text = parser.serialize(work, sections);
    const parsed = parser.parse(text, sections);

    expect(parsed).not.toBeNull();
    // Sectioned scores are derived from sub-scores, so the stored parent 8 is replaced by their average.
    expect(parsed!.sectionScores.story).toBe(7);
    expect(parsed!.sectionScores.art).toBe(9);
    expect(parsed!.subSectionScores['story_pacing']).toBe(7);
  });

  it('formats calculated review scores to one decimal place', () => {
    const sound: AstraSection[] = [{
      id: 'sound',
      name: 'Sound',
      weight: 1,
      subSections: [
        { id: 'intro', name: 'Intro', weight: 1 },
        { id: 'outro', name: 'Outro', weight: 1 },
        { id: 'all', name: 'All', weight: 1 },
      ],
    }];
    const work = makeWork({ scores: { sound_intro: 4.9, sound_outro: 4, sound_all: 4.4 } });

    const text = parser.serialize(work, sound);

    expect(text).toContain('• Sound: 4.4/10');
    expect(text).toContain('└ Intro: 4.9/10');
    expect(text).toContain('└ Outro: 4/10');
    expect(text).toContain('└ All: 4.4/10');
    expect(text).not.toMatch(/4\.4\d{3,}/);
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

  it('round-trips multiline prose without interpreting its labels as scores or other episodes', () => {
    const journal = 'First line\n\nNOTES:\nEp 99: just a quotation\n  indentation\n-----\nLast line';
    const review = 'My review\nJOURNAL:\nRating: quoted text\n\nEnd';
    const original = makeWork({ notes: review, episodeNotes: { 1: { text: journal, score: 9, timestamp: 123 } } });
    const parsed = parser.parse(parser.serialize(original, sections), sections)!;
    expect(parsed.journal).toEqual({ 1: journal });
    expect(parsed.ratingNotes).toBe(review);
    const restored = makeWork({ episodeNotes: { 1: { text: '', score: 9, timestamp: 123 } } });
    parser.merge(restored, parsed);
    expect(restored.seasons[0].notes).toBe(review);
    expect(restored.seasons[0].episodeNotes![1]).toEqual({ text: journal, score: 9, timestamp: 123 });
  });

  it('does not absorb personal surrounding text into the managed review across repeated pull/push cycles', () => {
    const source = makeWork({ scores: { art: 8 }, notes: 'Review\nSecond line' });
    const original = `Personal introduction\n\n${parser.serialize(source, sections)}\n\nPersonal ending`;
    const restored = makeWork();
    let remote = original;
    for (let i = 0; i < 4; i++) {
      parser.merge(restored, parser.parse(remote, sections)!);
      remote = parser.inject(remote, restored, sections);
    }
    expect(restored.seasons[0].notes).toBe('Review\nSecond line');
    expect(remote).toBe(original);
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

  it('preserves every surrounding character and is idempotent, including CRLF and whitespace', () => {
    const before = '  Personal text\r\n\r\n\t';
    const after = '\r\n\r\n  Personal ending  \r\n';
    const oldBlock = parser.serialize(makeWork({ scores: { art: 8 } }), sections);
    // Keep the tab on the preceding line: indentation on a marker belongs to the marker itself.
    const original = before + '\r\n' + oldBlock + after;
    const updated = makeWork({ scores: { art: 5 } });
    const result = parser.inject(original, updated, sections, true);
    expect(result).toBe(before + '\r\n' + parser.serialize(updated, sections) + after);
    expect(parser.compose(parser.decompose(original))).toBe(original);
    expect(parser.inject(result, updated, sections)).toBe(result);
  });

  it('treats an ordinary mention of Astra Review as personal text', () => {
    const personal = 'I used Astra Review yesterday.\n-----\nKeep all of this.  ';
    const updated = makeWork({ notes: 'Astra Review' });
    const result = parser.inject(personal, updated, sections, true);
    expect(result.startsWith(personal + '\n\n')).toBe(true);
    expect(parser.parse(personal, sections)).toBeNull();
  });

  it('does not move or remove personal prose that happens to contain the local review', () => {
    const personal = 'Before Great show After\nGreat show\n';
    expect(parser.inject(personal, makeWork({ notes: 'Great show' }), sections, true).startsWith(personal)).toBe(true);
  });

  it.each([
    ASTRA_MARKERS.HEADER + '\nUnterminated\nPersonal ending',
    ASTRA_MARKERS.HEADER + '\n' + ASTRA_MARKERS.HEADER + '\n' + ASTRA_MARKERS.FOOTER,
    ASTRA_MARKERS.HEADER + '\n' + ASTRA_MARKERS.FOOTER + '\n' + ASTRA_MARKERS.FOOTER,
    ASTRA_MARKERS.FOOTER + '\n' + ASTRA_MARKERS.HEADER,
    '--- [ ASTRA REVIEW ] ---\nUnknown historical format\n-----',
  ])('refuses an incomplete, duplicated or unrecognized managed block: %s', original => {
    expect(() => parser.inject(original, makeWork({ scores: { art: 8 } }), sections)).toThrow(/boundary|boundaries|block/);
  });

  it('does not erase a remote block when the local work has no report data', () => {
    const original = parser.serialize(makeWork({ notes: 'Remote review' }), sections);
    expect(parser.inject(original, makeWork(), sections)).toBe(original);
  });

  it.each([ASTRA_MARKERS.HEADER, ASTRA_MARKERS.FOOTER])('rejects marker injection from a review or Journal: %s', marker => {
    expect(() => parser.inject('Personal', makeWork({ notes: `Text\n${marker}\nTail` }), sections)).toThrow(/reserved/);
    expect(() => parser.inject('Personal', makeWork({ episodeNotes: { 1: { text: `Text\n${marker}\nTail` } } }), sections)).toThrow(/reserved/);
  });

  it('refuses an oversized result without truncating any personal text', () => {
    const report = makeWork({ notes: 'Report' });
    const block = parser.serialize(report, sections);
    const exact = 'x'.repeat(6000 - block.length - 2);
    expect(parser.inject(exact, report, sections)).toHaveLength(6000);
    expect(() => parser.inject(exact + 'x', report, sections)).toThrow(/6000/);
  });

  it('recognizes the generated header case-insensitively and keeps ordinary separators in the report', () => {
    const original = `${ASTRA_MARKERS.HEADER.toLowerCase()}\nNOTES:\nRating: Text\n-----\nEnding\n${ASTRA_MARKERS.FOOTER}\nPersonal`;
    expect(parser.decompose(original).bottom).toBe('\nPersonal');
    expect(parser.decompose(original).block).toContain('Ending');
  });

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
    });

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
    });

    expect(changed).toBe(false);
  });

  it('preserves local episode scores and timestamps when replacing synced text', () => {
    const work = makeWork({ notes: '', episodeNotes: { 1: { text: 'Old', score: 8, timestamp: 123 } } });
    parser.merge(work, { sectionScores: {}, subSectionScores: {}, journal: { 1: 'New' }, cleanText: '' });
    expect(work.seasons[0].episodeNotes![1]).toEqual({ text: 'New', score: 8, timestamp: 123 });
  });

  it('keeps local journal entries that the remote text omits, never deleting or blanking them', () => {
    const work = makeWork({ notes: '', episodeNotes: { 1: { text: 'Old', score: 8, timestamp: 123 }, 2: { text: 'Remove' } } });
    expect(parser.merge(work, { sectionScores: {}, subSectionScores: {}, journal: {}, cleanText: '' })).toBe(false);
    expect(work.seasons[0].episodeNotes).toEqual({ 1: { text: 'Old', score: 8, timestamp: 123 }, 2: { text: 'Remove' } });
  });

  it('derives a sectioned score from its sub-scores, ignoring a stale parent value unless it is the lode', () => {
    expect(parser.serialize(makeWork({ scores: { story: 3, story_pacing: 7 } }), sections)).toContain('• Story: 7/10');
    expect(parser.serialize(makeWork({ scores: { story: 11, story_pacing: 7 } }), sections)).toContain('• Story: 11/10');
  });

  it.each([null, 0])('round-trips sub-section scores when the parent score is unset (%s)', parent => {
    const work = makeWork({ scores: { story: parent, story_pacing: 7 } });
    const parsed = parser.parse(parser.serialize(work, sections), sections);
    expect(parsed?.subSectionScores.story_pacing).toBe(7);
  });

  it('ignores an empty season list without mutating or crashing', () => {
    const work = makeWork();
    work.seasons = [];
    expect(parser.merge(work, { sectionScores: {}, subSectionScores: {}, journal: {}, cleanText: '' })).toBe(false);
  });
});
