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
  constructor(rootPath) {
    this.rootPath = rootPath;
  }

  /**
   * Resolves an include filename relative to the root path
   * @param {string} includeName - The filename to include
   * @returns {string} The absolute path to the file
   */
  ResolveInkFilename(includeName) {
    return path.resolve(this.rootPath, includeName);
  }

  /**
   * Loads the contents of an Ink file and strips BOM if present
   * @param {string} fullFilename - The full path to the file
   * @returns {string} The file contents with BOM removed
   */
  LoadInkFileContents(fullFilename) {
    let content = fs.readFileSync(fullFilename, 'utf8');
    // Remove BOM if present (0xFEFF at start of file)
    if (content.charCodeAt(0) === 0xFEFF) {
      content = content.slice(1);
    }
    return content;
  }
}

/**
 * Strips BOM from file content if present
 * @param {string} content - The file content
 * @returns {string} Content with BOM removed
 */
export function stripBOM(content) {
  if (content.charCodeAt(0) === 0xFEFF) {
    return content.slice(1);
  }
  return content;
}
