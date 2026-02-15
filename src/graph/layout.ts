/**
 * Graph Layout Logic
 * Handles the conversion of story structure to graph data and computing node positions
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
    fx?: number | null; // For d3 force simulation
    fy?: number | null; // For d3 force simulation
}

export interface GraphLink {
    source: string | GraphNode; // d3 force simulation replaces string ids with node objects
    target: string | GraphNode;
    isConditional: boolean;
}

export interface Graph {
    nodes: GraphNode[];
    links: GraphLink[];
}

/**
 * Converts story structure to graph format
 */
export function structureToGraph(structure: StoryStructure): Graph {
    const nodes: GraphNode[] = [];
    const links: GraphLink[] = [];
    const nodeIds = new Set<string>();

    // Always create root node — it represents the story entry point
    nodes.push({ id: '__root__', label: 'Root', type: 'root' });
    nodeIds.add('__root__');

    // Create nodes for all knots and stitches
    structure.knots.forEach((knot: KnotInfo) => {
        const knotId = knot.name;
        if (!nodeIds.has(knotId)) {
            nodes.push({
                id: knotId,
                label: knot.name,
                type: 'knot'
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
                    knotName: knot.name
                });
                nodeIds.add(stitchId);
            }
        });
    });

    // Create links from knot and stitch exits (same data source as the structure output)
    structure.knots.forEach((knot: KnotInfo) => {
        const sourceId = knot.name;

        // Add links from knot exits
        knot.exits.forEach((targetName: string) => {
            // Check if target exists as a node (could be a knot or a knot.stitch)
            if (nodeIds.has(targetName)) {
                links.push({
                    source: sourceId,
                    target: targetName,
                    isConditional: false
                });
            }
        });

        // Add links from stitch exits
        knot.stitches.forEach((stitch: StitchInfo) => {
            const stitchId = `${knot.name}.${stitch.name}`;

            stitch.exits.forEach((targetName: string) => {
                // Check if target exists as a node
                if (nodeIds.has(targetName)) {
                    links.push({
                        source: stitchId,
                        target: targetName,
                        isConditional: false
                    });
                }
            });
        });
    });

    // Add links from root exits
    if (structure.rootExits && nodeIds.has('__root__')) {
        structure.rootExits.forEach((targetName: string) => {
            if (nodeIds.has(targetName)) {
                links.push({ source: '__root__', target: targetName, isConditional: false });
            }
        });
    }

    return { nodes, links };
}

/**
 * Function to compute hierarchical positions (top-to-bottom based on story flow)
 */
