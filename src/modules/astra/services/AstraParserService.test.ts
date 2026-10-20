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

/** A framed block as written by earlier versions; still read, never written. */
function legacyFramed(body: string): string {
  return `${ASTRA_MARKERS.HEADER}\n${body}\n${ASTRA_MARKERS.FOOTER}`;
}

function makeWork(seasonOver: Partial<AstraSeason> = {}, notes = ''): AstraWork {
  return {
    id: 'w',
    mediaId: 1,
    title: 'Test',
    type: 'anime',
    status: MediaListStatus.COMPLETED,
    customLists: [],
    tags: [],
    notes,
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
    const sound: AstraSection[] = [
      {
        id: 'sound',
        name: 'Sound',
        weight: 1,
        subSections: [
          { id: 'intro', name: 'Intro', weight: 1 },
          { id: 'outro', name: 'Outro', weight: 1 },
          { id: 'all', name: 'All', weight: 1 },
        ],
      },
    ];
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

  it('carries legacy NOTES text verbatim and never writes General thoughts into the block', () => {
    const work = makeWork({ scores: { art: 8 }, notes: 'A masterpiece of pacing.' });
    expect(parser.serialize(work, sections)).not.toContain('A masterpiece');

    const carried = parser.serialize(
      makeWork({ scores: { art: 8 } }),
      sections,
      'A masterpiece of pacing.'
    );
    expect(parser.parse(carried, sections)!.ratingNotes).toBe('A masterpiece of pacing.');
  });

  it('round-trips multiline prose without interpreting its labels as scores or other episodes', () => {
    const journal =
      'First line\n\nNOTES:\nEp 99: just a quotation\n  indentation\n-----\nLast line';
    const review = 'My review\nJOURNAL:\nRating: quoted text\n\nEnd';
    const original = makeWork({
      episodeNotes: { 1: { text: journal, score: 9, timestamp: 123 } },
    });
    const parsed = parser.parse(`${review}\n\n${parser.serialize(original, sections)}`, sections)!;
    expect(parsed.journal).toEqual({ 1: journal });
    expect(parsed.cleanText).toBe(review);
    const restored = makeWork({ episodeNotes: { 1: { text: '', score: 9, timestamp: 123 } } });
    parser.merge(restored, parsed);
    expect(restored.seasons[0].notes).toBe(review);
    expect(restored.seasons[0].episodeNotes![1]).toEqual({
      text: journal,
      score: 9,
      timestamp: 123,
    });
  });

  it('keeps personal text byte-for-byte across repeated pull/push cycles', () => {
    const source = makeWork({ scores: { art: 8 } });
    const original = `Personal introduction\n\n${parser.serialize(source, sections)}\n\nPersonal ending`;
    const restored = makeWork();
    let remote = original;
    for (let i = 0; i < 4; i++) {
      parser.merge(restored, parser.parse(remote, sections)!);
      remote = parser.inject(remote, restored, sections);
    }
    expect(restored.seasons[0].notes).toBe('Personal introduction\n\nPersonal ending');
    expect(remote).toBe(original);
  });

  it('returns null when the text has no Astra block', () => {
    expect(parser.parse('Just a normal AniList comment.', sections)).toBeNull();
  });

  it('returns an empty string when serializing a work with no data', () => {
    expect(parser.serialize(makeWork(), sections)).toBe('');
  });
});

