import { operationFailureCode, workValidationField } from '@core/errors/OperationFailure';

export type AstraSaveStage = 'VALIDATE' | 'ACCOUNT' | 'LOCAL' | 'NOTES' | 'QUEUE' | 'DISPATCH' | 'VERIFY';

export class AstraSaveFailure extends Error {
  constructor(readonly stage: AstraSaveStage, readonly localCommitted: boolean, readonly originalError: unknown) {
    super(originalError instanceof Error ? originalError.message : 'Astra save failed');
    this.name = 'AstraSaveFailure';
  }
}

/** Keep the editable form open and report a fixed, shareable diagnostic, never raw data. */
export function astraSaveFailureMessage(error: unknown): string {
  if (error instanceof Error && error.message === 'Save operation timed out') {
    return 'Save timed out. Your edits remain open; AniList may still be processing.';
  }
  const stage = error instanceof AstraSaveFailure ? error.stage : 'FORM';
  const code = operationFailureCode(error instanceof AstraSaveFailure ? error.originalError : error);
  const source = error instanceof AstraSaveFailure ? error.originalError : error;
  const field = code === 'WORK_DATA' && source instanceof Error
    ? workValidationField((source as Error & { validationField?: unknown }).validationField) : undefined;
  let reason = '';
  if (code === 'CONFLICT') reason = ' This entry changed in another operation.';
  if (code === 'ACCOUNT_CHANGED' || code === 'AUTH_REQUIRED') reason = ' Check your AniList connection.';
  if (code === 'WORK_DATA') reason = ' The entry could not be validated.';
  if (code === 'STORAGE_WRITE') reason = ' The extension could not write to storage.';
  const result = error instanceof AstraSaveFailure && error.localCommitted
    ? 'Saved to Astra; AniList synchronization could not be confirmed.' : 'Save failed.';
  return `${result}${reason} Your edits remain open. [AS-${stage}-${code}${field ? `:${field}` : ''}]`;
}
