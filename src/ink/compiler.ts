/**
 * Ink Compiler Module
 * Handles compilation of Ink files and extraction of story information
 */

import fs from 'fs';
import path from 'path';
import { Compiler } from 'inkjs/compiler/Compiler';
import { BomStrippingFileHandler, stripBOM } from '../utils/fileHandler.js';
import { createErrorHandler, formatError } from '../utils/errors.js';
import { extractStoryStructure, extractStoryInfo } from './analyzer.js';
import type { StoryStructure, StoryInfo } from './analyzer.js';

export interface CompilationResult {
  success: boolean;
  errors?: string[];
  warnings: string[];
  storyInfo?: StoryInfo;
  structure?: StoryStructure;
}

/**
 * Compiles an Ink file and returns the result with structure analysis
 * @param inkFilePath - Path to the Ink file to compile
 * @returns Compilation result object
 */
export async function compileInk(inkFilePath: string): Promise<CompilationResult> {
  try {
    // Read the main ink file
    let inkContent = fs.readFileSync(inkFilePath, 'utf8');
    inkContent = stripBOM(inkContent);

    // Create compiler with file handler
    const inkDir = path.dirname(inkFilePath);
    const fileHandler = new BomStrippingFileHandler(inkDir);

    // Create error handler
    const errorHandling = createErrorHandler();

    const compiler = new Compiler(inkContent, {
      sourceFilename: inkFilePath,
      fileHandler: fileHandler,
      errorHandler: errorHandling.handler
    });

    // Compile - this may call errorHandler multiple times
    let story = null;
    try {
      story = compiler.Compile();
    } catch (compileError) {
      // Compilation threw an error, but errorHandler should have collected the details
    }

    // Collect all errors and warnings
    const allErrors = [...errorHandling.errors];
    const allWarnings = [...errorHandling.warnings];

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

    // Extract story information and structure
    const storyInfo = extractStoryInfo(story);
    const structure = extractStoryStructure(story);

    // Return success with story info
    return {
      success: true,
      warnings: allWarnings,
      storyInfo,
      structure
    };

  } catch (error) {
    return {
      success: false,
      errors: [formatError(error)],
      warnings: []
    };
  }
}
