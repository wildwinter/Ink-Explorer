import { app, BrowserWindow, Menu, ipcMain, dialog, MenuItemConstructorOptions, nativeTheme } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { compileInk } from './ink/compiler.js';
import { RecentFilesManager } from './utils/recentFiles.js';
import {
  readPref, writePref, loadWindowBounds, loadFileState, saveFileState,
  loadThemeSetting, type ThemeSetting, type FileState
} from './utils/preferences.js';
import pkg from '../package.json'

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null;

// Recent files management
const recentFilesPath = path.join(app.getPath('userData'), 'recent-files.json');
const recentFilesManager = new RecentFilesManager(recentFilesPath);

let boundsTimeout: ReturnType<typeof setTimeout> | null = null;

// Source file change detection
let currentInkFilePath: string | null = null;
let sourceFileMtimes: Map<string, number> = new Map();
let isRecompiling = false;

// Theme management
let currentThemeSetting: ThemeSetting = 'system';

function saveWindowBounds(): void {
  if (!mainWindow) return;
  if (boundsTimeout) clearTimeout(boundsTimeout);
  boundsTimeout = setTimeout(() => {
    if (!mainWindow) return;
    writePref('windowBounds', JSON.stringify(mainWindow.getBounds()));
  }, 500);
}

function getEffectiveTheme(): 'light' | 'dark' {
  if (currentThemeSetting === 'system') {
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  }
  return currentThemeSetting;
}

function applyTheme(): void {
  if (!mainWindow) return;
  nativeTheme.themeSource = currentThemeSetting;
  mainWindow.webContents.send('theme-changed', getEffectiveTheme());
}

function setTheme(setting: ThemeSetting): void {
  currentThemeSetting = setting;
  writePref('theme', setting);
  applyTheme();
  createMenu();
}

/**
 * Snapshots the mtimes of all source files for later change detection.
 */
function storeSourceFileMtimes(filePaths: string[]): void {
  sourceFileMtimes.clear();
  for (const fp of filePaths) {
    try {
      const stat = fs.statSync(fp);
      sourceFileMtimes.set(fp, stat.mtimeMs);
    } catch { /* file may have been deleted */ }
  }
}

/**
 * Checks whether any tracked source file has been modified since compilation.
 */
function checkSourceFilesChanged(): boolean {
  for (const [fp, savedMtime] of sourceFileMtimes) {
    try {
      const stat = fs.statSync(fp);
      if (stat.mtimeMs !== savedMtime) return true;
    } catch {
      return true;
    }
  }
  return false;
}

async function compileAndLogInk(inkFilePath: string): Promise<void> {
  const result = await compileInk(inkFilePath);

  currentInkFilePath = inkFilePath;
  if (result.sourceFilePaths) {
    storeSourceFileMtimes(result.sourceFilePaths);
  }

  if (mainWindow) {
    const serializable = {
      ...result,
      sourceFiles: result.sourceFiles
        ? Object.fromEntries(result.sourceFiles)
        : undefined,
      filePath: inkFilePath,
      savedFileState: loadFileState(inkFilePath)
    };
    mainWindow.webContents.send('ink-compile-result', serializable);
  }

  if (result.success) {
    recentFilesManager.add(inkFilePath);
    createMenu();
  } else {
    const fileName = path.basename(inkFilePath);
    const errorMessage = result.errors?.join('\n\n') || 'Unknown error';

    await dialog.showMessageBox(mainWindow!, {
      type: 'error',
      title: 'Ink Compilation Failed',
      message: `Failed to compile ${fileName}`,
      detail: errorMessage,
      buttons: ['OK']
    });
  }
}

async function loadInkFile(): Promise<void> {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: 'Load Ink File',
    filters: [
      { name: 'Ink Files', extensions: ['ink'] },
      { name: 'All Files', extensions: ['*'] }
    ],
    properties: ['openFile']
  });

  if (!result.canceled && result.filePaths.length > 0) {
    const inkFilePath = result.filePaths[0];
    await compileAndLogInk(inkFilePath);
  }
}

// IPC handlers
ipcMain.handle('compile-ink', async (_event, inkFilePath: string) => {
  return await compileInk(inkFilePath);
});

ipcMain.on('save-file-state', (_event, filePath: string, state: FileState) => {
  saveFileState(filePath, state);
});

ipcMain.on('save-pref', (_event, key: string, value: string) => {
  writePref(key, value);
});
ipcMain.handle('load-pref', (_event, key: string) => {
  return readPref(key);
});

ipcMain.handle('list-ink-states', (_event, inkFilePath: string) => {
  const dir = path.dirname(inkFilePath);
  try {
    const files = fs.readdirSync(dir);
    return files
      .filter(f => f.endsWith('.inkstate'))
      .map(f => f.slice(0, -'.inkstate'.length));
  } catch {
    return [];
  }
});

ipcMain.handle('save-ink-state', (_event, inkFilePath: string, stateName: string, stateJson: string) => {
  const dir = path.dirname(inkFilePath);
  const filePath = path.join(dir, `${stateName}.inkstate`);
  fs.writeFileSync(filePath, stateJson, 'utf8');
});

ipcMain.handle('load-ink-state', (_event, inkFilePath: string, stateName: string) => {
  const dir = path.dirname(inkFilePath);
  const filePath = path.join(dir, `${stateName}.inkstate`);
  return fs.readFileSync(filePath, 'utf8');
});

ipcMain.handle('delete-ink-state', (_event, inkFilePath: string, stateName: string) => {
  const dir = path.dirname(inkFilePath);
  const filePath = path.join(dir, `${stateName}.inkstate`);
  fs.unlinkSync(filePath);
});

