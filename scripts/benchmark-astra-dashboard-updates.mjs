import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = process.cwd();
const cache = path.join(root, '.cache'); fs.mkdirSync(cache, { recursive: true });
const fixture = await build({ entryPoints: [path.join(root, 'src/test/astra-dashboard-updates-browser-fixture.ts')],
  bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'AUUpdatesFixture',
  outdir: path.join(cache, 'astra-dashboard-fixture'), define: { 'import.meta.env.DEV': 'false' },
  tsconfig: path.join(root, 'tsconfig.json') });
const source = fixture.outputFiles.find(file => file.path.endsWith('.js')).text;
const css = fixture.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? '';
const documentPath = path.join(cache, 'astra-dashboard-updates-benchmark.html');
fs.writeFileSync(documentPath, '<!doctype html><html><head><title>Astra synthetic dashboard benchmark</title></head><body></body></html>');
const profile = path.join(cache, `astra-dashboard-updates-profile-${randomUUID()}`);
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
browser.once('exit', () => { closed = true; failPending(new Error('Dashboard browser exited')); });
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
  if (closed) return Promise.reject(new Error('Dashboard browser exited'));
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
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'Dashboard fixture failed');
    return result.result.value;
  }
  await evaluate(`${source}\n(() => { const style = document.createElement('style'); style.textContent = ${JSON.stringify(css)}; document.head.append(style); })()`);
  const output = { date: new Date().toISOString(), browser: version.product,
    sourceSha256: createHash('sha256').update(source).digest('hex'),
    scope: 'Production WorkTable/row update methods and local CSS over synthetic summaries/adapters. Native scheduling verified after a pending progress update. Settled update timings exclude explicitly forced completion preparation. All HTTP(S) blocked; no provider/account/extension.',
    limitations: 'One workload per size/layout with 20 display and 5 progress samples; timings depend on hardware/headless browser and include dependency comparison. Complete DOM obtained using native chunk methods synchronously as preparation, separately reported; no natural full-settlement, heap, provider, or SLA claim.',
    measurements: [] };
  const artifact = path.join(cache, 'astra-dashboard-updates-benchmark.json');
  for (const [size, layout] of [[1000, 'table'], [1000, 'list'], [1000, 'grid'], [10000, 'table'], [10000, 'list'], [10000, 'grid']]) {
    const measured = await evaluate(`AUUpdatesFixture.measureAstraDashboardUpdates(${size}, ${JSON.stringify(layout)})`);
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
  if (resolvedProfile.startsWith(path.resolve(cache) + path.sep) && path.basename(resolvedProfile).startsWith('astra-dashboard-updates-profile-')) {
    try { fs.rmSync(resolvedProfile, { recursive: true, force: true }); } catch { /* Preserve a temporarily locked cache profile for later cleanup. */ }
  }
}
