import fs from 'fs';
import path from 'path';

const ARGS = process.argv.slice(2);

if (ARGS.length < 3) {
    console.log("Usage: node benchmark_generator.js <num_knots> <num_stitches> <output_filename>");
    process.exit(1);
}

const NUM_KNOTS = parseInt(ARGS[0]);
const NUM_STITCHES = parseInt(ARGS[1]);
const OUTPUT_FILE = ARGS[2];

// Configuration
const ISLAND_SIZE = 20; // Avg knots per island for clustering external links
const LOCAL_LINK_PROB = 0.8; // 80% chance to link within same island for external links

let content = "";
content += "// Benchmark Ink File (Strict Rules)\n";
content += `// Knots: ${NUM_KNOTS}, Stitches: ${NUM_STITCHES}\n\n`;

// Pre-calculate structure
const knotIslands = new Map();
const knotStitchCounts = new Map();

for (let i = 0; i < NUM_KNOTS; i++) {
    const islandId = Math.floor(i / ISLAND_SIZE);
    knotIslands.set(i, islandId);
}

// Calculate stitch distribution
let _tempStitchCount = NUM_STITCHES;
let _tempStitchesPerKnotBase = Math.floor(NUM_STITCHES / NUM_KNOTS);
let _tempExtraStitches = NUM_STITCHES % NUM_KNOTS;

for (let k = 0; k < NUM_KNOTS; k++) {
    let count = _tempStitchesPerKnotBase;
    if (_tempExtraStitches > 0) {
        count++;
        _tempExtraStitches--;
    }
    knotStitchCounts.set(k, count);
}

// Helper to get a random external knot target (Clustered)
const getRandomExternalKnot = (sourceKnotIndex) => {
    const currentIsland = knotIslands.get(sourceKnotIndex);
    let targetKnot;

    if (Math.random() < LOCAL_LINK_PROB) {
        // Pick from same island
        const start = currentIsland * ISLAND_SIZE;
        const end = Math.min((currentIsland + 1) * ISLAND_SIZE, NUM_KNOTS);
        const range = end - start;
        targetKnot = start + Math.floor(Math.random() * range);
    } else {
        // Pick from any other knot
        targetKnot = Math.floor(Math.random() * NUM_KNOTS);
    }
    return `knot_${targetKnot}`;
};

// Root connection: Connects to 1 knot.
// Let's pick a random start knot or just knot_0.
const startKnot = Math.floor(Math.random() * NUM_KNOTS);
content += `-> knot_${startKnot}\n\n`;

// Generate content
let finalStitchCount = 0;

for (let k = 0; k < NUM_KNOTS; k++) {
    content += `=== knot_${k} ===\n`;
    content += `This is knot ${k}.\n`;

    // Rule: Each knot can connect to 1-3 of its child stitches (unique).
    const stitchesInThisKnot = knotStitchCounts.get(k);

    if (stitchesInThisKnot > 0) {
        // Determine number of links (1-3, capped by available stitches)
        const maxLinks = Math.min(stitchesInThisKnot, 3);
        const numLinks = Math.floor(Math.random() * maxLinks) + 1;

        // Create array of possible targets
        const possibleTargets = Array.from({ length: stitchesInThisKnot }, (_, i) => i);

        // Shuffle to pick unique ones
        for (let i = possibleTargets.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [possibleTargets[i], possibleTargets[j]] = [possibleTargets[j], possibleTargets[i]];
        }

        // Generate links
        for (let i = 0; i < numLinks; i++) {
            content += `-> stitch_${possibleTargets[i]}\n`;
        }
    } else {
        // Fallback if no stitches: just connect to a random knot so it's not a dead end?
        content += `-> ${getRandomExternalKnot(k)}\n`;
    }
    content += `\n`;

    // Generate Stitches for this knot
    for (let s = 0; s < stitchesInThisKnot; s++) {
        content += `= stitch_${s}\n`;
        content += `This is stitch ${s} in knot ${k}.\n`;

        let hasLinks = false;

        // Rule: Each stitch can connect to 0-5 of the stitches in its own knot.
        // Constraint: max 1 link to any specific target (avoid duplicates).

        // Identify valid targets (all other stitches in this knot)
        const otherStitchIndices = [];
        for (let os = 0; os < stitchesInThisKnot; os++) {
            if (os !== s) otherStitchIndices.push(os);
        }

        // Shuffle valid targets to pick random unique ones
        for (let i = otherStitchIndices.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [otherStitchIndices[i], otherStitchIndices[j]] = [otherStitchIndices[j], otherStitchIndices[i]];
        }

        // Determine number of links (0-5, but capped by available targets)
        const maxPossibleLinks = Math.min(otherStitchIndices.length, 5);
        const numInternalLinks = Math.floor(Math.random() * (maxPossibleLinks + 1));

        for (let i = 0; i < numInternalLinks; i++) {
            const targetS = otherStitchIndices[i];
            content += `* [Internal Choice ${i}] -> stitch_${targetS}\n`;
            hasLinks = true;
        }

        // Rule: Each stitch can additionally connect to 0-5 external knots (but never stitches)
        const numExternalLinks = Math.floor(Math.random() * 6); // 0 to 5

        for (let i = 0; i < numExternalLinks; i++) {
            const targetKnotName = getRandomExternalKnot(k);
            content += `* [External Choice ${i}] -> ${targetKnotName}\n`;
            hasLinks = true;
        }

        // If no links generated (0 internal, 0 external), it's a dead end.
        if (!hasLinks) {
            content += `-> DONE\n`;
        } else {
            content += `-> DONE\n`;
        }

        content += `\n`;
        finalStitchCount++;
    }

    content += `-> DONE\n\n`;
}

fs.writeFileSync(OUTPUT_FILE, content);
console.log(`Generated ${OUTPUT_FILE} with ${NUM_KNOTS} knots and ${finalStitchCount} stitches.`);
