import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const directory = path.resolve('release');
const files = (await readdir(directory)).filter(file => /^Granny-is-Watching-.*-win-x64(?:-setup)?\.(exe|zip)$/.test(file)).sort();
if (files.length !== 2 || !files.some(file => file.endsWith('-setup.exe')) || !files.some(file => file.endsWith('.zip'))) {
  throw new Error('Expected exactly one Windows x64 installer and one ZIP. Use a clean release output directory.');
}
const lines = [];
for (const file of files) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path.join(directory, file))) hash.update(chunk);
  lines.push(`${hash.digest('hex')}  ${file}`);
}
await writeFile(path.join(directory, 'SHA256SUMS.txt'), lines.join('\n') + '\n');
console.log('Wrote SHA256SUMS.txt for the installer and ZIP.');
