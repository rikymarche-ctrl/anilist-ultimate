import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthService } from './AuthService';
import type { AuthTokenService } from './AuthTokenService';
import type { ILogger } from '@core/interfaces/ILogger';
import type { IEventBus } from '@core/interfaces/IEventBus';
import type { IApiClient } from '@core/interfaces/IApiClient';

function statusFixture(state: { token: unknown; user: unknown; session: unknown }) {
  // Unknown simulates a corrupted persistence provider at the service boundary.
  const token = { ensureInitialized: async () => {}, getToken: () => state.token,
    getUserCache: () => state.user, getSessionId: () => state.session };
  return new AuthService({} as ILogger, {} as IEventBus, {} as IApiClient, token as unknown as AuthTokenService);
}

const redirect = 'https://extension-test.chromiumapp.org/';
function fixture(response: 'valid' | 'state' | 'origin' = 'valid', viewerError = false) {
  let currentToken: string | null = 'old-token';
  let user: { userId: number; userName: string } | null = { userId: 1, userName: 'Previous' };
  const token = { ensureInitialized: vi.fn(async () => {}), getToken: () => currentToken, getUserCache: () => user,
    setToken: vi.fn(async (value: string, owner?: typeof user) => { currentToken = value; user = owner ?? null; }),
    clearToken: vi.fn(async () => { currentToken = null; user = null; }) };
  const identity = { getRedirectURL: () => redirect, launchWebAuthFlow: vi.fn(async ({ url }: { url: string }) => {
    const state = new URL(url).searchParams.get('state');
    return `${response === 'origin' ? 'https://attacker.test/' : redirect}#access_token=new-token&state=${response === 'state' ? 'incorrect' : state}`;
  }) };
  chrome.identity = identity as never;
  const api = { getCurrentUser: vi.fn(async () => {
    if (viewerError) throw new Error('Viewer failed');
    expect(token.getUserCache()).toBeNull(); // cannot sync the previous owner under a new credential
    return { id: 2, name: 'New' };
  }) };
  const logger = { info: vi.fn(), success: vi.fn(), error: vi.fn() };
  const auth = new AuthService(logger as never, {} as never, api as never, token as never);
  return { auth, token, identity, api, logger };
}
describe('OAuth callback boundaries', () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  it.each(['state', 'origin'] as const)('rejects an invalid callback %s before persisting any credential', async response => {
    const { auth, token, api } = fixture(response);
    expect(await auth.performOAuthLogin()).toEqual({ success: false, error: 'OAuth login failed', code: response === 'state' ? 'AUTH_STATE' : 'AUTH_REDIRECT' });
    expect(token.setToken).not.toHaveBeenCalled();
    expect(api.getCurrentUser).not.toHaveBeenCalled();
    expect(token.getToken()).toBe('old-token');
  });
  it('binds redirect/state, finalizes owner metadata and keeps the token out of the response', async () => {
    const { auth, identity, token } = fixture();
    expect(await auth.performOAuthLogin()).toEqual({ success: true, userId: 2, userName: 'New' });
    const request = new URL(identity.launchWebAuthFlow.mock.calls[0][0].url);
    // AniList's implicit grant uses the URI registered for this client. Passing
    // the normalized Chrome URL can differ from that exact stored string.
    expect(request.searchParams.has('redirect_uri')).toBe(false);
    expect(request.searchParams.get('state')?.length).toBeGreaterThan(20);
    expect(token.getUserCache()?.userId).toBe(2);
  });
  it('restores the previous credential and owner if viewer lookup fails', async () => {
    const { auth, token } = fixture('valid', true);
    expect((await auth.performOAuthLogin()).success).toBe(false);
    expect(token.getToken()).toBe('old-token');
    expect(token.getUserCache()?.userId).toBe(1);
  });
  it('coalesces concurrent login requests into one flow', async () => {
    const { auth, identity } = fixture();
    await Promise.all([auth.performOAuthLogin(), auth.performOAuthLogin()]);
    expect(identity.launchWebAuthFlow).toHaveBeenCalledTimes(1);
  });
  it.each(['identity', 'viewer'] as const)('contains private %s failures at the OAuth diagnostic boundary', async stage => {
    const f = fixture();
    const sensitive = new Error('private provider text opaque-secret');
    if (stage === 'identity') f.identity.launchWebAuthFlow.mockRejectedValueOnce(sensitive);
    else f.api.getCurrentUser.mockRejectedValueOnce(sensitive);
    expect(await f.auth.performOAuthLogin()).toEqual({ success: false, error: 'OAuth login failed', code: stage === 'identity' ? 'AUTH_OPEN' : 'AUTH_VIEWER' });
    expect(f.logger.error).toHaveBeenLastCalledWith('[AuthService] OAuth flow failed');
    expect(f.logger.error.mock.calls.flat()).not.toContain(sensitive);
    expect(f.token.getToken()).toBe('old-token');
    expect(f.token.getUserCache()?.userId).toBe(1);
  });
  it('contains storage failures at the background logout diagnostic boundary', async () => {
    const f = fixture();
    f.token.clearToken.mockRejectedValueOnce(new Error('private storage detail opaque-secret'));
    expect(await f.auth.performLogout()).toEqual({ success: false });
    expect(f.logger.error).toHaveBeenCalledExactlyOnceWith('[AuthService] Logout execution failed');
    expect(f.token.getUserCache()?.userId).toBe(1);
  });
  it('logs OAuth success without the provider username', async () => {
    const f = fixture();
    await f.auth.performOAuthLogin();
    expect(f.logger.success).toHaveBeenCalledExactlyOnceWith('[AuthService] OAuth successful');
  });
  it.each([
    ['Authorization page could not be loaded.', 'AUTH_PAGE_LOAD'],
    ['The user did not approve access.', 'AUTH_CANCELLED'],
    ['private provider text opaque-secret', 'AUTH_OPEN'],
  ])('identifies the browser failure without disclosing raw error text: %s', async (message, code) => {
    const f = fixture(); f.identity.launchWebAuthFlow.mockRejectedValueOnce(new Error(message));
    expect(await f.auth.performOAuthLogin()).toEqual({ success: false, error: 'OAuth login failed', code });
    expect(JSON.stringify(f.logger.error.mock.calls)).not.toContain(message);
  });
  it('contains auth initialization failures inside the coded login result', async () => {
    const f = fixture(); f.token.ensureInitialized.mockRejectedValueOnce(new Error('private storage detail'));
    expect(await f.auth.performOAuthLogin()).toEqual({ success: false, error: 'OAuth login failed', code: 'AUTH_STORAGE' });
    expect(f.identity.launchWebAuthFlow).not.toHaveBeenCalled();
  });
  it('does not restore/reopen authentication after logout during the provider flow', async () => {
    const { auth, identity, token } = fixture();
    let finish!: () => void;
    identity.launchWebAuthFlow.mockImplementationOnce(async ({ url }) => {
      await new Promise<void>(resolve => { finish = resolve; });
      return `${redirect}#access_token=new-token&state=${new URL(url).searchParams.get('state')}`;
    });
    const login = auth.performOAuthLogin();
    await Promise.resolve(); await Promise.resolve();
    expect(await auth.performLogout()).toEqual({ success: true });
    finish();
    expect((await login).success).toBe(false);
    expect(token.getToken()).toBeNull();
    expect(token.setToken).not.toHaveBeenCalled();
  });
  it('does not roll back to the previous account after logout during Viewer lookup', async () => {
    const { auth, api, token } = fixture();
    let finish!: (value: { id: number; name: string }) => void;
    api.getCurrentUser.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const login = auth.performOAuthLogin();
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(token.getToken()).toBe('new-token');
    await auth.performLogout();
    finish({ id: 2, name: 'New' });
    expect((await login).success).toBe(false);
    expect(token.getToken()).toBeNull();
    expect(token.setToken).toHaveBeenCalledTimes(1);
  });
  it('does not open an authorization window after logout while initialization was pending', async () => {
    const f = fixture(); const waiting = deferred<void>();
    f.token.ensureInitialized.mockImplementationOnce(() => waiting.promise);
    const login = f.auth.performOAuthLogin(); await f.auth.performLogout(); waiting.resolve();
    expect((await login).success).toBe(false); expect(f.identity.launchWebAuthFlow).not.toHaveBeenCalled();
  });
  it('does not replace another account that became active while the provider window was open', async () => {
    const f = fixture(); const callback = deferred<string>(); f.identity.launchWebAuthFlow.mockImplementationOnce(() => callback.promise);
    const login = f.auth.performOAuthLogin(); await Promise.resolve(); await Promise.resolve();
    const request = f.identity.launchWebAuthFlow.mock.calls[0][0];
    await f.token.setToken('other-token', { userId: 3, userName: 'Other' });
    callback.resolve(`${redirect}#access_token=new-token&state=${new URL(request.url).searchParams.get('state')}`);
    expect((await login).success).toBe(false); expect(f.token.getToken()).toBe('other-token');
  });
  it('allows a fresh login after logout and an older completion cannot detach the new flow', async () => {
    const f = fixture(); const first = deferred<string>(); const second = deferred<string>();
    f.identity.launchWebAuthFlow.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    const old = f.auth.performOAuthLogin(); for (let i = 0; i < 4; i++) await Promise.resolve();
    await f.auth.performLogout(); const fresh = f.auth.performOAuthLogin();
    for (let i = 0; i < 4; i++) await Promise.resolve(); expect(f.identity.launchWebAuthFlow).toHaveBeenCalledTimes(2);
    const response = (index: number) => `${redirect}#access_token=new-token&state=${new URL(f.identity.launchWebAuthFlow.mock.calls[index][0].url).searchParams.get('state')}`;
    first.resolve(response(0)); expect((await old).success).toBe(false);
    expect(f.auth.performOAuthLogin()).toBe(fresh); second.resolve(response(1));
    expect((await fresh).success).toBe(true); expect(f.token.getUserCache()?.userId).toBe(2);
  });
  it('preserves a newer account when the old provisional Viewer lookup fails', async () => {
    const f = fixture(); const lookup = deferred<{ id: number; name: string }>();
    f.api.getCurrentUser.mockImplementationOnce(() => lookup.promise);
    const old = f.auth.performOAuthLogin(); for (let i = 0; i < 10; i++) await Promise.resolve();
    await f.token.setToken('other-token', { userId: 3, userName: 'Other' });
    lookup.resolve({ id: 2, name: 'Old' }); expect((await old).success).toBe(false);
    expect(f.token.getToken()).toBe('other-token'); expect(f.token.getUserCache()?.userId).toBe(3);
  });
});

