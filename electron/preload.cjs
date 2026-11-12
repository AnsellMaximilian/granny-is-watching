require('@smartspectra/node-sdk/preload');
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('grannySpectra', {
  getConfig: () => ipcRenderer.invoke('granny:spectra-config'),
});
