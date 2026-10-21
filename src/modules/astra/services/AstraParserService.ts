import { injectable, singleton } from 'tsyringe';
import { logger } from '@core/logger';
import type { AstraSection, AstraWork } from '../AstraInterfaces';
import type {
  AstraInjectOptions,
  IAstraParser,
  ParsedAstraReport,
  AstraDecomposition,
} from '../interfaces/IAstraParser';
import { ASTRA_MARKERS } from '../utils/AstraConstants';
import { AstraCalculator } from '../utils/AstraCalculator';
import { isManualScore } from '../utils/AstraSeasons';
import { findFramelessBlocks, type AstraBlockRange } from '../utils/AstraBlockGrammar';
import { assertNotesLength } from '@core/services/NotesSafety';

const AMBIGUOUS_BLOCK_ERROR =
  'Incomplete or ambiguous Astra Notes block; original notes preserved. Review the block manually.';

function formatReviewScore(score: number): string {
  return String(Number(score.toFixed(1)));
}

function countNewlines(value: string): number {
  return value.split('\n').length - 1;
}

/** Line breaks that leave a blank line between `before` and the block that follows it. */
function breaksBefore(before: string, eol: string): string {
  if (before === '') return '';
  const trailing = /\s*$/.exec(before)?.[0] ?? '';
  return eol.repeat(Math.max(0, 2 - countNewlines(trailing)));
}

/** Line breaks that leave a blank line between a block and the non-empty text after it. */
function breaksAfter(after: string, eol: string): string {
  if (after === '') return '';
  const leading = /^\s*/.exec(after)?.[0] ?? '';
  return eol.repeat(Math.max(0, 2 - countNewlines(leading)));
}

function splitAt(text: string, range: AstraBlockRange): AstraDecomposition {
  return {
    top: text.slice(0, range.start),
    block: text.slice(range.start, range.end),
    bottom: text.slice(range.end),
  };
}

/**
 * Enterprise implementation of the Astra Parser Service.
 * Uses robust regex and normalization to handle metadata synchronization.
 *
 * This service implements a "Compartment-based" strategy to isolate
 * Astra metadata from user comments, ensuring no data loss during sync.
 */
@injectable()
@singleton()
export class AstraParserService implements IAstraParser {
  /**
   * Decomposes a string into Top, Astra Block, and Bottom compartments.
   * Recognizes both frameless and framed blocks stored on AniList.
   *
   * @param text The raw AniList notes string.
   * @returns An object containing the separated compartments.
   */
  public decompose(text: string): AstraDecomposition {
    const framed = this.locateFramedBlock(text);
    const frameless = findFramelessBlocks(text);
    if (framed) {
      // A frameless block inside the framed one belongs to it; any other one makes the Notes ambiguous.
      if (frameless.some((range) => range.start < framed.start || range.end > framed.end)) {
        throw new Error(AMBIGUOUS_BLOCK_ERROR);
      }
      return splitAt(text, framed);
    }
    if (frameless.length === 0) return { top: text, block: '', bottom: '' };
    if (frameless.length > 1) throw new Error(AMBIGUOUS_BLOCK_ERROR);
    return splitAt(text, frameless[0]);
  }

  /**
   * Composes a single string from multiple Astra compartments.
   *
   * @param parts The decomposed parts to join.
   * @returns A combined string with proper spacing.
   */
  public compose(parts: AstraDecomposition): string {
    return parts.top + parts.block + parts.bottom;
  }