export function computeHierarchicalPositions(graph: Graph, knotGroups: Map<string, GraphNode[]>, height: number) {
    // Build adjacency map (only for knot-level connections)
    const adjacency = new Map<string, Set<string>>();
    const reverseAdjacency = new Map<string, Set<string>>();

    graph.nodes.forEach(n => {
        if (n.type === 'knot' || n.type === 'root') {
            adjacency.set(n.id, new Set());
            reverseAdjacency.set(n.id, new Set());
        }
    });

    graph.links.forEach(link => {
        const sourceId = typeof link.source === 'string' ? link.source : (link.source as any).id;
        const targetId = typeof link.target === 'string' ? link.target : (link.target as any).id;

        // Only track knot-to-knot connections
        const sourceNode = graph.nodes.find(n => n.id === sourceId);
        const targetNode = graph.nodes.find(n => n.id === targetId);

        if (sourceNode && targetNode) {
            const sourceKnot = (sourceNode.type === 'knot' || sourceNode.type === 'root') ? sourceNode.id : sourceNode.knotName;
            const targetKnot = (targetNode.type === 'knot' || targetNode.type === 'root') ? targetNode.id : targetNode.knotName;

            if (sourceKnot && targetKnot && sourceKnot !== targetKnot) {
                adjacency.get(sourceKnot)?.add(targetKnot);
                reverseAdjacency.get(targetKnot)?.add(sourceKnot);
            }
        }
    });

    // Compute depth (vertical level) for knots using BFS
    const depths = new Map<string, number>();
    const visited = new Set<string>();
    const queue: Array<{ id: string; depth: number }> = [];

    // Knots and root are laid out at the top level
    const knots = graph.nodes.filter(n => n.type === 'knot' || n.type === 'root');

    // Start BFS from root node if present, otherwise from the first knot
    const startNode = knots.find(n => n.type === 'root') || knots[0];
    if (startNode) {
        queue.push({ id: startNode.id, depth: 0 });
        visited.add(startNode.id);
        depths.set(startNode.id, 0);
    }

    // BFS to assign depths - follow both forward and reverse edges
    // so that nodes only reachable via reverse edges (e.g. OtherContent → Main)
    // are still part of the connected component
    while (queue.length > 0) {
        const { id, depth } = queue.shift()!;

        // Forward edges: children at depth + 1
        const forward = adjacency.get(id);
        if (forward) {
            for (const neighborId of forward) {
                if (!visited.has(neighborId)) {
                    visited.add(neighborId);
                    depths.set(neighborId, depth + 1);
                    queue.push({ id: neighborId, depth: depth + 1 });
                }
            }
        }

        // Reverse edges: nodes that point to us, also at depth + 1
        const backward = reverseAdjacency.get(id);
        if (backward) {
            for (const neighborId of backward) {
                if (!visited.has(neighborId)) {
                    visited.add(neighborId);
                    depths.set(neighborId, depth + 1);
                    queue.push({ id: neighborId, depth: depth + 1 });
                }
            }
        }
    }

    // Record which knots are in the connected graph
    const connectedKnotIds = new Set(visited);

    // Process truly disconnected knots (no edges to/from the connected graph)
    // Each component gets its own internal hierarchy starting from depth 0
    while (true) {
        const unvisitedKnot = knots.find(n => !visited.has(n.id));
        if (!unvisitedKnot) break;

        // Discover all nodes in this disconnected component (undirected)
        const component = new Set<string>();
        const discoverQueue = [unvisitedKnot.id];
        component.add(unvisitedKnot.id);

        while (discoverQueue.length > 0) {
            const id = discoverQueue.shift()!;
            for (const neighborId of [...(adjacency.get(id) || []), ...(reverseAdjacency.get(id) || [])]) {
                if (!component.has(neighborId) && !visited.has(neighborId)) {
                    component.add(neighborId);
                    discoverQueue.push(neighborId);
                }
            }
        }

        // Directed BFS within the component (starting from depth 0)
        const componentEntry = Array.from(component).find(id => {
            const incoming = reverseAdjacency.get(id);
            return !incoming || !Array.from(incoming).some(src => component.has(src));
        }) || Array.from(component)[0];

        const compQueue: Array<{ id: string; depth: number }> = [];
        compQueue.push({ id: componentEntry, depth: 0 });
        visited.add(componentEntry);
        depths.set(componentEntry, 0);

        while (compQueue.length > 0) {
            const { id, depth: d } = compQueue.shift()!;
            const forward = adjacency.get(id);
            if (forward) {
                for (const neighborId of forward) {
                    if (!visited.has(neighborId) && component.has(neighborId)) {
                        visited.add(neighborId);
                        depths.set(neighborId, d + 1);
                        compQueue.push({ id: neighborId, depth: d + 1 });
                    }
                }
            }
        }

        // Handle remaining nodes in the component (cycles etc.)
        component.forEach(id => {
            if (!visited.has(id)) {
                visited.add(id);
                depths.set(id, 0);
            }
        });
    }

    // Layout parameters
    const depthSpacing = 300; // Horizontal spacing between knot levels (left-to-right)
    const knotVerticalSpacing = 400; // Vertical spacing when spreading multiple children
    const stitchVerticalOffset = 100; // Offset for stitches below their knot
    const stitchHorizontalSpacing = 150; // Horizontal spacing for stitches

    // Group knots by depth
    const knotsByDepth = new Map<number, GraphNode[]>();
    knots.forEach(n => {
        const depth = depths.get(n.id) || 0;
        if (!knotsByDepth.has(depth)) {
            knotsByDepth.set(depth, []);
        }
        knotsByDepth.get(depth)!.push(n);
    });

    // Track vertical positions for knots (horizontal layout: left-to-right with vertical spreading)
    const verticalPositions = new Map<string, number>();
    const positioned = new Set<string>();

    // Layout knots level by level, processing parents before children
    const sortedDepths = Array.from(knotsByDepth.keys()).sort((a, b) => a - b);

    sortedDepths.forEach(depth => {
        const knotsAtDepth = knotsByDepth.get(depth) || [];

        // First, position any nodes at this depth that don't have parents
        knotsAtDepth.forEach(knotNode => {
            const parents = reverseAdjacency.get(knotNode.id);
            if (!parents || parents.size === 0) {
                if (!positioned.has(knotNode.id)) {
                    // Root nodes - spread vertically centered
                    const rootNodes = knotsAtDepth.filter(n => {
                        const p = reverseAdjacency.get(n.id);
                        return !p || p.size === 0;
                    });
                    const index = rootNodes.indexOf(knotNode);
                    const totalRoots = rootNodes.length;
                    const centerY = height / 2;
                    const spreadHeight = (totalRoots - 1) * knotVerticalSpacing;
                    verticalPositions.set(knotNode.id, centerY - spreadHeight / 2 + index * knotVerticalSpacing);
                    positioned.add(knotNode.id);
                }
            }
        });

        // Now position children based on their parents
        // Group children by their parent(s)
        const childrenByParent = new Map<string, Set<string>>();

        if (depth > 0) {
            const prevDepthKnots = knotsByDepth.get(depth - 1) || [];
            prevDepthKnots.forEach(parentKnot => {
                const children = adjacency.get(parentKnot.id);
                if (children && children.size > 0) {
                    childrenByParent.set(parentKnot.id, children);
                }
            });

            // Position children for each parent
            childrenByParent.forEach((children, parentId) => {
                const parentY = verticalPositions.get(parentId);
                if (parentY === undefined) return;

                const childrenArray = Array.from(children).filter(c => !positioned.has(c));
                if (childrenArray.length === 0) return;

                if (childrenArray.length === 1) {
                    // Single child - same vertical position as parent
                    const childId = childrenArray[0];
                    verticalPositions.set(childId, parentY);
                    positioned.add(childId);
                } else {
                    // Multiple children - spread vertically, centered as a group around parent
                    const spreadHeight = (childrenArray.length - 1) * knotVerticalSpacing;
                    childrenArray.forEach((childId, index) => {
                        const childY = parentY - spreadHeight / 2 + index * knotVerticalSpacing;

                        // If child already has a position from another parent, average them
                        if (verticalPositions.has(childId)) {
                            const existingY = verticalPositions.get(childId)!;
                            verticalPositions.set(childId, (existingY + childY) / 2);
                        } else {
                            verticalPositions.set(childId, childY);
                        }
                        positioned.add(childId);
                    });
                }
            });
        }

        // Finally, position any remaining unpositioned nodes at this depth
        knotsAtDepth.forEach(knotNode => {
            if (!positioned.has(knotNode.id)) {
                // Unconnected nodes - spread them out vertically
                const unpositioned = knotsAtDepth.filter(n => !positioned.has(n.id));
                const index = unpositioned.indexOf(knotNode);
                const centerY = height / 2;
                const spreadHeight = (unpositioned.length - 1) * knotVerticalSpacing;
                verticalPositions.set(knotNode.id, centerY - spreadHeight / 2 + index * knotVerticalSpacing);
                positioned.add(knotNode.id);
            }
        });

        // Now position knots and their stitches
        knotsAtDepth.forEach((knotNode) => {
            // Horizontal layout: X based on depth (left-to-right), Y from vertical position map
            const baseX = 100 + depth * depthSpacing;
            const baseY = verticalPositions.get(knotNode.id)!;

            // Store original baseY for later adjustment
            (knotNode as any).originalBaseY = baseY;

            // Get stitches for this knot (in order from original structure)
            const stitches = knotGroups.get(knotNode.id) || [];

            if (stitches.length > 0) {
                // Build adjacency map for stitches within this knot
                const stitchAdjacency = new Map<string, Set<string>>();
                const stitchReverseAdjacency = new Map<string, Set<string>>();

                stitches.forEach(s => {
                    stitchAdjacency.set(s.id, new Set());
                    stitchReverseAdjacency.set(s.id, new Set());
                });

                // Find connections between stitches in this knot
                graph.links.forEach(link => {
                    const sourceId = typeof link.source === 'string' ? link.source : (link.source as any).id;
                    const targetId = typeof link.target === 'string' ? link.target : (link.target as any).id;

                    const sourceStitch = stitches.find(s => s.id === sourceId);
                    const targetStitch = stitches.find(s => s.id === targetId);

                    if (sourceStitch && targetStitch) {
                        stitchAdjacency.get(sourceId)?.add(targetId);
                        stitchReverseAdjacency.get(targetId)?.add(sourceId);
                    }
                });

                // Compute depths for stitches
                const stitchDepths = new Map<string, number>();
                const stitchVisited = new Set<string>();
                const stitchQueue: Array<{ id: string; depth: number }> = [];

                // Start with first stitch or stitches with no parents
                const rootStitches = stitches.filter(s =>
                    stitchReverseAdjacency.get(s.id)?.size === 0
                );

                if (rootStitches.length > 0) {
                    rootStitches.forEach(s => {
                        stitchQueue.push({ id: s.id, depth: 0 });
                        stitchVisited.add(s.id);
                        stitchDepths.set(s.id, 0);
                    });
                } else {
                    // No clear root, start with first stitch
                    stitchQueue.push({ id: stitches[0].id, depth: 0 });
                    stitchVisited.add(stitches[0].id);
                    stitchDepths.set(stitches[0].id, 0);
                }

                // BFS to assign depths
                while (stitchQueue.length > 0) {
                    const { id, depth } = stitchQueue.shift()!;
                    const neighbors = stitchAdjacency.get(id);

                    if (neighbors) {
                        for (const neighborId of neighbors) {
                            if (!stitchVisited.has(neighborId)) {
                                stitchVisited.add(neighborId);
                                stitchDepths.set(neighborId, depth + 1);
                                stitchQueue.push({ id: neighborId, depth: depth + 1 });
                            }
                        }
                    }
                }

                // Assign depths to any unvisited stitches
                stitches.forEach(s => {
                    if (!stitchDepths.has(s.id)) {
                        stitchDepths.set(s.id, 0);
                    }
                });

                // Group stitches by depth
                const stitchesByDepth = new Map<number, typeof stitches>();
                stitches.forEach(s => {
                    const d = stitchDepths.get(s.id) || 0;
                    if (!stitchesByDepth.has(d)) {
                        stitchesByDepth.set(d, []);
                    }
                    stitchesByDepth.get(d)!.push(s);
                });

                // Layout stitches using the same parent-child rule
                const stitchHorizontalPositions = new Map<string, number>();
                const stitchPositioned = new Set<string>();
                const stitchVerticalSpacing = 90;

                const sortedStitchDepths = Array.from(stitchesByDepth.keys()).sort((a, b) => a - b);

                sortedStitchDepths.forEach(stitchDepth => {
                    const stitchesAtDepth = stitchesByDepth.get(stitchDepth) || [];

                    // Position root stitches (no parents)
                    stitchesAtDepth.forEach(stitch => {
                        const parents = stitchReverseAdjacency.get(stitch.id);
                        if (!parents || parents.size === 0) {
                            if (!stitchPositioned.has(stitch.id)) {
                                const rootStitches = stitchesAtDepth.filter(s => {
                                    const p = stitchReverseAdjacency.get(s.id);
                                    return !p || p.size === 0;
                                });
                                const index = rootStitches.indexOf(stitch);
                                const spreadWidth = (rootStitches.length - 1) * stitchHorizontalSpacing;
                                stitchHorizontalPositions.set(stitch.id, - spreadWidth / 2 + index * stitchHorizontalSpacing);
                                stitchPositioned.add(stitch.id);
                            }
                        }
                    });

                    // Position children based on their parents
                    if (stitchDepth > 0) {
                        const prevDepthStitches = stitchesByDepth.get(stitchDepth - 1) || [];

                        prevDepthStitches.forEach(parentStitch => {
                            const children = stitchAdjacency.get(parentStitch.id);
                            if (!children || children.size === 0) return;

                            const parentX = stitchHorizontalPositions.get(parentStitch.id);
                            if (parentX === undefined) return;

                            const childrenArray = Array.from(children).filter(c => !stitchPositioned.has(c));
                            if (childrenArray.length === 0) return;

                            if (childrenArray.length === 1) {
                                // Single child - center below parent
                                const childId = childrenArray[0];
                                stitchHorizontalPositions.set(childId, parentX);
                                stitchPositioned.add(childId);
                            } else {
                                // Multiple children - spread horizontally, centered as a group below parent
                                const spreadWidth = (childrenArray.length - 1) * stitchHorizontalSpacing;
                                childrenArray.forEach((childId, index) => {
                                    const childX = parentX - spreadWidth / 2 + index * stitchHorizontalSpacing;

                                    if (stitchHorizontalPositions.has(childId)) {
                                        const existingX = stitchHorizontalPositions.get(childId)!;
                                        stitchHorizontalPositions.set(childId, (existingX + childX) / 2);
                                    } else {
                                        stitchHorizontalPositions.set(childId, childX);
                                    }
                                    stitchPositioned.add(childId);
                                });
                            }
                        });
                    }

                    // Position any remaining stitches at this depth
                    stitchesAtDepth.forEach(stitch => {
                        if (!stitchPositioned.has(stitch.id)) {
                            const unpositioned = stitchesAtDepth.filter(s => !stitchPositioned.has(s.id));
                            const index = unpositioned.indexOf(stitch);
                            const spreadWidth = (unpositioned.length - 1) * stitchHorizontalSpacing;
                            stitchHorizontalPositions.set(stitch.id, - spreadWidth / 2 + index * stitchHorizontalSpacing);
                            stitchPositioned.add(stitch.id);
                        }
                    });
                });

                // Position stitches
                stitches.forEach((stitch) => {
                    const stitchDepth = stitchDepths.get(stitch.id) || 0;
                    stitch.x = baseX + (stitchHorizontalPositions.get(stitch.id) || 0);
                    stitch.y = baseY + stitchVerticalOffset + stitchDepth * stitchVerticalSpacing;
                });

                // Position knot
                knotNode.x = baseX;
                knotNode.y = baseY;
            } else {
                // Knot has no stitches - position normally
                knotNode.x = baseX;
                knotNode.y = baseY;
            }
        });
    });

    // Post-process to fix overlapping knots and avoid stitches
    // Pre-calculate relative bounds for all knots (including their stitches)
    const knotBounds = new Map<string, { minX: number, maxX: number, minY: number, maxY: number }>();

    const KNOT_HALF_WIDTH = 60;
    const KNOT_HALF_HEIGHT = 30;

    knots.forEach(k => {
        let minX = -KNOT_HALF_WIDTH;
        let maxX = KNOT_HALF_WIDTH;
        let minY = -KNOT_HALF_HEIGHT;
        let maxY = KNOT_HALF_HEIGHT;

        const stitches = knotGroups.get(k.id) || [];
        stitches.forEach(s => {
            // Calculate relative position of stitch to knot
            if (s.x !== undefined && s.y !== undefined && k.x !== undefined && k.y !== undefined) {
                const dx = s.x - k.x;
                const dy = s.y - k.y;
                minX = Math.min(minX, dx - KNOT_HALF_WIDTH);
                maxX = Math.max(maxX, dx + KNOT_HALF_WIDTH);
                minY = Math.min(minY, dy - KNOT_HALF_HEIGHT);
                maxY = Math.max(maxY, dy + KNOT_HALF_HEIGHT);
            }
        });

        knotBounds.set(k.id, { minX, maxX, minY, maxY });
    });

    // Iterate through knots by depth to check for conflicts
    sortedDepths.forEach(depth => {
        const knotsAtDepth = knotsByDepth.get(depth) || [];

        knotsAtDepth.forEach(knotNode => {
            if (!knotNode.x || !knotNode.y) return;

            let hasConflict = true;
            let offsetAttempts = 0;
            const maxOffsetAttempts = 20;

            while (hasConflict && offsetAttempts < maxOffsetAttempts) {
                hasConflict = false;

                // Check knots at same depth and immediately previous depth
                const startDepth = Math.max(0, depth - 1);

                for (let d = startDepth; d <= depth; d++) {
                    const checkKnots = knotsByDepth.get(d) || [];

                    for (const otherKnot of checkKnots) {
                        if (otherKnot === knotNode || !otherKnot.x || !otherKnot.y) continue;

                        // Use pre-calculated bounds
                        const otherBounds = knotBounds.get(otherKnot.id);
                        if (!otherBounds) continue;

                        const otherMinX = otherKnot.x + otherBounds.minX;
                        const otherMaxX = otherKnot.x + otherBounds.maxX;
                        const otherMinY = otherKnot.y + otherBounds.minY;
                        const otherMaxY = otherKnot.y + otherBounds.maxY;

                        // Check if current knot (itself roughly a box) overlaps with otherKnot's bounds
                        const myMinX = knotNode.x - KNOT_HALF_WIDTH;
                        const myMaxX = knotNode.x + KNOT_HALF_WIDTH;
                        const myMinY = knotNode.y - KNOT_HALF_HEIGHT;
                        const myMaxY = knotNode.y + KNOT_HALF_HEIGHT;

                        // Collision check (AABB)
                        // Add some padding/margin for spacing (20px)
                        const MARGIN = 100;
                        const overlapsX = (myMinX < otherMaxX + MARGIN) && (myMaxX > otherMinX - MARGIN);
                        const overlapsY = (myMinY < otherMaxY + MARGIN) && (myMaxY > otherMinY - MARGIN);

                        if (overlapsX && overlapsY) {
                            // Collision detected!
                            hasConflict = true;
                            // Move current knot below the other knot's entire bounds
                            knotNode.y = otherMaxY + KNOT_HALF_HEIGHT + MARGIN + 20;
                            break;
                        }
                    }
                    if (hasConflict) break;
                }
                offsetAttempts++;
            }

            // Update stitch positions based on adjusted knot position
            const stitches = knotGroups.get(knotNode.id) || [];
            if (stitches.length > 0 && knotNode.y) {
                const originalBaseY = (knotNode as any).originalBaseY || knotNode.y;
                const yAdjustment = knotNode.y - originalBaseY;

                // Only adjust if the knot was moved
                if (yAdjustment !== 0) {
                    stitches.forEach(stitch => {
                        if (stitch.y !== undefined) {
                            stitch.y += yAdjustment;
                        }
                    });
                }
            }
        });
    });

    // Shift disconnected components below the connected graph so they don't
    // visually overlap with any edges in the connected graph
    let maxConnectedY = -Infinity;
    graph.nodes.forEach(n => {
        const knotId = (n.type === 'knot' || n.type === 'root') ? n.id : n.knotName || '';
        if (connectedKnotIds.has(knotId) && n.y !== undefined) {
            maxConnectedY = Math.max(maxConnectedY, n.y);
        }
    });

    if (maxConnectedY > -Infinity) {
        let minDisconnectedY = Infinity;
        graph.nodes.forEach(n => {
            const knotId = (n.type === 'knot' || n.type === 'root') ? n.id : n.knotName || '';
            if (!connectedKnotIds.has(knotId) && n.y !== undefined) {
                minDisconnectedY = Math.min(minDisconnectedY, n.y);
            }
        });

        if (minDisconnectedY < Infinity) {
            const verticalGap = 300;
            const yShift = maxConnectedY - minDisconnectedY + verticalGap;
            graph.nodes.forEach(n => {
                const knotId = (n.type === 'knot' || n.type === 'root') ? n.id : n.knotName || '';
                if (!connectedKnotIds.has(knotId) && n.y !== undefined) {
                    n.y += yShift;
                }
            });
        }
    }
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

