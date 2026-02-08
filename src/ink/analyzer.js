/**
 * Ink Story Analyzer
 * Analyzes compiled Ink stories to extract structure and flow information
 */

/**
 * Recursively traverses Ink content to find all Divert objects
 * @param {Object} content - The Ink content object to traverse
 * @param {Array<string>} path - Current path in the story hierarchy
 * @returns {Array<Object>} Array of divert objects with source and target information
 */
export function findDiverts(content, path = []) {
  const diverts = [];

  if (!content) return diverts;

  // Check if this is a Divert object
  if (content.constructor && content.constructor.name === 'Divert') {
    const targetPath = content.targetPath;
    if (targetPath) {
      diverts.push({
        source: path.join('.'),
        target: targetPath.componentsString || targetPath.toString(),
        isConditional: content.hasCondition || false,
        isFunctionCall: content.pushesToStack || false
      });
    }
  }

  // Traverse content array
  if (Array.isArray(content)) {
    content.forEach((item) => {
      diverts.push(...findDiverts(item, path));
    });
  }

  // Traverse content property
  if (content.content && Array.isArray(content.content)) {
    content.content.forEach((item) => {
      diverts.push(...findDiverts(item, path));
    });
  }

  // Traverse named content (for containers with sub-knots/stitches)
  if (content.namedContent) {
    for (const [name, namedItem] of content.namedContent) {
      diverts.push(...findDiverts(namedItem, [...path, name]));
    }
  }

  // Traverse named only content
  if (content.namedOnlyContent) {
    for (const [name, namedItem] of content.namedOnlyContent) {
      diverts.push(...findDiverts(namedItem, [...path, name]));
    }
  }

  return diverts;
}

/**
 * Extracts the complete story structure including knots, stitches, and their exits
 * @param {Object} story - The compiled Ink story object
 * @returns {Object} Structure containing knots array and diverts information
 */
export function extractStoryStructure(story) {
  const structure = {
    knots: [],
    diverts: []
  };

  try {
    // Access the main content container which holds all knots
    const mainContainer = story.mainContentContainer;

    if (mainContainer && mainContainer.namedContent) {
      // Iterate through all named content (knots)
      for (const [knotName, knotContent] of mainContainer.namedContent) {
        const knot = {
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
 * @param {Object} story - The compiled Ink story object
 * @returns {Object} Story information including canContinue, choiceCount, and tags
 */
export function extractStoryInfo(story) {
  return {
    canContinue: story.canContinue,
    choiceCount: story.currentChoices.length,
    currentTags: story.currentTags,
    globalTags: story.globalTags
  };
}
