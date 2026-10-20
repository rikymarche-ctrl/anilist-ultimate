import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { build as bundleFixture } from 'esbuild';

// Dedicated anonymous Chromium profile, local synthetic DOM, real worker RPC.
// Identity is replaced before any click; no real provider or credential is accessed.
const root = process.cwd();
const build = path.join(root, 'dist');
const manifest = JSON.parse(fs.readFileSync(path.join(build, 'manifest.json'), 'utf8'));
const executable = process.env.MV3_BROWSER || path.join(root, '.cache', 'mv3-runtime', 'chrome-win64', 'chrome.exe');
const profile = path.join(root, '.cache', 'mv3-calendar-login', `profile-${randomUUID()}`);
fs.mkdirSync(profile, { recursive: true });
const extensionId = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32)
  .replace(/[0-9a-f]/g, digit => String.fromCharCode(97 + Number.parseInt(digit, 16)));
const baseline = process.argv.includes('--baseline');
const content = process.argv.includes('--content');
const success = process.argv.includes('--success');
const races = process.argv.includes('--races');
assert.ok(!races || success, 'account races use the successful synthetic provider transport');
const visual = process.argv.includes('--visual');
assert.ok(!(success && baseline), 'success mode uses current production handlers');
const comet = /comet/i.test(path.basename(executable));
// Diagnostic control: the two prompt/click methods captured before the fix.
// Apply only to this in-memory fixture bundle; production files stay unchanged.
const baselinePlugin = { name: 'calendar-login-before-fix-control', setup(bundle) {
  bundle.onLoad({ filter: /CalendarDomService\.ts$/ }, args => {
    const current = fs.readFileSync(args.path, 'utf8');
    const replacement = `  public showAuthPrompt(onLoginClick: () => void): void {
    if (!this.containerElement) return;
    this.releaseGrid(); this.promptCleanup?.(); this.promptCleanup = null;
    this.containerElement.innerHTML = \`<div class="calendar-auth-prompt"><div class="calendar-auth-prompt__content"><i class="fa fa-lock"></i><h3>Authentication Required</h3><p>Please log in to Anilist to use the calendar feature.</p><button class="calendar-auth-prompt__btn">Log In</button></div></div>\`;
    const parent = this.containerElement;
    const loginBtn = parent.querySelector<HTMLButtonElement>('.calendar-auth-prompt__btn');
    if (loginBtn) {
      const login = () => {
        if (!parent.isConnected || !parent.contains(loginBtn)) return;
        void Promise.resolve().then(onLoginClick).catch(error => log.error('[CalendarDom] Login action failed', error));
      };
      loginBtn.addEventListener('click', login);
      this.promptCleanup = () => loginBtn.removeEventListener('click', login);
    }
  }

  public getGrid`;
    assert.match(current, /  public showAuthPrompt[\s\S]*?  public getGrid/);
    return { contents: current.replace(/  public showAuthPrompt[\s\S]*?  public getGrid/, replacement), loader: 'ts' };
  });
  bundle.onLoad({ filter: /CalendarModule\.ts$/ }, args => {
    let current = fs.readFileSync(args.path, 'utf8');
    const initialAuth = /      const authenticated = this\.apiClient\.isAuthenticated\(\);[\s\S]*?      \/\/ 1\. Setup late-loading section detection/;
    assert.match(current, initialAuth);
    current = current.replace(initialAuth, `      const authenticated = this.apiClient.isAuthenticated();
      if (!authenticated) {
        log.warn('[Calendar] User not authenticated, showing prompt');
        await this.handleUnauthenticated();
        return;
      }
      try {
        const owner = await this.apiClient.getCurrentUserId();
        if (this.destroyed || generation !== this.generation) return;
        this.userId = owner;
      } catch (e) { log.error('[Calendar] Failed to get userId', e); return; }
      // 1. Setup late-loading section detection`);
    const replacement = `  private async handleUnauthenticated(): Promise<void> {
    const generation = this.generation;
    if (!this.isCurrent(generation)) return;
    const astraEnabled = this.config.isFeatureEnabled('astra');
    const calendarContainer = await this.domService.injectCalendar(() => {}, async () => {}, astraEnabled, () => this.isCurrent(generation));
    if (calendarContainer && this.isCurrent(generation)) {
      this.domService.showAuthPrompt(async () => {
        try { await this.auth.login(); window.location.reload(); }
        catch (error) { log.error('[Calendar] Login error:', error); }
      });
    }
  }

  /**
   * Opens the calendar settings panel.`;
    const method = /  private async handleUnauthenticated\(\): Promise<void> \{[\s\S]*?  \/\*\*\s+\* Opens the calendar settings panel\./;
    assert.match(current, method);
    return { contents: current.replace(method, replacement), loader: 'ts' };
  });
} };
const fixture = await bundleFixture({
  entryPoints: [path.join(root, 'src', 'test', 'calendar-login-browser-fixture.ts')],
  bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'AUCalendarLoginFixture',
  outdir: path.join(root, '.cache', 'calendar-login-fixture'), tsconfig: path.join(root, 'tsconfig.json'),
  define: { 'import.meta.env.DEV': 'false',
    'import.meta.env.VITE_ANILIST_CLIENT_ID': '"35100"' },
  plugins: baseline ? [baselinePlugin] : [],
});
const source = fixture.outputFiles.find(file => file.path.endsWith('.js')).text;
const css = fixture.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? '';
const browser = spawn(executable, ['--headless=new', '--no-first-run', '--no-default-browser-check',
  '--disable-background-networking', '--disable-component-update', '--disable-sync', '--remote-debugging-pipe',
  '--host-resolver-rules=MAP * ~NOTFOUND',
  `--user-data-dir=${profile}`, `--disable-extensions-except=${build}`, `--load-extension=${build}`, 'about:blank'],
{ windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
let sequence = 0;
let buffer = '';
let closed = false;
const pending = new Map();
const events = [];
let localDocumentsFulfilled = 0;
let externalRequestsPrevented = 0;
const workerSetups = new Map();
browser.stdio[4].on('data', data => {
  buffer += data.toString();
  let boundary;
  while ((boundary = buffer.indexOf('\0')) !== -1) {
    const packet = JSON.parse(buffer.slice(0, boundary)); buffer = buffer.slice(boundary + 1);
    if (packet.id) {
      const request = pending.get(packet.id);
      if (request) {
        clearTimeout(request.timer); pending.delete(packet.id);
        if (packet.error) request.reject(new Error(`CDP operation failed: ${request.method}`)); else request.resolve(packet.result);
      }
    } else {
      events.push(packet);
      if (packet.method === 'Fetch.requestPaused') {
        const request = packet.params;
        // This main document is generated locally; every other web request fails.
        const localDocument = request.resourceType === 'Document' && request.request.url === 'https://anilist.co/home';
        if (localDocument) localDocumentsFulfilled++;
        else externalRequestsPrevented++;
        const action = localDocument
          ? send('Fetch.fulfillRequest', { requestId: request.requestId, responseCode: 200,
            responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }],
            body: Buffer.from('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Synthetic AniList home</title></head><body><main>Local login fixture</main></body></html>').toString('base64') }, packet.sessionId)
          : send('Fetch.failRequest', { requestId: request.requestId, errorReason: 'BlockedByClient' }, packet.sessionId);
        void action.catch(() => undefined);
      }
      if (packet.method === 'Target.attachedToTarget' && packet.params.targetInfo.type === 'service_worker'
        && packet.params.targetInfo.url.startsWith(`chrome-extension://${extensionId}/`)) {
        const session = packet.params.sessionId;
        const setup = (async () => {
          await send('Runtime.enable', {}, session);
          await send('Network.enable', {}, session);
          await send('Network.setBlockedURLs', { urls: ['http://*', 'https://*'] }, session);
          if (success) {
            // cross-fetch captures native fetch while importing the worker, so
            // install this local transport before allowing its modules to run.
            await evaluate(`(() => {
              const original = globalThis.fetch;
              globalThis.__calendarLoginFetchProbe = { owner: 424242, viewerCalls: 0, scheduleCalls: 0, blockedCalls: 0,
                bearerChecks: [], restore: () => { globalThis.fetch = original; } };
              globalThis.fetch = async (input, init) => {
                const probe = globalThis.__calendarLoginFetchProbe;
                const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
                if (url.origin !== 'https://graphql.anilist.co') { probe.blockedCalls++; throw new Error('Fixture external request blocked'); }
                const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
                probe.bearerChecks.push(headers.get('Authorization') === 'Bearer calendar-login-synthetic-token');
                const body = init?.body ? JSON.parse(init.body) : input instanceof Request ? await input.clone().json() : {};
                const query = body.query;
                let data;
                if (typeof query === 'string' && /\\bViewer\\s*\\{/.test(query)) {
                  probe.viewerCalls++;
                  data = { Viewer: { id: probe.owner, name: 'Synthetic login fixture', avatar: { medium: null },
                    options: { titleLanguage: 'ROMAJI' }, mediaListOptions: { scoreFormat: 'POINT_10', rowOrder: 'updatedTime' } } };
                } else if (typeof query === 'string' && query.includes('MediaListCollection')) {
                  probe.scheduleCalls++;
                  data = { MediaListCollection: { user: { id: probe.owner }, hasNextChunk: false, lists: [{ entries: [] }] } };
                } else { probe.blockedCalls++; throw new Error('Fixture operation blocked'); }
                return new Response(JSON.stringify({ data }), { status: 200, headers: { 'Content-Type': 'application/json' } });
              };
            })()`, session);
          }
          if (packet.params.waitingForDebugger) await send('Runtime.runIfWaitingForDebugger', {}, session);
          return session;
        })();
        workerSetups.set(packet.params.targetInfo.targetId, setup);
        void setup.catch(() => undefined);
      }
    }
  }
});
function failPending(error) {
  for (const request of pending.values()) { clearTimeout(request.timer); request.reject(error); }
  pending.clear();
}
browser.once('error', () => failPending(new Error('Isolated Chromium could not launch')));
browser.once('exit', () => { closed = true; failPending(new Error('Isolated Chromium exited')); });
function send(method, params = {}, sessionId, timeoutMs = 15000) {
  if (closed) return Promise.reject(new Error('Isolated Chromium exited'));
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, timeoutMs);
    pending.set(id, { resolve, reject, timer, method });
    browser.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
  });
}
async function evaluate(expression, session, timeout = 15000) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, session, timeout);
  if (result.exceptionDetails) throw new Error('Calendar login fixture evaluation failed');
  return result.result.value;
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let session;
let workerSession;
let executionContextId;
const report = { date: new Date().toISOString(), scope: 'isolated anonymous profile with synthetic Airing DOM; actual setupDI(false), CalendarModule, DOM service, AuthService and worker; trusted Input clicks; local identity boundary; HTTP(S) blocked and browser DNS resolution disabled; no real provider, token or account access' };
report.scenario = success ? 'successful synthetic OAuth callback and local synthetic Viewer transport; no real token or account' : 'cancelled/empty local identity callback';
report.browserKind = comet ? 'Comet' : 'Chromium';
report.source = baseline ? 'in-memory pre-fix showAuthPrompt, handleUnauthenticated and initial unauthenticated early return diagnostic control; other source current' : 'current source';
report.surface = content ? 'real extension content-script isolated world on locally fulfilled https://anilist.co/home; all HTTP(S) intercepted and other requests failed' : 'extension page /home';
try {
  report.browser = (await send('Browser.getVersion')).product;
  await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true,
    filter: [{ type: 'service_worker', exclude: false }, { exclude: true }] });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  ({ sessionId: session } = await send('Target.attachToTarget', { targetId, flatten: true }));
  await send('Runtime.enable', {}, session);
  await send('Page.enable', {}, session);
  await send('Network.enable', {}, session);
  await send('Network.setBlockedURLs', { urls: ['http://*', 'https://*'] }, session);
  await send('Page.navigate', { url: `chrome-extension://${extensionId}/${manifest.action.default_popup}` }, session);
  let ready = false;
  for (let spin = 0; spin < 80 && !ready; spin++) {
    ready = await evaluate("document.readyState === 'complete' && document.getElementById('auth-status-text')?.textContent === 'Disconnected'", session);
    if (!ready) await delay(100);
  }
  assert.equal(ready, true, 'anonymous native extension shell must load');
  const worker = (await send('Target.getTargets')).targetInfos.find(target => target.type === 'service_worker'
    && target.url.startsWith(`chrome-extension://${extensionId}/`));
  assert.ok(worker && workerSetups.has(worker.targetId), 'network-guarded worker must be attached');
  workerSession = await workerSetups.get(worker.targetId);
  await evaluate(`(() => {
    const original = chrome.identity.launchWebAuthFlow;
    globalThis.__calendarLoginProbe = { calls: 0, requests: [], restore: () => { chrome.identity.launchWebAuthFlow = original; } };
    chrome.identity.launchWebAuthFlow = async options => {
      const probe = globalThis.__calendarLoginProbe; probe.calls++;
      const url = new URL(options.url);
      probe.requests.push({ interactive: options.interactive, host: url.hostname, path: url.pathname,
        responseType: url.searchParams.get('response_type'), hasState: !!url.searchParams.get('state'),
        hasRedirectOverride: url.searchParams.has('redirect_uri') });
      if (${success}) {
        // The provider uses the client's registered redirect. The fixture models
        // that registration with this extension's exact native callback URL.
        const redirect = new URL(chrome.identity.getRedirectURL());
        redirect.hash = new URLSearchParams({ access_token: 'calendar-login-synthetic-token', state: url.searchParams.get('state') }).toString();
        return redirect.href;
      }
      if (${visual}) await new Promise(resolve => setTimeout(resolve, 1100));
      return undefined;
    };
  })()`, workerSession);
  if (content) {
    // Disable automatic feature factories before the production content entry loads.
    // The fixture manually resolves its actual calendar from a separate container.
    await evaluate(`(async () => {
      const config = await chrome.runtime.sendMessage({ type: 'config:command', operation: 'get' });
      const features = Object.fromEntries(Object.keys(config.data.features).map(key => [key, false]));
      const updated = await chrome.runtime.sendMessage({ type: 'config:command', operation: 'patch', value: { features } });
      if (!updated.success) throw new Error('Synthetic content configuration failed');
    })()`, session);
    await send('Fetch.enable', { patterns: [{ urlPattern: 'http://*', requestStage: 'Request' }, { urlPattern: 'https://*', requestStage: 'Request' }] }, session);
    await send('Network.setBlockedURLs', { urls: [] }, session);
    const before = events.length;
    await send('Page.navigate', { url: 'https://anilist.co/home' }, session);
    for (let spin = 0; spin < 80 && !executionContextId; spin++) {
      const contexts = events.slice(before).filter(event => event.method === 'Runtime.executionContextCreated')
        .map(event => event.params.context);
      const world = contexts.find(context => context.origin === `chrome-extension://${extensionId}` && context.auxData?.type === 'isolated');
      executionContextId = world?.id;
      if (!executionContextId) await delay(100);
    }
    assert.ok(executionContextId, 'actual extension content-script isolated world must exist');
    // Give the disabled original entry point time to finish its independent setup.
    await delay(500);
  }
  const inFixture = async expression => {
    const result = await send('Runtime.evaluate', { expression, contextId: executionContextId, awaitPromise: true, returnByValue: true }, session, 20000);
    if (result.exceptionDetails) throw new Error('Calendar login fixture evaluation failed');
    return result.result.value;
  };
  report.initial = await inFixture(`${source}\n(async () => {
    const style = document.createElement('style'); style.textContent = ${JSON.stringify(css)}; document.head.append(style);
    return AUCalendarLoginFixture.prepareCalendarLoginBrowserFixture();
  })()`);
  assert.equal(report.initial.prompt, true);
  assert.equal(report.initial.authCalls, 0);
  const captureUI = async name => {
    const mobile = name.includes('mobile');
    const image = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, fromSurface: true,
      clip: { x: 0, y: 0, width: mobile ? 375 : 800, height: 400, scale: 1 } }, session);
    const directory = path.join(root, '.cache', 'calendar-login-ui');
    fs.mkdirSync(directory, { recursive: true });
    const file = path.join(directory, `${name}.png`);
    fs.writeFileSync(file, Buffer.from(image.data, 'base64'));
    report.screenshots ??= {};
    report.screenshots[name] = file;
  };
  if (visual) await captureUI('idle-desktop');
  const snapshot = () => inFixture('AUCalendarLoginFixture.calendarLoginSnapshot()');
  async function clickLogin() {
    const state = await snapshot(); assert.ok(state.center && state.buttonConnected && !state.buttonDisabled, 'login button must be available');
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...state.center }, session);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...state.center }, session);
    if (visual && state.completed === 0) {
      await delay(150);
      const pendingState = await snapshot();
      assert.equal(pendingState.buttonDisabled, true, 'pending login must disable duplicate activation');
      assert.match(pendingState.buttonText, /Connecting/);
      await captureUI('pending-desktop');
    }
    for (let spin = 0; spin < 50; spin++) {
      const current = await snapshot();
      if (current.completed > state.completed) { await delay(50); return snapshot(); }
      await delay(20);
    }
    return snapshot();
  }
  report.first = await clickLogin();
  if (visual) {
    assert.equal(report.first.feedbackVisible, true, 'synthetic failure must show the designed error state');
    await captureUI('error-desktop');
    await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: true }, session);
    await inFixture("document.body.style.width = '100%'; document.body.style.minHeight = '100vh'");
    await captureUI('error-mobile');
    await send('Emulation.clearDeviceMetricsOverride', {}, session);
  }
  report.providerAfterFirst = await evaluate('({ calls: __calendarLoginProbe.calls, requests: __calendarLoginProbe.requests })', workerSession);
  assert.equal(report.first.authCalls, 1, 'actual button click must invoke real AuthService.login');
  assert.equal(report.providerAfterFirst.calls, 1, 'actual foreground login RPC must reach worker identity');
  if (success) {
    assert.equal(report.first.completed, 1, 'real AuthService.login must complete successfully');
    assert.ok(report.providerAfterFirst.requests.every(request => !request.hasRedirectOverride),
      'native OAuth request must let AniList use its registered redirect');
    assert.equal(report.first.failed, 0, 'valid synthetic OAuth callback must not fail');
    assert.equal(report.first.authenticated, true);
    assert.equal(report.first.userId, 424242);
    assert.equal(report.first.publicCredentialIsNull, true, 'foreground must continue exposing no token');
    assert.equal(report.first.sessionPresent, true);
    assert.ok(report.first.authEvents > 0, 'native/public state must publish its confirmed owner');
    assert.ok(content ? report.first.runtimeAuthSignals > 0 : report.first.storageAuthSignals > 0,
      'actual native auth notifications must reach the foreground');
    for (let spin = 0; spin < 100; spin++) {
      const state = await snapshot();
      if (!state.prompt) { report.afterLogin = state; break; }
      await delay(20);
    }
    assert.equal(report.afterLogin?.prompt, false, 'confirmed login must retire the authentication prompt');
    report.fetch = await evaluate('({ viewerCalls: __calendarLoginFetchProbe.viewerCalls, scheduleCalls: __calendarLoginFetchProbe.scheduleCalls, blockedCalls: __calendarLoginFetchProbe.blockedCalls, bearerChecks: __calendarLoginFetchProbe.bearerChecks })', workerSession);
    assert.ok(report.fetch.viewerCalls > 0, 'actual AnilistClient Viewer request must use local transport');
    assert.ok(report.fetch.bearerChecks.length > 0 && report.fetch.bearerChecks.every(Boolean), 'real API transport must carry only the synthetic credential');
    assert.equal(report.fetch.blockedCalls, 0, 'success flow must not request unexpected external operations');
  } else {
    assert.equal(report.first.failed, 1, 'empty stub response must fail without signing in');
    assert.equal(report.first.prompt, true, 'cancelled login must retain prompt');
    if (!baseline) {
      assert.ok(report.first.feedback && report.first.feedbackVisible, 'failed current login must expose visible feedback');
      assert.equal(report.first.buttonDisabled, false, 'failed current login must release its button');
    }
    report.retry = await clickLogin();
    report.providerAfterRetry = await evaluate('({ calls: __calendarLoginProbe.calls, requests: __calendarLoginProbe.requests })', workerSession);
    assert.equal(report.retry.authCalls, 2, 'failed login must permit another actual button click');
    assert.equal(report.providerAfterRetry.calls, 2, 'retry must reach native worker identity again');
  }
  assert.ok((report.providerAfterRetry ?? report.providerAfterFirst).requests.every(request => request.interactive === true && request.host === 'anilist.co'
    && request.path === '/api/v2/oauth/authorize' && request.responseType === 'token' && request.hasState));
  const status = await inFixture("chrome.runtime.sendMessage({ type: 'auth:status' }).then(status => ({ authenticated: status.authenticated }))");
  const storage = await evaluate(`(async () => {
    const stored = await chrome.storage.local.get(['anilist_ultimate_auth_token', 'anilist_ultimate_user_cache', 'anilist_ultimate_auth_session']);
    return { credentialKeysPresent: !!stored.anilist_ultimate_auth_token || !!stored.anilist_ultimate_user_cache,
      syntheticCredential: stored.anilist_ultimate_auth_token === 'calendar-login-synthetic-token',
      syntheticOwner: stored.anilist_ultimate_user_cache?.userId === 424242,
      sessionPresent: typeof stored.anilist_ultimate_auth_session === 'string' && !!stored.anilist_ultimate_auth_session };
  })()`, workerSession);
  report.status = { ...status, ...storage };
  assert.equal(status.authenticated, success);
  assert.equal(storage.credentialKeysPresent, success);
  if (success) {
    assert.equal(storage.syntheticCredential, true);
    assert.equal(storage.syntheticOwner, true);
    assert.equal(storage.sessionPresent, true);
  }
  if (races) {
    const second = await send('Target.createTarget', { url: 'about:blank' });
    const attached = await send('Target.attachToTarget', { targetId: second.targetId, flatten: true });
    const otherSession = attached.sessionId;
    try {
      await send('Runtime.enable', {}, otherSession); await send('Network.enable', {}, otherSession);
      await send('Network.setBlockedURLs', { urls: ['http://*', 'https://*'] }, otherSession);
      await send('Page.navigate', { url: `chrome-extension://${extensionId}/settings.html` }, otherSession);
      const until = async (expression, target) => {
        for (let i = 0; i < 100; i++) { if (await evaluate(expression, target)) return; await delay(50); }
        throw new Error('Isolated account race timed out');
      };
      await until("!!document.querySelector('#data-recovery button')", otherSession);
      await evaluate(`(() => {
        const original = chrome.identity.launchWebAuthFlow;
        globalThis.__authRaces = { pending: [], restore: () => { chrome.identity.launchWebAuthFlow = original; } };
        chrome.identity.launchWebAuthFlow = options => new Promise(resolve => {
          __authRaces.pending.push(() => {
            const callback = new URL(chrome.identity.getRedirectURL());
            callback.hash = new URLSearchParams({ access_token: 'calendar-login-synthetic-token', state: new URL(options.url).searchParams.get('state') }).toString();
            resolve(callback.href);
          });
        });
      })()`, workerSession);
      await inFixture("(globalThis.__raceLogin = chrome.runtime.sendMessage({ type: 'auth:login' }), true)");
      await until('__authRaces.pending.length === 1', workerSession);
      const logout = await evaluate("chrome.runtime.sendMessage({ type: 'auth:logout' })", otherSession);
      assert.equal(logout.success, true);
      await evaluate('__authRaces.pending.shift()()', workerSession);
      assert.equal((await inFixture('__raceLogin')).success, false, 'late login from the first tab must not undo logout from the second');
      const anonymous = await evaluate("chrome.runtime.sendMessage({ type: 'auth:status' })", otherSession);
      assert.equal(anonymous.authenticated, false);
      report.accountRaces = ['logout from the second real tab retires a pending first-tab OAuth callback'];
      await evaluate("chrome.identity.launchWebAuthFlow = async () => { throw new Error('The user did not approve access.'); }", workerSession);
      const cancelled = await evaluate("chrome.runtime.sendMessage({ type: 'auth:login' })", otherSession);
      assert.equal(cancelled.success, false); assert.equal(cancelled.code, 'AUTH_CANCELLED');
      report.accountRaces.push('provider cancellation leaves both contexts signed out and permits retry');
      await evaluate('__authRaces.restore()', workerSession);
      const fresh = await evaluate("chrome.runtime.sendMessage({ type: 'auth:login' })", otherSession);
      assert.equal(fresh.success, true); assert.equal(fresh.userId, 424242);
      const statuses = await Promise.all([inFixture("chrome.runtime.sendMessage({ type: 'auth:status' })"),
        evaluate("chrome.runtime.sendMessage({ type: 'auth:status' })", otherSession)]);
      assert.ok(statuses.every(value => value.authenticated && value.userId === 424242));
      assert.equal(statuses[0].sessionId, statuses[1].sessionId);
      report.accountRaces.push('fresh successful login publishes the same current owner/session to both real contexts');
      await evaluate('__calendarLoginFetchProbe.owner = 434343', workerSession);
      const switched = await evaluate("chrome.runtime.sendMessage({ type: 'auth:login' })", otherSession);
      assert.equal(switched.success, true); assert.equal(switched.userId, 434343);
      const switchedStatuses = await Promise.all([inFixture("chrome.runtime.sendMessage({ type: 'auth:status' })"),
        evaluate("chrome.runtime.sendMessage({ type: 'auth:status' })", otherSession)]);
      assert.ok(switchedStatuses.every(value => value.authenticated && value.userId === 434343));
      assert.equal(switchedStatuses[0].sessionId, switchedStatuses[1].sessionId);
      assert.notEqual(switchedStatuses[0].sessionId, statuses[0].sessionId);
      report.accountRaces.push('a different synthetic owner replaces the previous session consistently across both real contexts');
      report.raceStage = 'seed recovery';
      await evaluate(`chrome.storage.local.set({ anilist_ultimate_sync_queue_v1: { schemaVersion: 2, revision: 'recovery-fixture', entries: [{ id: 'synthetic-terminal', type: 'ASTRA_SAVE', userId: 434343,
        payload: { mediaId: 7, notes: 'synthetic-private-recovery-preview' }, retries: 10 },
        { id: 'other-account-terminal', type: 'ASTRA_SAVE', userId: 424242,
        payload: { mediaId: 8, notes: 'other-account-recovery-preview' }, retries: 10 }] } })`, workerSession);
      report.raceStage = 'refresh recovery';
      await delay(100);
      await evaluate("[...document.querySelectorAll('#data-recovery button')].find(button => button.textContent === 'Refresh').click()", otherSession);
      await until("document.querySelector('#data-recovery').textContent.includes('synthetic-private-recovery-preview')", otherSession);
      assert.equal(await evaluate("document.querySelector('#data-recovery').textContent.includes('other-account-recovery-preview')", otherSession), false);
      report.raceStage = 'logout with visible recovery';
      assert.equal((await inFixture("chrome.runtime.sendMessage({ type: 'auth:logout' })")).success, true);
      await until("!document.querySelector('#data-recovery').textContent.includes('synthetic-private-recovery-preview')", otherSession);
      report.raceStage = 'read preserved queue';
      const preserved = await evaluate("chrome.storage.local.get('anilist_ultimate_sync_queue_v1').then(value => value.anilist_ultimate_sync_queue_v1.entries)", workerSession);
      assert.equal(preserved.length, 2); assert.equal(preserved[0].id, 'synthetic-terminal');
      report.accountRaces.push('native cross-tab logout removes the rendered recovery preview while preserving its durable source');
      report.raceStage = 'complete';
    } finally { await send('Target.closeTarget', { targetId: second.targetId }); }
  }
  report.runtimeExceptions = events.filter(event => event.method === 'Runtime.exceptionThrown').length;
  assert.equal(report.runtimeExceptions, 0, 'fixture must have no uncaught runtime exceptions');
  const unexpectedWebResponses = events.filter(event => event.method === 'Network.responseReceived'
    && /^https?:/.test(event.params.response.url)
    && !(content && event.params.type === 'Document' && event.params.response.url === 'https://anilist.co/home')).length;
  report.network = { localDocumentsFulfilled, externalRequestsPrevented, unexpectedWebResponses, dnsResolutionDisabled: true };
  assert.equal(unexpectedWebResponses, 0, 'no external web request may receive a network response');
  assert.equal(localDocumentsFulfilled, content ? 1 : 0, 'content main document must come only from local fulfillment');
  report.passed = true;
  console.log(success
    ? 'Calendar login native success probe passed: actual worker, Viewer, storage, native listeners and foreground login completed with synthetic data; no account or provider access.'
    : 'Calendar login native probe passed: two trusted clicks reached real worker identity stub; no account or provider access.');
} catch (error) {
  report.passed = false;
  report.error = error instanceof assert.AssertionError ? error.message : 'Isolated calendar login probe failed';
  console.error(report.error);
  process.exitCode = 1;
} finally {
  if (session && !closed) { try { await send('Runtime.evaluate', { expression: 'AUCalendarLoginFixture.cleanupCalendarLoginBrowserFixture()', contextId: executionContextId, awaitPromise: true }, session); } catch { /* Target closes below. */ } }
  if (workerSession && !closed) { try { await evaluate('__calendarLoginProbe.restore(); globalThis.__calendarLoginFetchProbe?.restore()', workerSession); } catch { /* Profile closes below. */ } }
  fs.writeFileSync(path.join(root, '.cache', `mv3-calendar-login${content ? '-content' : ''}${baseline ? '-baseline' : ''}${success ? '-success' : ''}${races ? '-races' : ''}${comet ? '-comet' : ''}.json`), JSON.stringify(report, null, 2));
  if (!closed) { try { await send('Browser.close'); } catch { /* Browser can close before replying. */ } }
  if (!closed) browser.kill();
}
