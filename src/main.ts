import { app, BrowserWindow, Menu, ipcMain, dialog, MenuItemConstructorOptions } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { compileInk } from './ink/compiler.js';
import { RecentFilesManager } from './utils/recentFiles.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null;

// Recent files management
const recentFilesPath = path.join(app.getPath('userData'), 'recent-files.json');
const recentFilesManager = new RecentFilesManager(recentFilesPath);

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
        : undefined
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

  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false // Disable sandbox to ensure preload works
    }
  });

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
          label: path.basename(filePath),
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

  createMenu();
  createWindow();

  // Auto-load most recent file after window is ready
  mainWindow!.webContents.once('did-finish-load', () => {
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
