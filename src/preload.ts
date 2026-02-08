// Preload script for secure context isolation
// This script runs before the renderer process loads
// Use this to expose safe APIs to the renderer process

import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

// Type definitions inline to avoid import issues in preload context
interface CompilationResult {
  success: boolean;
  errors?: string[];
  warnings: string[];
  storyInfo?: unknown;
  structure?: unknown;
}

console.log('Preload script is running');

// Expose IPC API to renderer for Ink compilation
contextBridge.exposeInMainWorld('api', {
  // Listen for compile results from main process
  onCompileResult: (callback: (result: CompilationResult) => void) => {
    ipcRenderer.on('ink-compile-result', (_event: IpcRendererEvent, result: CompilationResult) => {
      callback(result);
    });
  }
});

console.log('API exposed to main world');
