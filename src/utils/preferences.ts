/**
 * Preferences Module
 * Platform-native config storage and per-file state persistence.
 * macOS: NSUserDefaults (~/Library/Preferences/net.wildwinter.inkexplorer.plist)
 * Windows: Registry (HKCU\Software\InkExplorer)
 */

import { execFileSync } from 'child_process';

const BUNDLE_ID = 'net.wildwinter.inkexplorer';
const REG_KEY = 'HKCU\\Software\\InkExplorer';

export type ThemeSetting = 'light' | 'dark' | 'system';

export interface FileState {
  codePaneOpen: boolean;
  graphTransform: { x: number; y: number; k: number } | null;
  selectedNodeId: string | null;
}

export function readPref(key: string): string | null {
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

export function writePref(key: string, value: string): void {
  try {
    if (process.platform === 'darwin') {
      execFileSync('defaults', ['write', BUNDLE_ID, key, '-string', value], { stdio: 'pipe' });
    } else if (process.platform === 'win32') {
      execFileSync('reg', ['add', REG_KEY, '/v', key, '/t', 'REG_SZ', '/d', value, '/f'], { stdio: 'pipe' });
    }
  } catch { /* ignore */ }
}

export function loadWindowBounds(): Electron.Rectangle | null {
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

function loadAllFileStates(): Record<string, FileState> {
  const raw = readPref('fileStates');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch { return {}; }
}

export function loadFileState(filePath: string): FileState | null {
  const all = loadAllFileStates();
  return all[filePath] || null;
}

export function saveFileState(filePath: string, state: FileState): void {
  const all = loadAllFileStates();
  all[filePath] = state;
  writePref('fileStates', JSON.stringify(all));
}

export function loadThemeSetting(): ThemeSetting {
  const saved = readPref('theme');
  if (saved === 'light' || saved === 'dark' || saved === 'system') {
    return saved;
  }
  return 'system';
}
