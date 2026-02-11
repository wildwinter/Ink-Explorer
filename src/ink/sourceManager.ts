/**
 * Source Code Manager
 * Handles extraction of ink source code from files
 */

function escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extracts the source code for a knot (including all its stitches) from the raw Ink source files.
 */
export function extractKnotSource(knotName: string, sourceFiles: Map<string, string>): { source: string; filename: string } | null {
    const knotPattern = new RegExp(`^={2,}\\s*${escapeRegExp(knotName)}\\s*={0,3}\\s*$`, 'm');
    const nextKnotPattern = /^={2,}\s*[a-zA-Z_][a-zA-Z0-9_]*\s*={0,3}\s*$/m;

    for (const [filename, content] of sourceFiles) {
        const match = knotPattern.exec(content);
        if (match) {
            const startIndex = match.index;
            // Find the next knot declaration after this one
            const rest = content.substring(startIndex + match[0].length);
            const nextMatch = nextKnotPattern.exec(rest);
            if (nextMatch) {
                return { source: content.substring(startIndex, startIndex + match[0].length + nextMatch.index).trimEnd(), filename };
            }
            // No next knot — take everything to the end
            return { source: content.substring(startIndex).trimEnd(), filename };
        }
    }
    return null;
}

/**
 * Extracts the source code for a single stitch from the raw Ink source files.
 */
export function extractStitchSource(knotName: string, stitchName: string, sourceFiles: Map<string, string>): { source: string; filename: string } | null {
    const knotResult = extractKnotSource(knotName, sourceFiles);
    if (!knotResult) return null;

    const { source: knotSource, filename } = knotResult;
    const stitchPattern = new RegExp(`^=(?!=)\\s*${escapeRegExp(stitchName)}\\s*$`, 'm');
    const match = stitchPattern.exec(knotSource);
    if (!match) return null;

    const startIndex = match.index;
    const rest = knotSource.substring(startIndex + match[0].length);
    // Next stitch or end of knot
    const nextStitchPattern = /^=(?!=)\s*[a-zA-Z_][a-zA-Z0-9_]*\s*$/m;
    const nextMatch = nextStitchPattern.exec(rest);
    if (nextMatch) {
        return { source: knotSource.substring(startIndex, startIndex + match[0].length + nextMatch.index).trimEnd(), filename };
    }
    return { source: knotSource.substring(startIndex).trimEnd(), filename };
}

/**
 * Extracts root content (everything before the first knot or stitch) from each source file.
 * The main/root ink file (first entry in the map) is placed last, since INCLUDEd files
 * are evaluated in the order encountered before the root file's own content.
 */
export function extractRootSource(sourceFiles: Map<string, string>): string {
    const firstKnotOrStitch = /^={1,3}\s*[a-zA-Z_][a-zA-Z0-9_]*\s*={0,3}\s*$/m;
    const sections: string[] = [];

    // Reorder: included files first, root file last
    const entries = Array.from(sourceFiles.entries());
    const mainEntry = entries[0];
    const reordered = entries.length > 1 ? [...entries.slice(1), mainEntry] : entries;

    for (const [filename, content] of reordered) {
        const match = firstKnotOrStitch.exec(content);
        let preamble = match ? content.substring(0, match.index).trimEnd() : content.trimEnd();
        // Remove INCLUDE lines — they're just file-loading directives, not story content
        preamble = preamble.split('\n').filter(line => !/^\s*INCLUDE\b/.test(line)).join('\n').trimEnd();
        if (preamble.length > 0) {
            sections.push(`// --------- ${filename} ---------\n${preamble}\n`);
        }
    }

    return sections.join('\n');
}
