/**
 * @file CuratedOrderParser.ts
 * @description Parses a curated watch order published as Markdown (the AnimeChrono
 * `/franchise/<slug>/order.md` format) into plain data.
 *
 * The input is third-party text and is untrusted: only fixed, line-based patterns are read,
 * sizes are capped, and every field is later rendered through textContent.
 */

export type CuratedKind = 'movie' | 'ona' | 'ova' | 'special' | 'tv';

export interface CuratedRange {
  from: number;
  to: number;
}

export interface CuratedEntry {
  position: number;
  /** Entry text as published, without the air-date suffix. */
  label: string;
  /** Label without trailing episode / part ranges and kind markers. */
  title: string;
  /** Absolute episode range inside the matching series ("Episodes 8-13"), when stated. */
  episodes: CuratedRange | null;
  /** Arc-local part range ("Part 1-4"); not an absolute episode number. */
  parts: CuratedRange | null;
  kind: CuratedKind | null;
  optional: boolean;
  /** YYYY-MM-DD, present in the release list only. */
  airDate: string | null;
}

export interface CuratedOrder {
  title: string;
  aliases: string[];
  sourceUrl: string | null;
  lastUpdated: string | null;
  lastChecked: string | null;
  /** One-line "start here" advice, when the file has one. */
  startHere: string | null;
  chronological: CuratedEntry[];
  release: CuratedEntry[];
}

/** Defensive caps: a franchise has dozens of entries, never thousands. */
export const MAX_CURATED_ENTRIES = 300;
export const MAX_CURATED_LINE = 400;
export const MAX_CURATED_BYTES = 256 * 1024;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const KINDS: Readonly<Record<string, CuratedKind>> = {
  movie: 'movie',
  ona: 'ona',
  ova: 'ova',
  special: 'special',
  tv: 'tv',
};
const TRAILING_RANGE =
  /\s*(?:[:\-–]\s*)?(?:Episodes?\s+\d+(?:\s*[-–]\s*\d+)?|Part\s+\d+\s*[-–]\s*\d+)\s*$/i;

function metaValue(lines: readonly string[], key: RegExp): string | null {
  for (const line of lines) {
    const match = key.exec(line);
    if (match) return match[1].trim().slice(0, MAX_CURATED_LINE) || null;
  }
  return null;
}

function validDate(value: string | null): string | null {
  return value !== null && DATE.test(value) ? value : null;
}

function range(from: string, to: string | undefined): CuratedRange | null {
  const start = Number(from);
  const end = to === undefined ? start : Number(to);
  return Number.isInteger(start) && Number.isInteger(end) && start > 0 && end >= start
    ? { from: start, to: end }
    : null;
}

/** Parse one numbered list item. Returns null for a line that is not a list entry. */
export function parseCuratedEntry(line: string): CuratedEntry | null {
  const item = /^(\d{1,3})\.\s+(.+)$/.exec(line.trim());
  if (!item) return null;
  let text = item[2].slice(0, MAX_CURATED_LINE).trim();

  let airDate: string | null = null;
  const aired = /\s+[—–-]\s+aired\s+(\d{4}-\d{2}-\d{2})\s*$/i.exec(text);
  if (aired) {
    airDate = validDate(aired[1]);
    text = text.slice(0, aired.index).trim();
  }
  const label = text;

  const optional = /\(optional\)/i.test(text);
  text = text.replace(/\s*\(optional\)/gi, '').trim();

  let kind: CuratedKind | null = null;
  const marker = /\s*\((movie|ona|ova|special|tv)\)\s*$/i.exec(text);
  if (marker) {
    kind = KINDS[marker[1].toLowerCase()] ?? null;
    text = text.slice(0, marker.index).trim();
  }

  let episodes: CuratedRange | null = null;
  let parts: CuratedRange | null = null;
  for (let guard = 0; guard < 4; guard++) {
    const trailing = TRAILING_RANGE.exec(text);
    if (!trailing) break;
    const ep = /Episodes?\s+(\d+)(?:\s*[-–]\s*(\d+))?/i.exec(trailing[0]);
    const part = /Part\s+(\d+)\s*[-–]\s*(\d+)/i.exec(trailing[0]);
    if (ep && !episodes) episodes = range(ep[1], ep[2]);
    else if (part && !parts) parts = range(part[1], part[2]);
    text = text.slice(0, trailing.index).trim();
  }
  if (!text) return null;

  return {
    position: Number(item[1]),
    label,
    title: text,
    episodes,
    parts,
    kind,
    optional,
    airDate,
  };
}

function listUnder(lines: readonly string[], heading: RegExp): CuratedEntry[] {
  const start = lines.findIndex((line) => /^##\s/.test(line) && heading.test(line));
  if (start === -1) return [];
  const entries: CuratedEntry[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^##\s/.test(line) || line.trim() === '---') break;
    const entry = parseCuratedEntry(line);
    if (entry && entries.length < MAX_CURATED_ENTRIES) entries.push(entry);
  }
  return entries;
}

/** Returns null when the text is not a watch order (no title or no chronological list). */
export function parseCuratedOrder(markdown: string): CuratedOrder | null {
  if (typeof markdown !== 'string' || markdown.length === 0 || markdown.length > MAX_CURATED_BYTES)
    return null;
  const lines = markdown.split(/\r?\n/);
  const heading = /^#\s+(.+?)\s+Watch Order\s*$/i.exec(
    lines.find((line) => /^#\s/.test(line)) ?? ''
  );
  if (!heading) return null;

  const chronological = listUnder(lines, /chronological order/i);
  if (!chronological.length) return null;

  const aliases = (metaValue(lines, /^Also known as:\s*(.+)$/i) ?? '')
    .split(',')
    .map((alias) => alias.trim())
    .filter(Boolean)
    .slice(0, 12);
  const startIndex = lines.findIndex((line) => /^##\s+Start here/i.test(line));
  const startHere =
    startIndex === -1
      ? null
      : (lines
          .slice(startIndex + 1)
          .find((line) => line.trim() && !line.startsWith('#'))
          ?.trim()
          .slice(0, MAX_CURATED_LINE) ?? null);

  return {
    title: heading[1].trim().slice(0, MAX_CURATED_LINE),
    aliases,
    sourceUrl: metaValue(lines, /^Source:\s*(https:\/\/\S+)$/i),
    lastUpdated: validDate(metaValue(lines, /^Last updated:\s*(\S+)$/i)),
    lastChecked: validDate(metaValue(lines, /^Last checked against current sources:\s*(\S+)$/i)),
    startHere,
    chronological,
    release: listUnder(lines, /^##\s+Release order/i),
  };
}
