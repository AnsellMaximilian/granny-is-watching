import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const publisher = fileURLToPath(new URL('../scripts/publish-release.mjs', import.meta.url));
const commit = '1'.repeat(40);
const tag = 'v0.1.0-alpha.1';
const installer = 'Granny-is-Watching-0.1.0-alpha.1-win-x64-setup.exe';
const zip = 'Granny-is-Watching-0.1.0-alpha.1-win-x64.zip';

async function fixture(t, mode) {
  const prefix = path.join(path.resolve(os.tmpdir()), 'granny-release-test-');
  const directory = await mkdtemp(prefix);
  t.after(async () => {
    assert.ok(path.resolve(directory).startsWith(prefix), 'Only remove this test\'s temporary directory.');
    await rm(directory, { recursive: true, force: true });
  });
  await mkdir(path.join(directory, 'release'));
  await mkdir(path.join(directory, 'docs'));
  await writeFile(path.join(directory, 'docs/release-notes.md'), 'Preview instructions.');
  for (const file of [installer, zip, 'SHA256SUMS.txt']) await writeFile(path.join(directory, 'release', file), 'fixture artifact');
  const bootstrap = path.join(directory, 'github-fixture.mjs');
  await writeFile(bootstrap, `
import { writeFileSync } from 'node:fs';
const mode = process.env.RELEASE_FIXTURE_MODE;
const calls = [];
const commit = '${commit}';
const draft = { id: 10, tag_name: mode === 'placeholder' ? 'untagged-fixture' : '${tag}', name: 'Granny is Watching ${tag}', target_commitish: commit, draft: true, body: 'Existing notes.', html_url: 'https://github.com/example/game/releases/tag/${tag}', assets: [{id: 7, name: '${installer}'}] };
const json = (data, status = 200) => new Response(JSON.stringify(data), {status});
globalThis.fetch = async (url, options = {}) => {
  const parsed = new URL(url);
  if (!['api.github.com', 'uploads.github.com'].includes(parsed.hostname)) throw Error('Unexpected host');
  const method = options.method ?? 'GET';
  const body = typeof options.body === 'string' ? JSON.parse(options.body) : undefined;
  calls.push({ route: parsed.pathname + parsed.search, method, body });
  writeFileSync('requests.json', JSON.stringify(calls));
  options.body?.destroy?.();
  if (parsed.hostname === 'uploads.github.com') return json({id: 99}, mode === 'upload-error' ? 500 : 201);
  if (method === 'DELETE') return new Response(null, {status: 204});
  if (parsed.pathname.includes('/git/ref/tags/')) {
    if (mode === 'new' || mode === 'upload-error' || mode === 'draft-mismatch') return json({}, 404);
    return json({object: {type: 'commit', sha: mode === 'tag-mismatch' ? '2'.repeat(40) : commit}});
  }
  if (parsed.pathname.endsWith('/git/refs') && method === 'POST') return json({ref: body.ref}, 201);
  if (parsed.pathname.includes('/releases/tags/')) return mode === 'published' ? json({...draft, draft: false}) : json({}, 404);
  if (parsed.pathname.endsWith('/releases') && method === 'GET') {
    if (mode === 'new' || mode === 'upload-error') return json([]);
    if (mode === 'draft-mismatch') return json([{...draft, target_commitish: '2'.repeat(40)}]);
    if (mode === 'retry' && parsed.searchParams.get('page') === '1') return json(Array.from({length:100},(_,i)=>({...draft,tag_name:'v9.0.'+i})));
    return json([draft]);
  }
  if (parsed.pathname.endsWith('/releases') && method === 'POST') return json({...draft, assets: []}, 201);
  if (parsed.pathname.endsWith('/releases/10') && method === 'PATCH') return json({...draft, tag_name: body.tag_name ?? 'untagged-fixture', body: body.body, assets: mode === 'new' || mode === 'upload-error' ? [] : draft.assets});
  throw Error('Unexpected request: ' + method + ' ' + url);
};
`);
  const result = spawnSync(process.execPath, ['--import', pathToFileURL(bootstrap).href, publisher], {
    cwd: directory, encoding: 'utf8', timeout: 10000,
    env: { ...process.env, GH_TOKEN: 'fixture-only-token', GITHUB_REPOSITORY: 'example/game', RELEASE_TAG: tag, RELEASE_COMMIT: commit, RELEASE_FIXTURE_MODE: mode },
  });
  const recorded = await readFile(path.join(directory, 'requests.json'), 'utf8').catch(() => { throw Error(result.stderr || String(result.error)); });
  const calls = JSON.parse(recorded);
  return { result, calls };
}

test('a new release creates a tag at the tested commit and uploads assets to a draft', async t => {
  const { result, calls } = await fixture(t, 'new');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(calls.find(call => call.route.endsWith('/git/refs')).body, { ref: 'refs/tags/' + tag, sha: commit });
  const created = calls.find(call => call.route.endsWith('/releases') && call.method === 'POST');
  assert.equal(created.body.draft, true);
  assert.equal(created.body.prerelease, true);
  assert.equal(created.body.target_commitish, commit);
  const update = calls.find(call => call.method === 'PATCH');
  assert.equal(update.body.tag_name, tag);
  assert.equal(update.body.target_commitish, commit);
  assert.equal(update.body.draft, true);
  assert.equal(calls.filter(call => call.route.includes('/releases/10/assets?')).length, 3);
});

test('a GitHub draft placeholder is found by its release title and repaired without duplication', async t => {
  const { result, calls } = await fixture(t, 'placeholder');
  assert.equal(result.status, 0, result.stderr);
  assert.ok(!calls.some(call => call.route.endsWith('/releases') && call.method === 'POST'));
  assert.equal(calls.find(call => call.method === 'PATCH').body.tag_name, tag);
  assert.equal(calls.filter(call => call.route.includes('/releases/10/assets?')).length, 3);
});

test('retry finds a paginated existing draft and replaces its assets without creating another release', async t => {
  const { result, calls } = await fixture(t, 'retry');
  assert.equal(result.status, 0, result.stderr);
  assert.ok(calls.some(call => call.route.endsWith('page=2')));
  assert.ok(calls.some(call => call.method === 'DELETE' && call.route.endsWith('/assets/7')));
  assert.ok(!calls.some(call => call.route.endsWith('/releases') && call.method === 'POST'));
  assert.equal(calls.filter(call => call.route.includes('/releases/10/assets?')).length, 3);
});

for (const mode of ['published', 'tag-mismatch', 'draft-mismatch']) {
  test(`${mode} fails before changing any remote tags, release or assets`, async t => {
    const { result, calls } = await fixture(t, mode);
    assert.notEqual(result.status, 0);
    assert.ok(calls.every(call => call.method === 'GET'));
  });
}

test('an interrupted asset upload fails clearly so the workflow can retry its draft', async t => {
  const { result } = await fixture(t, 'upload-error');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Re-run the workflow to finish the draft/);
});