describe('AstraParserService — frameless format', () => {
  const parser = new AstraParserService();

  it('serializes without the header or footer and never from season notes', () => {
    const text = parser.serialize(makeWork({ scores: { art: 8 }, notes: 'Review' }), sections);
    expect(text).toBe('BREAKDOWN:\n• Art: 8/10');
    expect(text).not.toContain(ASTRA_MARKERS.HEADER);
    expect(text).not.toContain(ASTRA_MARKERS.FOOTER);
  });

  it('writes the carried NOTES section after the journal, separated by a blank line', () => {
    const text = parser.serialize(
      makeWork({ scores: { art: 8 }, episodeNotes: { 1: { text: 'Ok' } } }),
      sections,
      'Legacy\nline'
    );
    expect(text).toBe(
      'BREAKDOWN:\n• Art: 8/10\n\nJOURNAL:\nEp 1: Ok\n\nNOTES:\nRating: Legacy\n  line'
    );
  });

  it('serializes a carried-only report as a NOTES section', () => {
    expect(parser.serialize(makeWork(), sections, 'Only this')).toBe('NOTES:\nRating: Only this');
  });

  it('accepts the manual OVERALL SCORE line inside the breakdown', () => {
    const text = 'BREAKDOWN:\nOVERALL SCORE: 8.5/10 (manual)\n• Art: 8/10';
    const { block } = parser.decompose(`Top\n\n${text}`);
    expect(block).toBe(text);
    expect(parser.parse(text, sections)!.overallScore).toBe(8.5);
  });

  it('takes a frameless block at the end of the text', () => {
    const block = parser.serialize(makeWork({ scores: { art: 8 } }), sections);
    expect(parser.decompose(`Personal\n\n${block}`)).toEqual({
      top: 'Personal\n\n',
      block,
      bottom: '',
    });
  });

  it('keeps personal text after a blank line as the bottom', () => {
    const block = parser.serialize(makeWork({ scores: { art: 8 } }), sections);
    expect(parser.decompose(`${block}\n\nPersonal after`)).toEqual({
      top: '',
      block,
      bottom: '\n\nPersonal after',
    });
  });

  it('ends the block before the first line that does not match the grammar', () => {
    const block = 'BREAKDOWN:\n• Art: 8/10';
    expect(parser.decompose(`${block}\nPersonal line right after\n`)).toEqual({
      top: '',
      block,
      bottom: '\nPersonal line right after\n',
    });
  });

  it('does not treat a label followed by prose as a block', () => {
    const text = 'Thoughts\n\nJOURNAL:\nThis is prose, not an episode.';
    expect(parser.decompose(text)).toEqual({ top: text, block: '', bottom: '' });
    expect(parser.parse(text, sections)).toBeNull();
  });

  it('reads a frameless block written with CRLF line endings', () => {
    const text = 'Top\r\n\r\nBREAKDOWN:\r\n• Art: 8/10\r\n\r\nBottom';
    expect(parser.decompose(text)).toEqual({
      top: 'Top\r\n\r\n',
      block: 'BREAKDOWN:\r\n• Art: 8/10',
      bottom: '\r\n\r\nBottom',
    });
    expect(parser.parse(text, sections)!.sectionScores.art).toBe(8);
  });

  it('refuses two frameless blocks as ambiguous', () => {
    const text = 'BREAKDOWN:\n• Art: 8/10\n\nPersonal\n\nBREAKDOWN:\n• Art: 5/10';
    expect(() => parser.decompose(text)).toThrow(/ambiguous/);
  });

  it('reads a legacy framed block and ignores frameless-looking sections inside it', () => {
    const text = legacyFramed('BREAKDOWN:\n• Art: 8/10\n\nJOURNAL:\nEp 1: great');
    expect(parser.decompose(text).block).toBe(text);
    expect(parser.parse(text, sections)!.journal).toEqual({ 1: 'great' });
  });

  it('refuses a frameless block outside a legacy framed block as ambiguous', () => {
    const text = `BREAKDOWN:\n• Art: 8/10\n\n${legacyFramed('BREAKDOWN:\n• Art: 5/10')}`;
    expect(() => parser.decompose(text)).toThrow(/ambiguous/);
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
    const result = parser.inject(original, updated, sections);
    expect(result).toBe(
      before + '\r\n' + parser.serialize(updated, sections).replace(/\n/g, '\r\n') + after
    );
    expect(parser.compose(parser.decompose(original))).toBe(original);
    expect(parser.inject(result, updated, sections)).toBe(result);
  });

  it('keeps top and bottom byte-for-byte when a score-only save rewrites the block', () => {
    const block = parser.serialize(makeWork({ scores: { art: 8 } }), sections);
    const result = parser.inject(
      `Head\n\n${block}\n\nTail`,
      makeWork({ scores: { art: 5 } }),
      sections
    );
    expect(result).toBe(`Head\n\nBREAKDOWN:\n• Art: 5/10\n\nTail`);
  });

  it('treats an ordinary mention of Astra Review as personal text', () => {
    const personal = 'I used Astra Review yesterday.\n-----\nKeep all of this.  ';
    const updated = makeWork({ notes: 'Astra Review', scores: { art: 8 } });
    const result = parser.inject(personal, updated, sections);
    expect(result.startsWith(personal + '\n\n')).toBe(true);
    expect(parser.parse(personal, sections)).toBeNull();
  });

  it('does not move or remove personal prose that happens to contain the local review', () => {
    const personal = 'Before Great show After\nGreat show\n';
    expect(
      parser.inject(personal, makeWork({ notes: 'Great show' }), sections).startsWith(personal)
    ).toBe(true);
  });

  it.each([
    ASTRA_MARKERS.HEADER + '\nUnterminated\nPersonal ending',
    ASTRA_MARKERS.HEADER + '\n' + ASTRA_MARKERS.HEADER + '\n' + ASTRA_MARKERS.FOOTER,
    ASTRA_MARKERS.HEADER + '\n' + ASTRA_MARKERS.FOOTER + '\n' + ASTRA_MARKERS.FOOTER,
    ASTRA_MARKERS.FOOTER + '\n' + ASTRA_MARKERS.HEADER,
    '--- [ ASTRA REVIEW ] ---\nUnknown historical format\n-----',
  ])('refuses an incomplete, duplicated or unrecognized managed block: %s', (original) => {
    expect(() => parser.inject(original, makeWork({ scores: { art: 8 } }), sections)).toThrow(
      /boundary|boundaries|block/
    );
  });

  it('does not erase a remote block when the local work has no report data', () => {
    const block = parser.serialize(makeWork({ scores: { art: 8 } }), sections);
    const original = `Personal\n\n${block}`;
    expect(parser.inject(original, makeWork(), sections)).toBe(original);
    // Edited General thoughts replace the personal text, but the report itself survives.
    expect(parser.inject(original, makeWork({ notes: '' }), sections, { replaceNotes: true })).toBe(
      block
    );
  });

  it.each([ASTRA_MARKERS.HEADER, ASTRA_MARKERS.FOOTER])(
    'rejects marker injection from a review or Journal: %s',
    (marker) => {
      expect(() =>
        parser.inject('Personal', makeWork({ notes: `Text\n${marker}\nTail` }), sections)
      ).toThrow(/reserved/);
      expect(() =>
        parser.inject(
          'Personal',
          makeWork({ episodeNotes: { 1: { text: `Text\n${marker}\nTail` } } }),
          sections
        )
      ).toThrow(/reserved/);
    }
  );

  it('refuses an oversized result without truncating any personal text', () => {
    const report = makeWork({ scores: { art: 8 } });
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
    const text = `My personal comment\n\n${parser.serialize(work, sections)}`;
    const { top } = parser.decompose(text);
    expect(top).toContain('My personal comment');
  });

  it('inject() replaces the block while preserving surrounding text', () => {
    const work = makeWork({ scores: { art: 8 } });
    const original = `Hello\n\n${parser.serialize(work, sections)}\n\nGoodbye`;

    const updated = makeWork({ scores: { art: 5 } });
    const injected = parser.inject(original, updated, sections);

    expect(injected).toContain('Hello');
    expect(injected).toContain('Goodbye');

    const reparsed = parser.parse(injected, sections);
    expect(reparsed!.sectionScores.art).toBe(5);
  });

  it('never copies General thoughts into the block when they already stay above it', () => {
    const note = 'Story 8 | Characters 7.8';
    const work = makeWork({ scores: { art: 8 }, notes: note });
    const result = parser.inject(note, work, sections);
    expect(result.split(note)).toHaveLength(2);
    expect(result).toContain('BREAKDOWN:');
    expect(parser.parse(result, sections)!.sectionScores.art).toBe(8);
    expect(work.seasons[0].notes).toBe(note);
  });

  it('replaces the text outside the block with edited General thoughts', () => {
    const block = parser.serialize(makeWork({ scores: { art: 8 } }), sections);
    const work = makeWork({ scores: { art: 5 }, notes: 'New outside' });
    expect(parser.inject(`Old outside\n\n${block}`, work, sections, { replaceNotes: true })).toBe(
      'New outside\n\nBREAKDOWN:\n• Art: 5/10'
    );
  });

  it('a notes-only edit writes plain text and no report when there is no data', () => {
    expect(parser.inject('', makeWork({ notes: 'Plain' }), sections, { replaceNotes: true })).toBe(
      'Plain'
    );
  });

  it('turns a legacy framed block with NOTES into a frameless block with the NOTES carried', () => {
    const text = legacyFramed(
      'BREAKDOWN:\n• Art: 8/10\n\nNOTES:\nRating: Legacy review\n  second line'
    );
    const result = parser.inject(text, makeWork({ scores: { art: 8 } }), sections);
    expect(result).toBe('BREAKDOWN:\n• Art: 8/10\n\nNOTES:\nRating: Legacy review\n  second line');
    expect(result).not.toContain(ASTRA_MARKERS.HEADER);
  });

  it('migrates a legacy framed block to plain General thoughts when they are edited', () => {
    const text = legacyFramed('BREAKDOWN:\n• Art: 8/10\n\nNOTES:\nRating: Old review');
    const result = parser.inject(text, makeWork({ scores: { art: 8 }, notes: 'Fresh' }), sections, {
      replaceNotes: true,
    });
    expect(result).toBe('Fresh\n\nBREAKDOWN:\n• Art: 8/10');
  });

  it('round-trips through inject, parse and merge without changing General thoughts, scores or journal', () => {
    const source = makeWork({
      scores: { story: 8, story_pacing: 7, art: 9 },
      episodeNotes: { 1: { text: 'great opener' } },
      notes: 'Outside text',
    });
    const written = parser.inject('Old outside', source, sections, { replaceNotes: true });
    expect(written).toBe(`Outside text\n\n${parser.serialize(source, sections)}`);

    const restored = makeWork();
    parser.merge(restored, parser.parse(written, sections)!);
    const season = restored.seasons[0];
    expect(season.notes).toBe('Outside text');
    expect(restored.notes).toBe('Outside text');
    expect(season.scores).toEqual({ story: 7, story_pacing: 7, art: 9 });
    expect(season.episodeNotes).toEqual({ 1: { text: 'great opener' } });
    // Nothing changed, so a second inject returns the identical text.
    expect(parser.inject(written, restored, sections)).toBe(written);
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
    const work = makeWork({
      notes: '',
      episodeNotes: { 1: { text: 'Old', score: 8, timestamp: 123 } },
    });
    parser.merge(work, {
      sectionScores: {},
      subSectionScores: {},
      journal: { 1: 'New' },
      cleanText: '',
    });
    expect(work.seasons[0].episodeNotes![1]).toEqual({ text: 'New', score: 8, timestamp: 123 });
  });

  it('keeps local journal entries that the remote text omits, never deleting or blanking them', () => {
    const work = makeWork({
      notes: '',
      episodeNotes: { 1: { text: 'Old', score: 8, timestamp: 123 }, 2: { text: 'Remove' } },
    });
    expect(
      parser.merge(work, { sectionScores: {}, subSectionScores: {}, journal: {}, cleanText: '' })
    ).toBe(false);
    expect(work.seasons[0].episodeNotes).toEqual({
      1: { text: 'Old', score: 8, timestamp: 123 },
      2: { text: 'Remove' },
    });
  });

  it('derives a sectioned score from its sub-scores, ignoring a stale parent value unless it is the lode', () => {
    expect(
      parser.serialize(makeWork({ scores: { story: 3, story_pacing: 7 } }), sections)
    ).toContain('• Story: 7/10');
    expect(
      parser.serialize(makeWork({ scores: { story: 11, story_pacing: 7 } }), sections)
    ).toContain('• Story: 11/10');
  });

  it.each([null, 0])(
    'round-trips sub-section scores when the parent score is unset (%s)',
    (parent) => {
      const work = makeWork({ scores: { story: parent, story_pacing: 7 } });
      const parsed = parser.parse(parser.serialize(work, sections), sections);
      expect(parsed?.subSectionScores.story_pacing).toBe(7);
    }
  );

  it('ignores an empty season list without mutating or crashing', () => {
    const work = makeWork();
    work.seasons = [];
    expect(
      parser.merge(work, { sectionScores: {}, subSectionScores: {}, journal: {}, cleanText: '' })
    ).toBe(false);
  });
});

