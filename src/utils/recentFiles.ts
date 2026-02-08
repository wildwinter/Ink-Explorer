/**
 * Recent Files Manager
 * Handles persistence and management of recently opened files
 */

import fs from 'fs';

const MAX_RECENT_FILES = 10;

/**
 * Recent Files Manager class
 */
export class RecentFilesManager {
  private storagePath: string;
  private recentFiles: string[];

  constructor(storagePath: string) {
    this.storagePath = storagePath;
    this.recentFiles = [];
  }

  /**
   * Loads recent files from disk
   */
  load(): void {
    try {
      if (fs.existsSync(this.storagePath)) {
        const data = fs.readFileSync(this.storagePath, 'utf8');
        this.recentFiles = JSON.parse(data);
      }
    } catch (error) {
      console.error('Failed to load recent files:', error);
      this.recentFiles = [];
    }
  }

  /**
   * Saves recent files to disk
   */
  save(): void {
    try {
      fs.writeFileSync(this.storagePath, JSON.stringify(this.recentFiles, null, 2));
    } catch (error) {
      console.error('Failed to save recent files:', error);
    }
  }

  /**
   * Adds a file to the recent files list
   * @param filePath - The file path to add
   */
  add(filePath: string): void {
    // Remove if already exists
    this.recentFiles = this.recentFiles.filter(f => f !== filePath);
    // Add to beginning
    this.recentFiles.unshift(filePath);
    // Keep only MAX_RECENT_FILES
    this.recentFiles = this.recentFiles.slice(0, MAX_RECENT_FILES);
    // Save
    this.save();
  }

  /**
   * Gets the most recent file
   * @returns The most recent file path or null
   */
  getMostRecent(): string | null {
    return this.recentFiles.length > 0 ? this.recentFiles[0] : null;
  }

  /**
   * Gets all recent files
   * @returns Array of recent file paths
   */
  getAll(): string[] {
    return [...this.recentFiles];
  }

  /**
   * Clears all recent files
   */
  clear(): void {
    this.recentFiles = [];
    this.save();
  }

  /**
   * Gets the count of recent files
   * @returns Number of recent files
   */
  get length(): number {
    return this.recentFiles.length;
  }
}
