/**
 * Graph Visualizer
 * Creates an interactive force-directed graph of the Ink story structure
 */

import * as d3 from 'd3';
import type { StoryStructure, KnotInfo, StitchInfo } from './ink/analyzer.js';

interface GraphNode {
  id: string;
  label: string;
  type: 'knot' | 'stitch';
  knotName?: string; // For stitches, track which knot they belong to
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
}

interface GraphLink {
  source: string;
  target: string;
  isConditional: boolean;
}

interface Graph {
  nodes: GraphNode[];
  links: GraphLink[];
}

/**
 * Converts story structure to graph format
 */
function structureToGraph(structure: StoryStructure): Graph {
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];
  const nodeIds = new Set<string>();

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

  return { nodes, links };
}


export interface GraphOptions {
  onNodeClick?: (nodeId: string, nodeType: 'knot' | 'stitch', knotName?: string) => void;
  onTransformChange?: (transform: { x: number; y: number; k: number }) => void;
  initialTransform?: { x: number; y: number; k: number };
  initialSelectedNodeId?: string | null;
}

export interface GraphController {
  getTransform(): { x: number; y: number; k: number };
  setTransform(x: number, y: number, k: number): void;
  getSelectedNodeId(): string | null;
  selectNode(nodeId: string): void;
}

/**
 * Creates an interactive graph visualization
 */
