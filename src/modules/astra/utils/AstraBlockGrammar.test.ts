import { describe, it, expect } from 'vitest';
import { findFramelessBlocks } from './AstraBlockGrammar';

/** The text of every frameless block found in `text`. */
const blocksOf = (text: string): string[] =>
  findFramelessBlocks(text).map((range) => text.slice(range.start, range.end));

describe('findFramelessBlocks — trailing whitespace', () => {
  it('keeps the block whole when its labels and lines end with spaces or tabs', () => {
    const block = 'BREAKDOWN:  \n• Art: 8/10 \t\n\nJOURNAL:\t\nEp 1: Ok  ';
    expect(blocksOf(`Top\n\n${block}\n\nBottom`)).toEqual([block]);
  });

  it('reads a manual OVERALL SCORE line with trailing whitespace', () => {
    const block = 'BREAKDOWN:\nOVERALL SCORE: 9/10 (manual)   \n• Art: 8/10';
    expect(blocksOf(`Top\n\n${block}`)).toEqual([block]);
  });

  it('still ends the block at a line that does not match once the trailing space is removed', () => {
    expect(blocksOf('BREAKDOWN:\n• Art: 8/10 \nnot a score')).toEqual(['BREAKDOWN:\n• Art: 8/10 ']);
  });

  it('keeps leading indentation significant', () => {
    expect(blocksOf('BREAKDOWN:\n  • Art: 8/10')).toEqual([]);
    expect(blocksOf('BREAKDOWN:\n• Art: 8/10\n  └ Pacing: 7/10 \t')).toEqual([
      'BREAKDOWN:\n• Art: 8/10\n  └ Pacing: 7/10 \t',
    ]);
  });
});
