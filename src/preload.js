// Preload script for secure context isolation
// This script runs before the renderer process loads
// Use this to expose safe APIs to the renderer process

const { contextBridge } = require('electron');

// Example: Expose a safe API to the renderer
// contextBridge.exposeInMainWorld('api', {
//   // Add your safe API methods here
// });
