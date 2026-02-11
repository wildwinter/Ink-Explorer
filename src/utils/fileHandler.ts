/**
 * File Handler Utilities
 * Handles file operations for Ink compilation, including BOM stripping
 */

import fs from 'fs';
import path from 'path';

/**
 * Custom file handler that strips BOM (Byte Order Mark) from Ink files
 * This is necessary because some editors add BOM to UTF-8 files which can cause issues
 */
export class BomStrippingFileHandler {
  private rootPath: string;
  public loadedFiles: Map<string, string> = new Map();
  public resolvedPaths: Map<string, string> = new Map(); // basename → full path

  constructor(rootPath: string) {
    this.rootPath = rootPath;
  }

  /**
   * Resolves an include filename relative to the root path
   * @param includeName - The filename to include
   * @returns The absolute path to the file
   */
  ResolveInkFilename(includeName: string): string {
    return path.resolve(this.rootPath, includeName);
  }

  /**
   * Loads the contents of an Ink file and strips BOM if present
   * @param fullFilename - The full path to the file
   * @returns The file contents with BOM removed
   */
  LoadInkFileContents(fullFilename: string): string {
    let content = fs.readFileSync(fullFilename, 'utf8');
    // Remove BOM if present (0xFEFF at start of file)
    if (content.charCodeAt(0) === 0xFEFF) {
      content = content.slice(1);
    }

    // Track loaded file and its content
    const filename = path.basename(fullFilename);
    this.loadedFiles.set(filename, content);
    this.resolvedPaths.set(filename, fullFilename);

    return content;
  }
}

/**
 * Strips BOM from file content if present
 * @param content - The file content
 * @returns Content with BOM removed
 */
export function stripBOM(content: string): string {
  if (content.charCodeAt(0) === 0xFEFF) {
    return content.slice(1);
  }
  return content;
}
