import assert from 'node:assert/strict';
import { access, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { listPackage, extractFile } from '@electron/asar';

const directory = path.resolve(process.argv[2] ?? 'release/win-unpacked');
const resources = path.join(directory, 'resources');
const archive = path.join(resources, 'app.asar');
const entries = listPackage(archive).map(file => file.replaceAll('\\', '/'));
const has = file => entries.includes('/' + file);
for (const file of ['package.json', 'electron/main.cjs', 'electron/progress.cjs', 'dist/index.html', 'dist/preload.cjs', 'dist/models/granny.glb', 'dist/audio/horror-gamelan.ogg']) {
  assert.ok(has(file), `Missing packaged file: ${file}`);
}
for (const file of entries) {
  assert.ok(!/(?:^|\/)\.env(?:[./]|$)|\/(?:\.git|\.codex[^/]*|\.agents|\.playtest)(?:\/|$)/.test(file), `Private/development file in package: ${file}`);
  assert.ok(!file.includes('/@smartspectra/node-sdk-'), `Native platform payload belongs outside ASAR: ${file}`);
}
assert.ok(!entries.some(file => /^\/(?:src|art|test|docs)\//.test(file)), 'Source/test/reference files must not ship.');
const manifest = JSON.parse(extractFile(archive, 'package.json').toString());
assert.equal(manifest.main, 'electron/main.cjs');
if (process.env.RELEASE_VERSION) assert.equal(manifest.version, process.env.RELEASE_VERSION);
await access(path.join(directory, 'Granny is Watching.exe'));
await access(path.join(resources, 'app.asar.unpacked/node_modules/koffi/build/koffi/win32_x64/koffi.node'));
const native = path.join(resources, 'node_modules/@smartspectra/node-sdk-win32-x64');
for (const file of ['smartspectra_capi.dll', 'smartspectra.dll', 'opencv_world4100.dll', 'vulkan-1.dll', 'LICENSE', 'smartspectra_manifest.json']) {
  assert.ok((await stat(path.join(native, file))).size > 0, `Missing native runtime dependency: ${file}`);
}
assert.ok((await readdir(native)).every(file => !/\.(?:so|dylib)$/.test(file)), 'Windows packages must not include other platform runtimes.');
console.log(`Verified Windows package ${manifest.version}: game assets, sandboxed preload, native DLLs, and secret-file exclusions.`);
