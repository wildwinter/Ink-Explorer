import { Compiler } from 'inkjs/compiler/Compiler';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Custom file handler that strips BOM from ink files
class BomStrippingFileHandler {
  constructor(rootPath) {
    this.rootPath = rootPath;
  }

  ResolveInkFilename(includeName) {
    return path.resolve(this.rootPath, includeName);
  }

  LoadInkFileContents(fullFilename) {
    let content = fs.readFileSync(fullFilename, 'utf8');
    // Strip BOM if present
    if (content.charCodeAt(0) === 0xFEFF) {
      content = content.slice(1);
    }
    return content;
  }
}

function parseAndRunInk(inkFilePath) {
  console.log(`\n=== Parsing Dink file: ${inkFilePath} ===\n`);

  try {
    // Read the main ink file
    let inkContent = fs.readFileSync(inkFilePath, 'utf8');
    // Strip BOM if present
    if (inkContent.charCodeAt(0) === 0xFEFF) {
      inkContent = inkContent.slice(1);
    }
    console.log('✓ Ink file loaded');

    // Create compiler with file handler for INCLUDE support
    const inkDir = path.dirname(inkFilePath);
    const fileHandler = new BomStrippingFileHandler(inkDir);

    console.log('Compiling Ink with inkjs-compiler...');

    // Error handler for compiler
    const errorHandler = (message, type) => {
      // Just collect errors, we'll handle them after compilation
    };

    const compiler = new Compiler(inkContent, {
      sourceFilename: inkFilePath,
      fileHandler: fileHandler,
      errorHandler: errorHandler
    });

    // Compile to get a Story instance
    let story;
    try {
      story = compiler.Compile();
    } catch (compileError) {
      // Display compilation errors
      if (compiler.errors.length > 0) {
        console.error('\n❌ Compilation Errors:');
        compiler.errors.forEach(error => console.error(`  - ${error}`));
      }
      throw compileError;
    }

    // Check for any remaining errors
    if (compiler.errors.length > 0) {
      console.error('\n❌ Compilation Errors:');
      compiler.errors.forEach(error => console.error(`  - ${error}`));
      throw new Error('Compilation failed');
    }

    // Display warnings if any
    if (compiler.warnings.length > 0) {
      console.warn('\n⚠️  Warnings:');
      compiler.warnings.forEach(warning => console.warn(`  - ${warning}`));
    }

    console.log('✓ Ink compiled successfully');
    console.log('✓ Story created\n');

    // Run through the story
    console.log('=== Story Output ===\n');

    let iteration = 0;
    const maxIterations = 50;

    while (story.canContinue && iteration < maxIterations) {
      const text = story.Continue();
      if (text.trim()) {
        console.log(text);
      }
      iteration++;
    }

    // Display choices if available
    if (story.currentChoices.length > 0) {
      console.log('\n=== Available Choices ===\n');
      story.currentChoices.forEach((choice, index) => {
        console.log(`${index + 1}. ${choice.text}`);
      });
    }

    // Display tags
    if (story.currentTags.length > 0) {
      console.log('\n=== Current Tags ===');
      story.currentTags.forEach(tag => {
        console.log(`  - ${tag}`);
      });
    }

    // Display global tags
    if (story.globalTags && story.globalTags.length > 0) {
      console.log('\n=== Global Tags ===');
      story.globalTags.forEach(tag => {
        console.log(`  - ${tag}`);
      });
    }

    console.log('\n=== Story Analysis ===');
    console.log(`Total iterations: ${iteration}`);
    console.log(`Can continue: ${story.canContinue}`);
    console.log(`Current choices: ${story.currentChoices.length}`);

    return story;

  } catch (error) {
    console.error('❌ Error parsing Ink file:', error);
    throw error;
  }
}

// Run the parser
const inkPath = path.join(__dirname, '../tests/dink/main.ink');
parseAndRunInk(inkPath);