// Check if we're in development mode
const isDev = !app.isPackaged;
const VITE_DEV_SERVER_URL = 'http://localhost:5173';

function createWindow(): void {
  const preloadPath = isDev
    ? path.join(process.cwd(), 'dist-electron', 'preload.js')
    : path.join(__dirname, 'preload.js');

  console.log('CWD:', process.cwd());
  console.log('__dirname:', __dirname);
  console.log('Preload path:', preloadPath);
  console.log('Preload exists:', fs.existsSync(preloadPath));

  const savedBounds = loadWindowBounds();

  mainWindow = new BrowserWindow({
    width: savedBounds?.width ?? 800,
    height: savedBounds?.height ?? 600,
    x: savedBounds?.x,
    y: savedBounds?.y,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    }
  });

  mainWindow.on('resize', saveWindowBounds);
  mainWindow.on('move', saveWindowBounds);

  // Auto-reload when source files change on focus
  mainWindow.on('focus', () => {
    if (!currentInkFilePath || isRecompiling) return;
    if (sourceFileMtimes.size === 0) return;
    if (!checkSourceFilesChanged()) return;

    isRecompiling = true;
    mainWindow!.webContents.send('request-save-state');
    setTimeout(async () => {
      try {
        await compileAndLogInk(currentInkFilePath!);
      } finally {
        isRecompiling = false;
      }
    }, 50);
  });

  if (isDev) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createMenu(): void {
  const isMac = process.platform === 'darwin';

  const recentFiles = recentFilesManager.getAll();
  const recentFilesSubmenu: MenuItemConstructorOptions[] = recentFiles.length > 0
    ? [
      ...recentFiles.map((filePath, index) => ({
        label: `${path.basename(filePath)} — ${path.dirname(filePath)}`,
        accelerator: index < 9 ? `${isMac ? 'Cmd' : 'Ctrl'}+${index + 1}` : undefined,
        click: () => compileAndLogInk(filePath)
      })),
      { type: 'separator' as const },
      {
        label: 'Clear Recent Files',
        click: () => {
          recentFilesManager.clear();
          createMenu();
        }
      }
    ]
    : [
      {
        label: 'No Recent Files',
        enabled: false
      }
    ];

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' as const },
        { type: 'separator' as const },
        { role: 'services' as const },
        { type: 'separator' as const },
        { role: 'hide' as const },
        { role: 'hideOthers' as const },
        { role: 'unhide' as const },
        { type: 'separator' as const },
        {
          label: 'Quit',
          accelerator: 'Command+Q',
          click: () => app.quit()
        }
      ]
    }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Load Ink...',
          accelerator: isMac ? 'Cmd+O' : 'Ctrl+O',
          click: () => loadInkFile()
        },
        { type: 'separator' as const },
        {
          label: 'Recent Files',
          submenu: recentFilesSubmenu
        },
        ...(isMac ? [] : [
          { type: 'separator' as const },
          {
            label: 'Quit',
            accelerator: 'Alt+F4',
            click: () => app.quit()
          }
        ])
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' as const },
        { role: 'redo' as const },
        { type: 'separator' as const },
        { role: 'cut' as const },
        { role: 'copy' as const },
        { role: 'paste' as const },
        ...(isMac ? [
          { role: 'pasteAndMatchStyle' as const },
          { role: 'delete' as const },
          { role: 'selectAll' as const }
        ] : [
          { role: 'delete' as const },
          { type: 'separator' as const },
          { role: 'selectAll' as const }
        ])
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle Code Pane',
          accelerator: isMac ? 'Cmd+Shift+C' : 'Ctrl+Shift+C',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('toggle-code-pane');
            }
          }
        },
        {
          label: 'Theme',
          submenu: [
            {
              label: 'System',
              type: 'radio' as const,
              checked: currentThemeSetting === 'system',
              click: () => setTheme('system')
            },
            {
              label: 'Light',
              type: 'radio' as const,
              checked: currentThemeSetting === 'light',
              click: () => setTheme('light')
            },
            {
              label: 'Dark',
              type: 'radio' as const,
              checked: currentThemeSetting === 'dark',
              click: () => setTheme('dark')
            }
          ]
        },
        { type: 'separator' as const },
        { role: 'reload' as const },
        { role: 'forceReload' as const },
        { role: 'toggleDevTools' as const },
        { type: 'separator' as const },
        { role: 'resetZoom' as const },
        { role: 'zoomIn' as const },
        { role: 'zoomOut' as const },
        { type: 'separator' as const },
        { role: 'togglefullscreen' as const }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' as const },
        { role: 'zoom' as const },
        ...(isMac ? [
          { type: 'separator' as const },
          { role: 'front' as const },
          { type: 'separator' as const },
          { role: 'window' as const }
        ] : [
          { role: 'close' as const }
        ])
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(() => {
  app.name = 'InkExplorer';

  app.setAboutPanelOptions({
    applicationName: 'Ink Explorer',
    applicationVersion: app.getVersion(),
    version: '',
    copyright: 'Copyright © 2026 Ian Thomas',
    credits: `Powered by inkjs v${(pkg as any).inkjsVersion}`
  });

  recentFilesManager.load();
  currentThemeSetting = loadThemeSetting();

  createMenu();
  createWindow();

  nativeTheme.on('updated', () => {
    if (currentThemeSetting === 'system') {
      applyTheme();
    }
  });

  mainWindow!.webContents.once('did-finish-load', () => {
    applyTheme();

    const mostRecentFile = recentFilesManager.getMostRecent();
    if (mostRecentFile && fs.existsSync(mostRecentFile)) {
      compileAndLogInk(mostRecentFile);
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  app.quit();
});
