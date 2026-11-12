const { app, BrowserWindow } = require('electron');
const path = require('node:path');

function openGame() {
  const window = new BrowserWindow({
    title: 'Granny is Watching',
    width: 1280,
    height: 800,
    minWidth: 640,
    minHeight: 480,
    backgroundColor: '#110e0d',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.loadFile(path.join(__dirname, '../dist/index.html'));
}

app.whenReady().then(() => {
  openGame();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) openGame();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
