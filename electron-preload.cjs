/**
 * Electron Preload Script
 * Exposes safe IPC channels to the renderer process
 */

const { contextBridge, ipcRenderer } = require('electron');

try {
  const snap = ipcRenderer.sendSync('persist:snapshot');
  if (snap && typeof snap === 'object') {
    for (const key of Object.keys(snap)) {
      if (typeof snap[key] !== 'string') continue;
      if (localStorage.getItem(key) == null) {
        localStorage.setItem(key, snap[key]);
      }
    }
  }
} catch {
  /* first run / empty store */
}

contextBridge.exposeInMainWorld('electronAPI', {
  // Platform detection
  isElectron: true,
  getPlatform: () => ipcRenderer.invoke('app:platform'),
  getVersion: () => ipcRenderer.invoke('app:version'),

  persistSet: (key, value) => ipcRenderer.send('persist:set', key, value),
  persistRemove: (key) => ipcRenderer.send('persist:remove', key),
  persistAll: (obj) => ipcRenderer.send('persist:all', obj),

  youtubeOpen: (opts) => ipcRenderer.invoke('youtube:open', opts),
  youtubeBounds: (bounds) => ipcRenderer.send('youtube:bounds', bounds),
  youtubeSetVisible: (visible) => ipcRenderer.send('youtube:visible', visible),
  youtubeClose: () => ipcRenderer.send('youtube:close'),
  youtubeCommand: (cmd) => ipcRenderer.invoke('youtube:command', cmd),
  onYoutubeEnded: (cb) => {
    const listener = () => cb();
    ipcRenderer.on('youtube:ended', listener);
    return () => ipcRenderer.removeListener('youtube:ended', listener);
  },
  onYoutubeState: (cb) => {
    const listener = (_event, playing) => cb(!!playing);
    ipcRenderer.on('youtube:state', listener);
    return () => ipcRenderer.removeListener('youtube:state', listener);
  },

  // Printer operations
  printer: {
    list: () => ipcRenderer.invoke('printer:list'),
    print: (portPath, escPosHex) => ipcRenderer.invoke('printer:print', { portPath, escPosHex }),
    printAndOpenDrawer: (portPath, escPosHex, pulseHex) => 
      ipcRenderer.invoke('printer:printAndOpenDrawer', { portPath, escPosHex, pulseHex }),
  },

  // Cash drawer operations
  drawer: {
    open: (portPath, pulseHex) => ipcRenderer.invoke('drawer:open', { portPath, pulseHex }),
  },

  installUpdate: (url) => ipcRenderer.invoke('app:installUpdate', url),
});
