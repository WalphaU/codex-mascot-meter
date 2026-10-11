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
  setMode: (mode) => ipcRenderer.send('window:set-mode', mode),
  petTeleport: () => ipcRenderer.invoke('window:pet-teleport'),
  petDragStart: (payload) => ipcRenderer.send('window:pet-drag-start', payload),
  petDragMove: (payload) => ipcRenderer.send('window:pet-drag-move', payload),
  petDragEnd: (payload) => ipcRenderer.send('window:pet-drag-end', payload),
  onPetDragStopped: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('window:pet-drag-stopped', listener);
    return () => ipcRenderer.removeListener('window:pet-drag-stopped', listener);
  }
});
