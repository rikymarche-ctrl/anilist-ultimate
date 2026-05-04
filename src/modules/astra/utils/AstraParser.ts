/**
 * @file AstraParser.ts
 * @description Indestructible parser for extracting structured Astra data.
 * Uses fuzzy matching and robust regex to survive browser/rendering variations.
 */
import type { AstraSection, AstraWork } from '../AstraService';

export interface ParsedAstraReport {
  overallScore?: number;
  sectionScores: Record<string, number>;
  subSectionScores: Record<string, number>;
  generalNotes?: string;
  ratingNotes?: string;
  journal: Record<number, string>;
}

export class AstraParser {
  public static parse(text: string, sections: AstraSection[]): ParsedAstraReport | null {
    if (!text || !text.includes('Astra Review')) {
      console.debug('[AstraParser] No "Astra Review" anchor found.');
      return null;
    }

    const report: ParsedAstraReport = {
      sectionScores: {},
      subSectionScores: {},
      journal: {}
    };

    // Normalize text: remove \r and split by \n
    const lines = text.replace(/\r/g, '').split('\n').map(l => l.trim());
    
    let mode: 'breakdown' | 'journal' | 'notes' | null = null;
    let currentSectionId: string | null = null;
    let generalNotesLines: string[] = [];

    // Find where the Astra block actually starts to ignore header fluff
    const startIdx = lines.findIndex(l => l.toUpperCase().includes('ASTRA REVIEW'));
    const relevantLines = lines.slice(startIdx);

    for (const line of relevantLines) {
      if (!line) continue;

      // 1. Mode/Header Detection (Flexible)
      const upperLine = line.toUpperCase();
      if (upperLine.includes('BREAKDOWN:')) { mode = 'breakdown'; continue; }
      if (upperLine.includes('JOURNAL:')) { mode = 'journal'; continue; }
      if (upperLine.includes('NOTES:')) { mode = 'notes'; continue; }
      if (upperLine.includes('OVERALL SCORE:')) {
        const match = line.match(/[\d.]+/);
        if (match) report.overallScore = parseFloat(match[0]);
        continue;
      }
      
      // Skip decorative lines
      if (line.includes('───') || line.includes('🌌')) continue;

      // 2. Data Extraction based on mode
      if (mode === 'breakdown') {
        // Match a score line: [symbol] Name: Score/10
        // We use a regex that matches any leading symbol/bullet
        const match = line.match(/^[^a-zA-Z0-9]*\s*([^:]+):\s*([\d.]+)\/10/);
        if (match) {
          const rawName = match[1].trim();
          const score = parseFloat(match[2]);
          
          if (isNaN(score)) continue;

          // Is it a sub-section? (Detected by indentation-like symbols like ├, └, or starting with spaces)
          const isSubSection = line.match(/^[ \t]*[├└|]/) || line.startsWith(' ') || line.startsWith('  ');

          if (!isSubSection) {
            // Main Section
            const section = sections.find(s => s.name.toLowerCase() === rawName.toLowerCase());
            if (section) {
              report.sectionScores[section.id] = score;
              currentSectionId = section.id;
            }
          } else if (currentSectionId) {
            // Sub-section
            const section = sections.find(s => s.id === currentSectionId);
            const sub = section?.subSections?.find(ss => ss.name.toLowerCase() === rawName.toLowerCase());
            if (sub) {
              report.subSectionScores[`${currentSectionId}_${sub.id}`] = score;
            }
          }
        }
      } 
      else if (mode === 'journal') {
        // Ep [Number]: [Text]
        const match = line.match(/Ep\s*(\d+):\s*(.*)/i);
        if (match) {
          const ep = parseInt(match[1]);
          report.journal[ep] = match[2].trim();
        }
      } 
      else if (mode === 'notes') {
        // Rating: [Text] OR just lines of text
        if (upperLine.startsWith('RATING:')) {
          report.ratingNotes = line.replace(/^Rating:\s*/i, '').trim();
        } else {
          generalNotesLines.push(line);
        }
      }
    }

    if (generalNotesLines.length > 0) {
      report.generalNotes = generalNotesLines.join('\n').trim();
    }

    // Validation
    const hasData = Object.keys(report.sectionScores).length > 0 || 
                    Object.keys(report.journal).length > 0 || 
                    !!report.overallScore;

    return hasData ? report : null;
  }

  public static merge(work: AstraWork, parsed: ParsedAstraReport): boolean {
    let changed = false;
    const season = work.seasons[work.seasons.length - 1];

    if (parsed.generalNotes && work.notes !== parsed.generalNotes) {
      work.notes = parsed.generalNotes;
      changed = true;
    }
    if (parsed.ratingNotes && season.notes !== parsed.ratingNotes) {
      season.notes = parsed.ratingNotes;
      changed = true;
    }

    // Merge scores
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

    // Merge journal
    for (const [ep, text] of Object.entries(parsed.journal)) {
      const epNum = parseInt(ep);
      if (!season.episodeNotes) season.episodeNotes = {};
      if (!season.episodeNotes[epNum] || season.episodeNotes[epNum].text !== text) {
        season.episodeNotes[epNum] = { ...season.episodeNotes[epNum], text };
        changed = true;
      }
    }

    return changed;
  }
}
