/**
 * Graph Layout Logic
 * Handles the conversion of story structure to graph data and computing node positions
 * Strictly enforces:
 * 1. Knot Islands (Knot at top, stitches below)
 * 2. Left-to-Right flow for Knots
 * 3. Top-to-Bottom flow for Stitches within Knots
 * 4. No Overlaps
 */

import type { StoryStructure, KnotInfo, StitchInfo } from '../ink/analyzer.js';

export type NodeType = 'knot' | 'stitch' | 'root';

export interface GraphNode {
    id: string;
    label: string;
    type: NodeType;
    knotName?: string; // For stitches, track which knot they belong to
    x?: number;
    y?: number;
    width?: number;  // Calculated width
    height?: number; // Calculated height
}

export interface GraphLink {
    source: string | GraphNode;
    target: string | GraphNode;
    isConditional: boolean;
}

export interface Graph {
    nodes: GraphNode[];
    links: GraphLink[];
}

// Layout Constants
const NODE_WIDTH = 180;  // Slightly wider to accommodate text
const NODE_HEIGHT = 60;
const KNOT_PADDING = 20; // Padding inside the knot island
const STITCH_SPACING_Y = 40; // Vertical space between stitches in an island
const ISLAND_SPACING_X = 150; // Horizontal space between knot islands
const ISLAND_SPACING_Y = 80;  // Vertical space between knot islands

export interface Island {
    id: string;
    knotNode: GraphNode;
    stitches: GraphNode[];
    width: number;
    height: number;
    x: number;
    y: number;
    rank: number; // Horizontal rank (column)
}

/**
 * Converts story structure to graph format
 */
export function structureToGraph(structure: StoryStructure): Graph {
    const nodes: GraphNode[] = [];
    const links: GraphLink[] = [];
    const nodeIds = new Set<string>();

    // Always create root node — it represents the story entry point
    nodes.push({ id: '__root__', label: 'Root', type: 'root', width: NODE_WIDTH, height: NODE_HEIGHT });
    nodeIds.add('__root__');

    // Create nodes for all knots and stitches
    structure.knots.forEach((knot: KnotInfo) => {
        const knotId = knot.name;
        if (!nodeIds.has(knotId)) {
            nodes.push({
                id: knotId,
                label: knot.name,
                type: 'knot',
                width: NODE_WIDTH,
                height: NODE_HEIGHT
            });
            nodeIds.add(knotId);
        }

        // Create nodes for stitches
        knot.stitches.forEach((stitch: StitchInfo) => {
            const stitchId = `${knot.name}.${stitch.name}`;
            if (!nodeIds.has(stitchId)) {
                nodes.push({
                    id: stitchId,
                    label: stitch.name,
                    type: 'stitch',
                    knotName: knot.name,
                    width: NODE_WIDTH,
                    height: NODE_HEIGHT
                });
                nodeIds.add(stitchId);
            }
        });
    });

    // Create links
    const createLink = (source: string, target: string) => {
        if (nodeIds.has(source) && nodeIds.has(target)) {
            links.push({
                source,
                target,
                isConditional: false
            });
        }
    };

    structure.knots.forEach((knot: KnotInfo) => {
        // Knot exits
        knot.exits.forEach((targetName: string) => createLink(knot.name, targetName));

        // Stitch exits
        knot.stitches.forEach((stitch: StitchInfo) => {
            const stitchId = `${knot.name}.${stitch.name}`;
            stitch.exits.forEach((targetName: string) => createLink(stitchId, targetName));
        });
    });

    // Root exits
    if (structure.rootExits) {
        structure.rootExits.forEach((targetName: string) => createLink('__root__', targetName));
    }

    return { nodes, links };
}

/**
 * Computes the strict layout for the graph.
 */
