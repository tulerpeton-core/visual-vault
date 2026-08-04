const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('visualVault', {
  listImages: () => ipcRenderer.invoke('images:list'),
  listTags: () => ipcRenderer.invoke('tags:list'),
  createTag: (payload) => ipcRenderer.invoke('tags:create', payload),
  updateTag: (payload) => ipcRenderer.invoke('tags:update', payload),
  deleteTag: (id) => ipcRenderer.invoke('tags:delete', id),
  storageInfo: () => ipcRenderer.invoke('storage:info'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSetting: (key, value) =>
    ipcRenderer.invoke('settings:set', { key, value }),
  setShortcut: (shortcut) => ipcRenderer.invoke('shortcut:set', shortcut),
  createBackup: () => ipcRenderer.invoke('backup:create'),
  restoreBackup: () => ipcRenderer.invoke('backup:restore'),
  verifyDatabase: () => ipcRenderer.invoke('database:verify'),
  exportSettings: () => ipcRenderer.invoke('settings:export'),
  importSettings: () => ipcRenderer.invoke('settings:import'),
  addImage: (payload) => ipcRenderer.invoke('image:add', payload),
  pickImages: () => ipcRenderer.invoke('image:pick'),
  clipboardImage: () => ipcRenderer.invoke('capture:clipboard'),
  screenImage: () => ipcRenderer.invoke('capture:screen'),
  captureSources: () => ipcRenderer.invoke('capture:sources'),
  systemLocale: () => ipcRenderer.invoke('app:locale'),
  captureSource: (sourceId) => ipcRenderer.invoke('capture:source', sourceId),
  toggleFavorite: (id) => ipcRenderer.invoke('image:favorite', id),
  renameImage: (id, name) => ipcRenderer.invoke('image:rename', { id, name }),
  updateTags: (id, tagIds) => ipcRenderer.invoke('image:tags', { id, tagIds }),
  setTrash: (id, trash) => ipcRenderer.invoke('image:trash', { id, trash }),
  deleteImage: (id) => ipcRenderer.invoke('image:delete', id),
  copyImage: (id) => ipcRenderer.invoke('image:copy', id),
  openImage: (id) => ipcRenderer.invoke('image:open', id),
  revealImage: (id) => ipcRenderer.invoke('image:reveal', id),
  pinImage: (id) => ipcRenderer.invoke('image:pin', id),
  locateImage: (id) => ipcRenderer.invoke('image:locate', id),
  openStorage: () => ipcRenderer.invoke('storage:open'),
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('window:toggle-maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  setTitlebarTheme: (dark) =>
    ipcRenderer.invoke('window:titlebar-theme', dark),
  onWindowMaximized: (callback) => {
    const listener = (_event, maximized) => callback(maximized);
    ipcRenderer.on('window:maximized', listener);
    return () => ipcRenderer.removeListener('window:maximized', listener);
  },
  onOpenCapture: (callback) => {
    const listener = (_event, dataUrl) => callback(dataUrl);
    ipcRenderer.on('capture:open', listener);
    return () => ipcRenderer.removeListener('capture:open', listener);
  },
  onPinState: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('image:pin-state', listener);
    return () => ipcRenderer.removeListener('image:pin-state', listener);
  },
  onVaultChanged: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('vault:changed', listener);
    return () => ipcRenderer.removeListener('vault:changed', listener);
  },
  onVaultError: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('vault:error', listener);
    return () => ipcRenderer.removeListener('vault:error', listener);
  },
});
