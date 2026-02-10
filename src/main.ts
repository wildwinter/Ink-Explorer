import { app, BrowserWindow, Menu, ipcMain, dialog, MenuItemConstructorOptions, nativeTheme } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { execFileSync } from 'child_process';
import { compileInk } from './ink/compiler.js';
import { RecentFilesManager } from './utils/recentFiles.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null;

// Recent files management
const recentFilesPath = path.join(app.getPath('userData'), 'recent-files.json');
const recentFilesManager = new RecentFilesManager(recentFilesPath);

// Platform-native config storage
// macOS: NSUserDefaults (~/Library/Preferences/net.wildwinter.dinkexplorer.plist)
// Windows: Registry (HKCU\Software\DinkExplorer)
// Uses execFileSync to avoid shell escaping issues
const BUNDLE_ID = 'net.wildwinter.dinkexplorer';
const REG_KEY = 'HKCU\\Software\\DinkExplorer';
let boundsTimeout: ReturnType<typeof setTimeout> | null = null;

// Theme management
type ThemeSetting = 'light' | 'dark' | 'system';
let currentThemeSetting: ThemeSetting = 'system';

function readPref(key: string): string | null {
  try {
    if (process.platform === 'darwin') {
      return execFileSync('defaults', ['read', BUNDLE_ID, key], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    } else if (process.platform === 'win32') {
      const output = execFileSync('reg', ['query', REG_KEY, '/v', key], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
      const match = output.match(new RegExp(`${key}\\s+REG_SZ\\s+(.+)`));
      return match ? match[1].trim() : null;
    }
  } catch { /* key not found */ }
  return null;
}

function writePref(key: string, value: string): void {
  try {
    if (process.platform === 'darwin') {
      execFileSync('defaults', ['write', BUNDLE_ID, key, '-string', value], { stdio: 'pipe' });
    } else if (process.platform === 'win32') {
      execFileSync('reg', ['add', REG_KEY, '/v', key, '/t', 'REG_SZ', '/d', value, '/f'], { stdio: 'pipe' });
    }
  } catch { /* ignore */ }
}

// Window bounds persistence
function loadWindowBounds(): Electron.Rectangle | null {
  const raw = readPref('windowBounds');
  if (!raw) return null;
  try {
    const bounds = JSON.parse(raw);
    if (typeof bounds.x === 'number' && typeof bounds.y === 'number' &&
        typeof bounds.width === 'number' && typeof bounds.height === 'number') {
      return bounds;
    }
  } catch { /* invalid data */ }
  return null;
}

function saveWindowBounds(): void {
  if (!mainWindow) return;
  if (boundsTimeout) clearTimeout(boundsTimeout);
  boundsTimeout = setTimeout(() => {
    if (!mainWindow) return;
    writePref('windowBounds', JSON.stringify(mainWindow.getBounds()));
  }, 500);
}

// Per-file state persistence
interface FileState {
  codePaneOpen: boolean;
  graphTransform: { x: number; y: number; k: number } | null;
  selectedNodeId: string | null;
}

function loadAllFileStates(): Record<string, FileState> {
  const raw = readPref('fileStates');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch { return {}; }
}

function loadFileState(filePath: string): FileState | null {
  const all = loadAllFileStates();
  return all[filePath] || null;
}

function saveFileState(filePath: string, state: FileState): void {
  const all = loadAllFileStates();
  all[filePath] = state;
  writePref('fileStates', JSON.stringify(all));
}

function getEffectiveTheme(): 'light' | 'dark' {
  if (currentThemeSetting === 'system') {
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  }
  return currentThemeSetting;
}

function loadThemeSetting(): ThemeSetting {
  const saved = readPref('theme');
  if (saved === 'light' || saved === 'dark' || saved === 'system') {
    return saved;
  }
  return 'system';
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
  createMenu(); // rebuild to update radio check marks
}

// Function to compile Ink file and send results to renderer
async function compileAndLogInk(inkFilePath: string): Promise<void> {
  const result = await compileInk(inkFilePath);

  // Send result to renderer for logging
  // Convert sourceFiles Map to plain object for reliable IPC serialization
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

  // Add to recent files if compilation succeeded
  if (result.success) {
    recentFilesManager.add(inkFilePath);
    // Rebuild menu to show updated recent files
    createMenu();
  } else {
    // Show error dialog on compilation failure
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

// Function to show file picker and compile Ink
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

// IPC handler (kept for compatibility)
ipcMain.handle('compile-ink', async (_event, inkFilePath: string) => {
  return await compileInk(inkFilePath);
});

// IPC handler for saving per-file state
ipcMain.on('save-file-state', (_event, filePath: string, state: FileState) => {
  saveFileState(filePath, state);
});

// IPC handlers for simple preferences
ipcMain.on('save-pref', (_event, key: string, value: string) => {
  writePref(key, value);
});
ipcMain.handle('load-pref', (_event, key: string) => {
  return readPref(key);
});

// Check if we're in development mode
const isDev = !app.isPackaged;
const VITE_DEV_SERVER_URL = 'http://localhost:5173';

function createWindow(): void {
  // Resolve preload script path correctly for dev and production
  // In dev mode, use process.cwd() to get project root
  // In production, use __dirname which is the dist-electron directory
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
      sandbox: false // Disable sandbox to ensure preload works
    }
  });

  // Save window bounds on resize and move
  mainWindow.on('resize', saveWindowBounds);
  mainWindow.on('move', saveWindowBounds);

  // In development, load from Vite dev server; in production, load built files
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

  // Build Recent Files submenu
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
    // App menu (macOS only)
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
    // File menu
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
    // Edit menu
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
    // View menu
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
    // Window menu
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
  // Load recent files from disk
  recentFilesManager.load();

  // Load saved theme preference
  currentThemeSetting = loadThemeSetting();

  createMenu();
  createWindow();

  // React to OS theme changes (relevant when setting is 'system')
  nativeTheme.on('updated', () => {
    if (currentThemeSetting === 'system') {
      applyTheme();
    }
  });

  // Auto-load most recent file after window is ready
  mainWindow!.webContents.once('did-finish-load', () => {
    applyTheme(); // send initial theme to renderer

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
