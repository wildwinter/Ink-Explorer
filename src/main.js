import { app, BrowserWindow, Menu, ipcMain, dialog } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { Compiler } from 'inkjs/compiler/Compiler';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow;

// Recent files management
const MAX_RECENT_FILES = 10;
let recentFiles = [];
const recentFilesPath = path.join(app.getPath('userData'), 'recent-files.json');

// Load recent files from disk
function loadRecentFiles() {
  try {
    if (fs.existsSync(recentFilesPath)) {
      const data = fs.readFileSync(recentFilesPath, 'utf8');
      recentFiles = JSON.parse(data);
    }
  } catch (error) {
    console.error('Failed to load recent files:', error);
    recentFiles = [];
  }
}

// Save recent files to disk
function saveRecentFiles() {
  try {
    fs.writeFileSync(recentFilesPath, JSON.stringify(recentFiles, null, 2));
  } catch (error) {
    console.error('Failed to save recent files:', error);
  }
}

// Add file to recent files list
function addRecentFile(filePath) {
  // Remove if already exists
  recentFiles = recentFiles.filter(f => f !== filePath);
  // Add to beginning
  recentFiles.unshift(filePath);
  // Keep only MAX_RECENT_FILES
  recentFiles = recentFiles.slice(0, MAX_RECENT_FILES);
  // Save
  saveRecentFiles();
  // Rebuild menu to show updated recent files
  createMenu();
}

// Get most recent file
function getMostRecentFile() {
  return recentFiles.length > 0 ? recentFiles[0] : null;
}

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

// Function to compile Ink file and send results to renderer
async function compileAndLogInk(inkFilePath) {
  const result = await compileInk(inkFilePath);

  // Send result to renderer for logging
  if (mainWindow) {
    mainWindow.webContents.send('ink-compile-result', result);
  }

  // Add to recent files if compilation succeeded
  if (result.success) {
    addRecentFile(inkFilePath);
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

// Format an error object to a readable string
function formatError(error) {
  if (typeof error === 'string') {
    return error;
  }

  // Handle error objects with various properties
  if (error && typeof error === 'object') {
    let parts = [];

    // Add line number if available
    if (error.lineNumber !== undefined) {
      parts.push(`Line ${error.lineNumber}`);
    }

    // Add error type if available
    if (error.type) {
      parts.push(`[${error.type}]`);
    }

    // Add the message
    const message = error.message || error.text || String(error);
    parts.push(message);

    return parts.join(' ');
  }

  return String(error);
}

// Core Ink compilation function
async function compileInk(inkFilePath) {
  try {
    // Read the main ink file
    let inkContent = fs.readFileSync(inkFilePath, 'utf8');
    if (inkContent.charCodeAt(0) === 0xFEFF) {
      inkContent = inkContent.slice(1);
    }

    // Create compiler with file handler
    const inkDir = path.dirname(inkFilePath);
    const fileHandler = new BomStrippingFileHandler(inkDir);

    // Collect errors and warnings from error handler
    const collectedErrors = [];
    const collectedWarnings = [];

    const errorHandler = (message, type) => {
      const formattedMessage = formatError(message);
      if (type === 'WARNING' || type === 'warning') {
        collectedWarnings.push(formattedMessage);
      } else {
        collectedErrors.push(formattedMessage);
      }
    };

    const compiler = new Compiler(inkContent, {
      sourceFilename: inkFilePath,
      fileHandler: fileHandler,
      errorHandler: errorHandler
    });

    // Compile - this may call errorHandler multiple times
    let story = null;
    try {
      story = compiler.Compile();
    } catch (compileError) {
      // Compilation threw an error, but errorHandler should have collected the details
    }

    // Collect all errors and warnings
    const allErrors = [...collectedErrors];
    const allWarnings = [...collectedWarnings];

    // Also check compiler.errors and compiler.warnings arrays
    if (compiler.errors && compiler.errors.length > 0) {
      compiler.errors.forEach(error => {
        allErrors.push(formatError(error));
      });
    }

    if (compiler.warnings && compiler.warnings.length > 0) {
      compiler.warnings.forEach(warning => {
        allWarnings.push(formatError(warning));
      });
    }

    // Check for errors
    if (allErrors.length > 0) {
      return {
        success: false,
        errors: allErrors,
        warnings: allWarnings
      };
    }

    // Check if story was successfully created
    if (!story) {
      return {
        success: false,
        errors: ['Compilation failed - no story object created'],
        warnings: allWarnings
      };
    }

    // Return success with story info
    return {
      success: true,
      warnings: allWarnings,
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
      errors: [formatError(error)],
      warnings: []
    };
  }
}

// IPC handler (kept for compatibility)
ipcMain.handle('compile-ink', async (event, inkFilePath) => {
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
            recentFiles = [];
            saveRecentFiles();
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
  loadRecentFiles();

  createMenu();
  createWindow();

  // Auto-load most recent file after window is ready
  mainWindow.webContents.once('did-finish-load', () => {
    const mostRecentFile = getMostRecentFile();
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
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