describe('public authentication status boundaries', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(chrome.runtime.sendMessage).mockReset(); });
  it.each([
    { authenticated: 'true', userId: 1, sessionId: 'one' },
    { authenticated: true, userId: '1', sessionId: 'one' },
    { authenticated: true, userId: 1, sessionId: 17 },
    { authenticated: true, userId: 1, sessionId: 'one', userName: {} },
    { authenticated: false, sessionId: '' },
    { authenticated: false, sessionId: 17 },
  ])('refuses malformed RPC metadata rather than reporting authentication: %j', async response => {
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce(response);
    const auth = statusFixture({ token: null, user: null, session: 'one' });
    await expect(auth.isAuthenticated()).rejects.toThrow('authentication');
  });
  it('accepts validated authenticated and anonymous RPC statuses', async () => {
    const auth = statusFixture({ token: null, user: null, session: 'one' });
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce({ authenticated: true, userId: 1, sessionId: 'one' })
      .mockResolvedValueOnce({ authenticated: false, userId: 'ignored', sessionId: 'anon' });
    expect(await auth.isAuthenticated()).toBe(true); expect(await auth.isAuthenticated()).toBe(false);
  });
  it.each([
    { token: 'private', user: { userId: '1', userName: 'Bad' }, session: 'one' },
    { token: 'private', user: { userId: 1, userName: {} }, session: 'one' },
    { token: 'private', user: { userId: 1, userName: 'One' }, session: 17 },
    { token: 'private', user: { userId: 1, userName: 'One' }, session: undefined },
  ])('does not publish malformed persisted owner or session metadata: %j', async state => {
    await expect(statusFixture(state).getStatus()).rejects.toThrow('authentication');
  });
  it('projects validated writer status without credentials or provider extras', async () => {
    const auth = statusFixture({ token: 'private', user: { userId: 1, userName: '', token: 'private', extra: true }, session: ' opaque ' });
    expect(await auth.getStatus()).toEqual({ authenticated: true, userId: 1, userName: '', sessionId: ' opaque ' });
    expect(await statusFixture({ token: null, user: { userId: 1, userName: 'Old' }, session: 'anon' }).getStatus())
      .toEqual({ authenticated: false, sessionId: 'anon' });
  });
  it.each([null, { userId: 1, userName: 'Earlier' }, { userId: 'corrupt', userName: {} }])(
    'publishes anonymous fallback without an operational session or cached owner: %j', async user => {
      expect(await statusFixture({ token: null, user, session: '' }).getStatus()).toEqual({ authenticated: false });
    });
  it('does not normalize a numeric anonymous session into an absent session', async () => {
    await expect(statusFixture({ token: null, user: null, session: 0 }).getStatus()).rejects.toThrow('authentication');
  });

});

