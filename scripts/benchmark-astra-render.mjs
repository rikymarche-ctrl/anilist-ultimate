import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

// Current production source, synthetic adapters, fresh signed-out Chromium.
// No extension, private profile or provider network is required.
const root = process.cwd();
const baseline = process.argv.includes('--baseline');
const modalPath = path.join(root, 'src/modules/astra/ui/AstraRatingModal.ts');
const modalSource = fs.readFileSync(modalPath, 'utf8');
const reconstruction = baseline ? [
  'Counterfactual current modal: replace paged journal with visibleCount=total||max(progress,aired,Object.keys(notes).length) and loop 1..visibleCount, without pagination.',
  'Bind the current extracted calendar helper to the parent viewScope instead of a child journal scope; omit paging listeners.',
  'Omit pre-redraw captureEpisodeInputs and child-scope release from renderEpisodeJournal refresh; retain all other current behavior, including Save.',
] : [];
const baselinePlugin = { name: 'counterfactual-unpaged-current-journal', setup(builder) {
  builder.onLoad({ filter: /AstraRatingModal\.ts$/ }, args => {
    let contents = fs.readFileSync(args.path, 'utf8');
    const renderStart = contents.indexOf('    const page = journalPage(', contents.indexOf('  private renderEpisodeList('));
    const rowStart = contents.indexOf("      const note = notes[i]?.text || '';", renderStart);
    const bindStart = contents.indexOf('  private bindEpisodeDatePickers(): void {');
    const bindEnd = contents.indexOf('  private updateLivePreview(', bindStart);
    const rowsStart = contents.indexOf("    list.querySelectorAll<HTMLElement>('.astra-ep-date-picker')", bindStart);
    if ([renderStart, rowStart, bindStart, bindEnd, rowsStart].some(index => index < 0)) throw new Error('Counterfactual current-journal anchors changed; review transform before measuring');
    const boundRows = contents.slice(rowsStart, bindEnd).replaceAll('scope.listen(', 'this.listen(')
      .replace("list.querySelectorAll<HTMLElement>('.astra-ep-date-picker')", "this.overlay?.querySelectorAll<HTMLElement>('.astra-ep-date-picker')");
    contents = contents.slice(0, bindStart) + '  private bindEpisodeDatePickers(): void {\n    const scope = this.viewScope;\n    if (!scope) return;\n' + boundRows + contents.slice(bindEnd);
    contents = contents.slice(0, renderStart) + `    const visibleCount = total || Math.max(progress, airedCount || 0, Object.keys(notes).length);\n    let html = '';\n    for (let i = 1; i <= visibleCount; i++) {\n` + contents.slice(rowStart);
    const refreshStart = contents.indexOf('  private renderEpisodeJournal(');
    const refreshEnd = contents.indexOf('  private formatProgressCounter(', refreshStart);
    const refresh = contents.slice(refreshStart, refreshEnd)
      .replace('    if (capture) this.captureEpisodeInputs(season, progress);', '')
      .replace('    this.journalScope?.release(); this.journalScope = null;', '');
    contents = contents.slice(0, refreshStart) + refresh + contents.slice(refreshEnd);
    return { contents, loader: 'ts' };
  });
} };
const fixture = await build({ entryPoints: [path.join(root, 'src/test/astra-render-browser-fixture.ts')],
  bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'AURenderFixture',
  outdir: path.join(root, '.cache/astra-render-fixture'), define: { 'import.meta.env.DEV': 'false' },
  tsconfig: path.join(root, 'tsconfig.json'), plugins: baseline ? [baselinePlugin] : [] });