export function createGraphVisualization(
  containerId: string,
  structure: StoryStructure,
  options?: GraphOptions
): GraphController | null {
  const onNodeClick = options?.onNodeClick;
  const container = document.getElementById(containerId);
  if (!container) {
    console.error(`Container ${containerId} not found`);
    return null;
  }

  // Clear previous content
  container.innerHTML = '';

  // Convert structure to graph
  const graph = structureToGraph(structure);

  if (graph.nodes.length === 0) {
    container.innerHTML = '<div class="empty-message">No nodes to display</div>';
    return null;
  }

  // Capture initial dimensions for layout computation
  const height = container.clientHeight;

  // Create SVG - no viewBox so resizing clips rather than rescaling
  const svg = d3.select(`#${containerId}`)
    .append('svg')
    .attr('width', '100%')
    .attr('height', '100%');

  // Create container for zoom
  const g = svg.append('g');

  // Define arrow marker for directed edges
  svg.append('defs')
    .append('marker')
    .attr('id', 'arrow')
    .attr('viewBox', '0 -5 10 10')
    .attr('refX', 9)
    .attr('refY', 0)
    .attr('markerWidth', 6)
    .attr('markerHeight', 6)
    .attr('orient', 'auto')
    .append('path')
    .attr('d', 'M0,-5L10,0L0,5')
    .attr('fill', '#95a5a6');

  // Create layers
  const linksLayer = g.append('g').attr('class', 'links');
  const nodesLayer = g.append('g').attr('class', 'nodes');

  // Variables to hold D3 selections and simulation
  let simulation: d3.Simulation<d3.SimulationNodeDatum, undefined>;
  let link: d3.Selection<SVGLineElement, GraphLink, SVGGElement, unknown>;
  let node: d3.Selection<SVGGElement, GraphNode, SVGGElement, unknown>;
  let renderPositions: () => void;
  let selectedNodeId: string | null = null;

  // Minimap update functions (assigned after minimap is created)
  let updateMinimapViewport: () => void = () => {};
  let updateMinimapPositions: () => void = () => {};

  // Function to compute hierarchical positions (top-to-bottom based on story flow)
  function computeHierarchicalPositions(graph: Graph, knotGroups: Map<string, GraphNode[]>) {
    // Build adjacency map (only for knot-level connections)
    const adjacency = new Map<string, Set<string>>();
    const reverseAdjacency = new Map<string, Set<string>>();

    graph.nodes.forEach(n => {
      if (n.type === 'knot') {
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
        const sourceKnot = sourceNode.type === 'knot' ? sourceNode.id : sourceNode.knotName;
        const targetKnot = targetNode.type === 'knot' ? targetNode.id : targetNode.knotName;

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

    // Start with the first knot in the structure (assume it's the entry point)
    const knots = graph.nodes.filter(n => n.type === 'knot');
    if (knots.length > 0) {
      const firstKnot = knots[0];
      queue.push({ id: firstKnot.id, depth: 0 });
      visited.add(firstKnot.id);
      depths.set(firstKnot.id, 0);
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
    const knotVerticalSpacing = 200; // Vertical spacing when spreading multiple children
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
    // Iterate through knots by depth to check for conflicts
    sortedDepths.forEach(depth => {
      const knotsAtDepth = knotsByDepth.get(depth) || [];

      knotsAtDepth.forEach(knotNode => {
        if (!knotNode.x || !knotNode.y) return;

        // Check for conflicts with earlier knots and their stitches
        let hasConflict = true;
        let offsetAttempts = 0;
        const maxOffsetAttempts = 20;

        while (hasConflict && offsetAttempts < maxOffsetAttempts) {
          hasConflict = false;

          // Check all knots at earlier depths (to the left)
          for (let d = 0; d < depth; d++) {
            const earlierKnots = knotsByDepth.get(d) || [];

            for (const earlierKnot of earlierKnots) {
              if (!earlierKnot.x || !earlierKnot.y) continue;

              // Check if current knot overlaps with earlier knot
              const xDist = Math.abs(knotNode.x - earlierKnot.x);
              const yDist = Math.abs(knotNode.y - earlierKnot.y);

              if (xDist < 120 && yDist < 60) {
                // Knots overlap, offset current knot vertically
                hasConflict = true;
                knotNode.y += 80;
                break;
              }

              // Check if current knot overlaps with earlier knot's stitches
              const earlierStitches = knotGroups.get(earlierKnot.id) || [];
              if (earlierStitches.length > 0) {
                // Get bounds of earlier knot's stitches
                const stitchYs = earlierStitches.map(s => s.y || 0);
                const minStitchY = Math.min(...stitchYs, earlierKnot.y);
                const maxStitchY = Math.max(...stitchYs, earlierKnot.y);

                // Check if current knot is in the vertical range of the stitches
                if (xDist < 150 && knotNode.y >= minStitchY - 60 && knotNode.y <= maxStitchY + 60) {
                  // Current knot is in range of earlier knot's stitches, offset it
                  hasConflict = true;
                  knotNode.y = maxStitchY + 80;
                  break;
                }
              }
            }

            if (hasConflict) break;
          }

          // Also check knots at the same depth
          for (const otherKnot of knotsAtDepth) {
            if (otherKnot === knotNode || !otherKnot.x || !otherKnot.y) continue;

            const xDist = Math.abs(knotNode.x - otherKnot.x);
            const yDist = Math.abs(knotNode.y - otherKnot.y);

            // Check if current knot overlaps with other knot
            if (xDist < 120 && yDist < 60) {
              // Same position, offset vertically with larger spacing
              hasConflict = true;
              knotNode.y += 150;
              break;
            }

            // Check if current knot overlaps with other knot's stitches
            const otherStitches = knotGroups.get(otherKnot.id) || [];
            if (otherStitches.length > 0) {
              // Get bounds of other knot's stitches
              const stitchYs = otherStitches.map(s => s.y || 0);
              const minStitchY = Math.min(...stitchYs, otherKnot.y);
              const maxStitchY = Math.max(...stitchYs, otherKnot.y);

              // Check if current knot is in the vertical range of the stitches
              if (xDist < 150 && knotNode.y >= minStitchY - 60 && knotNode.y <= maxStitchY + 60) {
                // Current knot is in range of other knot's stitches, offset it
                hasConflict = true;
                knotNode.y = maxStitchY + 80;
                break;
              }
            }
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
      const knotId = n.type === 'knot' ? n.id : n.knotName || '';
      if (connectedKnotIds.has(knotId) && n.y !== undefined) {
        maxConnectedY = Math.max(maxConnectedY, n.y);
      }
    });

    if (maxConnectedY > -Infinity) {
      let minDisconnectedY = Infinity;
      graph.nodes.forEach(n => {
        const knotId = n.type === 'knot' ? n.id : n.knotName || '';
        if (!connectedKnotIds.has(knotId) && n.y !== undefined) {
          minDisconnectedY = Math.min(minDisconnectedY, n.y);
        }
      });

      if (minDisconnectedY < Infinity) {
        const verticalGap = 300;
        const yShift = maxConnectedY - minDisconnectedY + verticalGap;
        graph.nodes.forEach(n => {
          const knotId = n.type === 'knot' ? n.id : n.knotName || '';
          if (!connectedKnotIds.has(knotId) && n.y !== undefined) {
            n.y += yShift;
          }
        });
      }
    }
  }

  // Helper function to get node dimensions - all nodes are the same size now
  const getNodeDimensions = (_node: GraphNode) => {
    return { width: 100, height: 50 };
  };

  // Helper function to calculate intersection point of line with rectangle
  const getIntersectionPoint = (
    cx: number, cy: number, // center of rectangle
    width: number, height: number, // dimensions of rectangle
    tx: number, ty: number // target point (to calculate direction)
  ) => {
    // Calculate angle from center to target
    const dx = tx - cx;
    const dy = ty - cy;

    if (dx === 0 && dy === 0) {
      return { x: cx, y: cy };
    }

    const angle = Math.atan2(dy, dx);

    // Half dimensions
    const hw = width / 2;
    const hh = height / 2;

    // Calculate intersection with rectangle edges
    // Check all four edges and find which one the line intersects
    const absAngle = Math.abs(angle);
    const cornerAngle = Math.atan2(hh, hw);

    let x, y;

    if (absAngle <= cornerAngle) {
      // Right edge
      x = cx + hw;
      y = cy + Math.tan(angle) * hw;
    } else if (absAngle <= Math.PI - cornerAngle) {
      // Top or bottom edge
      if (angle > 0) {
        // Bottom edge
        y = cy + hh;
        x = cx + hh / Math.tan(angle);
      } else {
        // Top edge
        y = cy - hh;
        x = cx - hh / Math.tan(angle);
      }
    } else {
      // Left edge
      x = cx - hw;
      y = cy - Math.tan(angle) * hw;
    }

    return { x, y };
  };

  // Function to update the visualization
  function updateVisualization() {
    // Group nodes by knot for positioning
    const knotGroups = new Map<string, GraphNode[]>();

    graph.nodes.forEach(n => {
      if (n.type === 'knot') {
        knotGroups.set(n.id, []);
      }
    });

    // Get stitches in their original order from the structure
    graph.nodes.forEach(n => {
      if (n.type === 'stitch' && n.knotName) {
        const stitches = knotGroups.get(n.knotName);
        if (stitches) {
          stitches.push(n);
        }
      }
    });

    // Sort stitches by their original order in the structure
    knotGroups.forEach((stitches, knotId) => {
      const knotInStructure = structure.knots.find(k => k.name === knotId);
      if (knotInStructure) {
        stitches.sort((a, b) => {
          const aIndex = knotInStructure.stitches.findIndex(s => `${knotId}.${s.name}` === a.id);
          const bIndex = knotInStructure.stitches.findIndex(s => `${knotId}.${s.name}` === b.id);
          return aIndex - bIndex;
        });
      }
    });

    // Only do full hierarchical layout if this is the first time
    const needsLayout = !graph.nodes.every(n => n.type === 'stitch' || (n.x !== undefined && n.y !== undefined));
    if (needsLayout) {
      computeHierarchicalPositions(graph, knotGroups);

      // Restore saved transform or zoom to fit
      if (options?.initialTransform) {
        const t = options.initialTransform;
        const transform = d3.zoomIdentity.translate(t.x, t.y).scale(t.k);
        svg.call(zoom.transform as any, transform);
      } else {
        zoomToFit();
      }
    }

    // Stop existing simulation if any
    if (simulation) {
      simulation.stop();
    }

    // Function to render positions
    renderPositions = () => {
      // Update links - calculate edge-to-edge positions
      link
        .attr('x1', (d: any) => {
          const source = typeof d.source === 'object' ? d.source : graph.nodes.find(n => n.id === d.source);
          const target = typeof d.target === 'object' ? d.target : graph.nodes.find(n => n.id === d.target);
          if (!source || !target) return 0;

          const dims = getNodeDimensions(source);
          const intersection = getIntersectionPoint(
            source.x || 0, source.y || 0,
            dims.width, dims.height,
            target.x || 0, target.y || 0
          );
          return intersection.x;
        })
        .attr('y1', (d: any) => {
          const source = typeof d.source === 'object' ? d.source : graph.nodes.find(n => n.id === d.source);
          const target = typeof d.target === 'object' ? d.target : graph.nodes.find(n => n.id === d.target);
          if (!source || !target) return 0;

          const dims = getNodeDimensions(source);
          const intersection = getIntersectionPoint(
            source.x || 0, source.y || 0,
            dims.width, dims.height,
            target.x || 0, target.y || 0
          );
          return intersection.y;
        })
        .attr('x2', (d: any) => {
          const source = typeof d.source === 'object' ? d.source : graph.nodes.find(n => n.id === d.source);
          const target = typeof d.target === 'object' ? d.target : graph.nodes.find(n => n.id === d.target);
          if (!source || !target) return 0;

          const dims = getNodeDimensions(target);
          const intersection = getIntersectionPoint(
            target.x || 0, target.y || 0,
            dims.width, dims.height,
            source.x || 0, source.y || 0
          );
          return intersection.x;
        })
        .attr('y2', (d: any) => {
          const source = typeof d.source === 'object' ? d.source : graph.nodes.find(n => n.id === d.source);
          const target = typeof d.target === 'object' ? d.target : graph.nodes.find(n => n.id === d.target);
          if (!source || !target) return 0;

          const dims = getNodeDimensions(target);
          const intersection = getIntersectionPoint(
            target.x || 0, target.y || 0,
            dims.width, dims.height,
            source.x || 0, source.y || 0
          );
          return intersection.y;
        });

      // Update nodes
      node.attr('transform', (d: any) => `translate(${d.x},${d.y})`);
    };

    // Store original positions as target positions for the simulation
    graph.nodes.forEach(n => {
      (n as any).targetX = n.x;
      (n as any).targetY = n.y;
    });

    // Create light simulation with collision detection
    // Strong position forces keep nodes at their target positions
    simulation = d3.forceSimulation(graph.nodes as any)
      .force('link', d3.forceLink(graph.links as any)
        .id((d: any) => d.id)
        .distance(150)
        .strength(0.01))
      .force('collision', d3.forceCollide<any>()
        .radius(40)
        .strength(0.2)
        .iterations(2))
      .force('x', d3.forceX((d: any) => (d as any).targetX).strength(0.9))
      .force('y', d3.forceY((d: any) => (d as any).targetY).strength(0.9))
      .alphaDecay(0.05)
      .on('tick', () => { renderPositions(); updateMinimapPositions(); });

    // Update links
    link = linksLayer
      .selectAll<SVGLineElement, GraphLink>('line')
      .data(graph.links, (d: GraphLink) => {
        const sourceId = typeof d.source === 'string' ? d.source : (d.source as any).id;
        const targetId = typeof d.target === 'string' ? d.target : (d.target as any).id;
        return `${sourceId}-${targetId}`;
      })
      .join('line')
      .attr('stroke', '#95a5a6')
      .attr('stroke-width', 2)
      .attr('stroke-opacity', 0.6)
      .attr('marker-end', 'url(#arrow)');

    // Update nodes
    node = nodesLayer
      .selectAll<SVGGElement, GraphNode>('g')
      .data(graph.nodes, (d: GraphNode) => d.id)
      .join(
        enter => {
          const nodeEnter = enter.append('g')
            .attr('class', d => `node-${d.type}`)
            .call(d3.drag<any, any>()
              .on('start', dragStarted)
              .on('drag', dragged)
              .on('end', dragEnded));

          // Add rounded rectangle - all nodes same size now
          nodeEnter.append('rect')
            .attr('class', 'node-rect')
            .attr('width', 100)
            .attr('height', 50)
            .attr('x', -50)
            .attr('y', -25)
            .attr('rx', 8)
            .attr('ry', 8)
            .attr('fill', d => d.type === 'knot' ? '#3498db' : '#2ecc71')
            .attr('stroke', '#ecf0f1')
            .attr('stroke-width', 2)
            .style('cursor', 'pointer');

          // Add label
          nodeEnter.append('text')
            .attr('class', 'node-label')
            .text(d => d.label)
            .attr('x', 0)
            .attr('y', 5)
            .attr('text-anchor', 'middle')
            .attr('fill', '#ecf0f1')
            .attr('font-size', '12px')
            .attr('font-weight', d => d.type === 'knot' ? 'bold' : 'normal')
            .style('pointer-events', 'none')
            .style('user-select', 'none');

          // Add type indicator (small icon in top-left corner)
          nodeEnter.append('text')
            .attr('class', 'node-icon')
            .attr('x', -42)
            .attr('y', -15)
            .attr('text-anchor', 'start')
            .attr('font-size', '12px')
            .text(d => d.type === 'knot' ? '📦' : '📎')
            .style('pointer-events', 'none');

          // Add tooltip
          nodeEnter.append('title')
            .text(d => d.type === 'knot' ? `Knot: ${d.id}` : `Stitch: ${d.id}`);

          // Add click handler (only fires if not dragging)
          if (onNodeClick) {
            nodeEnter.on('click', (event: MouseEvent, d: GraphNode) => {
              // Ignore if this was a drag
              if (wasDragged) return;

              // Highlight selected node
              nodesLayer.selectAll('.node-rect')
                .attr('stroke', '#ecf0f1')
                .attr('stroke-width', 2);
              d3.select(event.currentTarget as Element).select('.node-rect')
                .attr('stroke', '#f1c40f')
                .attr('stroke-width', 3);

              selectedNodeId = d.id;
              onNodeClick(d.id, d.type, d.knotName);
            });
          }

          return nodeEnter;
        },
        update => update,
        exit => exit.remove()
      );

    // Render the final positions
    renderPositions();
  }

  // Drag functions - update target position and move stitches with knots
  let dragStartX: number;
  let dragStartY: number;
  let wasDragged = false;

  function dragStarted(event: any) {
    if (!event.active) simulation.alphaTarget(0.3).restart();
    event.subject.fx = event.subject.x;
    event.subject.fy = event.subject.y;
    dragStartX = event.subject.x;
    dragStartY = event.subject.y;
    wasDragged = false;
  }

  const DRAG_THRESHOLD = 5;

  function dragged(event: any) {
    const dx = event.x - dragStartX;
    const dy = event.y - dragStartY;
    if (!wasDragged && Math.sqrt(dx * dx + dy * dy) < DRAG_THRESHOLD) return;
    wasDragged = true;
    // Update position during drag
    event.subject.fx = event.x;
    event.subject.fy = event.y;

    // If dragging a knot, move its stitches too
    if (event.subject.type === 'knot') {
      const dx = event.x - dragStartX;
      const dy = event.y - dragStartY;

      graph.nodes.forEach(n => {
        if (n.type === 'stitch' && n.knotName === event.subject.id) {
          if (n.x !== undefined && n.y !== undefined) {
            const originalX = (n as any).targetX || n.x;
            const originalY = (n as any).targetY || n.y;
            n.fx = originalX + dx;
            n.fy = originalY + dy;
          }
        }
      });
    }
  }

  function dragEnded(event: any) {
    if (!event.active) simulation.alphaTarget(0);

    if (!wasDragged) {
      // Below threshold — snap back to original position, treat as click
      event.subject.fx = null;
      event.subject.fy = null;
      event.subject.x = dragStartX;
      event.subject.y = dragStartY;
      simulation.alpha(0.1).restart();
      return;
    }

    // Update both current position and target position to the new location
    const newX = event.subject.fx;
    const newY = event.subject.fy;

    event.subject.x = newX;
    event.subject.y = newY;
    event.subject.targetX = newX;
    event.subject.targetY = newY;

    // If dragging a knot, update stitch targets too
    if (event.subject.type === 'knot') {
      const dx = newX - dragStartX;
      const dy = newY - dragStartY;

      graph.nodes.forEach(n => {
        if (n.type === 'stitch' && n.knotName === event.subject.id) {
          const originalX = (n as any).targetX || n.x;
          const originalY = (n as any).targetY || n.y;
          n.x = originalX + dx;
          n.y = originalY + dy;
          (n as any).targetX = originalX + dx;
          (n as any).targetY = originalY + dy;
          n.fx = null;
          n.fy = null;
        }
      });
    }

    // Release fixed position so simulation takes over
    event.subject.fx = null;
    event.subject.fy = null;

    // Update the position forces to use the new target values
    simulation.force('x', d3.forceX((d: any) => (d as any).targetX).strength(0.9));
    simulation.force('y', d3.forceY((d: any) => (d as any).targetY).strength(0.9));
    simulation.alpha(0.3).restart();
  }

  // Add zoom behavior
  const zoom = d3.zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.1, 4])
    .on('zoom', (event) => {
      g.attr('transform', event.transform);
      updateMinimapViewport();
      if (options?.onTransformChange) {
        const t = event.transform;
        options.onTransformChange({ x: t.x, y: t.y, k: t.k });
      }
    });

  svg.call(zoom as any);

  // Function to zoom to fit all nodes in view
  function zoomToFit() {
    if (graph.nodes.length === 0) return;

    // Use current container dimensions
    const currentWidth = container!.clientWidth;
    const currentHeight = container!.clientHeight;

    // Calculate bounds of all nodes
    const padding = 50; // Padding around the graph
    const nodeDims = { width: 100, height: 50 };

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    graph.nodes.forEach(n => {
      if (n.x !== undefined && n.y !== undefined) {
        minX = Math.min(minX, n.x - nodeDims.width / 2);
        maxX = Math.max(maxX, n.x + nodeDims.width / 2);
        minY = Math.min(minY, n.y - nodeDims.height / 2);
        maxY = Math.max(maxY, n.y + nodeDims.height / 2);
      }
    });

    // Add padding
    minX -= padding;
    maxX += padding;
    minY -= padding;
    maxY += padding;

    const graphWidth = maxX - minX;
    const graphHeight = maxY - minY;

    // Calculate scale to fit
    const scale = Math.min(
      currentWidth / graphWidth,
      currentHeight / graphHeight,
      4 // Max zoom level
    );

    // Calculate translation to center the graph
    const translateX = (currentWidth - graphWidth * scale) / 2 - minX * scale;
    const translateY = (currentHeight - graphHeight * scale) / 2 - minY * scale;

    // Apply the transform
    const transform = d3.zoomIdentity
      .translate(translateX, translateY)
      .scale(scale);

    svg.transition()
      .duration(750)
      .call(zoom.transform as any, transform);
  }

  // Add legend
  const legend = svg.append('g')
    .attr('class', 'legend')
    .attr('transform', 'translate(20, 20)');

  // Legend background
  legend.append('rect')
    .attr('x', -10)
    .attr('y', -10)
    .attr('width', 150)
    .attr('height', 50)
    .attr('fill', 'rgba(30, 30, 30, 0.8)')
    .attr('rx', 5);

  // Knot legend
  legend.append('rect')
    .attr('x', -8)
    .attr('y', -8)
    .attr('width', 35)
    .attr('height', 16)
    .attr('rx', 4)
    .attr('ry', 4)
    .attr('fill', '#3498db')
    .attr('stroke', '#ecf0f1')
    .attr('stroke-width', 1);

  legend.append('text')
    .attr('x', 35)
    .attr('y', 5)
    .attr('fill', '#ecf0f1')
    .attr('font-size', '11px')
    .text('Knot');

  // Stitch legend
  legend.append('rect')
    .attr('x', -8)
    .attr('y', 17)
    .attr('width', 30)
    .attr('height', 16)
    .attr('rx', 4)
    .attr('ry', 4)
    .attr('fill', '#2ecc71')
    .attr('stroke', '#ecf0f1')
    .attr('stroke-width', 1);

  legend.append('text')
    .attr('x', 35)
    .attr('y', 30)
    .attr('fill', '#ecf0f1')
    .attr('font-size', '11px')
    .text('Stitch');

  // Initial render
  updateVisualization();

  // === MINIMAP ===
  const MINIMAP_WIDTH = 100;
  const MINIMAP_HEIGHT = 70;
  const MINIMAP_PADDING = 30;

  const minimapDiv = document.createElement('div');
  minimapDiv.className = 'minimap';
  container.appendChild(minimapDiv);

  const minimapSvg = d3.select(minimapDiv)
    .append('svg')
    .attr('width', MINIMAP_WIDTH)
    .attr('height', MINIMAP_HEIGHT);

  // Background
  minimapSvg.append('rect')
    .attr('width', MINIMAP_WIDTH)
    .attr('height', MINIMAP_HEIGHT)
    .attr('fill', 'rgba(30, 30, 30, 0.85)')
    .attr('stroke', '#555')
    .attr('stroke-width', 1)
    .attr('rx', 4);

  const minimapG = minimapSvg.append('g');

  // Simplified links
  const minimapLinkSel = minimapG.selectAll<SVGLineElement, GraphLink>('line')
    .data(graph.links)
    .join('line')
    .attr('stroke', '#555')
    .attr('stroke-width', 0.5);

  // Simplified nodes
  const minimapNodeSel = minimapG.selectAll<SVGRectElement, GraphNode>('rect.mm-node')
    .data(graph.nodes)
    .join('rect')
    .attr('class', 'mm-node')
    .attr('width', 8)
    .attr('height', 4)
    .attr('rx', 1)
    .attr('fill', d => d.type === 'knot' ? '#3498db' : '#2ecc71');

  // Viewport rectangle (shows current visible area)
  const viewportRect = minimapSvg.append('rect')
    .attr('fill', 'rgba(255, 255, 255, 0.12)')
    .attr('stroke', 'rgba(255, 255, 255, 0.6)')
    .attr('stroke-width', 1)
    .style('pointer-events', 'none');

  // Compute scale and offset to fit the full graph into minimap pixels
  function computeMinimapMapping() {
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    graph.nodes.forEach(n => {
      if (n.x !== undefined && n.y !== undefined) {
        minX = Math.min(minX, n.x - 50);
        maxX = Math.max(maxX, n.x + 50);
        minY = Math.min(minY, n.y - 25);
        maxY = Math.max(maxY, n.y + 25);
      }
    });

    if (minX === Infinity) return { scale: 1, offsetX: 0, offsetY: 0 };

    const gw = maxX - minX + MINIMAP_PADDING * 2;
    const gh = maxY - minY + MINIMAP_PADDING * 2;
    const s = Math.min(MINIMAP_WIDTH / gw, MINIMAP_HEIGHT / gh);
    const ox = (MINIMAP_WIDTH - gw * s) / 2 - (minX - MINIMAP_PADDING) * s;
    const oy = (MINIMAP_HEIGHT - gh * s) / 2 - (minY - MINIMAP_PADDING) * s;

    return { scale: s, offsetX: ox, offsetY: oy };
  }

  // Assign the real minimap position updater
  updateMinimapPositions = () => {
    const mm = computeMinimapMapping();

    minimapNodeSel
      .attr('x', d => (d.x || 0) * mm.scale + mm.offsetX - 4)
      .attr('y', d => (d.y || 0) * mm.scale + mm.offsetY - 2);

    minimapLinkSel
      .attr('x1', (d: any) => {
        const s = typeof d.source === 'object' ? d.source : graph.nodes.find(n => n.id === d.source);
        return s ? (s.x || 0) * mm.scale + mm.offsetX : 0;
      })
      .attr('y1', (d: any) => {
        const s = typeof d.source === 'object' ? d.source : graph.nodes.find(n => n.id === d.source);
        return s ? (s.y || 0) * mm.scale + mm.offsetY : 0;
      })
      .attr('x2', (d: any) => {
        const t = typeof d.target === 'object' ? d.target : graph.nodes.find(n => n.id === d.target);
        return t ? (t.x || 0) * mm.scale + mm.offsetX : 0;
      })
      .attr('y2', (d: any) => {
        const t = typeof d.target === 'object' ? d.target : graph.nodes.find(n => n.id === d.target);
        return t ? (t.y || 0) * mm.scale + mm.offsetY : 0;
      });
  };

  // Assign the real minimap viewport updater
  updateMinimapViewport = () => {
    const mm = computeMinimapMapping();
    const cw = container!.clientWidth;
    const ch = container!.clientHeight;
    const t = d3.zoomTransform(svg.node()!);

    // Visible region in graph coordinates
    const visLeft = -t.x / t.k;
    const visTop = -t.y / t.k;
    const visWidth = cw / t.k;
    const visHeight = ch / t.k;

    // Map to minimap pixel coordinates
    viewportRect
      .attr('x', visLeft * mm.scale + mm.offsetX)
      .attr('y', visTop * mm.scale + mm.offsetY)
      .attr('width', visWidth * mm.scale)
      .attr('height', visHeight * mm.scale);
  };

  // Click/drag on minimap centers the main view on that graph position
  function navigateFromMinimap(event: any) {
    const [mx, my] = d3.pointer(event, minimapSvg.node());
    const mm = computeMinimapMapping();

    // Convert minimap pixel coords to graph coords
    const graphX = (mx - mm.offsetX) / mm.scale;
    const graphY = (my - mm.offsetY) / mm.scale;

    // Center main view on this point, keeping current zoom level
    const cw = container!.clientWidth;
    const ch = container!.clientHeight;
    const t = d3.zoomTransform(svg.node()!);

    const newTransform = d3.zoomIdentity
      .translate(cw / 2 - graphX * t.k, ch / 2 - graphY * t.k)
      .scale(t.k);
    svg.call(zoom.transform as any, newTransform);
  }

  minimapSvg.call(d3.drag<SVGSVGElement, unknown>()
    .on('start drag', navigateFromMinimap) as any);

  // Initial minimap render
  updateMinimapPositions();
  updateMinimapViewport();

  // Select initial node if specified
  function selectNode(nodeId: string): void {
    const targetNode = graph.nodes.find(n => n.id === nodeId);
    if (!targetNode) return;

    // Highlight the node visually
    nodesLayer.selectAll('.node-rect')
      .attr('stroke', '#ecf0f1')
      .attr('stroke-width', 2);
    nodesLayer.selectAll<SVGGElement, GraphNode>('.node')
      .filter(d => d.id === nodeId)
      .select('.node-rect')
      .attr('stroke', '#f1c40f')
      .attr('stroke-width', 3);

    selectedNodeId = nodeId;
    if (onNodeClick) {
      onNodeClick(targetNode.id, targetNode.type, targetNode.knotName);
    }
  }

  if (options?.initialSelectedNodeId) {
    selectNode(options.initialSelectedNodeId);
  }

  // Return controller
  return {
    getTransform(): { x: number; y: number; k: number } {
      const t = d3.zoomTransform(svg.node()!);
      return { x: t.x, y: t.y, k: t.k };
    },
    setTransform(x: number, y: number, k: number): void {
      const transform = d3.zoomIdentity.translate(x, y).scale(k);
      svg.call(zoom.transform as any, transform);
    },
    getSelectedNodeId(): string | null {
      return selectedNodeId;
    },
    selectNode
  };
}
