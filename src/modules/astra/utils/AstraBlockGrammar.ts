/**
 * @file AstraBlockGrammar.ts
 * @description Line grammar for frameless Astra blocks written into AniList Notes.
 *
 * A frameless block is a run of labelled sections (BREAKDOWN:, JOURNAL:, NOTES:) that
 * starts after a blank line. It continues only while each line matches the grammar of its
 * section, so personal prose that merely mentions a label is never mistaken for a block.
 */

import { ASTRA_MARKERS } from './AstraConstants';

/** Character range of one frameless block; `end` excludes the line break that follows it. */
export interface AstraBlockRange {
  start: number;
  end: number;
}

type SectionKind = 'breakdown' | 'journal' | 'notes';

interface AstraLine {
  /** Line content without its line break (and without a trailing carriage return). */
  value: string;
  start: number;
  end: number;
}

const SECTION_LABELS = new Map<string, SectionKind>([
  [ASTRA_MARKERS.LABELS.BREAKDOWN, 'breakdown'],
  [ASTRA_MARKERS.LABELS.JOURNAL, 'journal'],
  // Existing NOTES sections are read and carried, never generated from season notes.
  [ASTRA_MARKERS.LABELS.NOTES, 'notes'],
]);

const BREAKDOWN_LINES: readonly RegExp[] = [
  /^OVERALL SCORE: \d+(\.\d+)?\/10( \(manual\))?$/,
  /^• .+: \d+(\.\d+)?\/10$/,
  /^ {2}└ .+: \d+(\.\d+)?\/10$/,
  /^ {4}★ Lode Astra assegnata a .+$/,
  /^ {2}★ Lode Astra assegnata a tutti i sottocampi di .+$/,
];
const JOURNAL_ENTRY = /^Ep \d+: ?.*$/;
const RATING_LINE = /^Rating: ?.*$/;

/** Finds every frameless block in `text`, in order. Framed blocks are not reported here. */
export function findFramelessBlocks(text: string): AstraBlockRange[] {
  const lines = splitLines(text);
  const blocks: AstraBlockRange[] = [];
  let index = 0;
  while (index < lines.length) {
    const last = blockLastLine(lines, index);
    if (last === -1) {
      index += 1;
      continue;
    }
    blocks.push({ start: lines[index].start, end: lines[last].end });
    index = last + 1;
  }
  return blocks;
}

function splitLines(text: string): AstraLine[] {
  const lines: AstraLine[] = [];
  let start = 0;
  for (const raw of text.split('\n')) {
    const value = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    lines.push({ value, start, end: start + value.length });
    start += raw.length + 1;
  }
  return lines;
}

function isBlank(value: string): boolean {
  return value.trim() === '';
}

/** Trailing spaces and tabs never change what a line means; leading indentation does. */
function withoutTrailingSpace(value: string): string {
  return value.replace(/[ \t]+$/, '');
}

function labelOf(value: string): SectionKind | undefined {
  return SECTION_LABELS.get(withoutTrailingSpace(value));
}

/** Whether `value` is valid content for `kind`. `first` marks the line right after the label. */
function isContentLine(kind: SectionKind, value: string, first: boolean): boolean {
  const body = withoutTrailingSpace(value);
  if (kind === 'breakdown') return BREAKDOWN_LINES.some((pattern) => pattern.test(body));
  if (kind === 'journal') {
    return JOURNAL_ENTRY.test(body) || (!first && value.startsWith('  '));
  }
  return first ? RATING_LINE.test(body) : value.startsWith('  ');
}

/**
 * Returns the index of the last content line of the block that starts at `index`,
 * or -1 when no block starts there.
 */
function blockLastLine(lines: AstraLine[], index: number): number {
  const first = labelOf(lines[index].value);
  if (!first) return -1;
  if (index > 0 && !isBlank(lines[index - 1].value)) return -1;
  if (index + 1 >= lines.length || !isContentLine(first, lines[index + 1].value, true)) return -1;

  let kind = first;
  let last = index + 1;
  let cursor = index + 2;
  while (cursor < lines.length) {
    const value = lines[cursor].value;
    if (isContentLine(kind, value, false)) {
      last = cursor;
      cursor += 1;
      continue;
    }
    if (!isBlank(value)) break;
    // A blank line only separates sections: the block continues when the next label starts validly.
    let next = cursor;
    while (next < lines.length && isBlank(lines[next].value)) next += 1;
    const nextKind = next < lines.length ? labelOf(lines[next].value) : undefined;
    if (
      nextKind === undefined ||
      next + 1 >= lines.length ||
      !isContentLine(nextKind, lines[next + 1].value, true)
    ) {
      break;
    }
    kind = nextKind;
    last = next + 1;
    cursor = next + 2;
  }
  return last;
}
