import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { getLocation, Kind, parse } from 'graphql';

// Runs the compiled extension in a fresh, signed-out browser profile. This
// exercises MV3 startup, extension pages and messaging, not provider login or
// the real AniList DOM. No personal browser profile is opened or changed.
const root = process.cwd();
const build = path.join(root, 'dist');
const manifest = JSON.parse(fs.readFileSync(path.join(build, 'manifest.json'), 'utf8'));
const executable = process.env.MV3_BROWSER || path.join(root, '.cache', 'mv3-runtime', 'chrome-win64', 'chrome.exe');
if (!fs.existsSync(executable)) throw new Error('Set MV3_BROWSER to Chrome for Testing (or another Chromium runtime supporting unpacked extensions)');
const profile = path.join(root, '.cache', 'mv3-smoke', `profile-${randomUUID()}`);
fs.mkdirSync(profile, { recursive: true });
const extensionId = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32)
  .replace(/[0-9a-f]/g, digit => String.fromCharCode(97 + Number.parseInt(digit, 16)));
const browser = spawn(executable, [
  '--headless=new', '--no-first-run', '--no-default-browser-check',
  '--disable-background-networking', '--disable-component-update', '--disable-sync',
  '--remote-debugging-pipe', `--user-data-dir=${profile}`,
  `--disable-extensions-except=${build}`, `--load-extension=${build}`, 'about:blank',
], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
let sequence = 0;
let buffer = '';
let stderr = '';
let closed = false;
let notificationInterceptionSession;
let notificationPageSession;
let notificationPageHTML = '';
let notificationResponseGate;
let notificationRecoveryGate;
const notificationTransport = [];
const pending = new Map();
const events = [];
const workerSetups = new Map();
browser.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-4000); });
browser.stdio[4].on('data', data => {
  buffer += data.toString();
  let boundary;
  while ((boundary = buffer.indexOf('\0')) !== -1) {
    const packet = JSON.parse(buffer.slice(0, boundary)); buffer = buffer.slice(boundary + 1);
    if (packet.id) {
      const request = pending.get(packet.id);
      if (request) {
        clearTimeout(request.timer); pending.delete(packet.id);
        if (packet.error) request.reject(new Error(`${request.method}: ${packet.error.message}`)); else request.resolve(packet.result);
      }
    } else {
      events.push(packet);
      if (packet.method === 'Fetch.requestPaused' && packet.sessionId === notificationPageSession) {
        const { requestId, request } = packet.params;
        void (request.url === 'https://anilist.co/notifications' && request.method === 'GET'
          ? send('Fetch.fulfillRequest', { requestId, responseCode: 200,
            responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }],
            body: Buffer.from(notificationPageHTML).toString('base64') }, packet.sessionId)
          : send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }, packet.sessionId))
          .catch(error => events.push({ method: 'Smoke.notificationTransportError', message: error.message }));
      }
      if (packet.method === 'Fetch.requestPaused' && packet.sessionId === notificationInterceptionSession) {
        void (async () => {
          const { requestId, request } = packet.params;
          if (request.url !== 'https://graphql.anilist.co/' || request.method !== 'POST') {
            await send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }, packet.sessionId); return;
          }
          const body = JSON.parse(request.postData);
          const activity = id => id === 63 ? null : id >= 61 && id <= 64
            ? { __typename: 'MessageActivity', id, type: 'MESSAGE', isPrivate: id === 61 || id === 64, message: '' }
            : { __typename: 'ListActivity', id, type: 'ANIME_LIST', status: 'watched episode', progress: id === 11 ? '1 - 2' : String(id),
              media: { id: id + 100, type: 'ANIME', title: { english: id === 11 ? 'Re:ZERO - Starting Life in Another World- Season 4' : 'Work ' + id, romaji: null } } };
          const variables = Object.entries(body.variables);
          const operation = parse(body.query).definitions.find(node => node.kind === Kind.OPERATION_DEFINITION);
          const missingField = operation?.selectionSet.selections.find(field => field.kind === Kind.FIELD
            && field.arguments?.some(argument => argument.name.value === 'id' && argument.value.kind === Kind.VARIABLE
              && Number(body.variables[argument.value.name.value]) === 63));
          const missingLocation = missingField?.loc ? getLocation(missingField.loc.source, missingField.loc.start) : undefined;
          let response; let responseCode = 200;
          if (variables.length === 1 && variables[0][0] === 'id') {
            response = { data: { Activity: activity(Number(variables[0][1])) } };
            if (Number(variables[0][1]) === 63) {
              responseCode = 404;
              assert.ok(missingLocation, 'missing resource must have a root field location');
              response.errors = [{ message: 'Not Found.', status: 404, locations: [missingLocation] }];
            }
          } else {
            if (variables.some(([key]) => !/^a\d+_id$/.test(key))) throw new Error('Unexpected notification fixture variable');
            if (variables.some(([, value]) => Number(value) === 63)) {
              // Verified against the public AniList endpoint: one missing
              // Activity returns HTTP 404 and nulls every alias, with locations
              // but no error path. Preserve the actual transport status too.
              responseCode = 404;
              assert.ok(missingLocation, 'missing resource must have a root field location');
              response = { data: Object.fromEntries(variables.map(([key]) => [key.slice(0, -3), null])),
                errors: [{ message: 'Not Found.', status: 404, locations: [missingLocation] }] };
            } else {
              const data = {};
              for (const [key, value] of variables) data[key.slice(0, -3)] = activity(Number(value));
              response = { data };
            }
          }
          notificationTransport.push({ http: responseCode, variables: body.variables });
          await notificationResponseGate;
          if (responseCode === 200 && variables.some(([, value]) => Number(value) === 61)) await notificationRecoveryGate;
          await send('Fetch.fulfillRequest', { requestId, responseCode,
            responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
            body: Buffer.from(JSON.stringify(response)).toString('base64') }, packet.sessionId);
        })().catch(error => events.push({ method: 'Smoke.notificationTransportError', message: error.message }));
      }
      if (packet.method === 'Target.attachedToTarget' && packet.params.targetInfo.url.startsWith(`chrome-extension://${extensionId}/`)) {
        const setup = (async () => {
          const workerSession = packet.params.sessionId;
          await send('Runtime.enable', {}, workerSession);
          await send('Log.enable', {}, workerSession);
          await send('Network.enable', {}, workerSession);
          await send('Network.setBlockedURLs', { urls: ['http://*', 'https://*'] }, workerSession);
          if (packet.params.waitingForDebugger) await send('Runtime.runIfWaitingForDebugger', {}, workerSession);
        })();
        workerSetups.set(packet.params.targetInfo.targetId, setup);
        void setup.catch(error => events.push({ method: 'Smoke.workerAttachError', message: error.message }));
      }
    }
  }
});
function failPending(error) {
  for (const request of pending.values()) { clearTimeout(request.timer); request.reject(error); }
  pending.clear();
}
browser.once('error', failPending);
browser.once('exit', () => { closed = true; failPending(new Error('Isolated browser exited')); });
function send(method, params = {}, sessionId, timeoutMs = 15000) {
  if (closed) return Promise.reject(new Error('Isolated browser exited'));
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, timeoutMs);
    pending.set(id, { resolve, reject, timer, method });
    browser.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
  });
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const checks = [];
let version;
const started = Date.now();
try {
  version = await send('Browser.getVersion');
  await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true,
    filter: [{ type: 'service_worker', exclude: false }, { exclude: true }] });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Runtime.enable', {}, sessionId);
  await send('Log.enable', {}, sessionId);
  await send('Page.enable', {}, sessionId);
  await send('ServiceWorker.enable', {}, sessionId);
  await send('Network.enable', {}, sessionId);
  // Extension resources remain local; external fonts/images/API cannot load.
  await send('Network.setBlockedURLs', { urls: ['http://*', 'https://*'] }, sessionId);
  async function evaluate(expression, timeoutMs = 5000) {
    const guarded = `Promise.race([Promise.resolve().then(() => (${expression})), new Promise((_, reject) => setTimeout(() => reject(new Error('Smoke operation timeout')), ${timeoutMs}))])`;
    const result = await send('Runtime.evaluate', { expression: guarded, awaitPromise: true, returnByValue: true }, sessionId, timeoutMs + 5000);
    if (result.exceptionDetails) throw new Error(`Exception while exercising isolated extension page: ${result.exceptionDetails.exception?.description || result.exceptionDetails.text}`);
    return result.result.value;
  }
  for (const page of [manifest.action.default_popup, manifest.options_page]) {
    await send('Page.navigate', { url: `chrome-extension://${extensionId}/${page}` }, sessionId);
    let ready = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      const mounted = page === manifest.action.default_popup
        ? "!!document.querySelector('#login-container:not(.hidden) #login-btn') && !!document.querySelector('#user-info.hidden')"
        : "document.querySelectorAll('#settings-app .module-card input[data-module]').length > 0 && !!document.getElementById('data-recovery')";
      ready = await evaluate(`document.readyState === 'complete' && typeof chrome.runtime.sendMessage === 'function' && (${mounted})`);
      if (ready) break;
      await delay(100);
    }
    assert.equal(ready, true, `${page} must finish loading`);
    const result = await evaluate(`(async () => {
      const status = await chrome.runtime.sendMessage({ type: 'auth:status' });
      const config = await chrome.runtime.sendMessage({ type: 'config:command', operation: 'get' });
      return { status, config, title: document.title, contentLength: document.body.textContent.trim().length };
    })()`);
    assert.equal(result.status.authenticated, false, 'test profile must have no login');
    assert.equal(result.config.success, true, 'background config must respond after cold start');
    assert.ok(result.contentLength > 0, 'page must have content');
    checks.push(`${page}: DOM, unauthenticated metadata and background RPC`);
    const { targetInfos } = await send('Target.getTargets');
    assert.ok(targetInfos.some(target => target.type === 'service_worker' && target.url.startsWith(`chrome-extension://${extensionId}/`)), 'worker must be visible after RPC');
  }
  const persistence = await evaluate(`(async () => {
    await chrome.storage.local.set({ mv3_smoke_fixture: { value: 7 } });
    const stored = await chrome.storage.local.get('mv3_smoke_fixture');
    const invalid = await chrome.runtime.sendMessage({ type: 'config:command', operation: 'patch', value: { features: { unknownFeature: true } } });
    return { stored, invalid };
  })()`);
  assert.equal(persistence.stored.mv3_smoke_fixture.value, 7);
  assert.equal(persistence.invalid.success, false);
  checks.push('real Chrome storage and rejected invalid config payload');
  const repository = await evaluate(`(async () => {
    const status = await chrome.runtime.sendMessage({ type: 'auth:status' });
    const send = (command, args = [], sessionId = status.sessionId) => chrome.runtime.sendMessage({ type: 'astra:command', command, args, sessionId });
    const saved = await send('saveWork', [{ mediaId: 42, notes: 'MV3 synthetic fixture' }]);
    const read = await send('getFullWork', [42]);
    const stale = await send('deleteWork', [42], 'stale-test-session');
    const key = 'anilist_ultimate_astra_account_local_au_astra_work_42';
    const fixture = (await chrome.storage.local.get(key))[key];
    Object.assign(fixture.seasons[0], { scores: { story: 8, finale: 9 }, isSeriesFinale: true,
      notes: 'Keep season notes', episodeNotes: { 1: { text: 'Keep journal', score: 7, timestamp: 123 } },
      legacyScore: 6, manualOverride: false, label: 'Removed', unknownField: true });
    await chrome.storage.local.set({ [key]: fixture });
    return { saved: saved.success, read, stale };
  })()`);
  assert.equal(repository.saved, true);
  assert.equal(repository.read.success, true);
  assert.equal(repository.read.data.notes, 'MV3 synthetic fixture');
  assert.equal(repository.read.data.ownerId, null);
  assert.equal(repository.stale.success, false);
  checks.push('workspace repository persists synthetic work and rejects obsolete session');
  async function stopOwnWorker() {
    await send('ServiceWorker.enable', {}, sessionId);
    const workerBeforeStop = (await send('Target.getTargets')).targetInfos.find(target => target.type === 'service_worker' && target.url.startsWith(`chrome-extension://${extensionId}/`));
    assert.ok(workerBeforeStop, 'worker must be running before stop');
    assert.ok(workerSetups.has(workerBeforeStop.targetId), 'cold worker diagnostics and network guard must be attached');
    await workerSetups.get(workerBeforeStop.targetId);
    await send('Target.setAutoAttach', { autoAttach: false, waitForDebuggerOnStart: false, flatten: true });
    const ownVersions = events.filter(event => event.method === 'ServiceWorker.workerVersionUpdated')
      .flatMap(event => event.params.versions).filter(worker => worker.scriptURL.startsWith(`chrome-extension://${extensionId}/`));
    const ownVersion = ownVersions.at(-1);
    assert.ok(ownVersion, 'Chrome must report the extension worker version');
    await send('ServiceWorker.stopWorker', { versionId: ownVersion.versionId }, sessionId);
    let stopped = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      const targets = await send('Target.getTargets');
      stopped = !targets.targetInfos.some(target => target.targetId === workerBeforeStop.targetId);
      if (stopped) break;
      await delay(100);
    }
    assert.equal(stopped, true, 'worker must actually stop before testing restart');
    await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true,
      filter: [{ type: 'service_worker', exclude: false }, { exclude: true }] });
    return workerBeforeStop;
  }
  async function verifyNewWorker(previous) {
    const current = (await send('Target.getTargets')).targetInfos.find(target => target.type === 'service_worker' && target.url.startsWith(`chrome-extension://${extensionId}/`));
    assert.ok(current && current.targetId !== previous.targetId, 'RPC must wake a new worker instance');
    assert.ok(workerSetups.has(current.targetId), 'restarted worker diagnostics and network guard must be attached');
    await workerSetups.get(current.targetId);
  }
  const workerBeforeStop = await stopOwnWorker();
  const restarted = await evaluate(`(async () => {
    const status = await chrome.runtime.sendMessage({ type: 'auth:status' });
    const read = await chrome.runtime.sendMessage({ type: 'astra:command', command: 'getFullWork', args: [42], sessionId: status.sessionId });
    const saved = await chrome.runtime.sendMessage({ type: 'astra:command', command: 'saveWork', args: [{ ...read.data, status: 'PLANNING' }], sessionId: status.sessionId });
    const key = 'anilist_ultimate_astra_account_local_au_astra_work_42';
    const persisted = (await chrome.storage.local.get(key))[key];
    const stored = await chrome.storage.local.get('mv3_smoke_fixture');
    return { read, saved, persisted, stored };
  })()`);
  assert.equal(restarted.read.success, true);
  assert.equal(restarted.read.data.notes, 'MV3 synthetic fixture');
  assert.equal(restarted.stored.mv3_smoke_fixture.value, 7);
  assert.equal(restarted.saved.success, true, 'stored extra season fields must not block a current save');
  assert.equal(restarted.persisted.status, 'PLANNING');
  assert.deepEqual(restarted.persisted.seasons, restarted.read.data.seasons);
  assert.deepEqual(restarted.persisted.seasons[0].scores, { story: 8, finale: 9 });
  assert.equal(restarted.persisted.seasons[0].isSeriesFinale, true);
  assert.equal(restarted.persisted.seasons[0].notes, 'Keep season notes');
  assert.deepEqual(restarted.persisted.seasons[0].episodeNotes, { 1: { text: 'Keep journal', score: 7, timestamp: 123 } });
  for (const removed of ['legacyScore', 'manualOverride', 'label', 'unknownField']) assert.equal(removed in restarted.persisted.seasons[0], false);
  await verifyNewWorker(workerBeforeStop);
  checks.push('worker stop/restart preserves repository and real storage');
  checks.push('worker reads and saves only current season fields, preserving scores/finale/notes/journal after restart');
  if (process.argv.includes('--archives')) {
    const results = [];
    for (const size of [1000, 5000, 10000]) {
      const measured = await evaluate(`(async () => {
        const status = await chrome.runtime.sendMessage({ type: 'auth:status' });
        const invoke = (command, args = []) => chrome.runtime.sendMessage({ type: 'astra:command', command, args, sessionId: status.sessionId });
        const requireSuccess = (response, operation) => {
          if (!response?.success) throw new Error(operation + ' failed');
          return response.data;
        };
        requireSuccess(await invoke('factoryReset'), 'reset');
        const works = Array.from({ length: ${size} }, (_, index) => ({ mediaId: index + 1,
          title: 'Fixture ' + String(index).padStart(5, '0'), notes: 'Fixture notes', progress: index % 13 }));
        const started = performance.now();
        requireSuccess(await invoke('saveWorks', [works]), 'bulk save');
        const saved = performance.now();
        const snapshot = requireSuccess(await invoke('getSnapshot'), 'snapshot');
        const listed = performance.now();
        const backup = requireSuccess(await invoke('exportJSON'), 'export');
        const exported = performance.now();
        const source = JSON.parse(backup);
        const serializedArgumentCharacters = JSON.stringify([backup]).length;
        requireSuccess(await invoke('factoryReset'), 'reset before import');
        const importStarted = performance.now();
        const restored = await invoke('importJSON', [backup]);
        const imported = performance.now();
        const result = { size: ${size}, saveMs: saved - started, snapshotMs: listed - saved,
          exportMs: exported - listed, importMs: imported - importStarted,
          backupCharacters: backup.length, serializedArgumentCharacters,
          sourceCount: source.manifest.length, snapshotCount: snapshot.summaries.length,
          restored: restored.success === true && restored.data === true, error: restored.error };
        if (result.restored) {
          const read = requireSuccess(await invoke('getFullWork', [${size}]), 'restored work');
          const final = requireSuccess(await invoke('getSnapshot'), 'restored snapshot');
          result.finalCount = final.summaries.length;
          result.notesPreserved = read.notes === 'Fixture notes';
          result.progressPreserved = read.progress === (${size} - 1) % 13;
          result.storageBytesInUse = await chrome.storage.local.getBytesInUse();
        }
        return result;
      })()`, 40000);
      results.push(measured);
      fs.writeFileSync(path.join(root, '.cache', 'mv3-archives.json'), JSON.stringify({
        date: new Date().toISOString(), browser: version.product, profile, results,
        scope: 'synthetic local archives, actual background RPC and Chrome storage; no rendering or AniList mutation',
      }, null, 2));
      assert.equal(measured.sourceCount, size);
      assert.equal(measured.snapshotCount, size);
      assert.equal(measured.restored, true, `valid ${size}-work backup must be importable through the real RPC`);
      assert.equal(measured.finalCount, size);
      assert.equal(measured.notesPreserved, true);
      assert.equal(measured.progressPreserved, true);
      checks.push(`${size}-work archive: real bulk save, snapshot, export/reset/import and data integrity`);
    }
    const previous = await stopOwnWorker();
    const coldRead = await evaluate(`(async () => {
      const started = performance.now();
      const status = await chrome.runtime.sendMessage({ type: 'auth:status' });
      const invoke = (command, args = []) => chrome.runtime.sendMessage({ type: 'astra:command', command, args, sessionId: status.sessionId });
      const snapshot = await invoke('getSnapshot');
      const work = await invoke('getFullWork', [10000]);
      return { durationMs: performance.now() - started, snapshotSuccess: snapshot.success,
        count: snapshot.data?.summaries?.length, workSuccess: work.success,
        notes: work.data?.notes, progress: work.data?.progress, ownerId: work.data?.ownerId };
    })()`, 40000);
    assert.equal(coldRead.snapshotSuccess, true);
    assert.equal(coldRead.workSuccess, true);
    assert.equal(coldRead.count, 10000);
    assert.equal(coldRead.notes, 'Fixture notes');
    assert.equal(coldRead.progress, 9999 % 13);
    assert.equal(coldRead.ownerId, null);
    await verifyNewWorker(previous);
    fs.writeFileSync(path.join(root, '.cache', 'mv3-archives.json'), JSON.stringify({
      date: new Date().toISOString(), browser: version.product, profile, results, coldRead,
      scope: 'synthetic local archives, actual background RPC and Chrome storage; no rendering or AniList mutation',
    }, null, 2));
    checks.push('10,000-work imported archive readable after actual worker stop/restart');
  }
  if (process.argv.includes('--templates')) {
    const { build: bundleFixture } = await import('esbuild');
    const fixture = await bundleFixture({
      entryPoints: [path.join(root, 'src', 'test', 'template-browser-fixture.ts')],
      bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'AUTemplateFixture',
      define: { 'import.meta.env.DEV': 'false' }, tsconfig: path.join(root, 'tsconfig.json'),
    });
    // CDP evaluates the local synthetic fixture; no fixture or debug export is added to dist.
    const result = await send('Runtime.evaluate', {
      expression: `${fixture.outputFiles[0].text}\nAUTemplateFixture.runTemplateBrowserFixture()`, returnByValue: true,
    }, sessionId);
    assert.equal(result.exceptionDetails, undefined, 'native Chromium template/parser fixture must pass');
    const templateChecks = result.result.value;
    assert.equal(templateChecks.length, 8);
    fs.writeFileSync(path.join(root, '.cache', 'mv3-templates.json'), JSON.stringify({
      date: new Date().toISOString(), browser: version.product, checks: templateChecks,
      scope: 'current source bundled as local synthetic fixture via CDP in isolated extension page; no production fixture exports, AniList Vue or account access',
    }, null, 2));
    checks.push('eight native Chromium DOM/template interpolation and CSS/URL checks');
  }
  for (const wrapped of [
    { flag: '--wrapped', file: 'astra-wrapped-browser-fixture.ts', name: 'AUWrappedFixture', folder: 'astra-wrapped', mount: 'mountWrapped', verify: 'verifyWrapped', artwork: 'wrappedArtwork', dispose: 'disposeWrapped' },
    { flag: '--seasonal', file: 'seasonal-wrapped-browser-fixture.ts', name: 'AUSeasonalFixture', folder: 'seasonal-wrapped', mount: 'mountSeasonal', verify: 'verifySeasonal', artwork: 'seasonalArtwork', dispose: 'disposeSeasonal' },
  ].filter(item => process.argv.includes(item.flag))) {
    if (wrapped.flag === '--seasonal') {
      const saved = await evaluate(`(async () => {
        const status = await chrome.runtime.sendMessage({ type: 'auth:status' });
        const send = (command, args = []) => chrome.runtime.sendMessage({ type: 'astra:command', command, args, sessionId: status.sessionId });
        const saved = await send('saveSeasonalChoices', ['2026-SPRING', { updatedAt: 0, awards: { favorite: 42 }, confirmedMediaIds: [42] }]);
        const stale = await send('saveSeasonalChoices', ['2026-SPRING', { updatedAt: 0, awards: {}, confirmedMediaIds: [] }]);
        return { saved, stale };
      })()`);
      assert.equal(saved.saved.success, true, 'compiled worker must accept valid seasonal choices');
      assert.equal(saved.stale.success, false, 'compiled worker must reject stale seasonal choices');
      await stopOwnWorker();
      const restored = await evaluate(`(async () => {
        const status = await chrome.runtime.sendMessage({ type: 'auth:status' });
        const response = await chrome.runtime.sendMessage({ type: 'astra:command', command: 'exportJSON', args: [], sessionId: status.sessionId });
        if (!response.success) throw new Error('Compiled seasonal archive export failed');
        return JSON.parse(response.data).seasonalWrapped['2026-SPRING'];
      })()`);
      assert.deepEqual(restored, saved.saved.data, 'compiled worker must restore seasonal choices after a real stop/restart');
      checks.push('compiled seasonal RPC, optimistic conflict and real worker stop/restart preserve award and participation');
    }
    const { build: bundleFixture } = await import('esbuild');
    const fixture = await bundleFixture({ entryPoints: [path.join(root, 'src', 'test', wrapped.file)],
      bundle: true, write: false, platform: 'browser', format: 'iife', globalName: wrapped.name,
      outdir: path.join(root, '.cache', 'wrapped-fixture'), define: { 'import.meta.env.DEV': 'false' }, tsconfig: path.join(root, 'tsconfig.json') });
    const target = await send('Target.createTarget', { url: 'about:blank' });
    const directory = path.join(root, '.cache', wrapped.folder); fs.mkdirSync(directory, { recursive: true });
    try {
      const attached = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true }); const wrappedSession = attached.sessionId;
      await send('Page.enable', {}, wrappedSession); await send('Runtime.enable', {}, wrappedSession);
      await send('Network.enable', {}, wrappedSession); await send('Network.setBlockedURLs', { urls: ['http://*', 'https://*'] }, wrappedSession);
      const run = async expression => {
        const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, wrappedSession);
        assert.equal(result.exceptionDetails, undefined, `Wrapped browser fixture must pass: ${JSON.stringify(result.exceptionDetails)}`);
        return result.result.value;
      };
      await send('Page.navigate', { url: `chrome-extension://${extensionId}/manifest.json` }, wrappedSession);
      for (let attempt = 0; attempt < 30; attempt++) {
        if (await run("document.readyState === 'complete' && !!document.body")) break;
        await delay(100);
      }
      await run(`(() => { document.body.style.margin = '0'; document.body.style.fontFamily = 'Arial, sans-serif';
        ${fixture.outputFiles.find(file => file.path.endsWith('.js')).text}
        window.${wrapped.name} = ${wrapped.name};
        const style = document.createElement('style'); style.textContent = ${JSON.stringify(fixture.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? '')}; document.head.append(style);
      })()`);
      const reports = [];
      for (const width of [1440, 800, 480]) {
        await send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false }, wrappedSession);
        await run(`${wrapped.name}.${wrapped.mount}()`); await delay(400);
        const screenshot = await send('Page.captureScreenshot', { format: 'png' }, wrappedSession);
        fs.writeFileSync(path.join(directory, `preview-${width}.png`), Buffer.from(screenshot.data, 'base64'));
        // One preview per story slide, after its entrance animation and palette transition.
        const slideCount = await run("document.querySelectorAll('.aw-shell .aw-slide').length");
        for (let slide = 0; slide < slideCount; slide++) {
          await run(`document.querySelector('.aw-shell [data-goto="${slide}"]').click()`); await delay(1800);
          const detail = await send('Page.captureScreenshot', { format: 'png' }, wrappedSession);
          fs.writeFileSync(path.join(directory, `slide-${String(slide + 1).padStart(2, '0')}-${width}.png`), Buffer.from(detail.data, 'base64'));
        }
        const liveBackdrop = await run("!document.querySelector('.aw-shell').classList.contains('aw-liquid-fallback')");
        await run(`document.querySelector('.aw-shell [data-goto="0"]').click()`);
        const artwork = await run(`${wrapped.name}.${wrapped.artwork}()`); fs.writeFileSync(path.join(directory, 'wrapped.png'), Buffer.from(artwork, 'base64'));
        reports.push({ width, slides: slideCount, liveBackdrop, checks: await run(`${wrapped.name}.${wrapped.verify}()`) });
        await run(`${wrapped.name}.${wrapped.dispose}()`);
      }
      fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify({ browser: version.product, reports,
        scope: 'real dashboard, Wrapped UI, calculation, canvas/PNG and CSS; synthetic provider data in fresh isolated Chromium; seasonal choices use real repository/native Chrome storage; no personal account or provider access' }, null, 2));
      checks.push(`${wrapped.folder} dashboard, periods, actual PNG download and account cleanup at three widths`);
    } finally { await send('Target.closeTarget', { targetId: target.targetId }); }
  }
  if (process.argv.includes('--toolbar')) {
    const { build: bundleFixture } = await import('esbuild');
    const fixture = await bundleFixture({
      entryPoints: [path.join(root, 'src', 'test', 'astra-toolbar-browser-fixture.ts')],
      bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'AUToolbarFixture',
      outdir: path.join(root, '.cache', 'toolbar-fixture'),
      define: { 'import.meta.env.DEV': 'false' }, tsconfig: path.join(root, 'tsconfig.json'),
    });
    const toolbarTarget = await send('Target.createTarget', { url: 'about:blank' });
    try {
      const attached = await send('Target.attachToTarget', { targetId: toolbarTarget.targetId, flatten: true });
      const toolbarSession = attached.sessionId;
      await send('Runtime.enable', {}, toolbarSession);
      await send('Log.enable', {}, toolbarSession);
      await send('Page.enable', {}, toolbarSession);
      await send('Network.enable', {}, toolbarSession);
      await send('Network.setBlockedURLs', { urls: ['http://*', 'https://*'] }, toolbarSession);
      // A passive extension document supplies a secure origin without app styles or scripts.
      await send('Page.navigate', { url: `chrome-extension://${extensionId}/manifest.json` }, toolbarSession);
      const toolbarEvaluate = async expression => {
        const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, toolbarSession);
        assert.equal(result.exceptionDetails, undefined, 'isolated dashboard toolbar fixture must pass');
        return result.result.value;
      };
      for (let attempt = 0; attempt < 30; attempt++) {
        if (await toolbarEvaluate("document.readyState === 'complete' && !!document.body")) break;
        await delay(100);
      }
      await toolbarEvaluate(`(() => {
        document.body.style.fontFamily = 'Arial, sans-serif';
        ${fixture.outputFiles.find(file => file.path.endsWith('.js')).text}
        window.AUToolbarFixture = AUToolbarFixture;
        const style = document.createElement('style'); style.textContent = ${JSON.stringify(fixture.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? '')}; document.head.append(style);
      })()`);
      const reports = [];
      const directory = path.join(root, '.cache', 'astra-toolbar'); fs.mkdirSync(directory, { recursive: true });
      for (const width of [1700, 1609, 1501, 1440, 1100, 800]) {
        await send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false }, toolbarSession);
        await toolbarEvaluate('AUToolbarFixture.mountAstraToolbar()');
        const report = await toolbarEvaluate('AUToolbarFixture.measureAstraToolbar()');
        const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: report.clip }, toolbarSession);
        fs.writeFileSync(path.join(directory, `after-${width}.png`), Buffer.from(screenshot.data, 'base64'));
        report.checks = await toolbarEvaluate('AUToolbarFixture.verifyAstraToolbar()');
        reports.push({ viewport: width, ...report });
        await toolbarEvaluate('AUToolbarFixture.disposeAstraToolbar()');
      }
      fs.writeFileSync(path.join(directory, 'after.json'), JSON.stringify(reports, null, 2));
      checks.push('production dashboard toolbar geometry, single desktop row, search, sorting and filters at six widths');
    } finally { await send('Target.closeTarget', { targetId: toolbarTarget.targetId }); }
  }
  if (process.argv.includes('--notifications')) {
    const worker = (await send('Target.getTargets')).targetInfos.find(target => target.type === 'service_worker' && target.url.startsWith(`chrome-extension://${extensionId}/`));
    assert.ok(worker, 'notification fixture requires the compiled worker');
    await workerSetups.get(worker.targetId);
    const workerSession = events.findLast(event => event.method === 'Target.attachedToTarget' && event.params.targetInfo.targetId === worker.targetId).params.sessionId;
    // Intercept only HTTP in our own fresh test profile. All message validation,
    // scheduling, batching and parsing remain real; no provider request leaves.
    notificationInterceptionSession = workerSession;
    await send('Fetch.enable', { patterns: [{ urlPattern: 'https://*' }, { urlPattern: 'http://*' }] }, workerSession);
    await send('Network.setBlockedURLs', { urls: [] }, workerSession);
    const { build: bundleFixture } = await import('esbuild');
    const fixture = await bundleFixture({ entryPoints: [path.join(root, 'src', 'test', 'notifications-browser-fixture.ts')],
      bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'AUNotificationsFixture',
      outdir: path.join(root, '.cache', 'notifications-fixture'),
      define: { 'import.meta.env.DEV': 'false' }, tsconfig: path.join(root, 'tsconfig.json') });
    const source = fixture.outputFiles.find(file => file.path.endsWith('.js')).text;
    const css = fixture.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? '';
    const result = await send('Runtime.evaluate', { expression: `${source}\n(async () => {
      const style = document.createElement('style'); style.textContent = ${JSON.stringify(css)}; document.head.append(style);
      return AUNotificationsFixture.runNotificationsBrowserFixture();
    })()`, awaitPromise: true, returnByValue: true }, sessionId);
    if (result.exceptionDetails) console.log('Notification transport:', events.filter(event => event.method === 'Fetch.requestPaused').map(event => ({ url: event.params.request.url, method: event.params.request.method })), events.filter(event => event.method === 'Smoke.notificationTransportError'));
    assert.equal(result.exceptionDetails, undefined, 'native notifications grouping, context and original handlers must pass');
    checks.push(...result.result.value);
    for (const width of [1100, 390]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
      await evaluate('AUNotificationsFixture.verifyNotificationGeometry()');
      await evaluate('AUNotificationsFixture.verifyActivityContextWrapping()');
    }
    await send('Emulation.clearDeviceMetricsOverride', {}, sessionId);
    checks.push('notification summary and expanded activity geometry remains readable at desktop and phone widths');
    const metrics = await send('Page.getLayoutMetrics', {}, sessionId);
    const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: metrics.cssContentSize.width, height: metrics.cssContentSize.height, scale: 1 } }, sessionId);
    fs.writeFileSync(path.join(root, '.cache', 'notifications-after.png'), Buffer.from(screenshot.data, 'base64'));
    await evaluate('AUNotificationsFixture.disposeNotificationsBrowserFixture()');

    // Exercise the manifest loader, compiled content entry, actual DI/module
    // registry, proxy, and compiled worker together on an intercepted AniList
    // URL. No production service is imported/injected by this fixture.
    await evaluate("chrome.storage.sync.set({ anilist_ultimate_clutterfree_group_likes: true })");
    notificationPageHTML = await evaluate('AUNotificationsFixture.productionNotificationDocument()');
    const productionTarget = await send('Target.createTarget', { url: 'about:blank' });
    let releaseResponses; let releaseRecovery;
    try {
      const attached = await send('Target.attachToTarget', { targetId: productionTarget.targetId, flatten: true });
      const productionSession = attached.sessionId;
      notificationPageSession = productionSession;
      for (const domain of ['Runtime', 'Log', 'Page', 'Network']) await send(`${domain}.enable`, {}, productionSession);
      await send('Fetch.enable', { patterns: [{ urlPattern: 'https://*' }, { urlPattern: 'http://*' }] }, productionSession);
      const productionEvaluate = async expression => {
        const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, productionSession);
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
        return result.result.value;
      };
      const untilProduction = async (expression, label, timeout = 15000) => {
        const deadline = Date.now() + timeout;
        while (!await productionEvaluate(expression)) {
          if (Date.now() >= deadline) {
            const state = await productionEvaluate("({ contexts: document.querySelectorAll('.au-activity-context').length, summary: document.querySelector('.au-virtual-notification')?.textContent, html: document.querySelector('.notifications')?.innerHTML })");
            fs.writeFileSync(path.join(root, '.cache', 'notifications-progress-failure.json'), JSON.stringify({ label, state, transport: notificationTransport }, null, 2));
            throw new Error(`Production notifications timeout: ${label}; contexts=${state.contexts}; transport=${JSON.stringify(notificationTransport)}`);
          }
          await delay(50);
        }
      };
      notificationResponseGate = new Promise(resolve => { releaseResponses = resolve; });
      notificationRecoveryGate = new Promise(resolve => { releaseRecovery = resolve; });
      const productionTransportStart = notificationTransport.length;
      await send('Page.navigate', { url: 'https://anilist.co/notifications' }, productionSession);
      await untilProduction("document.querySelector('.au-activity-count')?.textContent === '5'", 'compiled content-script bootstrap');
      const productionActivityRequests = () => notificationTransport.slice(productionTransportStart).filter(item => Object.keys(item.variables).length > 0);
      for (let attempt = 0; attempt < 500 && !productionActivityRequests().some(item => Object.values(item.variables).includes(63)); attempt++) await delay(10);
      assert.equal(productionActivityRequests().length, 1, 'initial activity batch must be pending before appending another page');
      assert.equal(Object.keys(productionActivityRequests()[0].variables).length, 5, 'initial activities must be dispatched before Load More');
      const appendStarted = Date.now();
      await productionEvaluate("document.querySelector('#load-more-fixture').click()");
      await untilProduction("document.querySelector('.au-activity-count')?.textContent === '7'", 'pagination while API is unresolved', 1500);
      const paginationLatencyMs = Date.now() - appendStarted;
      assert.equal(await productionEvaluate("document.querySelectorAll('.au-activity-context').length"), 0,
        'pagination must group before any API response is released');
      await productionEvaluate("(() => { const summary = document.querySelector('.au-virtual-notification'); summary.dataset.fixtureStable = 'true'; summary.click(); })()");
      const detailStarted = Date.now();
      releaseResponses(); notificationResponseGate = undefined;
      await untilProduction("document.querySelectorAll('.au-activity-context').length === 2", 'independent page details while 404 recovery is held');
      const firstDetailsLatencyMs = Date.now() - detailStarted;
      assert.equal(await productionEvaluate("document.querySelector('.au-virtual-notification')?.dataset.fixtureStable === 'true' && document.querySelector('.au-virtual-notification')?.getAttribute('aria-expanded') === 'true'"), true,
        'progressive details must preserve the same expanded group');
      releaseRecovery(); notificationRecoveryGate = undefined;
      await untilProduction("document.querySelectorAll('.au-activity-context').length === 6 && document.querySelector('.au-activity-count')?.textContent === '7'",
        'HTTP 404 isolation and grouped missing row');
      const detailLatencyMs = Date.now() - detailStarted;
      const productionTransport = productionActivityRequests();
      assert.equal(productionTransport.length, 3, 'initial page, appended page and one scoped recovery must use three HTTP requests');
      assert.equal(productionTransport.filter(item => item.http === 404).length, 1, 'the deleted activity must not be requested again');
      const state = await productionEvaluate(`(() => {
        const deleted = document.querySelector('.au-sub-notification a.link[href="/activity/63"]');
        deleted?.click();
        return { summary: document.querySelector('.au-virtual-notification')?.textContent,
          deletedIsGrouped: !!deleted && !!deleted.closest('.au-sub-notification') && !deleted.closest('.notification')?.querySelector('.au-activity-context'),
          sameExpandedGroup: document.querySelector('.au-virtual-notification')?.dataset.fixtureStable === 'true'
            && document.querySelector('.au-virtual-notification')?.getAttribute('aria-expanded') === 'true',
          wording: deleted?.querySelector('.context')?.textContent, nativeClicks: deleted?.dataset.nativeClicks,
          private: document.querySelector('[data-activity-id="61"]')?.dataset.messagePrivate,
          likes: document.querySelectorAll('.au-title').length };
      })()`);
      assert.ok(state.summary.includes('7 notifications: 2 messages (1 private), 5 activity likes'));
      assert.equal(state.deletedIsGrouped, true); assert.equal(state.sameExpandedGroup, true); assert.equal(state.wording, 'sent you a message.');
      assert.equal(state.nativeClicks, '1'); assert.equal(state.private, 'true'); assert.equal(state.likes, 5);
      await productionEvaluate("document.querySelector('.au-compress-button').click()");
      await untilProduction("document.querySelectorAll('.au-virtual-notification').length === 0", 'compiled unmerge');
      assert.equal(await productionEvaluate("document.querySelectorAll('.notifications > .notification').length"), 7);
      await productionEvaluate("document.querySelector('.au-compress-button').click()");
      await untilProduction("document.querySelector('.au-activity-count')?.textContent === '7'", 'compiled remerge');
      await productionEvaluate("(() => { const summary = document.querySelector('.au-virtual-notification'); if (summary.getAttribute('aria-expanded') !== 'true') summary.click(); })()");
      await untilProduction("Number(getComputedStyle(document.querySelector('.au-virtual-notification')).opacity) > 0.99 && document.querySelector('.au-notification-dropdown').getBoundingClientRect().height > 300",
        'summary and expanded rows finish their entrance animations');
      const layout = await productionEvaluate(`Array.from(document.querySelectorAll('.au-activity-context')).map(context => {
        const box = context.getBoundingClientRect(); const card = context.closest('.notification').getBoundingClientRect();
        return { visible: box.width > 20 && box.height > 0, inside: box.left >= card.left && box.right <= card.right + 1 };
      })`);
      assert.ok(layout.every(item => item.visible && item.inside), 'compiled CSS must show every enriched row inside its native card');
      assert.equal(productionActivityRequests().length, 3, 'unmerge and remerge must reuse cached details without requesting the deleted activity');
      assert.ok(notificationTransport.some(item => item.http === 404), 'real graphql-request must receive HTTP 404');
      assert.ok(events.some(event => event.sessionId === productionSession && event.method === 'Network.requestWillBeSent'
        && event.params.request.url.startsWith(`chrome-extension://${extensionId}/assets/main.ts-`)), 'the manifest must load the compiled main entry');
      const artifactNames = ['manifest.json', ...fs.readdirSync(path.join(build, 'assets'))
        .filter(name => name.endsWith('.js')).map(name => 'assets/' + name)];
      const artifactHashes = Object.fromEntries(artifactNames.map(name => [name, createHash('sha256').update(fs.readFileSync(path.join(build, name))).digest('hex')]));
      fs.writeFileSync(path.join(root, '.cache', 'notifications-production.json'), JSON.stringify({
        date: new Date().toISOString(), browser: version.product, paginationLatencyMs, firstDetailsLatencyMs, detailLatencyMs,
        state, layout, artifactHashes, sourceFixtureRequests: productionTransportStart, productionTransport,
        scope: 'manifest-injected production content script on intercepted https://anilist.co/notifications, full foreground DI and real compiled worker; synthetic HTML and HTTP 404/200 only; anonymous fresh profile, no external provider traffic',
      }, null, 2));
      const image = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, productionSession);
      fs.writeFileSync(path.join(root, '.cache', 'notifications-production-after.png'), Buffer.from(image.data, 'base64'));
      checks.push('compiled manifest content-script bootstrap and full foreground/worker notification path');
      checks.push('compiled pagination groups immediately with API responses held, before enrichment');
      checks.push('compiled rows receive independent details before delayed 404 recovery completes, without changing the expanded group');
      checks.push('real HTTP 404 keeps the deleted row grouped without details, preserving the expanded summary and valid private/like details through unmerge/remerge');
    } finally {
      releaseResponses?.(); releaseRecovery?.(); notificationResponseGate = undefined; notificationRecoveryGate = undefined; notificationPageSession = undefined;
      await send('Target.closeTarget', { targetId: productionTarget.targetId });
    }
    await send('Network.setBlockedURLs', { urls: ['http://*', 'https://*'] }, workerSession);
    await send('Fetch.disable', {}, workerSession);
    notificationInterceptionSession = undefined;
  }
  if (process.argv.includes('--media')) {
    assert.ok(manifest.host_permissions.includes('https://jikan.lucashdo.com/*'), 'replacement provider permission must ship');
    assert.ok(manifest.host_permissions.includes('https://api.tenrai.org/*'), 'music catalogue permission must ship');
    assert.ok(manifest.host_permissions.includes('https://toshy.github.io/*'), 'public video index permission must ship');
    assert.ok(!manifest.host_permissions.includes('https://api.jikan.moe/*'), 'closed provider permission must be removed');
    const worker = (await send('Target.getTargets')).targetInfos.find(target => target.type === 'service_worker' && target.url.startsWith(`chrome-extension://${extensionId}/`));
    const attachedWorker = events.findLast(event => event.method === 'Target.attachedToTarget' && event.params.targetInfo.targetId === worker.targetId);
    assert.ok(attachedWorker, 'worker network guard session must exist');
    const workerSession = attachedWorker.params.sessionId;
    if (process.argv.includes('--media-live')) {
      await send('Network.enable', {}, workerSession);
      await send('Network.setBlockedURLs', { urls: ['http://*', 'https://graphql.anilist.co/*', 'https://anilist.co/*'] }, workerSession);
      try {
        const liveMusic = await evaluate(`(async () => {
          const output = [];
          for (const idMal of [61578, 63382]) output.push(await chrome.runtime.sendMessage({ type: 'media:music-themes', idMal }));
          return output;
        })()`, 30000);
        for (const [index, opening] of ['Kaze no Naka', 'Respawn!!'].entries()) {
          assert.equal(liveMusic[index].success, true, `live music RPC must succeed: ${JSON.stringify(liveMusic[index])}`);
          assert.ok(liveMusic[index].data.data.openings.some(song => song.includes(opening)), 'live catalogue must include the reported missing opening');
        }
        assert.equal(liveMusic[1].data.data.endings.length, 2, 'live Nia catalogue must retain both endings');
        checks.push('live public Tenrai requests through the compiled worker recover both reported openings and both Nia endings');
        const liveVideos = await evaluate(`Promise.all([61578, 63382, 1].map(idMal => chrome.runtime.sendMessage({ type: 'media:music-videos', idMal })))`, 30000);
        for (const [index, basename] of ['NamaAnaru-OP1.webm', 'NiaListon-OP1.webm'].entries()) {
          assert.equal(liveVideos[index].success, true, 'live video index RPC must succeed');
          assert.ok(liveVideos[index].data.links.some(link => link.type === 'OP' && link.url.endsWith(basename)), 'live metadata must identify the correct opening video');
        }
        checks.push('live public AnimeThemes metadata index identifies direct videos for both reported works');
      } finally { await send('Network.setBlockedURLs', { urls: ['http://*', 'https://*'] }, workerSession); }
    }
    // Only this isolated worker is stubbed. The production router and native RPC remain real.
    const videoFixtures = JSON.parse(fs.readFileSync(path.join(root, 'src', 'test', 'fixtures', 'music-videos.json'), 'utf8'));
    const stub = await send('Runtime.evaluate', { expression: `(() => {
      const videoFixtures = ${JSON.stringify(videoFixtures)};
      globalThis.__mediaFetch = globalThis.fetch;
      globalThis.fetch = async (url, options) => {
        if (!['https://jikan.lucashdo.com/v1/', 'https://api.tenrai.org/v1/', 'https://toshy.github.io/animethemes-moe-tracker/'].some(base => String(url).startsWith(base))) throw new Error('Unexpected provider');
        if (options.credentials !== 'omit') throw new Error('Public provider received credentials');
        const path = new URL(url).pathname;
        if (new URL(url).hostname === 'toshy.github.io') {
          const key = path.split('/').at(-1).replace('.json', '');
          return new Response(JSON.stringify(videoFixtures[key]));
        }
        if (path.endsWith('/themes') && new URL(url).hostname !== 'api.tenrai.org') throw new Error('Incomplete music provider used');
        const data = path === '/v1/anime/61578/themes' ? { openings: ['"Kaze no Naka wa Hashiru kkya Nai!" by Sangatsu no Phantasia'], endings: ['"Pi" by Akari Nanawo'] }
          : path === '/v1/anime/63382/themes' ? { openings: ['"Respawn!!" by Watame Tsunomaki (eps 2-)'], endings: ['"Respawn!!" by Watame Tsunomaki (eps 1)', '"Tokimeki Un, Deux, Trois♪" by Magic Vision Hirome-tai (eps 2-)'] }
          : path.endsWith('/themes') ? { openings: ['"Tank!" by The Seatbelts (eps 1-25)'], endings: [] }
          : new URL(url).searchParams.has('q') ? [{ malId: 1, title: 'Cowboy Bebop' }]
          : { malId: Number(path.split('/').at(-1)), score: path.includes('/manga/') ? 9.46 : 8.75 };
        return new Response(JSON.stringify({ data, meta: { cached: true, stale: false } }), { headers: { 'Content-Type': 'application/json' } });
      };
    })()`, returnByValue: true }, workerSession);
    assert.equal(stub.exceptionDetails, undefined);
    try {
      const { build: bundleFixture } = await import('esbuild');
      const fixture = await bundleFixture({ entryPoints: [path.join(root, 'src', 'test', 'media-browser-fixture.ts')],
        bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'AUMediaFixture',
        define: { 'import.meta.env.DEV': 'false' }, tsconfig: path.join(root, 'tsconfig.json') });
      const result = await send('Runtime.evaluate', { expression: `${fixture.outputFiles[0].text}\nAUMediaFixture.runMediaBrowserFixture()`,
        awaitPromise: true, returnByValue: true }, sessionId);
      assert.equal(result.exceptionDetails, undefined, 'native media modules and compiled public-data RPC must pass');
      checks.push(...result.result.value);
    } finally {
      await send('Runtime.evaluate', { expression: 'globalThis.fetch = globalThis.__mediaFetch; delete globalThis.__mediaFetch;' }, workerSession);
    }
  }
  if (process.argv.includes('--quick-edit-opening')) {
    const { build: bundleFixture } = await import('esbuild');
    const fixture = await bundleFixture({
      entryPoints: [path.join(root, 'src', 'test', 'astra-opening-browser-fixture.ts')],
      bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'AUQuickEditFixture',
      outdir: path.join(root, '.cache', 'quick-edit-fixture'),
      define: { 'import.meta.env.DEV': 'false' }, tsconfig: path.join(root, 'tsconfig.json'),
    });
    const source = fixture.outputFiles.find(file => file.path.endsWith('.js')).text;
    const css = fixture.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? '';
    const prepared = await send('Runtime.evaluate', { expression: `${source}\n(async () => {
      const style = document.createElement('style'); style.textContent = ${JSON.stringify(css)}; document.head.append(style);
      await AUQuickEditFixture.prepareQuickEditOpening();
    })()`, awaitPromise: true, returnByValue: true }, sessionId);
    assert.equal(prepared.exceptionDetails, undefined, 'Quick Edit must show its loading window before the provider returns');
    const screenshot = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
    fs.writeFileSync(path.join(root, '.cache', 'quick-edit-loading.png'), Buffer.from(screenshot.data, 'base64'));
    const openingChecks = await evaluate('AUQuickEditFixture.completeQuickEditOpening()');
    assert.equal(openingChecks.length, 3);
    checks.push(...openingChecks);
  }
  if (process.argv.includes('--calendar-plans')) {
    const { build: bundleFixture } = await import('esbuild');
    const fixture = await bundleFixture({
      entryPoints: [path.join(root, 'src', 'test', 'calendar-plan-browser-fixture.ts')],
      bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'AUCalendarPlanFixture',
      outdir: path.join(root, '.cache', 'calendar-plan-fixture'),
      define: { 'import.meta.env.DEV': 'false' }, tsconfig: path.join(root, 'tsconfig.json'),
    });
    const source = fixture.outputFiles.find(file => file.path.endsWith('.js')).text;
    const css = fixture.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? '';
    const loaded = await send('Runtime.evaluate', {
      expression: `${source}\n(() => { const style = document.createElement('style'); style.textContent = ${JSON.stringify(css)}; document.head.append(style); })()`,
      awaitPromise: true, returnByValue: true,
    }, sessionId);
    assert.equal(loaded.exceptionDetails, undefined, 'calendar plan browser fixture must load');
    const result = await evaluate('AUCalendarPlanFixture.runCalendarPlanBrowserFixture()');
    assert.equal(result.length, 3, 'native calendar list/search/editor checks must pass');
    for (const [view, width] of [['lists', 1100], ['search', 1100], ['editor', 1100], ['lists', 375]]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 860, deviceScaleFactor: 1, mobile: false }, sessionId);
      await evaluate(`AUCalendarPlanFixture.mountCalendarPlanPreview(${JSON.stringify(view)})`);
      const rect = await evaluate(`(() => {
        const box = document.querySelector('.calendar-plan-panel').getBoundingClientRect();
        if (box.left < 0 || box.right > innerWidth || box.height > innerHeight || box.width < 300) throw new Error('Calendar plan layout overflows');
        return { x: box.x + scrollX, y: box.y + scrollY, width: box.width, height: box.height, scale: 1 };
      })()`);
      const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: rect }, sessionId);
      fs.writeFileSync(path.join(root, '.cache', `calendar-plans-${view}-${width}.png`), Buffer.from(screenshot.data, 'base64'));
      await evaluate(`document.querySelector('.calendar-plan-panel__close').click()`);
    }
    checks.push(...result);
    fs.writeFileSync(path.join(root, '.cache', 'mv3-calendar-plans.json'), JSON.stringify({
      date: new Date().toISOString(), browser: version.product, checks: result,
      scope: 'production picker/provider/store/CSS; synthetic AniList data and storage; desktop/mobile layout; no personal account access',
    }, null, 2));
  }
  if (process.argv.includes('--calendar')) {
    const { build: bundleFixture } = await import('esbuild');
    const fixture = await bundleFixture({
      entryPoints: [path.join(root, 'src', 'test', 'calendar-browser-fixture.ts')],
      bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'AUCalendarFixture',
      outdir: path.join(root, '.cache', 'calendar-fixture'),
      define: { 'import.meta.env.DEV': 'false' }, tsconfig: path.join(root, 'tsconfig.json'),
    });
    const source = fixture.outputFiles.find(file => file.path.endsWith('.js')).text;
    const css = fixture.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? '';
    const result = await send('Runtime.evaluate', {
      expression: `${source}\n(async () => {
        const style = document.createElement('style'); style.textContent = ${JSON.stringify(css)}; document.head.append(style);
        try { return await AUCalendarFixture.runCalendarBrowserFixture(); } finally { style.remove(); }
      })()`,
      awaitPromise: true, returnByValue: true,
    }, sessionId);
    assert.equal(result.exceptionDetails, undefined, 'native Chromium calendar settings/store fixture must pass');
    const calendarChecks = result.result.value;
    assert.equal(calendarChecks.length, 65);
    if (process.argv.includes('--calendar-preview')) {
      await evaluate(`(async () => {
        const style = document.createElement('style'); style.textContent = ${JSON.stringify(css)}; document.head.append(style);
        await AUCalendarFixture.mountCalendarSettingsPreview();
        await new Promise(resolve => setTimeout(resolve, 400));
      })()`);
      const rect = await evaluate(`(() => {
        const box = document.querySelector('.settings-panel').getBoundingClientRect();
        return { x: box.x + scrollX, y: box.y + scrollY, width: box.width, height: box.height, scale: 1 };
      })()`);
      const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: rect }, sessionId);
      fs.writeFileSync(path.join(root, '.cache', 'calendar-settings.png'), Buffer.from(screenshot.data, 'base64'));
      await evaluate(`document.querySelector('.settings-panel__close').click()`);
    }
    fs.writeFileSync(path.join(root, '.cache', 'mv3-calendar.json'), JSON.stringify({
      date: new Date().toISOString(), browser: version.product, checks: calendarChecks,
      scope: 'production settings/store/grid/column/card/DOM service/cache/loading/collection/DI/activity renderer, Astra rating modal/header/view scope, EventBus and calendar/Astra CSS from current source; synthetic preferences/services/account context/save gates and native DOM in isolated extension page; no AniList Vue, personal data or account access',
    }, null, 2));
    checks.push('sixty-five native Chromium calendar rollover/hierarchy/CSS/DOM/cache/settings, activity and Astra data/form/lifecycle/journal checks');
  }
  if (process.argv.includes('--following')) {
    const preview = process.argv.includes('--following-preview');
    const { build: bundleFixture } = await import('esbuild');
    const fixture = await bundleFixture({
      entryPoints: [path.join(root, 'src', 'test', 'following-progress-browser-fixture.ts')],
      bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'AUFollowingFixture',
      outdir: path.join(root, '.cache', 'following-progress-fixture'),
      define: { 'import.meta.env.DEV': 'false' }, tsconfig: path.join(root, 'tsconfig.json'),
    });
    const result = await send('Runtime.evaluate', {
      expression: `${fixture.outputFiles.find(file => file.path.endsWith('.js')).text}\n(async () => {
        const style = document.createElement('style'); style.textContent = ${JSON.stringify(fixture.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? '')}; document.head.append(style);
        try { return await AUFollowingFixture.runFollowingProgressBrowserFixture(${preview}); } finally { if (!${preview}) style.remove(); }
      })()`,
      awaitPromise: true, returnByValue: true,
    }, sessionId);
    assert.equal(result.exceptionDetails, undefined, 'native Chromium Following progress fixture must pass');
    assert.equal(result.result.value.length, 10);
    if (preview) {
      const directory = path.join(root, '.cache', 'following-layout'); fs.mkdirSync(directory, { recursive: true });
      for (const width of [520, 375]) {
        const rect = await send('Runtime.evaluate', {
          expression: `(() => { const host = document.querySelector('.au-following-layout-fixture'); host.style.width = '${width}px'; const box = host.getBoundingClientRect(); return { x: box.x + scrollX, y: box.y + scrollY, width: box.width, height: box.height, scale: 1 }; })()`,
          returnByValue: true,
        }, sessionId);
        const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: rect.result.value }, sessionId);
        fs.writeFileSync(path.join(directory, `following-${width}.png`), Buffer.from(screenshot.data, 'base64'));
      }
    }
    fs.writeFileSync(path.join(root, '.cache', 'mv3-following.json'), JSON.stringify({
      date: new Date().toISOString(), browser: version.product, checks: result.result.value,
      scope: 'production Following module/service/alias batcher, native DOM and synthetic API/context; no AniList Vue, private data or authenticated provider',
    }, null, 2));
    checks.push('ten native Chromium Following progress batching/layout/social/account/lifecycle checks');
  }
  if (process.argv.includes('--scores')) {
    const { build: bundleFixture } = await import('esbuild');
    const fixture = await bundleFixture({
      entryPoints: [path.join(root, 'src', 'test', 'activity-scores-browser-fixture.ts')],
      bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'AUActivityScoresFixture',
      outdir: path.join(root, '.cache', 'activity-scores-fixture'),
      define: { 'import.meta.env.DEV': 'false' }, tsconfig: path.join(root, 'tsconfig.json'),
    });
    const source = fixture.outputFiles.find(file => file.path.endsWith('.js')).text;
    const css = fixture.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? '';
    const result = await send('Runtime.evaluate', {
      expression: `${source}\n(async () => {
        const style = document.createElement('style'); style.textContent = ${JSON.stringify(css)}; document.head.append(style);
        try { return await AUActivityScoresFixture.runActivityScoresBrowserFixture(); } finally { style.remove(); }
      })()`,
      awaitPromise: true, returnByValue: true,
    }, sessionId);
    assert.equal(result.exceptionDetails, undefined, 'native Chromium score service/cache/module fixture must pass');
    const scoreChecks = result.result.value;
    assert.equal(scoreChecks.length, 5);
    fs.writeFileSync(path.join(root, '.cache', 'mv3-scores.json'), JSON.stringify({
      date: new Date().toISOString(), browser: version.product, checks: scoreChecks,
      scope: 'production score service/cache/module bundled from current source; synthetic API/context and native DOM observer in isolated extension page; no AniList Vue, private data or authenticated provider',
    }, null, 2));
    checks.push('five native Chromium activity score identity/cache/account/observer checks');
  }
  if (process.argv.includes('--foreground')) {
    const authStorageChecks = [];
    // Stop the real worker with corrupt public metadata already durable, so
    // this tests startup readiness as well as warm storage notifications.
    for (const [key, malformed] of [['anilist_ultimate_user_cache', { userId: '7', userName: {} }], ['anilist_ultimate_auth_session', 17]]) {
      const saved = await evaluate(`(async () => {
        const saved = await chrome.storage.local.get(${JSON.stringify(key)});
        await chrome.storage.local.set({ [${JSON.stringify(key)}]: ${JSON.stringify(malformed)} });
        return saved;
      })()`);
      try {
        const previousWorker = await stopOwnWorker();
        const cold = await evaluate(`(async () => {
          const status = await chrome.runtime.sendMessage({ type: 'auth:status' });
          const config = await chrome.runtime.sendMessage({ type: 'config:command', operation: 'get' });
          const preserved = await chrome.storage.local.get(${JSON.stringify(key)});
          const credentials = await chrome.storage.local.get('anilist_ultimate_auth_token');
          return { status, configAvailable: config.success === true,
            preserved: JSON.stringify(preserved[${JSON.stringify(key)}]) === ${JSON.stringify(JSON.stringify(malformed))},
            credentialAbsent: !credentials.anilist_ultimate_auth_token };
        })()`);
        assert.deepEqual(cold.status, { authenticated: false }, 'cold corruption must expose no owner or operational session');
        assert.equal(cold.configAvailable, true, 'corrupt auth metadata must not poison background readiness');
        assert.equal(cold.preserved, true, 'cold startup must preserve corrupted metadata without guessing a repair');
        assert.equal(cold.credentialAbsent, true, 'corruption probes must never install credentials');
        await verifyNewWorker(previousWorker);
        authStorageChecks.push({ key, ...cold });
      } finally {
        await evaluate(`(async () => {
          const saved = ${JSON.stringify(saved)};
          if (Object.prototype.hasOwnProperty.call(saved, ${JSON.stringify(key)})) await chrome.storage.local.set(saved);
          else await chrome.storage.local.remove(${JSON.stringify(key)});
        })()`);
      }
      const recovered = await evaluate("chrome.runtime.sendMessage({ type: 'auth:status' })");
      assert.equal(recovered.authenticated, false);
      assert.equal(typeof recovered.sessionId, 'string', 'restored metadata must recover an operational anonymous session');
      assert.ok(recovered.sessionId.length > 0);
    }
    fs.writeFileSync(path.join(root, '.cache', 'mv3-auth-storage.json'), JSON.stringify({
      date: new Date().toISOString(), browser: version.product, checks: authStorageChecks,
      scope: 'real worker stop/restart with corrupt synthetic public owner/session metadata in native Chrome storage; anonymous readiness/config RPC and preservation/restoration; credentials remain absent, HTTP(S) blocked, no OAuth/provider/personal profile',
    }, null, 2));
    checks.push('cold worker startup with corrupt public owner/session metadata stays available and recovers without modifying the persisted input');
    const { build: bundleFixture } = await import('esbuild');
    const fixture = await bundleFixture({
      entryPoints: [path.join(root, 'src', 'test', 'foreground-browser-fixture.ts')],
      bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'AUForegroundFixture',
      outdir: path.join(root, '.cache', 'foreground-fixture'),
      define: {
        'import.meta.env.DEV': 'false',
        'import.meta.env.VITE_ANILIST_CLIENT_ID': '"35100"',
      }, tsconfig: path.join(root, 'tsconfig.json'),
    });
    const source = fixture.outputFiles.find(file => file.path.endsWith('.js')).text;
    const css = fixture.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? '';
    // A dedicated extension-origin target prevents this source bundle's independent
    // tsyringe container and shared services from affecting the tested page shell.
    const foregroundTarget = await send('Target.createTarget', { url: 'about:blank' });
    try {
      const attached = await send('Target.attachToTarget', { targetId: foregroundTarget.targetId, flatten: true });
      const foregroundSession = attached.sessionId;
      await send('Runtime.enable', {}, foregroundSession);
      await send('Log.enable', {}, foregroundSession);
      await send('Page.enable', {}, foregroundSession);
      await send('Network.enable', {}, foregroundSession);
      await send('Network.setBlockedURLs', { urls: ['http://*', 'https://*'] }, foregroundSession);
      await send('Page.navigate', { url: `chrome-extension://${extensionId}/${manifest.action.default_popup}` }, foregroundSession);
      let ready = false;
      for (let attempt = 0; attempt < 30; attempt++) {
        const state = await send('Runtime.evaluate', { expression: "document.readyState === 'complete' && !!document.querySelector('#login-container:not(.hidden) #login-btn') && !!document.querySelector('#user-info.hidden')", returnByValue: true }, foregroundSession);
        ready = state.result.value === true;
        if (ready) break;
        await delay(100);
      }
      assert.equal(ready, true, 'dedicated logged-out foreground extension shell must load');
      const result = await send('Runtime.evaluate', {
        expression: `${source}\n(async () => {
          const style = document.createElement('style'); style.textContent = ${JSON.stringify(css)}; document.head.append(style);
          try { return await AUForegroundFixture.runForegroundBrowserFixture(); } finally { style.remove(); }
        })()`, awaitPromise: true, returnByValue: true,
      }, foregroundSession, 20000);
      assert.equal(result.exceptionDetails, undefined, 'native Chromium full foreground composition fixture must pass');
      assert.equal(result.result.value.length, 8);
      fs.writeFileSync(path.join(root, '.cache', 'mv3-foreground.json'), JSON.stringify({
        date: new Date().toISOString(), browser: version.product, checks: result.result.value,
        scope: 'full setupDI(false) from current source in independently bundled tsyringe container and dedicated extension target; real logged-out background auth/logout/config/custom-list/Astra-date RPC and native local storage, corruption/restoration of synthetic public owner/session metadata without credentials; explicit shared-service/API destroy followed by owner/feature disposal, Astra subscriptions/private snapshots/native listeners checked; HTTP(S) blocked, no AniList Vue, authenticated provider or personal profile',
      }, null, 2));
      checks.push('eight full foreground setup, local-list/Astra-date RPC/storage, feature/owner container lifetime and exact native listener cleanup checks');
    } finally { await send('Target.closeTarget', { targetId: foregroundTarget.targetId }); }
  }
  const errors = events.filter(event => event.method === 'Runtime.exceptionThrown'
    || (event.method === 'Log.entryAdded' && ((event.params.entry.level === 'error' && event.params.entry.source !== 'network')
      || /cross-world extension resource mismatch|must be added on the initial evaluation of worker script/i.test(event.params.entry.text)))
    || (event.method === 'ServiceWorker.workerErrorReported' && event.params.errorMessage.sourceURL?.startsWith(`chrome-extension://${extensionId}/`)));
  assert.equal(errors.length, 0, 'extension pages must have no uncaught exception/CSP errors');
  checks.push('no runtime/CSP errors, cross-world preloads or late worker-listener warnings');
  fs.writeFileSync(path.join(root, '.cache', 'mv3-smoke.json'), JSON.stringify({
    date: new Date().toISOString(), browser: version.product, profile, extensionId,
    checks, durationMs: Date.now() - started, scope: 'fresh profile; logged out; HTTP(S) blocked except scoped public music/theme-video metadata requests when --media-live is enabled; no media downloads or AniList mutation',
  }, null, 2));
  console.log(`MV3 smoke passed (${version.product}): ${checks.length} checks; isolated report in .cache/mv3-smoke.json`);
} catch (error) {
  try {
    const { targetInfos } = await send('Target.getTargets');
    for (const target of targetInfos.filter(target => target.type === 'service_worker' && target.url.startsWith(`chrome-extension://${extensionId}/`))) {
      const attached = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
      const state = await send('Runtime.evaluate', { expression: "({location: location.href, reflect: typeof Reflect.getMetadata, listeners: chrome.runtime.onMessage.hasListeners()})", returnByValue: true }, attached.sessionId);
      events.push({ method: 'Smoke.workerState', state });
      const storage = await send('Runtime.evaluate', { expression: "Promise.race([chrome.storage.local.get(null).then(value => Object.keys(value)), new Promise(resolve => setTimeout(() => resolve('local-storage-timeout'), 2000))])", awaitPromise: true, returnByValue: true }, attached.sessionId);
      events.push({ method: 'Smoke.workerStorage', storage });
      const access = await send('Runtime.evaluate', { expression: "Promise.race([chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'}).then(() => 'access-level-ok'), new Promise(resolve => setTimeout(() => resolve('access-level-timeout'), 2000))])", awaitPromise: true, returnByValue: true }, attached.sessionId);
      events.push({ method: 'Smoke.workerAccess', access });
    }
  } catch (diagnosticError) { events.push({ method: 'Smoke.workerDiagnosticError', message: diagnosticError.message }); }
  fs.writeFileSync(path.join(root, '.cache', 'mv3-smoke-failure.json'), JSON.stringify({
    date: new Date().toISOString(), browser: version?.product, profile, checks, error: error.message, stderr,
    runtimeErrors: events.filter(event => event.method === 'Runtime.exceptionThrown' || event.method === 'Log.entryAdded' || event.method === 'Runtime.consoleAPICalled' || event.method.startsWith('ServiceWorker.') || event.method.startsWith('Smoke.')),
  }, null, 2));
  throw error;
} finally {
  if (!closed) { try { await send('Browser.close'); } catch { /* child can exit before acknowledgement */ } }
  if (!closed) await new Promise(resolve => { browser.once('exit', resolve); setTimeout(resolve, 3000).unref(); });
  if (!closed) browser.kill();
  failPending(new Error('Smoke run finished'));
}