export function computeStrictLayout(graph: Graph): void {
    const islands = createKnotIslands(graph);

    // Build Island Graph (Adjacency between islands)
    // We need both Directed (for Rank) and Undirected (for Components)
    const islandAdjacency = new Map<string, Set<string>>();
    const islandReverseAdjacency = new Map<string, Set<string>>();
    const islandUndirectedAdjacency = new Map<string, Set<string>>();

    // Initialize adjacency maps
    islands.forEach(island => {
        islandAdjacency.set(island.id, new Set());
        islandReverseAdjacency.set(island.id, new Set());
        islandUndirectedAdjacency.set(island.id, new Set());
    });

    // Populate adjacency based on node links
    graph.links.forEach(link => {
        const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
        const targetId = typeof link.target === 'object' ? link.target.id : link.target;

        const sourceIsland = findIslandForNode(sourceId, islands);
        const targetIsland = findIslandForNode(targetId, islands);

        if (sourceIsland && targetIsland && sourceIsland !== targetIsland) {
            islandAdjacency.get(sourceIsland.id)!.add(targetIsland.id);
            islandReverseAdjacency.get(targetIsland.id)!.add(sourceIsland.id);

            islandUndirectedAdjacency.get(sourceIsland.id)!.add(targetIsland.id);
            islandUndirectedAdjacency.get(targetIsland.id)!.add(sourceIsland.id);
        }
    });

    // Identify Connected Components
    const components = getConnectedComponents(islands, islandUndirectedAdjacency);

    // Layout Each Component Independently
    let currentComponentY = 0;

    // Sort components by size (largest first)? Or deterministically?
    // Deterministic is better for stability.
    // Sort by ID of the first island in component.
    components.sort((a, b) => a[0].id.localeCompare(b[0].id));

    components.forEach(componentIslands => {
        // Rank Islands within this component
        rankIslands(componentIslands, islandAdjacency);

        // Position Islands within this component (Relative to component 0,0)
        // Passes reverse adjacency for Barycenter heuristic
        positionIslands(componentIslands, islandReverseAdjacency);

        // Calculate Component Height and Shift
        let compHeight = 0;
        componentIslands.forEach(island => {
            island.y += currentComponentY; // Apply vertical stack offset
            compHeight = Math.max(compHeight, island.y - currentComponentY + island.height);
        });

        currentComponentY += compHeight + ISLAND_SPACING_Y * 2; // Extra spacing between components
    });

    // Finalize Node Positions
    applyPositionsToNodes(islands);
}

function getConnectedComponents(
    islands: Island[],
    undirectedAdjacency: Map<string, Set<string>>
): Island[][] {
    const visited = new Set<string>();
    const components: Island[][] = [];

    // Sort islands to ensure deterministic component discovery 
    // (if graph is disconnected, order matters for which component is "first")
    const sortedIslands = [...islands].sort((a, b) => a.id.localeCompare(b.id));

    sortedIslands.forEach(island => {
        if (visited.has(island.id)) return;

        const component: Island[] = [];
        const queue = [island];
        visited.add(island.id);

        while (queue.length > 0) {
            const current = queue.shift()!;
            component.push(current);

            const neighbors = undirectedAdjacency.get(current.id);
            if (neighbors) {
                neighbors.forEach(neighborId => {
                    const neighbor = islands.find(i => i.id === neighborId); // optimize? Map lookup is faster
                    if (neighbor && !visited.has(neighborId)) {
                        visited.add(neighborId);
                        queue.push(neighbor);
                    }
                });
            }
        }
        components.push(component);
    });

    return components;
}

function createKnotIslands(graph: Graph): Island[] {
    const islandMap = new Map<string, Island>();

    // Identify Island Roots (Knots and Root)
    graph.nodes.forEach(node => {
        if (node.type === 'knot' || node.type === 'root') {
            islandMap.set(node.id, {
                id: node.id,
                knotNode: node,
                stitches: [],
                width: NODE_WIDTH + KNOT_PADDING * 2,
                height: NODE_HEIGHT + KNOT_PADDING * 2,
                x: 0,
                y: 0,
                rank: 0
            });
        }
    });

    // Assign Stitches to Islands
    graph.nodes.forEach(node => {
        if (node.type === 'stitch' && node.knotName) {
            const island = islandMap.get(node.knotName);
            if (island) {
                island.stitches.push(node);
            }
        }
    });

    // Layout Internals of each Island
    islandMap.forEach(island => {
        layoutStitchesInIsland(island, graph);
    });

    return Array.from(islandMap.values());
}

