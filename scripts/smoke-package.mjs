import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';

assert.equal(process.platform, 'win32', 'The packaged smoke test currently targets Windows.');
const directory = path.resolve(process.argv[2] ?? 'release/win-unpacked');
const profile = path.resolve('release/smoke-profile-' + Date.now());
await mkdir(profile, { recursive: true });
const server = createServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
await new Promise(resolve => server.close(resolve));
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
delete environment.SMARTSPECTRA_API_KEY;
delete environment.SMARTSPECTRA_CAPI_PATH;
const run = spawn(path.join(directory, 'Granny is Watching.exe'), [
  '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=' + port,
  '--user-data-dir=' + profile, '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
], { env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
const exited = new Promise(resolve => { run.on('exit', resolve); run.on('error', () => resolve('launch-error')); });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let logs = '';
run.stdout.on('data', chunk => { logs += chunk; });
run.stderr.on('data', chunk => { logs += chunk; });
let ws;
const errors = [];
const pending = new Map();
try {
  let page;
  for (let i = 0; i < 300 && !page; i++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(500) });
      page = (await response.json()).find(tab => tab.type === 'page' && tab.url.includes('index.html'));
    } catch {}
    if (!page) await delay(100);
  }
  assert.ok(page, 'Packaged app did not open its game window. See packaged-smoke.log.');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  let sequence = 0;
  ws.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    const request = pending.get(message.id);
    if (request) {
      clearTimeout(request.timer);
      pending.delete(message.id);
      if (message.error) request.reject(Error(message.error.message));
      else request.resolve(message.result);
    }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(Error('Timed out: ' + method)); }, 10000);
    timer.unref();
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) throw Error(response.exceptionDetails.text);
    return response.result.value;
  };
  const until = async expression => {
    for (let i = 0; i < 300; i++) {
      if (await evaluate(expression)) return;
      await delay(100);
    }
    throw Error('Packaged UI did not become ready: ' + expression);
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await until('Boolean(document.querySelector("#wake:enabled"))');
  const config = await evaluate('window.grannySpectra.getConfig().then(c=>({packaged:c.packaged,nativeAvailable:c.nativeAvailable,hasKey:Boolean(c.apiKey)}))');
  assert.deepEqual(config, { packaged: true, nativeAvailable: true, hasKey: false }, 'The bundle must load its own native runtime without shipping an API key.');
  const nativeModule = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
    `(Get-Process -Id ${run.pid} -ErrorAction Stop).Modules | Where-Object ModuleName -eq 'smartspectra_capi.dll' | ForEach-Object FileName`,
  ], { encoding: 'utf8', timeout: 10000, windowsHide: true });
  assert.equal(nativeModule.status, 0, 'Could not inspect the loaded native DLL.');
  assert.equal(path.normalize(nativeModule.stdout.trim()).toLowerCase(), path.join(directory, 'resources/node_modules/@smartspectra/node-sdk-win32-x64/smartspectra_capi.dll').toLowerCase(), 'The EXE must load its bundled SDK, without falling back to the source checkout.');
  assert.equal(await evaluate('typeof window.require'), 'undefined');
  const progress = {
    version: 1, settings: { sound: false, facialHurdles: false, saveProgress: true, showCamera: true },
    checkpoint: { burned: [1, 8], escapePattern: [0, 2, 7, 9] },
  };
  assert.deepEqual(await evaluate('window.grannyProgress.save(JSON.stringify(' + JSON.stringify(progress) + '))'), { ok: true });
  await send('Page.reload', { ignoreCache: true });
  await until('Boolean(document.querySelector("#wake:enabled"))');
  assert.equal(await evaluate('document.querySelector("#continue-run").textContent'), 'Continue · Round 3');
  await evaluate('document.querySelector("#continue-run").click()');
  await until('document.querySelectorAll("#pit-layer button:enabled").length === 5');
  assert.equal(await evaluate('Array.from(document.querySelectorAll(".pit-count"),e=>e.textContent==="×"?0:Number(e.textContent)).reduce((a,b)=>a+b,0)'), 40);
  assert.equal(await evaluate('document.querySelector("#spectra-panel").dataset.sdk'), 'idle');
  assert.equal(await evaluate('document.querySelector("#spectra-video").srcObject'), null);
  await evaluate('document.querySelector("#rulebook-button").click()');
  await until('!document.querySelector("#book-reader").hidden && !document.querySelector("#book-close").disabled');
  await evaluate('document.querySelector("#book-close").click()');
  await until('!document.querySelector("#match").hidden');
  const screenshot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  await writeFile('release/packaged-smoke.png', Buffer.from(screenshot.data, 'base64'));
  assert.deepEqual(errors, [], 'The installed renderer must not throw during startup, continue or the rulebook.');
  progress.settings.showCamera = false;
  await evaluate('void window.grannyProgress.save(JSON.stringify(' + JSON.stringify(progress) + ')); true');
  void send('Browser.close').catch(() => {});
  assert.equal(await Promise.race([exited, delay(10000).then(() => 'timeout')]), 0, 'Packaged shutdown should flush saves and exit cleanly.');
  assert.deepEqual(JSON.parse(await readFile(path.join(profile, 'progress.json'), 'utf8')), progress);
  console.log('Packaged Windows app passed: native FFI load, no embedded key, isolated renderer, saved round, board assets, rulebook, and clean shutdown. No camera or SDK measurement session started.');
} finally {
  for (const request of pending.values()) clearTimeout(request.timer);
  ws?.close();
  run.kill();
  await writeFile('release/packaged-smoke.log', logs);
}
