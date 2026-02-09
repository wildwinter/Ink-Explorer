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
import type { StoryStructure, StoryInfo, KnotInfo } from './analyzer.js';

export interface CompilationResult {
  success: boolean;
  errors?: string[];
  warnings: string[];
  storyInfo?: StoryInfo;
  structure?: StoryStructure;
  sourceFiles?: Map<string, string>; // filename -> content
  mainFilename?: string; // The main file that was loaded
  storyJson?: string; // Compiled story JSON for inkjs runtime
}

/**
 * Parses an Ink source file to extract knot names in the order they appear
 * @param inkContent - The Ink source content
 * @returns Array of knot names in order
 */
function parseKnotOrder(inkContent: string): string[] {
  const knotNames: string[] = [];
  const lines = inkContent.split('\n');

  for (const line of lines) {
    // Match knot declarations: == KnotName or === KnotName ===
    // Knots start with 2+ equals signs followed by name, optionally followed by more ===
    const knotMatch = line.match(/^={2,}\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*={0,3}\s*$/);
    if (knotMatch) {
      knotNames.push(knotMatch[1]);
    }
  }

  return knotNames;
}

/**
 * Orders knots so that main file knots come first, in their original order
 * @param knots - Array of knots from the compiled structure
 * @param mainFileKnotOrder - Array of knot names from the main file in order
 * @returns Reordered array of knots
 */
function orderKnots(knots: KnotInfo[], mainFileKnotOrder: string[]): KnotInfo[] {
  const mainFileKnots: KnotInfo[] = [];
  const includedFileKnots: KnotInfo[] = [];
  const mainFileKnotSet = new Set(mainFileKnotOrder);

  // Separate main file knots from included file knots
  knots.forEach(knot => {
    if (mainFileKnotSet.has(knot.name)) {
      mainFileKnots.push(knot);
    } else {
      includedFileKnots.push(knot);
    }
  });

  // Sort main file knots according to their order in the source
  mainFileKnots.sort((a, b) => {
    const indexA = mainFileKnotOrder.indexOf(a.name);
    const indexB = mainFileKnotOrder.indexOf(b.name);
    return indexA - indexB;
  });

  // Return main file knots first, then included file knots
  return [...mainFileKnots, ...includedFileKnots];
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

    // Track the main file
    const mainFilename = path.basename(inkFilePath);
    fileHandler.loadedFiles.set(mainFilename, inkContent);

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

    // Parse main file to get knot order
    const mainFileKnotOrder = parseKnotOrder(inkContent);

    // Order knots so main file knots come first
    if (structure.knots && mainFileKnotOrder.length > 0) {
      structure.knots = orderKnots(structure.knots, mainFileKnotOrder);
    }

    // Return success with story info and source files
    return {
      success: true,
      warnings: allWarnings,
      storyInfo,
      structure,
      sourceFiles: fileHandler.loadedFiles,
      mainFilename,
      storyJson: story.ToJson()
    };

  } catch (error) {
    return {
      success: false,
      errors: [formatError(error)],
      warnings: []
    };
  }
}