function layoutStitchesInIsland(island: Island, graph: Graph) {
    // Collect stitches and build local dependency graph
    const stitches = island.stitches;
    if (stitches.length === 0) {
        // Just the knot
        island.knotNode.x = KNOT_PADDING;
        island.knotNode.y = KNOT_PADDING;
        island.width = NODE_WIDTH + KNOT_PADDING * 2;
        island.height = NODE_HEIGHT + KNOT_PADDING * 2;
        return;
    }

    const stitchIdMap = new Map<string, GraphNode>();
    stitches.forEach(s => stitchIdMap.set(s.id, s));

    const localAdj = new Map<string, string[]>();
    const localInDegree = new Map<string, number>();
    stitches.forEach(s => {
        localAdj.set(s.id, []);
        localInDegree.set(s.id, 0); // Initialize
    });

    // Identify links between stitches WITHIN this island
    // Also links from Knot -> Stitch
    const knotId = island.knotNode.id;
    const connectedFromKnot = new Set<string>();

    graph.links.forEach(link => {
        const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
        const targetId = typeof link.target === 'object' ? link.target.id : link.target;

        const isInternalStitchLink = stitchIdMap.has(sourceId) && stitchIdMap.has(targetId);
        if (isInternalStitchLink) {
            localAdj.get(sourceId)!.push(targetId);
            localInDegree.set(targetId, (localInDegree.get(targetId) || 0) + 1);
        }

        const isKnotToStitch = sourceId === knotId && stitchIdMap.has(targetId);
        if (isKnotToStitch) {
            connectedFromKnot.add(targetId);
            // We treat Knot->Stitch as a primary vertical flow, but "parallel streams" 
            // imply we might have multiple starts.
            // We won't increment inDegree here to allow them to be "Roots" of streams 
            // if they don't have other stitch dependencies.
        }
    });

    // Identify Stream Roots: Stitches with In-Degree 0 (from other stitches)
    // These start new vertical chains.
    const streamRoots = stitches.filter(s => (localInDegree.get(s.id) || 0) === 0);

    // If no roots (cycle?), pick one arbitrarily
    if (streamRoots.length === 0 && stitches.length > 0) {
        streamRoots.push(stitches[0]);
    }

    // Assign Streams and Depths (Simple DFS/BFS per root)
    // We want to layout streams horizontally.

    let currentStreamX = KNOT_PADDING;
    let maxIslandHeight = 0;

    // Sort stream roots: Connected from Knot first?
    streamRoots.sort((a, b) => {
        const aConnected = connectedFromKnot.has(a.id) ? 1 : 0;
        const bConnected = connectedFromKnot.has(b.id) ? 1 : 0;
        if (aConnected !== bConnected) return bConnected - aConnected; // Connected first
        return a.id.localeCompare(b.id);
    });

    const visited = new Set<string>();

    streamRoots.forEach(root => {
        if (visited.has(root.id)) return;

        // Trace this stream
        const streamNodes: GraphNode[] = [];
        const queue = [root];

        while (queue.length > 0) {
            const node = queue.shift()!;
            if (visited.has(node.id)) continue;
            visited.add(node.id);
            streamNodes.push(node);

            const children = localAdj.get(node.id) || [];
            // Sort children by connection?
            children.forEach(childId => {
                const child = stitchIdMap.get(childId);
                if (child && !visited.has(childId)) {
                    queue.push(child);
                }
            });
        }

        // Layout this stream vertically
        let currentY = KNOT_PADDING + NODE_HEIGHT + STITCH_SPACING_Y;

        // Knot is centered above *all* streams? 
        // Or just placed at top-left? Top-left is safest for now.

        streamNodes.forEach(node => {
            node.x = currentStreamX;
            node.y = currentY;
            currentY += NODE_HEIGHT + STITCH_SPACING_Y;
        });

        const streamWidth = NODE_WIDTH;
        const streamHeight = currentY - STITCH_SPACING_Y; // Remove last spacing

        maxIslandHeight = Math.max(maxIslandHeight, streamHeight);
        currentStreamX += streamWidth + KNOT_PADDING; // Spacing between streams
    });

    // Handle any unreachable stitches (cycles disconnected from roots?)
    stitches.forEach(s => {
        if (!visited.has(s.id)) {
            // Append as new stream
            s.x = currentStreamX;
            s.y = KNOT_PADDING + NODE_HEIGHT + STITCH_SPACING_Y;
            currentStreamX += NODE_WIDTH + KNOT_PADDING;
            maxIslandHeight = Math.max(maxIslandHeight, s.y! + NODE_HEIGHT);
        }
    });

    // Update Island Dimensions
    island.width = Math.max(currentStreamX - KNOT_PADDING + KNOT_PADDING, NODE_WIDTH + KNOT_PADDING * 2);
    island.height = Math.max(maxIslandHeight + KNOT_PADDING, NODE_HEIGHT + KNOT_PADDING * 2);

    // Center Knot Node over the Island
    island.knotNode.x = (island.width - NODE_WIDTH) / 2;
    island.knotNode.y = KNOT_PADDING;
}

