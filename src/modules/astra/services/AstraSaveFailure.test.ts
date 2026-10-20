import { describe, expect, it } from 'vitest';
import { BackgroundOperationError, operationFailureCode } from '@core/errors/OperationFailure';
import { AstraSaveFailure, astraSaveFailureMessage } from './AstraSaveFailure';
import { AstraConflictError } from '../store/AstraRepository';

describe('shareable Astra save diagnostics', () => {
  it.each([
    [new AstraConflictError(), 'CONFLICT'],
    [new Error('Invalid Astra work'), 'WORK_DATA'],
    [new Error('Invalid persisted sync queue; original data preserved'), 'QUEUE_DATA'],
    [new Error('Astra storage journal write failed'), 'STORAGE_WRITE'],
    [new Error('Sync account changed'), 'ACCOUNT_CHANGED'],
    [new TypeError('Private payload contents'), 'TYPE_ERROR'],
    [new Error('Secret text or credential'), 'UNKNOWN'],
  ])('classifies only fixed details for %s', (error, expected) => {
    expect(operationFailureCode(error)).toBe(expected);
    const message = astraSaveFailureMessage(new AstraSaveFailure('LOCAL', false, error));
    expect(message).toContain(`AS-LOCAL-${expected}`);
    expect(message).not.toContain(error.message);
  });
  it('rejects arbitrary worker diagnostic strings and retains allowed codes across JSON', () => {
    expect(operationFailureCode(new BackgroundOperationError('Background failure', 'private payload'))).toBe('UNKNOWN');
    const response = JSON.parse(JSON.stringify({ failureCode: 'WORK_DATA' }));
    expect(astraSaveFailureMessage(new AstraSaveFailure('LOCAL', false,
      new BackgroundOperationError('Background failure', response.failureCode)))).toContain('AS-LOCAL-WORK_DATA');
    expect(astraSaveFailureMessage(new AstraSaveFailure('LOCAL', false,
      new BackgroundOperationError('Background failure', 'WORK_DATA', 'Sensitive data')))).not.toContain('Sensitive data');
    expect(astraSaveFailureMessage(new AstraSaveFailure('LOCAL', false,
      new BackgroundOperationError('Background failure', 'WORK_DATA', 'SCORES')))).toContain('AS-LOCAL-WORK_DATA:SCORES]');
  });
  it('distinguishes rejected local persistence from unconfirmed synchronization after a commit', () => {
    const failure = new Error('Private note');
    expect(astraSaveFailureMessage(new AstraSaveFailure('LOCAL', false, failure))).toContain('Save failed.');
    const message = astraSaveFailureMessage(new AstraSaveFailure('QUEUE', true, failure));
    expect(message).toContain('Saved to Astra'); expect(message).toContain('AS-QUEUE-UNKNOWN');
    expect(message).not.toContain('Private note'); expect(message).toContain('Your edits remain open');
  });
});
