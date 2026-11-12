const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');

const gameFile = path.join(__dirname, '../dist/index.html');
const gameUrl = pathToFileURL(gameFile).href;
let environmentError = false;
const localEnv = path.join(__dirname, '../.env.local');
if (fs.existsSync(localEnv)) {
  try { process.loadEnvFile(localEnv); }
  catch { environmentError = true; }
}

let bindSmartSpectraIpc;
let nativeAvailable = false;

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
  if (bindSmartSpectraIpc) {
    try {
      bindSmartSpectraIpc(window, { logger: () => {} });
      nativeAvailable = true;
    } catch { nativeAvailable = false; }
  }
  window.loadFile(gameFile);
}

app.whenReady().then(() => {
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
