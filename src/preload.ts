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
  },
  // Listen for code pane toggle from View menu
  onToggleCodePane: (callback: () => void) => {
    ipcRenderer.on('toggle-code-pane', () => {
      callback();
    });
  },
  // Save per-file state to main process
  saveFileState: (filePath: string, state: unknown) => {
    ipcRenderer.send('save-file-state', filePath, state);
  },
  // Listen for theme changes from main process
  onThemeChanged: (callback: (theme: 'light' | 'dark') => void) => {
    ipcRenderer.on('theme-changed', (_event: IpcRendererEvent, theme: 'light' | 'dark') => {
      callback(theme);
    });
  },
  // Listen for request to save state (before auto-reload)
  onRequestSaveState: (callback: () => void) => {
    ipcRenderer.on('request-save-state', () => {
      callback();
    });
  },
  // Save/load a simple preference
  savePref: (key: string, value: string) => {
    ipcRenderer.send('save-pref', key, value);
  },
  loadPref: (key: string): Promise<string | null> => {
    return ipcRenderer.invoke('load-pref', key);
  }
});

console.log('API exposed to main world');
