require('@smartspectra/node-sdk/preload');
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('grannySpectra', {
  getConfig: () => ipcRenderer.invoke('granny:spectra-config'),
  logDiagnostic: record => ipcRenderer.send('granny:spectra-diagnostic', record),
});
contextBridge.exposeInMainWorld('grannyProgress', {
  load: () => ipcRenderer.invoke('granny:load-progress'),
  save: (json) => ipcRenderer.invoke('granny:save-progress', json),
});