function findIslandForNode(nodeId: string, islands: Island[]): Island | undefined {
    // Check if it's an island ID
    let island = islands.find(i => i.id === nodeId);
    if (island) return island;

    // Check stitches
    for (const i of islands) {
        if (i.stitches.some(s => s.id === nodeId)) return i;
    }
    return undefined;
}

function rankIslands(
    islands: Island[],
    adjacency: Map<string, Set<string>>
) {
    const ranks = new Map<string, number>();

    // Identify Back Edges:
    // Run DFS. If edge (u, v) goes to ancestor, mark as Back Edge.
    const backEdges = new Set<string>(); // "source->target"
    const dfsVisited = new Set<string>();
    const dfsStack = new Set<string>();

    const detectBackEdges = (u: string) => {
        dfsVisited.add(u);
        dfsStack.add(u);

        const targets = adjacency.get(u);
        if (targets) {
            targets.forEach(v => {
                if (!dfsVisited.has(v)) {
                    detectBackEdges(v);
                } else if (dfsStack.has(v)) {
                    // Back Edge detected
                    backEdges.add(`${u}->${v}`);
                }
            });
        }
        dfsStack.delete(u);
    };

    // Run Cycle Detection from Roots (and unvisited for disconnected components)
    // We iterate islands to catch all components
    islands.forEach(i => {
        if (!dfsVisited.has(i.id)) {
            detectBackEdges(i.id);
        }
    });

    // Now run Forward-Push BFS/Relaxation ignoring Back Edges
    // Initialize Ranks
    islands.forEach(i => ranks.set(i.id, 0));

    // Use a robust relaxation loop
    // But limit iterations to avoid any weird infinite loops (though back-edge removal should fix it)

    let changed = true;
    let iterations = 0;
    const MAX_ITERATIONS = islands.length + 50;

    while (changed && iterations < MAX_ITERATIONS) {
        changed = false;
        iterations++;

        // Iterate all edges
        adjacency.forEach((targets, u) => {
            targets.forEach(v => {
                if (backEdges.has(`${u}->${v}`)) return; // Ignore back edges

                const rankU = ranks.get(u) || 0;
                const rankV = ranks.get(v) || 0;

                if (rankU + 1 > rankV) {
                    ranks.set(v, rankU + 1);
                    changed = true;
                }
            });
        });
    }

    islands.forEach(i => {
        i.rank = ranks.get(i.id) || 0;
    });
}

