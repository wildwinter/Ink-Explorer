import { app, BrowserWindow, Menu, ipcMain, dialog } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { compileInk } from './ink/compiler.js';
import { RecentFilesManager } from './utils/recentFiles.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow;

// Recent files management
const recentFilesPath = path.join(app.getPath('userData'), 'recent-files.json');
const recentFilesManager = new RecentFilesManager(recentFilesPath);


// Function to compile Ink file and send results to renderer
async function compileAndLogInk(inkFilePath) {
  const result = await compileInk(inkFilePath);

  // Send result to renderer for logging
  if (mainWindow) {
    mainWindow.webContents.send('ink-compile-result', result);
  }

  // Add to recent files if compilation succeeded
  if (result.success) {
    recentFilesManager.add(inkFilePath);
    // Rebuild menu to show updated recent files
    createMenu();
  } else {
    // Show error dialog on compilation failure
    const fileName = path.basename(inkFilePath);
    const errorMessage = result.errors.join('\n\n');

    await dialog.showMessageBox(mainWindow, {
      type: 'error',
      title: 'Ink Compilation Failed',
      message: `Failed to compile ${fileName}`,
      detail: errorMessage,
      buttons: ['OK']
    });
  }

  return result;
}

// Function to show file picker and compile Ink
async function loadInkFile() {
  const result = await dialog.showOpenDialog(mainWindow, {
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
ipcMain.handle('compile-ink', async (_event, inkFilePath) => {
  return await compileInk(inkFilePath);
});

// Check if we're in development mode
const isDev = !app.isPackaged;
const VITE_DEV_SERVER_URL = 'http://localhost:5173';

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
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

function createMenu() {
  const isMac = process.platform === 'darwin';

  // Build Recent Files submenu
  const recentFiles = recentFilesManager.getAll();
  const recentFilesSubmenu = recentFiles.length > 0
    ? [
        ...recentFiles.map((filePath, index) => ({
          label: path.basename(filePath),
          accelerator: index < 9 ? `${isMac ? 'Cmd' : 'Ctrl'}+${index + 1}` : undefined,
          click: () => compileAndLogInk(filePath)
        })),
        { type: 'separator' },
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

  const template = [
    // App menu (macOS only)
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
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
        { type: 'separator' },
        {
          label: 'Recent Files',
          submenu: recentFilesSubmenu
        },
        ...(isMac ? [] : [
          { type: 'separator' },
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
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...(isMac ? [
          { role: 'pasteAndMatchStyle' },
          { role: 'delete' },
          { role: 'selectAll' }
        ] : [
          { role: 'delete' },
          { type: 'separator' },
          { role: 'selectAll' }
        ])
      ]
    },
    // View menu
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    // Window menu
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac ? [
          { type: 'separator' },
          { role: 'front' },
          { type: 'separator' },
          { role: 'window' }
        ] : [
          { role: 'close' }
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
  mainWindow.webContents.once('did-finish-load', () => {
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