  /**
   * Parses the Astra block to extract structured metadata.
   *
   * @param text The full notes text.
   * @param sections Current Astra configuration for ID matching.
   * @returns A parsed report or null if no block is found.
   */
  public parse(text: string, sections: AstraSection[]): ParsedAstraReport | null {
    const { block, top, bottom } = this.decompose(text);
    if (!block) return null;

    const report: ParsedAstraReport = {
      sectionScores: {},
      subSectionScores: {},
      journal: {},
      cleanText: [top.trim(), bottom.trim()].filter(Boolean).join('\n\n'),
    };

    // Only a framed block has boundary lines to drop; a frameless block starts with its label.
    const rawLines = block.replace(/\r/g, '').split('\n');
    const framed = rawLines[0].trim().toUpperCase() === ASTRA_MARKERS.HEADER.toUpperCase();
    const lines = framed ? rawLines.slice(1, -1) : rawLines;
    let mode: 'breakdown' | 'journal' | 'notes' | null = null;
    let currentSectionId: string | null = null;
    let currentEpisode: number | null = null;
    const generalNotesLines: string[] = [];

    for (const rawLine of lines) {
      // Generated continuation lines are indented so prose such as "NOTES:" or
      // "Ep 2:" cannot be mistaken for a structural label on the next pull.
      if (rawLine.startsWith('  ')) {
        if (mode === 'journal' && currentEpisode !== null) {
          report.journal[currentEpisode] += '\n' + rawLine.slice(2);
          continue;
        }
        if (mode === 'notes' && report.ratingNotes !== undefined) {
          report.ratingNotes += '\n' + rawLine.slice(2);
          continue;
        }
      }
      const line = rawLine.trim();
      if (!line) continue;

      const upperLine = line.toUpperCase();
      if (upperLine === ASTRA_MARKERS.LABELS.BREAKDOWN) {
        mode = 'breakdown';
        continue;
      }
      if (upperLine === ASTRA_MARKERS.LABELS.JOURNAL) {
        mode = 'journal';
        continue;
      }
      if (
        upperLine === ASTRA_MARKERS.LABELS.NOTES ||
        upperLine === 'NOTES' ||
        upperLine === 'GENERAL THOUGHTS:'
      ) {
        mode = 'notes';
        continue;
      }
      if (mode === 'breakdown' && upperLine.startsWith(ASTRA_MARKERS.LABELS.OVERALL)) {
        const match = line.match(/[\d.]+/);
        if (match) {
          report.overallScore = parseFloat(match[0]);
          if (/\(manual\)$/i.test(line) && isManualScore(report.overallScore)) {
            report.manualScore = report.overallScore;
          }
        }
        continue;
      }

      if (mode === 'breakdown') {
        const match = line.match(/[:\s]*([^:]+):\s*([\d.]+)\/10/);
        if (match) {
          const rawName = match[1].replace(/^[^a-zA-Z0-9]*/, '').trim();
          const score = parseFloat(match[2]);
          if (isNaN(score)) continue;

          const isSubSection =
            line.match(/^[ \t]*[├└|]/) || line.startsWith(' ') || line.startsWith('  ');
          const cleanRaw = rawName.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

          if (!isSubSection) {
            const section = sections.find(
              (s) =>
                s.name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() === cleanRaw ||
                s.id.toLowerCase() === cleanRaw
            );
            if (section) {
              report.sectionScores[section.id] = score;
              currentSectionId = section.id;
            }
          } else if (currentSectionId) {
            const section = sections.find((s) => s.id === currentSectionId);
            const sub = section?.subSections?.find(
              (ss) =>
                ss.name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() === cleanRaw ||
                ss.id.toLowerCase() === cleanRaw
            );
            if (sub) {
              report.subSectionScores[`${currentSectionId}_${sub.id}`] = score;
            }
          }
        }
      } else if (mode === 'journal') {
        const match = line.match(/^Ep\s*(\d+): ?(.*)/i);
        if (match) {
          const ep = parseInt(match[1]);
          if (
            !Number.isSafeInteger(ep) ||
            ep < 1 ||
            Object.prototype.hasOwnProperty.call(report.journal, ep)
          ) {
            throw new Error('Ambiguous Astra Journal entries; original data preserved');
          }
          report.journal[ep] = match[2];
          currentEpisode = ep;
        } else if (currentEpisode !== null) {
          report.journal[currentEpisode] += '\n' + rawLine;
        }
      } else if (mode === 'notes') {
        const ratingLabelUpper = ASTRA_MARKERS.LABELS.RATING.toUpperCase();
        if (upperLine.startsWith(ratingLabelUpper) && report.ratingNotes === undefined) {
          report.ratingNotes = line
            .substring(line.toUpperCase().indexOf(ratingLabelUpper) + ratingLabelUpper.length)
            .trim();
        } else if (report.ratingNotes !== undefined) {
          report.ratingNotes += '\n' + rawLine;
        } else {
          generalNotesLines.push(line);
        }
      }
    }

    if (generalNotesLines.length > 0) {
      report.generalNotes = generalNotesLines.join('\n').trim();
    }

    return report;
  }

