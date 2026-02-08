/**
 * Ink Story Analyzer
 * Analyzes compiled Ink stories to extract structure and flow information
 */

import type { Story } from 'inkjs/compiler/Compiler';

export interface DivertInfo {
  source: string;
  target: string;
  isConditional: boolean;
  isFunctionCall: boolean;
}

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
  diverts: DivertInfo[];
}

export interface StoryInfo {
  canContinue: boolean;
  choiceCount: number;
  currentTags: string[];
  globalTags: string[];
}

/**
 * Recursively traverses Ink content to find all Divert objects
 * @param content - The Ink content object to traverse
 * @param path - Current path in the story hierarchy
 * @returns Array of divert objects with source and target information
 */
export function findDiverts(content: unknown, path: string[] = []): DivertInfo[] {
  const diverts: DivertInfo[] = [];

  if (!content) return diverts;

  // Check if this is a Divert object
  if (typeof content === 'object' && content !== null) {
    const obj = content as any;

    if (obj.constructor && obj.constructor.name === 'Divert') {
      const targetPath = obj.targetPath;
      if (targetPath) {
        diverts.push({
          source: path.join('.') || 'root',
          target: targetPath.componentsString || targetPath.toString(),
          isConditional: obj.hasCondition || false,
          isFunctionCall: obj.pushesToStack || false
        });
      }
    }

    // Traverse content array
    if (Array.isArray(obj)) {
      obj.forEach((item) => {
        diverts.push(...findDiverts(item, path));
      });
    }

    // Traverse content property
    if (obj.content && Array.isArray(obj.content)) {
      obj.content.forEach((item: unknown) => {
        diverts.push(...findDiverts(item, path));
      });
    }

    // Traverse named content (for containers with sub-knots/stitches)
    if (obj.namedContent && obj.namedContent instanceof Map) {
      for (const [name, namedItem] of obj.namedContent) {
        diverts.push(...findDiverts(namedItem, [...path, name]));
      }
    }

    // Traverse named only content
    if (obj.namedOnlyContent && obj.namedOnlyContent instanceof Map) {
      for (const [name, namedItem] of obj.namedOnlyContent) {
        diverts.push(...findDiverts(namedItem, [...path, name]));
      }
    }

    // Traverse choice content (for diverts inside choices)
    if (obj.innerContent && Array.isArray(obj.innerContent)) {
      obj.innerContent.forEach((item: unknown) => {
        diverts.push(...findDiverts(item, path));
      });
    }

    // Traverse conditional branches
    if (obj.branches && Array.isArray(obj.branches)) {
      obj.branches.forEach((branch: unknown) => {
        diverts.push(...findDiverts(branch, path));
      });
    }
  }

  return diverts;
}

/**
 * Extracts the complete story structure including knots, stitches, and their exits
 * @param story - The compiled Ink story object
 * @returns Structure containing knots array and diverts information
 */
export function extractStoryStructure(story: Story): StoryStructure {
  const structure: StoryStructure = {
    knots: [],
    diverts: []
  };

  try {
    // Access the main content container which holds all knots
    const mainContainer = story.mainContentContainer;

    if (mainContainer && mainContainer.namedContent) {
      // Iterate through all named content (knots)
      for (const [knotName, knotContent] of mainContainer.namedContent) {
        const knot: KnotInfo = {
          name: knotName,
          stitches: [],
          exits: []
        };

        // Find diverts from the knot itself (not in stitches)
        const knotDiverts = findDiverts(knotContent, [knotName]);

        // Filter diverts that are directly from this knot (not from a stitch)
        const knotExits = knotDiverts.filter(d => {
          const sourceParts = d.source.split('.');
          return sourceParts.length === 1 ||
                 (knotContent.namedContent && !knotContent.namedContent.has(sourceParts[1]));
        }).map(d => d.target);

        knot.exits = [...new Set(knotExits)]; // Remove duplicates

        // Check if this knot has stitches (sub-containers)
        if (knotContent && knotContent.namedContent) {
          for (const [stitchName, stitchContent] of knotContent.namedContent) {
            // Find diverts from this stitch
            const stitchDiverts = findDiverts(stitchContent, [knotName, stitchName]);
            const stitchExits = stitchDiverts.map(d => d.target);

            knot.stitches.push({
              name: stitchName,
              exits: [...new Set(stitchExits)] // Remove duplicates
            });
          }
        }

        structure.knots.push(knot);

        // Collect all diverts for the overall structure
        structure.diverts.push(...knotDiverts);
      }
    }
  } catch (error) {
    console.error('Error extracting story structure:', error);
  }

  return structure;
}

/**
 * Extracts basic story information from a compiled story
 * @param story - The compiled Ink story object
 * @returns Story information including canContinue, choiceCount, and tags
 */
export function extractStoryInfo(story: Story): StoryInfo {
  return {
    canContinue: story.canContinue,
    choiceCount: story.currentChoices.length,
    currentTags: story.currentTags,
    globalTags: story.globalTags
  };
}
