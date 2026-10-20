/** Fixed diagnostics only: never expose provider errors, callback URLs or tokens. */
const descriptions = {
  AUTH_TRANSPORT: 'The extension background service could not be reached. Reload the extension and this page.',
  AUTH_BACKGROUND: 'The extension background service could not initialize authentication.',
  AUTH_STORAGE: 'The browser could not read or save the extension session.',
  AUTH_OPEN: 'The browser could not open the AniList authentication window.',
  AUTH_PAGE_LOAD: 'The browser could not load the AniList authorization page.',
  AUTH_CANCELLED: 'The authentication window was closed or access was not approved.',
  AUTH_REDIRECT: 'AniList returned an unexpected authentication address.',
  AUTH_STATE: 'AniList did not return the expected authentication verification code.',
  AUTH_TOKEN: 'AniList did not return an access token.',
  AUTH_VIEWER: 'The AniList account could not be verified after authorization.',
  AUTH_REFRESH: 'The extension could not confirm the new session.',
  AUTH_UNKNOWN: 'Login could not be completed.',
} as const;

export type AuthFailureCode = keyof typeof descriptions;
export function parseAuthFailureCode(value: unknown): AuthFailureCode | undefined {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(descriptions, value)
    ? value as AuthFailureCode : undefined;
}
export class AuthLoginError extends Error {
  constructor(public readonly code: AuthFailureCode) { super(`Login failed [${code}]`); }
}
export function authFailureMessage(error: unknown): string | undefined {
  if (!(error instanceof AuthLoginError)) return undefined;
  const code = parseAuthFailureCode(error.code);
  return code ? `${descriptions[code]} (${code})` : undefined;
}
export function identityFailureCode(error: unknown): AuthFailureCode {
  // Exact browser constants only; arbitrary exception text remains private.
  if (error instanceof Error) {
    if (error.message === 'Authorization page could not be loaded.') return 'AUTH_PAGE_LOAD';
    if (error.message === 'The user did not approve access.') return 'AUTH_CANCELLED';
  }
  return 'AUTH_OPEN';
}
