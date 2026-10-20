/**
 * @file AstraRemoteReconcile.ts
 * @description Pure reconciliation of a local Astra work with the AniList entry it was loaded beside.
 *
 * AniList is the source of truth for notes and score. A local cache can hold
 * scores that were never pushed, so an unrated AniList entry clears them.
 * Returns a patched copy; the input work is never mutated.
 */

import { logger } from '@core/logger';
import type { AstraSection, AstraWork } from '../AstraInterfaces';
import type { IAstraParser, ParsedAstraReport } from '../interfaces/IAstraParser';
import { AstraParserService } from '../services/AstraParserService';

export interface AstraRemoteReport {
  notes: string | null | undefined;
  score: number | null | undefined;
}

export interface AstraReconcileOptions {
  sections: AstraSection[];
  appendAstraToComment: boolean;
  parser?: IAstraParser;
}

export function reconcileWithRemote(
  work: AstraWork,
  remote: AstraRemoteReport,
  options: AstraReconcileOptions
): { work: AstraWork; changed: boolean } {
  const next = structuredClone(work);
  const season = next.seasons[next.seasons.length - 1];
  if (!season) return { work, changed: false };

  const parser = options.parser ?? new AstraParserService();
  const remoteNotes = remote.notes ?? '';

  let parsed: ParsedAstraReport | null = null;
  let notesReadable = true;
  try {
    parsed = parser.parse(remoteNotes, options.sections);
  } catch (error) {
    // A malformed Astra block must not erase local data; keep the local notes as they are.
    notesReadable = false;
    logger.warn(
      '[AstraRemoteReconcile] Malformed Astra block on AniList; keeping local notes',
      error
    );
  }

  if (notesReadable) {
    if (parsed === null) {
      // Plain personal notes: AniList text replaces the local copy, including an empty one.
      next.notes = remoteNotes;
      season.notes = remoteNotes;
    } else if (options.appendAstraToComment) {
      parser.merge(next, parsed);
    }
  }

  const remoteRated = typeof remote.score === 'number' && remote.score > 0;
  if (
    !remoteRated &&
    Object.values(season.scores).some((value) => typeof value === 'number' && value > 0)
  ) {
    season.scores = {};
  }

  const changed =
    JSON.stringify(work.notes) !== JSON.stringify(next.notes) ||
    JSON.stringify(work.seasons) !== JSON.stringify(next.seasons);
  return { work: changed ? next : work, changed };
}