function positionIslands(
    islands: Island[],
    reverseAdjacency: Map<string, Set<string>>
) {
    // Group by Rank
    const rankMap = new Map<number, Island[]>();
    islands.forEach(i => {
        if (!rankMap.has(i.rank)) rankMap.set(i.rank, []);
        rankMap.get(i.rank)!.push(i);
    });

    const maxRank = Math.max(...Array.from(rankMap.keys()), 0);
    let currentX = 0;

    // Optimize: Create lookup for quick retrieval
    const islandMap = new Map<string, Island>();
    islands.forEach(i => islandMap.set(i.id, i));

    for (let r = 0; r <= maxRank; r++) {
        const rankIslands = rankMap.get(r) || [];
        if (rankIslands.length === 0) continue;

        let rankMaxWidth = 0;
        rankIslands.forEach(i => rankMaxWidth = Math.max(rankMaxWidth, i.width));

        // Calculate Ideal Y (Barycenter)
        const islandIdealY = new Map<string, number>();

        rankIslands.forEach(island => {
            let idealY = 0;
            if (r === 0) {
                // Rank 0: Keep roughly centered or just basic stack order?
                // We rely on the sort below to stack them tightly starting at 0 if no heuristic.
                idealY = 0;
            } else {
                const parents = reverseAdjacency.get(island.id);
                if (parents && parents.size > 0) {
                    let sumY = 0;
                    let count = 0;
                    parents.forEach(pid => {
                        const parent = islandMap.get(pid);
                        // Use parent's center
                        if (parent && parent.rank < r) {
                            sumY += parent.y + (parent.height / 2);
                            count++;
                        }
                    });
                    // Ideal Y is the center point we want to be at.
                    // So we want: y + height/2 = average_parent_center
                    // y = average_parent_center - height/2
                    idealY = (count > 0) ? (sumY / count) - (island.height / 2) : 0;
                } else {
                    // No parents? 
                    idealY = 0;
                }
            }
            islandIdealY.set(island.id, idealY);
        });

        // Sort by Ideal Y
        rankIslands.sort((a, b) => {
            const yA = islandIdealY.get(a.id) || 0;
            const yB = islandIdealY.get(b.id) || 0;
            if (Math.abs(yA - yB) < 1) {
                return a.id.localeCompare(b.id);
            }
            return yA - yB;
        });

        // Assign Coordinates (Scan Line / Push Down)
        // Tracks the bottom of the previous item in this rank
        let currentY = -Infinity;

        if (r === 0) currentY = 0;

        rankIslands.forEach(island => {
            let desired = islandIdealY.get(island.id) || 0;

            if (currentY === -Infinity) {
                // First item in rank, just take desired (clamped to 0?)
                island.y = Math.max(0, desired);
            } else {
                // Must be below previous item
                island.y = Math.max(desired, currentY + ISLAND_SPACING_Y);
            }

            island.x = currentX;
            currentY = island.y + island.height;
        });

        currentX += rankMaxWidth + ISLAND_SPACING_X;
    }
}

function applyPositionsToNodes(islands: Island[]) {
    islands.forEach(island => {
        // Apply Island Offset to Knot Node
        island.knotNode.x = island.x + island.knotNode.x!;
        island.knotNode.y = island.y + island.knotNode.y!;

        // Apply Island Offset to Stitches
        island.stitches.forEach(stitch => {
            stitch.x = island.x + stitch.x!;
            stitch.y = island.y + stitch.y!;
        });
    });
}

export interface GraphOptions {
    onNodeClick?: (nodeId: string, nodeType: NodeType, knotName?: string) => void;
    onNodeTest?: (nodeId: string, nodeType: NodeType, knotName?: string) => void;
    onTransformChange?: (transform: { x: number; y: number; k: number }) => void;
    initialTransform?: { x: number; y: number; k: number };
    initialSelectedNodeId?: string | null;
}

export interface GraphController {
    getTransform(): { x: number; y: number; k: number };
    setTransform(x: number, y: number, k: number): void;
    getSelectedNodeId(): string | null;
    selectNode(nodeId: string): void;
    updateColors(): void;
    highlightCurrentNode(nodeId: string | null, visited?: Map<string, number>): void;
    centreOnNode(nodeId: string): void;
}
