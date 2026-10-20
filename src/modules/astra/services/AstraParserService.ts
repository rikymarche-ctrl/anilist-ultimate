import { injectable, singleton } from 'tsyringe';
import { logger } from '@core/logger';
import type { AstraSection, AstraWork } from '../AstraInterfaces';
import type { IAstraParser, ParsedAstraReport, AstraDecomposition } from '../interfaces/IAstraParser';
import { ASTRA_MARKERS } from '../utils/AstraConstants';
import { AstraCalculator } from '../utils/AstraCalculator';
import { assertNotesLength } from '@core/services/NotesSafety';

function formatReviewScore(score: number): string {
  return String(Number(score.toFixed(1)));
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
   * Uses regex to find the decorative header and footer boundaries.
   * 
   * @param text The raw AniList notes string.
   * @returns An object containing the separated compartments.
   */
  public decompose(text: string): AstraDecomposition {
    const headers: { start: number; end: number }[] = [];
    const footers: { start: number; end: number }[] = [];
    for (const line of text.matchAll(/[^\r\n]+/g)) {
      const value = line[0].trim();
      const range = { start: line.index!, end: line.index! + line[0].length };
      if (value.toUpperCase() === ASTRA_MARKERS.HEADER.toUpperCase()) headers.push(range);
      else if (value === ASTRA_MARKERS.FOOTER) footers.push(range);
      else if (/^[─_=-]+.*\[\s*ASTRA REVIEW\s*\]/i.test(value)) {
        throw new Error('Unrecognized Astra Notes boundary; original notes preserved. Review the block manually.');
      }
    }
    if (headers.length === 0) return { top: text, block: '', bottom: '' };
    if (headers.length !== 1 || footers.length !== 1 || footers[0].start < headers[0].end) {
      throw new Error('Incomplete or ambiguous Astra Notes block; original notes preserved. Review the block manually.');
    }
    return {
      top: text.slice(0, headers[0].start),
      block: text.slice(headers[0].start, footers[0].end),
      bottom: text.slice(footers[0].end),
    };
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
      cleanText: (top + '\n' + bottom).trim()
    };

    const lines = block.replace(/\r/g, '').split('\n').slice(1, -1);
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
      if (upperLine === ASTRA_MARKERS.LABELS.BREAKDOWN) { mode = 'breakdown'; continue; }
      if (upperLine === ASTRA_MARKERS.LABELS.JOURNAL) { mode = 'journal'; continue; }
      if (upperLine === ASTRA_MARKERS.LABELS.NOTES || upperLine === 'NOTES' || upperLine === 'GENERAL THOUGHTS:') {
        mode = 'notes'; 
        continue; 
      }
      if (mode === 'breakdown' && upperLine.startsWith(ASTRA_MARKERS.LABELS.OVERALL)) {
        const match = line.match(/[\d.]+/);
        if (match) report.overallScore = parseFloat(match[0]);
        continue;
      }

      if (mode === 'breakdown') {
        const match = line.match(/[:\s]*([^:]+):\s*([\d.]+)\/10/);
        if (match) {
          const rawName = match[1].replace(/^[^a-zA-Z0-9]*/, '').trim();
          const score = parseFloat(match[2]);
          if (isNaN(score)) continue;

          const isSubSection = line.match(/^[ \t]*[├└|]/) || line.startsWith(' ') || line.startsWith('  ');
          const cleanRaw = rawName.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

          if (!isSubSection) {
            const section = sections.find(s => 
              s.name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() === cleanRaw ||
              s.id.toLowerCase() === cleanRaw
            );
            if (section) {
              report.sectionScores[section.id] = score;
              currentSectionId = section.id;
            }
          } else if (currentSectionId) {
            const section = sections.find(s => s.id === currentSectionId);
            const sub = section?.subSections?.find(ss =>
              ss.name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() === cleanRaw ||
              ss.id.toLowerCase() === cleanRaw
            );
            if (sub) {
              report.subSectionScores[`${currentSectionId}_${sub.id}`] = score;
            }
          }
        }
      }
      else if (mode === 'journal') {
        const match = line.match(/^Ep\s*(\d+): ?(.*)/i);
        if (match) {
          const ep = parseInt(match[1]);
          if (!Number.isSafeInteger(ep) || ep < 1 || Object.prototype.hasOwnProperty.call(report.journal, ep)) {
            throw new Error('Ambiguous Astra Journal entries; original data preserved');
          }
          report.journal[ep] = match[2];
          currentEpisode = ep;
        } else if (currentEpisode !== null) {
          report.journal[currentEpisode] += '\n' + rawLine;
        }
      }
      else if (mode === 'notes') {
        const ratingLabelUpper = ASTRA_MARKERS.LABELS.RATING.toUpperCase();
        if (upperLine.startsWith(ratingLabelUpper) && report.ratingNotes === undefined) {
          report.ratingNotes = line.substring(line.toUpperCase().indexOf(ratingLabelUpper) + ratingLabelUpper.length).trim();
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

    // Keep outside text out of the managed review; otherwise pull/push cycles
    // repeatedly copy personal text into the block and grow the Notes forever.
    if (work.notes !== finalNotes || season.notes !== internalNotes) {
      logger.info(`[AstraParser] Notes updated for ${work.mediaId}`);
      work.notes = finalNotes;
      season.notes = internalNotes;
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
   * Converts a domain object into a stringified Astra block.
   * 
   * @param work The source domain object.
   * @param sections Configuration to use for labeling.
   * @returns A serialized string ready for AniList.
   */
  public serialize(work: AstraWork, sections: AstraSection[]): string {
    const season = work.seasons[work.seasons.length - 1];
    if (!season) return '';

    // A free-text marker could masquerade as the end of the managed block.
    const freeText = [season.notes ?? '', ...Object.values(season.episodeNotes ?? {}).map(note => note.text ?? ''),
      ...sections.flatMap(section => [section.name, ...(section.subSections ?? []).map(sub => sub.name)])];
    if (freeText.some(value => value.toUpperCase().includes(ASTRA_MARKERS.HEADER.toUpperCase()) || value.includes(ASTRA_MARKERS.FOOTER))) {
      throw new Error('Astra report contains reserved Notes boundaries; local data preserved. Remove the copied markers before syncing.');
    }

    let breakdownText = '';
    let hasScores = false;

    for (const section of sections) {
      // Sectioned scores derive from their sub-scores; a stored parent value only counts as the lode (11).
      const score = AstraCalculator.calcSectionScore(section, season.scores);
      if (score !== null && score > 0) {
        if (!hasScores) {
          breakdownText += `${ASTRA_MARKERS.LABELS.BREAKDOWN}\n`;
          hasScores = true;
        }
        breakdownText += `• ${section.name}: ${formatReviewScore(score)}/10\n`;
        if (section.subSections) {
          const allSubSectionsHaveLode = section.subSections.length > 0
            && section.subSections.every(sub => season.scores[`${section.id}_${sub.id}`] === 11);
          for (const sub of section.subSections) {
            const subScore = season.scores[`${section.id}_${sub.id}`];
            if (subScore !== null && subScore > 0) {
              breakdownText += `  └ ${sub.name}: ${formatReviewScore(subScore)}/10\n`;
              if (subScore === 11 && !allSubSectionsHaveLode) {
                breakdownText += `    ★ Lode Astra assegnata a ${sub.name}\n`;
              }
            }
          }
          if (allSubSectionsHaveLode) {
            breakdownText += `  ★ Lode Astra assegnata a tutti i sottocampi di ${section.name}\n`;
          }
        }
      }
    }

    let journalText = '';
    let hasJournal = false;
    if (season.episodeNotes && Object.keys(season.episodeNotes).length > 0) {
      const episodes = Object.keys(season.episodeNotes).map(Number).sort((a, b) => a - b);
      for (const ep of episodes) {
        const note = season.episodeNotes[ep];
        if (note.text && note.text.trim()) {
          if (!hasJournal) {
            journalText += `\n${ASTRA_MARKERS.LABELS.JOURNAL}\n`;
            hasJournal = true;
          }
          journalText += `Ep ${ep}: ${note.text.replace(/\r\n/g, '\n').replace(/\n/g, '\n  ')}\n`;
        }
      }
    }

    if (!hasScores && !hasJournal && !season.notes?.trim()) {
      return '';
    }

    let text = `${ASTRA_MARKERS.HEADER}\n`;
    text += breakdownText;
    text += journalText;

    if (season.notes?.trim()) {
      text += `\n${ASTRA_MARKERS.LABELS.NOTES}\n${ASTRA_MARKERS.LABELS.RATING} ${season.notes.trim().replace(/\r\n/g, '\n').replace(/\n/g, '\n  ')}\n`;
    }

    text += ASTRA_MARKERS.FOOTER;
    return text;
  }

  /**
   * Replaces or appends the Astra block in a text string.
   * 
   * @param text The original AniList notes.
   * @param work The data to inject.
   * @param sections Configuration for labels.
   * @param _moveNotesIntoBlock Legacy flag. Personal text is always preserved in place.
   * @returns The updated notes string.
   */
  public inject(text: string, work: AstraWork, sections: AstraSection[], _moveNotesIntoBlock: boolean = false): string {
    const { top, block, bottom } = this.decompose(text);
    const serialized = this.serialize(work, sections);
    // Empty local data must never erase an existing remote report.
    if (!serialized) return text;
    const result = block ? this.compose({ top, block: serialized, bottom })
      : text + (text ? (text.includes('\r\n') ? '\r\n\r\n' : '\n\n') : '') + serialized;
    assertNotesLength(result);
    this.decompose(result);
    return result;
  }
}
