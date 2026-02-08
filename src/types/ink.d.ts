/**
 * Type definitions for inkjs library
 * These are minimal definitions for the parts we use
 */

declare module 'inkjs/compiler/Compiler' {
  export interface CompilerOptions {
    sourceFilename?: string;
    fileHandler?: {
      ResolveInkFilename(includeName: string): string;
      LoadInkFileContents(fullFilename: string): string;
    };
    errorHandler?: (message: unknown, type?: string) => void;
  }

  export class Compiler {
    constructor(inkSource: string, options?: CompilerOptions);
    Compile(): Story;
    errors: unknown[];
    warnings: unknown[];
  }

  export interface Story {
    canContinue: boolean;
    currentChoices: unknown[];
    currentTags: string[];
    globalTags: string[];
    mainContentContainer: Container;
  }

  export interface Container {
    content?: unknown[];
    namedContent?: Map<string, Container>;
    namedOnlyContent?: Map<string, Container>;
  }

  export interface Path {
    componentsString?: string;
    toString(): string;
  }

  export interface Divert {
    constructor: { name: string };
    targetPath?: Path;
    hasCondition?: boolean;
    pushesToStack?: boolean;
  }
}
