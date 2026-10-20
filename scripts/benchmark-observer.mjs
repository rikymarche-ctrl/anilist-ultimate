import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = process.cwd();
const cache = path.join(root, '.cache'); fs.mkdirSync(cache, { recursive: true });
const fixture = await build({ entryPoints: [path.join(root, 'src/test/observer-browser-fixture.ts')],
  bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'AUObserverFixture',
  outdir: path.join(cache, 'observer-fixture'), define: { 'import.meta.env.DEV': 'false' },
  tsconfig: path.join(root, 'tsconfig.json') });
const source = fixture.outputFiles.find(file => file.path.endsWith('.js')).text;
const documentPath = path.join(cache, 'observer-benchmark.html');
fs.writeFileSync(documentPath, '<!doctype html><html><head><title>Shared observer synthetic benchmark</title></head><body></body></html>');
const profile = path.join(cache, `observer-profile-${randomUUID()}`);
const executable = process.env.MV3_BROWSER || path.join(cache, 'mv3-runtime/chrome-win64/chrome.exe');
const browser = spawn(executable, ['--headless=new', '--no-first-run', '--no-default-browser-check',
  '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-extensions',
  '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
  '--remote-debugging-pipe', `--user-data-dir=${profile}`, 'about:blank'],
{ windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
let sequence = 0; let buffer = ''; let closed = false; let stderr = '';
const pending = new Map();
browser.stderr.on('data', data => { stderr = (stderr + data).slice(-4000); });
function failPending(error) { for (const request of pending.values()) { clearTimeout(request.timer); request.reject(error); } pending.clear(); }
browser.once('error', failPending);
browser.once('exit', () => { closed = true; failPending(new Error('Observer browser exited')); });
browser.stdio[4].on('data', data => {
  buffer += data.toString(); let boundary;
  while ((boundary = buffer.indexOf('\0')) !== -1) {
    const packet = JSON.parse(buffer.slice(0, boundary)); buffer = buffer.slice(boundary + 1);
    const request = pending.get(packet.id); if (!request) continue;
    clearTimeout(request.timer); pending.delete(packet.id);
    if (packet.error) request.reject(new Error(`${request.method}: ${packet.error.message}`)); else request.resolve(packet.result);
  }
});
function send(method, params = {}, sessionId, timeoutMs = 75000) {
  if (closed) return Promise.reject(new Error('Observer browser exited'));
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, timeoutMs);
    pending.set(id, { resolve, reject, timer, method });
    browser.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
  });
}
try {
  const version = await send('Browser.getVersion');
  const { targetId } = await send('Target.createTarget', { url: pathToFileURL(documentPath).href });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Page.enable', {}, sessionId);
  await send('Page.bringToFront', {}, sessionId);
  await send('Network.enable', {}, sessionId);
  await send('Network.setBlockedURLs', { urls: ['http://*', 'https://*'] }, sessionId);
  async function evaluate(expression) {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'Observer fixture failed');
    return result.result.value;
  }
  await evaluate(source);
  const output = { date: new Date().toISOString(), browser: version.product,
    sourceSha256: createHash('sha256').update(source).digest('hex'),
    scope: 'Production SharedGlobalObserver/mutationsMatchSelector vs equivalent independent native observers, 8 subscribers and equal 10ms throttle. Synthetic 4k/10k element DOM with 100 synchronous insertions into one of 8 scopes. Native callback delivery, full/scoped TreeWalker scans, selector audit and pending cleanup probes. All HTTP(S) blocked; no accounts/provider/extension.',
    limitations: 'One run per size/mode in fixed order; timings include auditing and browser/hardware noise. Filter timing includes prototype-method counters; record inputs count offered records rather than records actually inspected, while explicit selector calls include short circuiting. Nodes visited count only TreeWalker scan elements; selector-engine internal visits are not measured. Native delivery counts alone do not prove speed. Synthetic TreeWalker scans represent fanout cost rather than production module selectors. No real AniList page, heap or SLA claim.',
    measurements: [] };
  const artifact = path.join(cache, 'observer-benchmark.json');
  for (const size of [4000, 10000]) for (const mode of ['shared-full', 'independent-full', 'shared-filtered', 'independent-targeted']) {
    const measured = await evaluate(`AUObserverFixture.measureObserver(${size}, ${JSON.stringify(mode)})`);
    output.measurements.push(measured);
    fs.writeFileSync(artifact, JSON.stringify(output, null, 2) + '\n');
    console.log(JSON.stringify(measured));
  }
  console.log(JSON.stringify({ artifact, browser: output.browser }));
} catch (error) { console.error(stderr); throw error; }
finally {
  if (!closed) { try { await send('Browser.close', {}, undefined, 3000); } catch { browser.kill(); } }
  await new Promise(resolve => { if (closed) resolve(); else { browser.once('exit', resolve); setTimeout(() => { browser.kill(); resolve(); }, 3000); } });
  const resolvedProfile = path.resolve(profile);
  if (resolvedProfile.startsWith(path.resolve(cache) + path.sep) && path.basename(resolvedProfile).startsWith('observer-profile-')) {
    try { fs.rmSync(resolvedProfile, { recursive: true, force: true }); } catch { /* Preserve a temporarily locked cache profile for later cleanup. */ }
  }
}
