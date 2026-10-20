import type { AstraRepository } from './AstraRepository';
import { MAX_ASTRA_BACKUP_CHARACTERS } from './AstraBackup';
import { validateSeasonKey, validateSeasonalArchive } from '../services/SeasonalWrappedModel';

export const ASTRA_COMMANDS = [
  'getSnapshot', 'getFullWork', 'saveWork', 'saveWorks', 'deleteWork', 'persist',
  'updateSettings', 'updateSections', 'addSection', 'removeSection', 'updateSectionWeight', 'updateSectionName',
  'addSubSection', 'removeSubSection', 'updateSubSectionWeight', 'updateSubSectionName',
  'factoryReset', 'exportJSON', 'importJSON',
  'saveSeasonalChoices',
] as const;
export type AstraCommand = typeof ASTRA_COMMANDS[number];

export async function dispatchAstraCommand(repository: AstraRepository, command: unknown, args: unknown): Promise<unknown> {
  if (typeof command !== 'string' || !ASTRA_COMMANDS.includes(command as AstraCommand) || !Array.isArray(args)
    || args.length > 3) throw new Error('Invalid Astra command');
  // The backup is already JSON. Its RPC string adds escaped quotes/backslashes;
  // bound the original file, not this second representation. Other operations
  // retain their serialized-argument limit.
  if (command !== 'importJSON' && JSON.stringify(args).length > MAX_ASTRA_BACKUP_CHARACTERS) throw new Error('Invalid Astra command');
  const id = (value: unknown) => Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= 2147483647;
  const text = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 200;
  const object = (value: unknown) => value !== null && typeof value === 'object' && !Array.isArray(value);
  switch (command as AstraCommand) {
    case 'saveSeasonalChoices':
      if (args.length !== 2) throw new Error('Invalid Seasonal Wrapped arguments');
      validateSeasonKey(args[0]);
      validateSeasonalArchive({ [args[0]]: args[1] });
      break;
    case 'getSnapshot': case 'persist': case 'factoryReset': case 'exportJSON':
      if (args.length !== 0) throw new Error('Invalid Astra arguments');
      break;
    case 'getFullWork': case 'deleteWork':
      if (args.length !== 1 || !id(args[0])) throw new Error('Invalid Astra mediaId');
      break;
    case 'saveWork':
      if (args.length !== 1 || !object(args[0]) || !id((args[0] as { mediaId?: unknown }).mediaId)) throw new Error('Invalid Astra work');
      break;
    case 'saveWorks':
      if (args.length !== 1 || !Array.isArray(args[0]) || args[0].length > 10000
        || !args[0].every(work => object(work) && id(work.mediaId))) throw new Error('Invalid Astra works');
      break;
    case 'updateSettings':
      if (args.length !== 1 || !object(args[0]) || !Object.keys(args[0]).every(key => ['enableSeriesFinale', 'finaleWeightMultiplier', 'autoSync', 'appendAstraToComment'].includes(key))) throw new Error('Invalid Astra settings');
      break;
    case 'updateSections':
      if (args.length !== 1 || !Array.isArray(args[0])) throw new Error('Invalid Astra sections');
      break;
    case 'importJSON':
      if (args.length !== 1 || typeof args[0] !== 'string' || args[0].length > MAX_ASTRA_BACKUP_CHARACTERS) throw new Error('Invalid Astra backup');
      break;
    case 'addSection': case 'removeSection':
      if (args.length !== 1 || !text(args[0])) throw new Error('Invalid Astra section');
      break;
    case 'addSubSection': case 'removeSubSection': case 'updateSectionName':
      if (args.length !== 2 || !args.every(text)) throw new Error('Invalid Astra section');
      break;
    case 'updateSectionWeight':
      if (args.length !== 2 || !text(args[0]) || typeof args[1] !== 'number' || !Number.isFinite(args[1]) || args[1] < 0) throw new Error('Invalid Astra weight');
      break;
    case 'updateSubSectionName':
      if (args.length !== 3 || !args.every(text)) throw new Error('Invalid Astra subsection');
      break;
    case 'updateSubSectionWeight':
      if (args.length !== 3 || !text(args[0]) || !text(args[1]) || typeof args[2] !== 'number' || !Number.isFinite(args[2]) || args[2] < 0) throw new Error('Invalid Astra weight');
      break;
  }
  // The allowlist and per-command validation above guard this single dynamic dispatch.
  const method = repository[command as AstraCommand] as (...values: unknown[]) => Promise<unknown>;
  return method.apply(repository, args);
}
