import assert from 'node:assert/strict';
import { createReadStream } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { releaseVersion } from './prepare-release.mjs';

const tag = process.env.RELEASE_TAG;
const version = releaseVersion(tag);
const title = 'Granny is Watching ' + tag;
const commit = process.env.RELEASE_COMMIT;
assert.match(commit ?? '', /^[a-f0-9]{40}$/);
const repository = process.env.GITHUB_REPOSITORY;
assert.match(repository ?? '', /^[\w.-]+\/[\w.-]+$/);
assert.ok(process.env.GH_TOKEN, 'The release job requires its automatic GITHUB_TOKEN.');
const headers = {
  Authorization: 'Bearer ' + process.env.GH_TOKEN,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
};
async function api(route, options = {}, allowMissing = false) {
  const response = await fetch('https://api.github.com' + route, {
    ...options, headers: { ...headers, ...options.headers }, signal: AbortSignal.timeout(30000),
  });
  if (allowMissing && response.status === 404) return null;
  if (!response.ok) throw Error(`GitHub release request failed (${response.status}): ${route}`);
  return response.status === 204 ? null : response.json();
}
const directory = path.resolve('release');
const assets = [
  `Granny-is-Watching-${version}-win-x64-setup.exe`,
  `Granny-is-Watching-${version}-win-x64.zip`, 'SHA256SUMS.txt',
];
for (const file of assets) assert.ok((await stat(path.join(directory, file))).size > 0, 'Missing release asset: ' + file);
assert.equal((await readdir(directory)).filter(file => /\.(?:exe|zip)$/.test(file)).length, 2);

// A manual run may create a new tag. An existing tag must identify precisely
// the commit tested by the build job, including when the tag is annotated.
let reference = await api(`/repos/${repository}/git/ref/tags/${encodeURIComponent(tag)}`, {}, true);
if (reference) {
  let object = reference.object;
  for (let depth = 0; object.type === 'tag' && depth < 8; depth++) object = (await api(`/repos/${repository}/git/tags/${object.sha}`)).object;
  assert.equal(object.type, 'commit');
  assert.equal(object.sha, commit, 'The release tag points at a different commit.');
}
let release = await api(`/repos/${repository}/releases/tags/${encodeURIComponent(tag)}`, {}, true);
// The tag endpoint is for published releases. Authenticated listing includes
// drafts, which must be reused when a failed upload is retried.
if (!release) {
  for (let page = 1; ; page++) {
    const releases = await api(`/repos/${repository}/releases?per_page=100&page=${page}`);
    release = releases.find(candidate => candidate.tag_name === tag
      || (candidate.draft && candidate.tag_name?.startsWith('untagged-') && candidate.name === title));
    if (release || releases.length < 100) break;
  }
}
if (release) {
  assert.equal(release.draft, true, 'Published release assets are immutable here. Use a new version.');
  if (!reference || release.tag_name !== tag) assert.equal(release.target_commitish, commit, 'The draft targets a different commit.');
}
if (!reference) {
  await api(`/repos/${repository}/git/refs`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: 'refs/tags/' + tag, sha: commit }),
  });
}
if (!release) {
  release = await api(`/repos/${repository}/releases`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tag_name: tag, target_commitish: commit, name: title,
      draft: true, prerelease: version.includes('-'), generate_release_notes: true,
    }),
  });
}
const notes = await readFile('docs/release-notes.md', 'utf8');
const hasInstructions = release.body?.includes(notes.trim());
if (!hasInstructions || release.tag_name !== tag) {
  release = await api(`/repos/${repository}/releases/${release.id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    // Keep draft identity explicit: GitHub can otherwise assign an untagged
    // placeholder when updating a draft's body through the release endpoint.
    body: JSON.stringify({
      tag_name: tag, target_commitish: commit, name: title,
      draft: true, prerelease: version.includes('-'),
      body: hasInstructions ? release.body : notes + '\n\n' + (release.body ?? ''),
    }),
  });
}
for (const file of assets) {
  const old = release.assets?.find(asset => asset.name === file);
  if (old) await api(`/repos/${repository}/releases/assets/${old.id}`, { method: 'DELETE' });
  const response = await fetch(`https://uploads.github.com/repos/${repository}/releases/${release.id}/assets?name=${encodeURIComponent(file)}`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/octet-stream', 'Content-Length': String((await stat(path.join(directory, file))).size) },
    body: createReadStream(path.join(directory, file)), duplex: 'half', signal: AbortSignal.timeout(600000),
  });
  if (!response.ok) throw Error(`Uploading ${file} failed (${response.status}). Re-run the workflow to finish the draft.`);
  console.log('Uploaded ' + file);
}
console.log('Draft release ready: ' + release.html_url);
