import { appendFile } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import semver from 'semver';

export function releaseVersion(tag) {
  if (typeof tag !== 'string' || !tag.startsWith('v')) throw new Error('Use a release tag such as v0.1.0-alpha.1.');
  const version = tag.slice(1);
  if (semver.valid(version) !== version || version.includes('+')) {
    throw new Error('Release tags must be vMAJOR.MINOR.PATCH with an optional prerelease, such as v0.1.0-alpha.1.');
  }
  return version;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const tag = process.env.RELEASE_TAG;
  const version = releaseVersion(tag);
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const existing = spawnSync('git', ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}^{commit}`], { encoding: 'utf8' });
  if (existing.status === 0 && existing.stdout.trim() !== commit) {
    throw new Error(`${tag} already points at another commit. Choose a new version or build that tag.`);
  }
  const output = `tag=${tag}\nversion=${version}\ncommit=${commit}\nprerelease=${Boolean(semver.prerelease(version))}\n`;
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, output);
  if (process.env.GITHUB_ENV) await appendFile(process.env.GITHUB_ENV, `RELEASE_VERSION=${version}\n`);
  console.log(`Preparing ${tag} from ${commit}.`);
}