const source = fixture.outputFiles.find(file => file.path.endsWith('.js')).text;
const css = fixture.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? '';
const cache = path.join(root, '.cache'); fs.mkdirSync(cache, { recursive: true });
const documentPath = path.join(cache, 'astra-render-benchmark.html');
fs.writeFileSync(documentPath, '<!doctype html><html><head><title>Astra synthetic render benchmark</title></head><body></body></html>');
const profile = path.join(cache, `astra-render-profile-${randomUUID()}`);
const executable = process.env.MV3_BROWSER || path.join(cache, 'mv3-runtime/chrome-win64/chrome.exe');
const browser = spawn(executable, ['--headless=new', '--no-first-run', '--no-default-browser-check',
  '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-extensions',
  '--remote-debugging-pipe', `--user-data-dir=${profile}`, 'about:blank'],
{ windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
let sequence = 0; let buffer = ''; let closed = false; let stderr = '';
const pending = new Map();
browser.stderr.on('data', data => { stderr = (stderr + data).slice(-4000); });
function failPending(error) { for (const request of pending.values()) { clearTimeout(request.timer); request.reject(error); } pending.clear(); }
browser.once('error', failPending);
browser.once('exit', () => { closed = true; failPending(new Error('Benchmark browser exited')); });
browser.stdio[4].on('data', data => {
  buffer += data.toString(); let boundary;
  while ((boundary = buffer.indexOf('\0')) !== -1) {
    const packet = JSON.parse(buffer.slice(0, boundary)); buffer = buffer.slice(boundary + 1);
    const request = pending.get(packet.id); if (!request) continue;
    clearTimeout(request.timer); pending.delete(packet.id);
    if (packet.error) request.reject(new Error(`${request.method}: ${packet.error.message}`)); else request.resolve(packet.result);
  }
});
function send(method, params = {}, sessionId, timeoutMs = 30000) {
  if (closed) return Promise.reject(new Error('Benchmark browser exited'));
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
  await send('Network.enable', {}, sessionId);
  await send('Network.setBlockedURLs', { urls: ['http://*', 'https://*'] }, sessionId);
  await send('Performance.enable', {}, sessionId);
  async function evaluate(expression) {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'Benchmark fixture failed');
    return result.result.value;
  }
  await evaluate(`${source}\n(() => { const style = document.createElement('style'); style.textContent = ${JSON.stringify(css)}; document.head.append(style); })()`);
  const measurements = [];
  const workloads = [[12, 20], [100, 20], [1000, 10], [10000, 0], ...(!baseline ? [[2147483647, 10]] : [])];
  for (const [count, refreshes] of workloads) {
    const measured = await evaluate(`AURenderFixture.measureAstraRender(${count}, ${refreshes})`);
    measurements.push(measured);
    console.log(JSON.stringify(measured));
  }
  const notes = await evaluate('AURenderFixture.inspectAstraSparseNotes()');
  const metrics = await send('Performance.getMetrics', {}, sessionId);
  const output = { date: new Date().toISOString(), browser: version.product,
    variant: baseline ? 'counterfactual unpaged current journal with parent-owned current calendar helper' : 'unmodified current source', reconstruction,
    inputModalSha256: createHash('sha256').update(modalSource).digest('hex'),
    sourceSha256: createHash('sha256').update(source).digest('hex'),
    scope: 'Production rating modal/current source; synthetic account/data adapters, local CSS and native Chromium DOM; all HTTP(S) blocked; no extension/account/provider DOM.',
    limitations: 'One run per case; timings depend on hardware/headless browser. Hidden journal measured. The --baseline variant is a counterfactual current-source unpaged journal with parent-owned current calendar helper, not verbatim October 9 source or an old dist; current row markup, helper, Save and other behavior remain. Max GraphQL Int is never rendered in the reconstructed variant. Heap metrics include runtime and are not retained-memory estimates. No claim of real AniList Vue integration.',
    measurements, notes, metrics: Object.fromEntries(metrics.metrics.map(metric => [metric.name, metric.value])) };
  const suffix = baseline ? '-baseline' : '';
  const artifact = path.join(cache, `astra-render-benchmark${suffix}.json`);
  fs.writeFileSync(artifact, JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify({ artifact, notes, browser: output.browser }));
} catch (error) { console.error(stderr); throw error; }
finally {
  if (!closed) { try { await send('Browser.close', {}, undefined, 3000); } catch { browser.kill(); } }
  await new Promise(resolve => { if (closed) resolve(); else { browser.once('exit', resolve); setTimeout(() => { browser.kill(); resolve(); }, 3000); } });
  const resolvedProfile = path.resolve(profile);
  if (resolvedProfile.startsWith(path.resolve(cache) + path.sep) && path.basename(resolvedProfile).startsWith('astra-render-profile-')) {
    try { fs.rmSync(resolvedProfile, { recursive: true, force: true }); } catch { /* Chromium may retain a temporary lock; preserve cache for later cleanup. */ }
  }
}