function commandFixture() {
  const state: { authenticated: unknown; user: unknown; session: unknown } = {
    authenticated: true, user: { userId: 2, userName: 'Current' }, session: 'current-session',
  };
  const token = { refresh: vi.fn(async () => {}), hasToken: () => state.authenticated,
    getUserCache: () => state.user, getSessionId: () => state.session };
  const logger = { info: vi.fn(), success: vi.fn(), error: vi.fn() };
  const eventBus = { emit: vi.fn() };
  const auth = new AuthService(logger as unknown as ILogger, eventBus as unknown as IEventBus,
    {} as IApiClient, token as unknown as AuthTokenService);
  return { auth, token, state, logger, eventBus };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe('client authentication command boundaries', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(chrome.runtime.sendMessage).mockReset(); });
  it.each(['AUTH_OPEN', 'AUTH_STATE', 'AUTH_BACKGROUND', 'unknown-secret', 'constructor', '__proto__'])('only forwards recognized diagnostic codes: %s', async code => {
    const { auth } = commandFixture();
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce({ success: false, code, error: 'private error detail' });
    await expect(auth.login()).rejects.toThrow(`Login failed [${['AUTH_OPEN', 'AUTH_STATE', 'AUTH_BACKGROUND'].includes(code) ? code : 'AUTH_UNKNOWN'}]`);
  });
  it.each([
    null, [], { success: 'true', userId: 2 }, { success: 1, userId: 2 },
    { success: false, error: 'secret-provider-error' }, { success: true },
    { success: true, userId: '2' }, { success: true, userId: 0 },
    { success: true, userId: 2147483648 }, { success: true, userId: 2, userName: {} },
    { success: true, userId: 2, userName: null },
  ])('rejects an invalid login command before refreshing or publishing: %j', async response => {
    const { auth, token, eventBus, logger } = commandFixture();
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce(response);
    await expect(auth.login()).rejects.toThrow('Login failed');
    expect(token.refresh).not.toHaveBeenCalled(); expect(eventBus.emit).not.toHaveBeenCalled();
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('secret-provider-error');
  });
  it.each([null, [], {}, { success: 'true' }, { success: 1 }, { success: false }])(
    'rejects an invalid logout command before refreshing or publishing: %j', async response => {
      const { auth, token, eventBus } = commandFixture();
      vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce(response);
      await expect(auth.logout()).rejects.toThrow('Logout failed');
      expect(token.refresh).not.toHaveBeenCalled(); expect(eventBus.emit).not.toHaveBeenCalled();
    });
  it('publishes only the refreshed login owner and excludes reply extras from logs/events', async () => {
    const { auth, token, eventBus, logger } = commandFixture();
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce({ success: true, userId: 2,
      userName: 'secret-reply-name', token: 'secret-token' });
    await auth.login();
    expect(token.refresh).toHaveBeenCalledOnce();
    expect(eventBus.emit).toHaveBeenCalledWith('auth:state-changed', {
      isAuthenticated: true, userId: 2, timestamp: expect.any(Date),
    });
    expect(JSON.stringify(logger.success.mock.calls)).not.toContain('secret');
  });
  it.each([
    { authenticated: true, user: { userId: 3, userName: 'Newer' }, session: 'new' },
    { authenticated: false, user: null, session: 'anonymous' },
    { authenticated: 'true', user: { userId: 2, userName: 'Bad' }, session: 'current' },
    { authenticated: true, user: { userId: '2', userName: 'Bad' }, session: 'current' },
    { authenticated: true, user: { userId: 2, userName: {} }, session: 'current' },
    { authenticated: true, user: null, session: 'current' },
    { authenticated: true, user: { userId: 2, userName: 'Current' }, session: 17 },
    { authenticated: true, user: { userId: 2, userName: 'Current' }, session: undefined },
  ])('does not announce login from a mismatched or invalid refreshed snapshot: %j', async snapshot => {
    const { auth, state, eventBus, token } = commandFixture();
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce({ success: true, userId: 2 });
    token.refresh.mockImplementationOnce(async () => { Object.assign(state, snapshot); });
    await expect(auth.login()).rejects.toThrow('Login failed');
    expect(eventBus.emit).not.toHaveBeenCalled();
  });
  it.each([
    { authenticated: true, user: { userId: 3, userName: 'Newer' }, session: 'new' },
    { authenticated: false, user: { userId: 2, userName: 'Stale' }, session: 'anonymous' },
    { authenticated: false, user: null, session: 17 },
    { authenticated: false, user: null, session: '' },
  ])('does not announce logout while the refreshed snapshot is incoherent: %j', async snapshot => {
    const { auth, state, eventBus, token } = commandFixture();
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce({ success: true });
    token.refresh.mockImplementationOnce(async () => { Object.assign(state, snapshot); });
    await expect(auth.logout()).rejects.toThrow('Logout failed'); expect(eventBus.emit).not.toHaveBeenCalled();
  });
  it('accepts a refreshed anonymous snapshot without requiring an operational session', async () => {
    const { auth, state, eventBus, token } = commandFixture();
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce({ success: true });
    token.refresh.mockImplementationOnce(async () => { Object.assign(state, { authenticated: false, user: null, session: undefined }); });
    await auth.logout();
    expect(eventBus.emit).toHaveBeenCalledWith('auth:state-changed', { isAuthenticated: false, timestamp: expect.any(Date) });
  });
  it.each(['login', 'logout'] as const)('redacts transport and refresh errors for %s', async operation => {
    for (const boundary of ['transport', 'refresh'] as const) {
      const { auth, token, logger, eventBus } = commandFixture();
      const secret = new Error('secret-token-provider-user');
      if (boundary === 'transport') vi.mocked(chrome.runtime.sendMessage).mockRejectedValueOnce(secret);
      else {
        vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce({ success: true, userId: 2 });
        token.refresh.mockRejectedValueOnce(secret);
      }
      await expect(auth[operation]()).rejects.toThrow(operation === 'login' ? 'Login failed' : 'Logout failed');
      expect(JSON.stringify(logger.error.mock.calls)).not.toContain('secret'); expect(eventBus.emit).not.toHaveBeenCalled();
    }
  });
  it.each(['login', 'logout'] as const)('ignores an older %s reply after a newer opposite operation', async first => {
    const { auth, state, eventBus, token } = commandFixture();
    const held = deferred<unknown>();
    vi.mocked(chrome.runtime.sendMessage).mockReturnValueOnce(held.promise);
    const older = auth[first]();
    const rejectedOlder = expect(older).rejects.toThrow(first === 'login' ? 'Login failed' : 'Logout failed');
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce({ success: true, userId: 2 });
    token.refresh.mockImplementationOnce(async () => {
      if (first === 'login') Object.assign(state, { authenticated: false, user: null, session: 'anonymous' });
    });
    await auth[first === 'login' ? 'logout' : 'login']();
    held.resolve({ success: true, userId: 2 }); await rejectedOlder;
    expect(token.refresh).toHaveBeenCalledTimes(1); expect(eventBus.emit).toHaveBeenCalledTimes(1);
  });
  it.each(['login', 'logout'] as const)('ignores an older %s refresh completion even if its snapshot appears valid', async first => {
    const { auth, state, eventBus, token } = commandFixture();
    const held = deferred<void>();
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce({ success: true, userId: 2 });
    token.refresh.mockImplementationOnce(() => held.promise);
    const older = auth[first]();
    const rejectedOlder = expect(older).rejects.toThrow(first === 'login' ? 'Login failed' : 'Logout failed');
    await Promise.resolve(); await Promise.resolve();
    expect(token.refresh).toHaveBeenCalledOnce();
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce({ success: true, userId: 2 });
    token.refresh.mockImplementationOnce(async () => {
      if (first === 'login') Object.assign(state, { authenticated: false, user: null, session: 'anonymous' });
    });
    await auth[first === 'login' ? 'logout' : 'login']();
    if (first === 'login') Object.assign(state, { authenticated: true, user: { userId: 2, userName: 'Old' }, session: 'old' });
    else Object.assign(state, { authenticated: false, user: null, session: 'anonymous' });
    held.resolve(); await rejectedOlder; expect(eventBus.emit).toHaveBeenCalledTimes(1);
  });
});