  /**
   * Merges parsed data into a domain object.
   * General thoughts are the text outside the Astra block, so both notes fields take it.
   *
   * @param work The target work object.
   * @param parsed The data extracted from AniList.
   * @returns True if the local state was updated.
   */
  public merge(work: AstraWork, parsed: ParsedAstraReport): boolean {
    logger.debug(`[AstraParser] Merging data for ${work.mediaId}`);
    let changed = false;
    const season = work.seasons[work.seasons.length - 1];
    if (!season) return false;

    // Combine clean text (outside block) and explicit notes (inside block)
    let finalNotes = parsed.cleanText || '';
    const internalNotes = [parsed.ratingNotes, parsed.generalNotes].filter(Boolean).join('\n');

    if (internalNotes && !finalNotes.includes(internalNotes)) {
      if (!finalNotes) {
        finalNotes = internalNotes;
      } else if (internalNotes.toUpperCase() !== 'NOTES:') {
        finalNotes += '\n' + internalNotes;
      }
    }

    // Keep the Astra block out of the notes the user edits; otherwise every pull copies
    // the report into General thoughts and the next push writes it back a second time.
    if (work.notes !== finalNotes || season.notes !== finalNotes) {
      logger.info(`[AstraParser] Notes updated for ${work.mediaId}`);
      work.notes = finalNotes;
      season.notes = finalNotes;
      changed = true;
    }

    for (const [id, score] of Object.entries(parsed.sectionScores)) {
      if (season.scores[id] !== score) {
        season.scores[id] = score;
        changed = true;
      }
    }
    for (const [key, score] of Object.entries(parsed.subSectionScores)) {
      if (season.scores[key] !== score) {
        season.scores[key] = score;
        changed = true;
      }
    }

    // AniList is the source of truth for the block: a manual overall the block lacks is cleared.
    if (isManualScore(parsed.manualScore)) {
      if (season.manualScore !== parsed.manualScore) {
        season.manualScore = parsed.manualScore;
        changed = true;
      }
    } else if (season.manualScore !== undefined) {
      delete season.manualScore;
      changed = true;
    }

    // Merge journal entries additively: a line missing from the remote text never deletes or blanks local data.
    if (parsed.journal) {
      if (!season.episodeNotes) season.episodeNotes = {};
      for (const [ep, text] of Object.entries(parsed.journal)) {
        const epNum = parseInt(ep);
        if (!season.episodeNotes[epNum] || season.episodeNotes[epNum].text !== text) {
          logger.info(`[AstraParser] Journal updated for Ep ${epNum}`);
          season.episodeNotes[epNum] = { ...season.episodeNotes[epNum], text };
          changed = true;
        }
      }
    }

    return changed;
  }

  /**
   * Converts a domain object into a frameless Astra block (no header or footer lines).
   *
   * @param work The source domain object.
   * @param sections Configuration to use for labeling.
   * @param carriedNotes Legacy NOTES text read from an existing block, written back verbatim.
   * @returns A serialized block ready for AniList, or '' when there is nothing to report.
   */
  public serialize(work: AstraWork, sections: AstraSection[], carriedNotes?: string): string {
    const season = work.seasons[work.seasons.length - 1];
    if (!season) return '';

    // A free-text marker could masquerade as the end of the managed block.
    const freeText = [
      season.notes ?? '',
      carriedNotes ?? '',
      ...Object.values(season.episodeNotes ?? {}).map((note) => note.text ?? ''),
      ...sections.flatMap((section) => [
        section.name,
        ...(section.subSections ?? []).map((sub) => sub.name),
      ]),
    ];
    if (
      freeText.some(
        (value) =>
          value.toUpperCase().includes(ASTRA_MARKERS.HEADER.toUpperCase()) ||
          value.includes(ASTRA_MARKERS.FOOTER)
      )
    ) {
      throw new Error(
        'Astra report contains reserved Notes boundaries; local data preserved. Remove the copied markers before syncing.'
      );
    }

    // The manual overall leads the breakdown, so a manual-only season still produces a block.
    const breakdown: string[] = [];
    if (isManualScore(season.manualScore)) {
      breakdown.push(
        `${ASTRA_MARKERS.LABELS.OVERALL} ${formatReviewScore(season.manualScore)}/10 (manual)`
      );
    }
    for (const section of sections) {
      // Sectioned scores derive from their sub-scores; a stored parent value only counts as the lode (11).
      const score = AstraCalculator.calcSectionScore(section, season.scores);
      if (score !== null && score > 0) {
        breakdown.push(`• ${section.name}: ${formatReviewScore(score)}/10`);
        if (section.subSections) {
          const allSubSectionsHaveLode =
            section.subSections.length > 0 &&
            section.subSections.every((sub) => season.scores[`${section.id}_${sub.id}`] === 11);
          for (const sub of section.subSections) {
            const subScore = season.scores[`${section.id}_${sub.id}`];
            if (subScore !== null && subScore > 0) {
              breakdown.push(`  └ ${sub.name}: ${formatReviewScore(subScore)}/10`);
              if (subScore === 11 && !allSubSectionsHaveLode) {
                breakdown.push(`    ★ Lode Astra assegnata a ${sub.name}`);
              }
            }
          }
          if (allSubSectionsHaveLode) {
            breakdown.push(`  ★ Lode Astra assegnata a tutti i sottocampi di ${section.name}`);
          }
        }
      }
    }

    const journal: string[] = [];
    if (season.episodeNotes) {
      const episodes = Object.keys(season.episodeNotes)
        .map(Number)
        .sort((a, b) => a - b);
      for (const ep of episodes) {
        const note = season.episodeNotes[ep];
        if (note.text && note.text.trim()) {
          journal.push(`Ep ${ep}: ${note.text.replace(/\r\n/g, '\n').replace(/\n/g, '\n  ')}`);
        }
      }
    }

    const parts: string[] = [];
    if (breakdown.length > 0) parts.push([ASTRA_MARKERS.LABELS.BREAKDOWN, ...breakdown].join('\n'));
    if (journal.length > 0) parts.push([ASTRA_MARKERS.LABELS.JOURNAL, ...journal].join('\n'));
    if (carriedNotes?.trim()) {
      const rating = carriedNotes.replace(/\r\n/g, '\n').replace(/\n/g, '\n  ');
      parts.push(`${ASTRA_MARKERS.LABELS.NOTES}\n${ASTRA_MARKERS.LABELS.RATING} ${rating}`);
    }
    // Every label must be preceded by a blank line for the block grammar to recognize it.
    return parts.join('\n\n');
  }

