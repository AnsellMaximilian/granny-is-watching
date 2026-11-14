import test from 'node:test';
import assert from 'node:assert/strict';
import { releaseVersion } from '../scripts/prepare-release.mjs';

test('release tags identify the exact stable or prerelease version of download assets', () => {
  assert.equal(releaseVersion('v0.1.0'), '0.1.0');
  assert.equal(releaseVersion('v0.1.0-alpha.1'), '0.1.0-alpha.1');
  assert.equal(releaseVersion('v2.12.3-rc.4'), '2.12.3-rc.4');
});

test('release input rejects ambiguous versions, branch names and shell or output-file injection', () => {
  for (const tag of [undefined, '', 'main', '0.1.0', 'v01.1.0', 'v1.2', 'v1.2.3.4', 'v1.2.3-alpha.01', 'v1.2.3+other', 'v1.2.3\nversion=9.0.0', 'v1.2.3;echo secret', 'v1.2.3$(whoami)', 'v1.2.3/../main']) {
    assert.throws(() => releaseVersion(tag), { message: /release tag|Release tags/ });
  }
});
