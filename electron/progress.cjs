const fs = require('node:fs/promises');
const path = require('node:path');

function registerProgressIpc({ app, ipcMain, isTrusted }) {
  const file = path.join(app.getPath('userData'), 'progress.json');
  let writes = Promise.resolve();
  ipcMain.handle('granny:load-progress', async (event) => {
    if (!isTrusted(event)) throw new Error('Unavailable outside the game window.');
    await writes.catch(() => {});
    try {
      if ((await fs.stat(file)).size > 8192) return { data: null, error: true };
      return { data: await fs.readFile(file, 'utf8') };
    }
    catch (error) { return error.code === 'ENOENT' ? { data: null } : { data: null, error: true }; }
  });
  ipcMain.handle('granny:save-progress', async (event, json) => {
    if (!isTrusted(event)) throw new Error('Unavailable outside the game window.');
    if (typeof json !== 'string' || Buffer.byteLength(json, 'utf8') > 8192) throw new Error('Invalid progress data.');
    const data = JSON.parse(json);
    if (!data || data.version !== 1 || !data.settings || typeof data.settings !== 'object' || Array.isArray(data.settings)) throw new Error('Invalid progress data.');
    const operation = writes.catch(() => {}).then(async () => {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file + '.tmp', json, { encoding: 'utf8', mode: 0o600 });
      await fs.rename(file + '.tmp', file);
    });
    writes = operation;
    try { await operation; return { ok: true }; }
    catch { return { ok: false }; }
  });
  return { flush: () => writes.catch(() => {}) };
}

module.exports = { registerProgressIpc };
