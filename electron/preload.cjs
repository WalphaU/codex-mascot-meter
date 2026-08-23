const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('codexMeter', {
  getSnapshot: () => ipcRenderer.invoke('meter:get-snapshot'),
  onSnapshot: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('meter:snapshot', listener);
    return () => ipcRenderer.removeListener('meter:snapshot', listener);
  },
  minimize: () => ipcRenderer.send('window:minimize'),
  close: () => ipcRenderer.send('window:close'),
  setMode: (mode) => ipcRenderer.send('window:set-mode', mode)
});
