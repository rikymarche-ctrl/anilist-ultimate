import { injectable, singleton } from 'tsyringe';
import { log } from '@core/logger';
import type { AstraSection, AstraWork } from '../AstraInterfaces';
import type { IAstraParser, ParsedAstraReport, AstraDecomposition } from '../interfaces/IAstraParser';
import { ASTRA_MARKERS } from '../utils/AstraConstants';

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
    if (!text) return { top: '', block: '', bottom: '' };

    // Find where the block starts by looking for the anchor
    // Use a case-insensitive search for better legacy compatibility
    const anchorRegex = new RegExp(ASTRA_MARKERS.ANCHOR, 'i');
    const anchorMatch = text.match(anchorRegex);
    
    if (!anchorMatch || anchorMatch.index === undefined) {
      return { top: text.trim(), block: '', bottom: '' };
    }

    let headerStartIdx = anchorMatch.index;

    // Find the start of the line containing the anchor (to catch the decorative header)
    const beforeAnchor = text.substring(0, headerStartIdx);
    const lastLineBreak = beforeAnchor.lastIndexOf('\n');
    headerStartIdx = lastLineBreak === -1 ? 0 : lastLineBreak + 1;

    const top = text.substring(0, headerStartIdx).trim();
    const rest = text.substring(headerStartIdx);
    
    // Look for footer/separator
    // Matches 5 or more dashes, underscores, etc. at the start of a line
    const footerRegex = /^([ \t]*[-_─=]{5,}.*)$/m;
    const footerMatch = rest.match(footerRegex);
    
    if (footerMatch && footerMatch.index !== undefined) {
      const blockEndIdx = footerMatch.index + footerMatch[0].length;
      const block = rest.substring(0, blockEndIdx).trim();
      const bottom = rest.substring(blockEndIdx).trim();
      return { top, block, bottom };
    }

    // If no footer, everything after header is block
    return { top, block: rest.trim(), bottom: '' };
  }

  /**
   * Composes a single string from multiple Astra compartments.
   * 
   * @param parts The decomposed parts to join.
   * @returns A combined string with proper spacing.
   */
  public compose(parts: AstraDecomposition): string {
    const segments: string[] = [];
    if (parts.top) segments.push(parts.top);
    if (parts.block) segments.push(parts.block);
    if (parts.bottom) segments.push(parts.bottom);
    return segments.join('\n\n').trim();
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

    const lines = block.replace(/\r/g, '').split('\n').map(l => l.trim());
    let mode: 'breakdown' | 'journal' | 'notes' | null = null;
    let currentSectionId: string | null = null;
    let generalNotesLines: string[] = [];

    for (const line of lines) {
      if (!line) continue;

      const upperLine = line.toUpperCase();
      if (upperLine.includes(ASTRA_MARKERS.LABELS.BREAKDOWN)) { mode = 'breakdown'; continue; }
      if (upperLine.includes(ASTRA_MARKERS.LABELS.JOURNAL)) { mode = 'journal'; continue; }
      // More permissive check for NOTES section
      if (upperLine.includes(ASTRA_MARKERS.LABELS.NOTES) || upperLine === 'NOTES' || upperLine === 'GENERAL THOUGHTS:') { 
        mode = 'notes'; 
        continue; 
      }
      if (upperLine.includes(ASTRA_MARKERS.LABELS.OVERALL)) {
        const match = line.match(/[\d.]+/);
        if (match) report.overallScore = parseFloat(match[0]);
        continue;
      }

      // Skip decorative lines
      if (line.match(/^[-_─=]{5,}/)) continue;

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
            const sub = section?.subSections?.find((ss: any) => 
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
        const match = line.match(/Ep\s*(\d+):\s*(.*)/i);
        if (match) {
          const ep = parseInt(match[1]);
          report.journal[ep] = match[2].trim();
        }
      }
      else if (mode === 'notes') {
        const ratingLabelUpper = ASTRA_MARKERS.LABELS.RATING.toUpperCase();
        if (upperLine.startsWith(ratingLabelUpper)) {
          report.ratingNotes = line.substring(line.toUpperCase().indexOf(ratingLabelUpper) + ratingLabelUpper.length).trim();
        } else if (!upperLine.includes(ASTRA_MARKERS.LABELS.NOTES)) {
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
    log.debug(`[AstraParser] Merging data for ${work.mediaId}. Parsed CleanText: "${parsed.cleanText?.substring(0, 20)}"`);
    let changed = false;
    const season = work.seasons[work.seasons.length - 1];

    // Combine clean text (outside block) and explicit notes (inside block)
    let finalNotes = parsed.cleanText || '';
    const internalNotes = (parsed.generalNotes || '') + (parsed.ratingNotes || '');
    
    if (internalNotes && !finalNotes.includes(internalNotes)) {
      if (!finalNotes) {
        finalNotes = internalNotes;
      } else if (internalNotes.toUpperCase() !== 'NOTES:') {
        finalNotes += '\n' + internalNotes;
      }
    }

    if (work.notes !== finalNotes || season.notes !== finalNotes) {
      log.info(`[AstraParser] Notes updating for ${work.mediaId}: Root="${work.notes?.substring(0, 20)}", Season="${season.notes?.substring(0, 20)}" -> New="${finalNotes.substring(0, 20)}"`);
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

    // Merge journal entries (Additive and Subtractive)
    if (parsed.journal) {
      if (!season.episodeNotes) season.episodeNotes = {};
      // Add or update
      for (const [ep, text] of Object.entries(parsed.journal)) {
        const epNum = parseInt(ep);
        if (!season.episodeNotes[epNum] || season.episodeNotes[epNum].text !== text) {
          log.info(`[AstraParser] Journal update for Ep ${epNum}: "${season.episodeNotes[epNum]?.text}" -> "${text}"`);
          season.episodeNotes[epNum] = { text };
          changed = true;
        }
      }
      
      // Remove local entries that are no longer in the parsed report
      const localEps = Object.keys(season.episodeNotes).map(Number);
      for (const epNum of localEps) {
        if (!parsed.journal[epNum]) {
          log.info(`[AstraParser] Deleting local journal entry for Ep ${epNum} (missing from AniList)`);
          delete season.episodeNotes[epNum];
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

    let breakdownText = '';
    let hasScores = false;

    for (const section of sections) {
      const score = season.scores[section.id];
      if (score !== null && score > 0) {
        if (!hasScores) {
          breakdownText += `${ASTRA_MARKERS.LABELS.BREAKDOWN}\n`;
          hasScores = true;
        }
        breakdownText += `• ${section.name}: ${score}/10\n`;
        if (section.subSections) {
          for (const sub of section.subSections) {
            const subScore = season.scores[`${section.id}_${sub.id}`];
            if (subScore !== null && subScore > 0) {
              breakdownText += `  └ ${sub.name}: ${subScore}/10\n`;
            }
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
          journalText += `Ep ${ep}: ${note.text}\n`;
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
      text += `\n${ASTRA_MARKERS.LABELS.NOTES}\n${ASTRA_MARKERS.LABELS.RATING} ${season.notes.trim()}\n`;
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
   * @param moveNotesIntoBlock If true, attempts to move the plain notes from the text into the block.
   * @returns The updated notes string.
   */
  public inject(text: string, work: AstraWork, sections: AstraSection[], moveNotesIntoBlock: boolean = false): string {
    const { top, bottom } = this.decompose(text);
    const serialized = this.serialize(work, sections);
    
    let finalTop = top;
    if (moveNotesIntoBlock) {
      const season = work.seasons[work.seasons.length - 1];
      const notesToStrip = season?.notes?.trim();
      if (notesToStrip && finalTop.includes(notesToStrip)) {
        finalTop = finalTop.replace(notesToStrip, '').trim();
      }
    }

    return this.compose({ top: finalTop, block: serialized, bottom });
  }
}