  /**
   * Replaces or appends the Astra block in a text string.
   *
   * @param text The original AniList notes.
   * @param work The data to inject.
   * @param sections Configuration for labels.
   * @param options.replaceNotes True when General thoughts were edited: the text outside the block is replaced by them.
   * @returns The updated notes string.
   */
  public inject(
    text: string,
    work: AstraWork,
    sections: AstraSection[],
    options: AstraInjectOptions = {}
  ): string {
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const { top, block, bottom } = this.decompose(text);
    let result: string;
    let blockExpected: boolean;
    if (options.replaceNotes) {
      const notes = work.seasons[work.seasons.length - 1]?.notes?.trim() ?? '';
      const body = this.serialize(work, sections);
      // Empty local data must never erase an existing remote report.
      const blockOut = body ? body.replace(/\n/g, eol) : block;
      result = [notes, blockOut.trim()].filter(Boolean).join(eol + eol);
      blockExpected = blockOut !== '';
    } else {
      const carried = block ? this.carriedNotesOf(block, sections) : '';
      const body = this.serialize(work, sections, carried);
      // Empty local data must never erase an existing remote report.
      if (!body) return text;
      const written = body.replace(/\n/g, eol);
      result = block
        ? top + breaksBefore(top, eol) + written + breaksAfter(bottom, eol) + bottom
        : text + breaksBefore(text, eol) + written;
      blockExpected = true;
    }
    assertNotesLength(result);
    // The result must read back with its block intact before it is sent to AniList.
    const readBack = this.decompose(result);
    if (blockExpected && readBack.block === '') {
      throw new Error(
        'Astra Notes block could not be written; original notes preserved. Review the block manually.'
      );
    }
    return result;
  }

  /** Existing NOTES text (rating and general lines) of a block, in merge order. */
  private carriedNotesOf(block: string, sections: AstraSection[]): string {
    const parsed = this.parse(block, sections);
    return [parsed?.ratingNotes, parsed?.generalNotes].filter(Boolean).join('\n');
  }

  /** Locates a framed block (header line through footer line), or null when there is none. */
  private locateFramedBlock(text: string): AstraBlockRange | null {
    const headers: AstraBlockRange[] = [];
    const footers: AstraBlockRange[] = [];
    for (const line of text.matchAll(/[^\r\n]+/g)) {
      const value = line[0].trim();
      const range = { start: line.index!, end: line.index! + line[0].length };
      if (value.toUpperCase() === ASTRA_MARKERS.HEADER.toUpperCase()) headers.push(range);
      else if (value === ASTRA_MARKERS.FOOTER) footers.push(range);
      else if (/^[─_=-]+.*\[\s*ASTRA REVIEW\s*\]/i.test(value)) {
        throw new Error(
          'Unrecognized Astra Notes boundary; original notes preserved. Review the block manually.'
        );
      }
    }
    if (headers.length === 0) return null;
    if (headers.length !== 1 || footers.length !== 1 || footers[0].start < headers[0].end) {
      throw new Error(AMBIGUOUS_BLOCK_ERROR);
    }
    return { start: headers[0].start, end: footers[0].end };
  }
}
