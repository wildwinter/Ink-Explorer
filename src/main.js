import { app, BrowserWindow, Menu, ipcMain } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { Compiler } from 'inkjs/compiler/Compiler';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow;

// File handler that strips BOM from ink files
class BomStrippingFileHandler {
  constructor(rootPath) {
    this.rootPath = rootPath;
  }

  ResolveInkFilename(includeName) {
    return path.resolve(this.rootPath, includeName);
  }

  LoadInkFileContents(fullFilename) {
    let content = fs.readFileSync(fullFilename, 'utf8');
    if (content.charCodeAt(0) === 0xFEFF) {
      content = content.slice(1);
    }
    return content;
  }
}

// IPC handler for Ink compilation
ipcMain.handle('compile-ink', async (event, inkFilePath) => {
  try {
    // Read the main ink file
    let inkContent = fs.readFileSync(inkFilePath, 'utf8');
    if (inkContent.charCodeAt(0) === 0xFEFF) {
      inkContent = inkContent.slice(1);
    }

    // Create compiler with file handler
    const inkDir = path.dirname(inkFilePath);
    const fileHandler = new BomStrippingFileHandler(inkDir);
    const errorHandler = (message, type) => {};

    const compiler = new Compiler(inkContent, {
      sourceFilename: inkFilePath,
      fileHandler: fileHandler,
      errorHandler: errorHandler
    });

    // Compile
    const story = compiler.Compile();

    // Check for errors
    if (compiler.errors.length > 0) {
      return {
        success: false,
        errors: compiler.errors,
        warnings: compiler.warnings
      };
    }

    // Return success with story info
    return {
      success: true,
      warnings: compiler.warnings,
      storyInfo: {
        canContinue: story.canContinue,
        choiceCount: story.currentChoices.length,
        currentTags: story.currentTags,
        globalTags: story.globalTags
      }
    };

  } catch (error) {
    return {
      success: false,
      errors: [error.message],
      warnings: []
    };
  }
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
        ...(isMac ? [] : [
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
  createMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
