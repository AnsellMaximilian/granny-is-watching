const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');
const { registerProgressIpc } = require('./progress.cjs');
const { registerSpectraDiagnosticsIpc } = require('./spectra-diagnostics.cjs');
const packageInfo = require('../package.json');

const gameFile = path.join(__dirname, '../dist/index.html');
const gameUrl = pathToFileURL(gameFile).href;
let environmentError = false;
const localEnv = path.join(__dirname, '../.env.local');
if (!app.isPackaged && fs.existsSync(localEnv)) {
  try { process.loadEnvFile(localEnv); }
  catch { environmentError = true; }
}

if (app.isPackaged) {
  // The packaged native module lives in resources/node_modules, outside ASAR.
  // Keep the SDK's scoped DLL loader instead of a developer path override.
  delete process.env.SMARTSPECTRA_CAPI_PATH;
  // Keep the same local saves through installer upgrades and ZIP releases.
  // Explicit isolated profiles remain available to the packaged smoke test.
  if (!app.commandLine.hasSwitch('user-data-dir')) {
    app.setPath('userData', path.join(app.getPath('appData'), 'granny-is-watching'));
  }
}

let bindSmartSpectraIpc;
let nativeAvailable = false;
let diagnostics;

function isGamePage(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.href === gameUrl;
  } catch { return false; }
}

function openGame() {
  const window = new BrowserWindow({
    title: 'Granny is Watching',
    width: 1280,
    height: 800,
    minWidth: 640,
    minHeight: 480,
    backgroundColor: '#110e0d',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../dist/preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (!isGamePage(url)) event.preventDefault();
  });
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.webContents.on('did-finish-load', () => diagnostics?.write({ event: 'renderer_loaded' }));
  if (bindSmartSpectraIpc) {
    try {
      bindSmartSpectraIpc(window, { logger: () => {} });
      nativeAvailable = true;
    } catch { nativeAvailable = false; }
  }
  window.loadFile(gameFile);
}

app.whenReady().then(() => {
  const isTrusted = event => Boolean(event.senderFrame && event.senderFrame === event.sender.mainFrame && isGamePage(event.senderFrame.url));
  const progress = registerProgressIpc({ app, ipcMain, isTrusted });
  diagnostics = registerSpectraDiagnosticsIpc({
    ipcMain, isTrusted,
    file: app.isPackaged
      ? path.join(app.getPath('userData'), 'logs/smartspectra-diagnostics.jsonl')
      : path.join(__dirname, '../.playtest/smartspectra-diagnostics.jsonl'),
    metadata: {
      appVersion: app.getVersion(), sdkVersion: packageInfo.dependencies['@smartspectra/node-sdk'],
      electronVersion: process.versions.electron, chromiumVersion: process.versions.chrome,
      platform: process.platform, packaged: app.isPackaged,
    },
  });
  let quitting = false;
  app.on('before-quit', (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    void Promise.all([progress.flush(), diagnostics.flush()]).finally(() => app.quit());
  });
  // A missing or unsupported native runtime must not prevent the game opening.
  try { ({ bindSmartSpectraIpc } = require('@smartspectra/node-sdk/main')); }
  catch { bindSmartSpectraIpc = null; }

  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(Boolean(
      contents && isGamePage(contents.getURL()) && isGamePage(details.requestingUrl)
      && details.isMainFrame && permission === 'media'
      && details.mediaTypes?.length && details.mediaTypes.every((type) => type === 'video')
    ));
  });
  session.defaultSession.setPermissionCheckHandler((contents, permission, _origin, details) => Boolean(
    contents && isGamePage(contents.getURL()) && isGamePage(details.requestingUrl)
    && details.isMainFrame && permission === 'media' && details.mediaType === 'video'
  ));
  ipcMain.handle('granny:spectra-config', (event) => {
    if (event.senderFrame !== event.sender.mainFrame || !isGamePage(event.senderFrame.url)) {
      throw new Error('Unavailable outside the game window.');
    }
    return {
      nativeAvailable,
      packaged: app.isPackaged,
      // Delivered only to this isolated local renderer, never baked into Vite output.
      apiKey: process.env.SMARTSPECTRA_API_KEY?.trim() || '',
      environmentError,
    };
  });
  openGame();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) openGame();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
