/** Fixed diagnostics that can cross the worker boundary without payloads or credentials. */
const FAILURE_CODES = ['CONFLICT', 'WORK_DATA', 'SETTINGS_DATA', 'QUEUE_DATA', 'STORAGE_WRITE',
  'ACCOUNT_CHANGED', 'AUTH_REQUIRED', 'DELETE_PENDING', 'INPUT', 'API_AUTH', 'API_LIMIT',
  'API_REQUEST', 'NOTES_READ', 'TRANSPORT', 'CLONE', 'TYPE_ERROR', 'UNKNOWN'] as const;
export type OperationFailureCode = typeof FAILURE_CODES[number];
const WORK_FIELDS = ['IDENTITY', 'TITLE', 'TYPE', 'STATUS', 'UPDATED_AT', 'NOTES', 'DATES', 'SEASONS',
  'SEASON_FIELDS', 'SCORES', 'SKIP', 'SEASON_NOTES', 'FINALE', 'JOURNAL', 'TAGS', 'GENRES', 'LISTS',
  'PROGRESS', 'EPISODES', 'CHAPTERS', 'DURATION', 'PRIVATE', 'HIDDEN', 'COVER', 'COUNTRY'] as const;
export type WorkValidationField = typeof WORK_FIELDS[number];
export function workValidationField(value: unknown): WorkValidationField | undefined {
  return WORK_FIELDS.includes(value as WorkValidationField) ? value as WorkValidationField : undefined;
}

export class BackgroundOperationError extends Error {
  readonly failureCode: OperationFailureCode;
  readonly validationField?: WorkValidationField;
  readonly statusCode?: number;
  constructor(message: string, code: unknown, field?: unknown, statusCode?: unknown) {
    super(message);
    this.name = 'BackgroundOperationError';
    this.failureCode = FAILURE_CODES.includes(code as OperationFailureCode) ? code as OperationFailureCode : 'UNKNOWN';
    this.validationField = workValidationField(field);
    this.statusCode = typeof statusCode === 'number' && Number.isInteger(statusCode) && statusCode >= 100 && statusCode <= 599
      ? statusCode : undefined;
  }
}

export function operationFailureCode(error: unknown): OperationFailureCode {
  if (error instanceof BackgroundOperationError) return error.failureCode;
  if (!(error instanceof Error)) return 'UNKNOWN';
  if (error.name === 'AstraConflictError') return 'CONFLICT';
  // Only our fixed messages are classified; raw messages never leave this context.
  if (/account changed/i.test(error.message)) return 'ACCOUNT_CHANGED';
  if (error.name === 'AstraWorkValidationError' || /^Invalid Astra work(?:s)?$/.test(error.message)) return 'WORK_DATA';
  if (/^Invalid Astra (?:sections|settings)$/.test(error.message)) return 'SETTINGS_DATA';
  if (/^Invalid (?:persisted sync queue; original data preserved|sync queue snapshot)$/.test(error.message)) return 'QUEUE_DATA';
  if (/^(?:Astra storage (?:journal write failed|commit pending recovery|removal pending recovery|finalization pending recovery)|Sync queue storage write failed)$/.test(error.message)) return 'STORAGE_WRITE';
  if (/^(?:Authenticated sync owner required|AniList authentication required|Astra account session unavailable)$/.test(error.message)) return 'AUTH_REQUIRED';
  if (error.message === 'Entry deletion is pending; wait before editing this entry') return 'DELETE_PENDING';
  if (/^(?:Invalid Astra date|Progress and repeat must be non-negative GraphQL integers|Astra score must be between 0 and 10|Invalid AniList media ID|Invalid sync payload|Invalid sync mutation)$/.test(error.message)) return 'INPUT';
  if (/^(?:Invalid API (?:request|operation|fragment)|Unexpected API variables|API (?:operation kind mismatch|root field not allowed|selection not allowed|selection too deep|selection expansion too large))$/.test(error.message)) return 'API_REQUEST';
  if (error.message === 'Unable to read AniList notes safely; local data was saved. Retry synchronization.') return 'NOTES_READ';
  if (error.name === 'ApiError') {
    const status = (error as Error & { statusCode?: number }).statusCode;
    return status === 401 || status === 403 ? 'API_AUTH' : status === 429 ? 'API_LIMIT' : 'API_REQUEST';
  }
  if (/^(?:Extension context invalidated\.?|Could not establish connection\. Receiving end does not exist\.|The message port closed before a response was received\.)/.test(error.message)) return 'TRANSPORT';
  if (error.name === 'DataCloneError') return 'CLONE';
  if (error instanceof TypeError) return 'TYPE_ERROR';
  return 'UNKNOWN';
}
