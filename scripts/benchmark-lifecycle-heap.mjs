import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = process.cwd();
const cache = path.join(root, '.cache'); fs.mkdirSync(cache, { recursive: true });
const fixture = await build({ entryPoints: [path.join(root, 'src/test/lifecycle-heap-browser-fixture.ts')],
  bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'AUHeapFixture',
  outdir: path.join(cache, 'heap-fixture'), define: { 'import.meta.env.DEV': 'false' },
  tsconfig: path.join(root, 'tsconfig.json') });
const source = fixture.outputFiles.find(file => file.path.endsWith('.js')).text;
const css = fixture.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? '';
const documentPath = path.join(cache, 'lifecycle-heap-benchmark.html');
fs.writeFileSync(documentPath, '<!doctype html><html><head><title>Synthetic lifecycle heap probe</title></head><body></body></html>');
const profile = path.join(cache, `heap-profile-${randomUUID()}`);
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
  await send('HeapProfiler.enable', {}, sessionId);
  async function evaluate(expression) {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'Heap fixture failed');
    return result.result.value;
  }
  await evaluate(`${source}\n(() => { const style = document.createElement('style'); style.textContent = ${JSON.stringify(css)}; document.head.append(style); })()`);
  async function collect() {
    await send('Runtime.discardConsoleEntries', {}, sessionId);
    await send('HeapProfiler.collectGarbage', {}, sessionId);
  }
  async function instances(name) {
    const objectGroup = `heap-count-${name}`;
    try {
      const prototype = await send('Runtime.evaluate', { expression: `AUHeapFixture.prototypes.${name}`, objectGroup }, sessionId);
      if (!prototype.result.objectId) throw new Error(`Missing production prototype ${name}`);
      const objects = await send('Runtime.queryObjects', { prototypeObjectId: prototype.result.objectId, objectGroup }, sessionId);
      const result = await send('Runtime.callFunctionOn', { objectId: objects.objects.objectId, functionDeclaration: 'function () { return this.length; }', returnByValue: true }, sessionId);
      if (result.exceptionDetails || !Number.isInteger(result.result.value)) throw new Error('Heap count failed');
      return result.result.value;
    } finally { await send('Runtime.releaseObjectGroup', { objectGroup }, sessionId); }
  }
  async function sample(label) {
    await collect();
    const retained = {};
    for (const name of ['AstraWorkTable', 'AstraWindowPlanner', 'SharedGlobalObserver', 'CacheFactory', 'CacheService']) retained[name] = await instances(name);
    // Query result arrays and handles have been released before byte/DOM sampling.
    await collect();
    return { label, retained, heap: await send('Runtime.getHeapUsage', {}, sessionId), dom: await send('Memory.getDOMCounters', {}, sessionId),
      cacheResources: await evaluate('AUHeapFixture.cacheResources()') };
  }
  function assertReleased(sampled) {
    if (Object.values(sampled.retained).some(value => value !== 0)) throw new Error(`Production instances retained after teardown: ${JSON.stringify(sampled)}`);
    const resources = sampled.cacheResources;
    if (resources.authListeners || resources.heldCacheEntries || resources.storageWrites || resources.storageRemovals || resources.cacheErrors) {
      throw new Error(`Cache resources retained or unexpected I/O: ${JSON.stringify(resources)}`);
    }
  }
  const output = { date: new Date().toISOString(), browser: version.product,
    sourceSha256: createHash('sha256').update(source).digest('hex'),
    scope: 'Actual WorkTable/WindowPlanner, SharedGlobalObserver, CacheFactory and CacheService instances over synthetic 1k/10k works and production CSS. Repeated mount, distant focus, progress update and teardown with pending native scheduling. Every factory owns a private and a public cache with entries and a real pending persistence debounce; disposal occurs within two seconds. The auth EventBus deliberately survives all cycles. Verify zero auth subscriptions, entries, storage writes/removals and error logs after teardown, and rejection of retired cache commands. CDP forced GC, prototype heap queries with released handles, renderer DOM/listener counters and isolate-wide heap bytes. HTTP(S) blocked; isolated profile, no account/provider/extension.',
    limitations: 'One ordered run, no RSS/allocation rate or whole-extension/Vue guarantee. Bytes cover the whole V8 isolate, including JIT/cache/browser overhead; changes are observations, not a zero-byte-leak assertion. Exact class counts cover only five named production classes. Cache workload cancels pending debounce; unit regressions separately cover pending read and queued/already-issued storage I/O. GC intentionally forced; positive control confirms retained instances are detectable. Static bundle/prototypes/CSS and the synthetic shared EventBus/backend remain loaded throughout.',
    references: ['https://github.com/ChromeDevTools/devtools-protocol/blob/master/json/js_protocol.json', 'https://github.com/ChromeDevTools/devtools-protocol/blob/master/json/browser_protocol.json'],
    control: {}, measurements: [] };
  const artifact = path.join(cache, 'lifecycle-heap-benchmark.json');
  const save = () => fs.writeFileSync(artifact, JSON.stringify(output, null, 2) + '\n');
  output.control.initial = await sample('initial'); assertReleased(output.control.initial);
  await evaluate('AUHeapFixture.mountHeld(1000, "table")');
  output.control.held = await sample('positive: mounted and deliberately held');
  if (Object.values(output.control.held.retained).some(value => value < 1)) throw new Error('Heap positive control failed');
  if (output.control.held.retained.CacheService < 2 || output.control.held.cacheResources.authListeners !== 1
    || output.control.held.cacheResources.heldCacheEntries !== 2) throw new Error('Cache heap positive control failed');
  await evaluate('AUHeapFixture.releaseHeld()');
  output.control.released = await sample('positive: released'); assertReleased(output.control.released); save();
  for (const size of [1000, 10000]) for (const layout of ['table', 'list', 'grid']) {
    await evaluate(`AUHeapFixture.runCycles(${size}, ${JSON.stringify(layout)}, 2)`);
    const baseline = await sample('warm baseline'); assertReleased(baseline);
    const measurement = { size, layout, warmupCycles: 2, baseline, batches: [] };
    output.measurements.push(measurement);
    for (let batch = 0; batch < 3; batch++) {
      const workload = await evaluate(`AUHeapFixture.runCycles(${size}, ${JSON.stringify(layout)}, 10)`);
      const sampled = await sample(`after ${(batch + 1) * 10} cycles`); assertReleased(sampled);
      if (sampled.dom.nodes !== baseline.dom.nodes || sampled.dom.documents !== baseline.dom.documents
        || sampled.dom.jsEventListeners !== baseline.dom.jsEventListeners) {
        throw new Error(`DOM resources retained after repeated teardown: ${JSON.stringify({ size, layout, baseline: baseline.dom, actual: sampled.dom })}`);
      }
      const result = { ...workload, ...sampled, deltaFromBaseline: {
        usedSize: sampled.heap.usedSize - baseline.heap.usedSize,
        embedderHeapUsedSize: sampled.heap.embedderHeapUsedSize - baseline.heap.embedderHeapUsedSize,
        nodes: sampled.dom.nodes - baseline.dom.nodes,
        jsEventListeners: sampled.dom.jsEventListeners - baseline.dom.jsEventListeners,
      } };
      measurement.batches.push(result); save();
      console.log(JSON.stringify({ size, layout, batch: batch + 1, retained: sampled.retained,
        cacheResources: sampled.cacheResources, delta: result.deltaFromBaseline }));
    }
  }
  console.log(JSON.stringify({ artifact, browser: output.browser }));
} catch (error) { console.error(stderr); throw error; }

finally {
  if (!closed) { try { await send('Browser.close', {}, undefined, 3000); } catch { browser.kill(); } }
  await new Promise(resolve => { if (closed) resolve(); else { browser.once('exit', resolve); setTimeout(() => { browser.kill(); resolve(); }, 3000); } });
  const resolvedProfile = path.resolve(profile);
  if (resolvedProfile.startsWith(path.resolve(cache) + path.sep) && path.basename(resolvedProfile).startsWith('heap-profile-')) {
    try { fs.rmSync(resolvedProfile, { recursive: true, force: true }); } catch { /* Preserve a temporarily locked cache profile for later cleanup. */ }
  }
}
