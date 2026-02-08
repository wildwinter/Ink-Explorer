/**
 * Shared type definitions for IPC communication
 */

export interface StitchInfo {
  name: string;
  exits: string[];
}

export interface KnotInfo {
  name: string;
  stitches: StitchInfo[];
  exits: string[];
}

export interface StoryStructure {
  knots: KnotInfo[];
  diverts: Array<{
    source: string;
    target: string;
    isConditional: boolean;
    isFunctionCall: boolean;
  }>;
}

export interface StoryInfo {
  canContinue: boolean;
  choiceCount: number;
  currentTags: string[];
  globalTags: string[];
}

export interface CompilationResult {
  success: boolean;
  errors?: string[];
  warnings: string[];
  storyInfo?: StoryInfo;
  structure?: StoryStructure;
}

// API exposed to renderer
export interface DinkExplorerAPI {
  onCompileResult: (callback: (result: CompilationResult) => void) => void;
}

// Extend Window interface
declare global {
  interface Window {
    api: DinkExplorerAPI;
  }
}