describe('AstraParserService — manual overall score', () => {
  const parser = new AstraParserService();

  it('serializes the manual overall as the first breakdown line, before the section scores', () => {
    expect(parser.serialize(makeWork({ scores: { art: 8 }, manualScore: 9 }), sections)).toBe(
      'BREAKDOWN:\nOVERALL SCORE: 9/10 (manual)\n• Art: 8/10'
    );
  });

  it('writes a manual-only breakdown when no section has a score', () => {
    expect(parser.serialize(makeWork({ manualScore: 3.5 }), sections)).toBe(
      'BREAKDOWN:\nOVERALL SCORE: 3.5/10 (manual)'
    );
  });

  it('writes the lode as 11 and leaves out an invalid manual score', () => {
    expect(parser.serialize(makeWork({ manualScore: 11 }), sections)).toBe(
      'BREAKDOWN:\nOVERALL SCORE: 11/10 (manual)'
    );
    expect(parser.serialize(makeWork({ manualScore: 0 }), sections)).toBe('');
  });

  it('reads the manual flag only on an OVERALL SCORE line marked (manual)', () => {
    const manual = parser.parse('BREAKDOWN:\nOVERALL SCORE: 3.5/10 (manual)', sections)!;
    expect(manual.overallScore).toBe(3.5);
    expect(manual.manualScore).toBe(3.5);

    const plain = parser.parse('BREAKDOWN:\nOVERALL SCORE: 7/10\n• Art: 8/10', sections)!;
    expect(plain.overallScore).toBe(7);
    expect(plain.manualScore).toBeUndefined();
  });

  it('round-trips the manual score through serialize, parse and merge', () => {
    const text = parser.serialize(makeWork({ scores: { art: 8 }, manualScore: 4 }), sections);
    const work = makeWork({ scores: { art: 8 } });
    expect(parser.merge(work, parser.parse(text, sections)!)).toBe(true);
    expect(work.seasons[0].manualScore).toBe(4);
  });

  it('clears a local manual score when the AniList block has no manual line', () => {
    const work = makeWork({ scores: { art: 8 }, manualScore: 4 });
    parser.merge(work, parser.parse('BREAKDOWN:\n• Art: 8/10', sections)!);
    expect(work.seasons[0].manualScore).toBeUndefined();
    expect('manualScore' in work.seasons[0]).toBe(false);
  });

  it('keeps a block whose lines end with spaces or tabs whole and still reads it', () => {
    // Sections are separated by a blank line, as serialize() writes them.
    const block =
      'BREAKDOWN:  \nOVERALL SCORE: 9/10 (manual) \t\n• Art: 8/10\t\n\nJOURNAL:  \nEp 1: Ok  ';
    const decomposed = parser.decompose(`Top\n\n${block}`);
    expect(decomposed.block).toBe(block);
    expect(decomposed.bottom).toBe('');

    const report = parser.parse(block, sections)!;
    expect(report.manualScore).toBe(9);
    expect(report.sectionScores.art).toBe(8);
    expect(report.journal[1]).toBe('Ok');
  });
});
