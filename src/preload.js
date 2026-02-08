// Preload script for secure context isolation
// This script runs before the renderer process loads
// Use this to expose safe APIs to the renderer process
// Note: Preload scripts must use CommonJS for Electron's sandbox

const { contextBridge, ipcRenderer } = require('electron');

// Expose IPC API to renderer for Ink compilation
contextBridge.exposeInMainWorld('api', {
  // Listen for compile results from main process
  onCompileResult: (callback) => {
    ipcRenderer.on('ink-compile-result', (event, result) => {
      callback(result);
    });
  }
});
