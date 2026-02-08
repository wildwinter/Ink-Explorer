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
  collapsed?: boolean; // For knots, track collapse state
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
        type: 'knot',
        collapsed: false // Start with all knots expanded
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

/**
 * Computes the visible graph based on collapse states
 * Filters out stitches of collapsed knots and redirects their links to the parent knot
 */
function computeVisibleGraph(fullGraph: Graph): Graph {
  const visibleNodes: GraphNode[] = [];
  const visibleLinks: GraphLink[] = [];

  // Track which knots are collapsed
  const collapsedKnots = new Set<string>();
  fullGraph.nodes.forEach(node => {
    if (node.type === 'knot' && node.collapsed) {
      collapsedKnots.add(node.id);
    }
  });

  // Filter nodes: include all knots and only stitches from expanded knots
  fullGraph.nodes.forEach(node => {
    if (node.type === 'knot') {
      visibleNodes.push(node);
    } else if (node.type === 'stitch' && node.knotName && !collapsedKnots.has(node.knotName)) {
      visibleNodes.push(node);
    }
  });

  const visibleNodeIds = new Set(visibleNodes.map(n => n.id));

  // Helper function to resolve a node ID to its visible representation
  const resolveNodeId = (nodeId: string): string => {
    // If the node is visible, return it as-is
    if (visibleNodeIds.has(nodeId)) {
      return nodeId;
    }

    // If it's a stitch of a collapsed knot, return the knot ID
    const node = fullGraph.nodes.find(n => n.id === nodeId);
    if (node && node.type === 'stitch' && node.knotName && collapsedKnots.has(node.knotName)) {
      return node.knotName;
    }

    return nodeId;
  };

  // Process links: redirect links involving hidden stitches to their parent knots
  fullGraph.links.forEach(link => {
    const resolvedSource = resolveNodeId(typeof link.source === 'string' ? link.source : (link.source as any).id);
    const resolvedTarget = resolveNodeId(typeof link.target === 'string' ? link.target : (link.target as any).id);

    // Only add if both source and target are visible (or resolved to visible)
    if (visibleNodeIds.has(resolvedSource) && visibleNodeIds.has(resolvedTarget)) {
      // Avoid duplicate links (multiple stitches might resolve to same knot-to-knot link)
      const linkExists = visibleLinks.some(l => {
        const lSource = typeof l.source === 'string' ? l.source : (l.source as any).id;
        const lTarget = typeof l.target === 'string' ? l.target : (l.target as any).id;
        return lSource === resolvedSource && lTarget === resolvedTarget;
      });

      if (!linkExists) {
        visibleLinks.push({
          source: resolvedSource,
          target: resolvedTarget,
          isConditional: link.isConditional
        });
      }
    }
  });

  return { nodes: visibleNodes, links: visibleLinks };
}

/**
 * Creates an interactive graph visualization
 */
export function createGraphVisualization(
  containerId: string,
  structure: StoryStructure
): void {
  const container = document.getElementById(containerId);
  if (!container) {
    console.error(`Container ${containerId} not found`);
    return;
  }

  // Clear previous content
  container.innerHTML = '';

  // Convert structure to graph (this is the full graph with all nodes)
  const fullGraph = structureToGraph(structure);

  if (fullGraph.nodes.length === 0) {
    container.innerHTML = '<div class="empty-message">No nodes to display</div>';
    return;
  }

  // Set up dimensions
  const width = container.clientWidth;
  const height = container.clientHeight;

  // Create SVG
  const svg = d3.select(`#${containerId}`)
    .append('svg')
    .attr('width', '100%')
    .attr('height', '100%')
    .attr('viewBox', `0 0 ${width} ${height}`);

  // Create container for zoom
  const g = svg.append('g');

  // Define arrow marker for directed edges
  svg.append('defs').selectAll('marker')
    .data(['arrow', 'arrow-conditional'])
    .join('marker')
    .attr('id', d => d)
    .attr('viewBox', '0 -5 10 10')
    .attr('refX', 9)
    .attr('refY', 0)
    .attr('markerWidth', 6)
    .attr('markerHeight', 6)
    .attr('orient', 'auto')
    .append('path')
    .attr('d', 'M0,-5L10,0L0,5')
    .attr('fill', d => d === 'arrow-conditional' ? '#f39c12' : '#95a5a6');

  // Create layers
  const knotContainers = g.append('g').attr('class', 'knot-containers');
  const linksLayer = g.append('g').attr('class', 'links');
  const nodesLayer = g.append('g').attr('class', 'nodes');

  // Variables to hold D3 selections and simulation
  let simulation: d3.Simulation<d3.SimulationNodeDatum, undefined>;
  let link: d3.Selection<SVGLineElement, GraphLink, SVGGElement, unknown>;
  let containers: d3.Selection<SVGRectElement, any, SVGGElement, unknown>;
  let node: d3.Selection<SVGGElement, GraphNode, SVGGElement, unknown>;

  // Helper function to check if a knot has stitches
  const knotHasStitches = (knotId: string): boolean => {
    return fullGraph.nodes.some(n => n.type === 'stitch' && n.knotName === knotId);
  };

  // Function to compute hierarchical positions (left-to-right based on story flow)
  function computeHierarchicalPositions(graph: Graph, knotGroups: Map<string, GraphNode[]>) {
    // Build adjacency map (only for knot-level connections)
    const adjacency = new Map<string, Set<string>>();
    graph.nodes.forEach(n => {
      if (n.type === 'knot') {
        adjacency.set(n.id, new Set());
      }
    });

    graph.links.forEach(link => {
      const sourceId = typeof link.source === 'string' ? link.source : (link.source as any).id;
      const targetId = typeof link.target === 'string' ? link.target : (link.target as any).id;

      // Only track knot-to-knot connections for horizontal positioning
      const sourceNode = graph.nodes.find(n => n.id === sourceId);
      const targetNode = graph.nodes.find(n => n.id === targetId);

      if (sourceNode && targetNode) {
        const sourceKnot = sourceNode.type === 'knot' ? sourceNode.id : sourceNode.knotName;
        const targetKnot = targetNode.type === 'knot' ? targetNode.id : targetNode.knotName;

        if (sourceKnot && targetKnot && sourceKnot !== targetKnot) {
          adjacency.get(sourceKnot)?.add(targetKnot);
        }
      }
    });

    // Compute depth (distance from start) for knots using BFS
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

    // BFS to assign depths
    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;
      const neighbors = adjacency.get(id);

      if (neighbors) {
        for (const neighborId of neighbors) {
          if (!visited.has(neighborId)) {
            visited.add(neighborId);
            depths.set(neighborId, depth + 1);
            queue.push({ id: neighborId, depth: depth + 1 });
          }
        }
      }
    }

    // Assign positions to any unvisited knots
    knots.forEach(n => {
      if (!depths.has(n.id)) {
        depths.set(n.id, 0);
      }
    });

    // Position knots based on depth
    const depthSpacing = 350;
    const knotVerticalSpacing = 200;
    const stitchVerticalOffset = 100;
    const stitchHorizontalSpacing = 150;

    // Group knots by depth
    const knotsByDepth = new Map<number, GraphNode[]>();
    knots.forEach(n => {
      const depth = depths.get(n.id) || 0;
      if (!knotsByDepth.has(depth)) {
        knotsByDepth.set(depth, []);
      }
      knotsByDepth.get(depth)!.push(n);
    });

    // Assign positions to knots and their stitches
    knotsByDepth.forEach((knotsAtDepth, depth) => {
      knotsAtDepth.forEach((knotNode, knotIndex) => {
        const baseX = width * 0.15 + depth * depthSpacing;
        const baseY = height / 2 + (knotIndex - (knotsAtDepth.length - 1) / 2) * knotVerticalSpacing;

        // Get stitches for this knot (in order from original structure)
        const stitches = knotGroups.get(knotNode.id) || [];

        if (stitches.length > 0) {
          // Knot is expanded - calculate container dimensions first
          const stitchesPerRow = 3;
          const totalRows = Math.ceil(stitches.length / stitchesPerRow);

          // Calculate the width needed for stitches
          const stitchesInFirstRow = Math.min(stitchesPerRow, stitches.length);
          const containerPadding = 50;
          const containerWidth = (stitchesInFirstRow * stitchHorizontalSpacing) + containerPadding * 2;

          // Calculate container height
          const knotHeight = 50;
          const stitchRowSpacing = 80;
          const containerHeight = knotHeight + stitchVerticalOffset + (totalRows * stitchRowSpacing) + containerPadding;

          // Position knot at the top of the container, centered
          knotNode.x = baseX;
          knotNode.y = baseY;

          // Store container dimensions on the knot for later use
          (knotNode as any).containerWidth = containerWidth;
          (knotNode as any).containerHeight = containerHeight;

          // Position stitches below the knot in order
          stitches.forEach((stitch, stitchIndex) => {
            const row = Math.floor(stitchIndex / stitchesPerRow);
            const col = stitchIndex % stitchesPerRow;
            const stitchesInThisRow = Math.min(stitchesPerRow, stitches.length - row * stitchesPerRow);

            stitch.x = baseX + (col - (stitchesInThisRow - 1) / 2) * stitchHorizontalSpacing;
            stitch.y = baseY + stitchVerticalOffset + row * stitchRowSpacing;
          });
        } else {
          // Knot is collapsed or has no stitches - position normally
          knotNode.x = baseX;
          knotNode.y = baseY;
          (knotNode as any).containerWidth = undefined;
        }
      });
    });
  }

  // Helper function to get node dimensions
  const getNodeDimensions = (node: GraphNode) => {
    if (node.type === 'knot') {
      const width = (node as any).containerWidth ? (node as any).containerWidth - 4 : 100;
      return { width, height: 50 };
    } else {
      return { width: 80, height: 40 };
    }
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
  function updateVisualization(recomputeLayout = false) {
    const visibleGraph = computeVisibleGraph(fullGraph);

    // Group nodes by knot for containment (do this first, before positioning)
    const knotGroups = new Map<string, GraphNode[]>();

    visibleGraph.nodes.forEach(n => {
      if (n.type === 'knot') {
        knotGroups.set(n.id, []);
      }
    });

    // Get stitches in their original order from the full graph structure
    visibleGraph.nodes.forEach(n => {
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

    // Compute positions for nodes that don't have them yet
    // For stitches, always recompute based on their parent knot's position
    visibleGraph.nodes.forEach(n => {
      if (n.type === 'stitch' && n.knotName) {
        // Find parent knot in fullGraph to get its position
        const parentKnot = fullGraph.nodes.find(node => node.id === n.knotName);
        if (parentKnot && parentKnot.x !== undefined && parentKnot.y !== undefined) {
          // Get stitches for this knot
          const stitches = knotGroups.get(n.knotName) || [];
          const stitchIndex = stitches.findIndex(s => s.id === n.id);

          if (stitchIndex >= 0) {
            // Calculate stitch position relative to knot
            const stitchesPerRow = 3;
            const row = Math.floor(stitchIndex / stitchesPerRow);
            const col = stitchIndex % stitchesPerRow;
            const stitchesInThisRow = Math.min(stitchesPerRow, stitches.length - row * stitchesPerRow);
            const stitchHorizontalSpacing = 150;
            const stitchVerticalOffset = 100;

            n.x = parentKnot.x + (col - (stitchesInThisRow - 1) / 2) * stitchHorizontalSpacing;
            n.y = parentKnot.y + stitchVerticalOffset + row * 80;
          }
        }
      }
    });

    // Only do full hierarchical layout if this is the first time or forced
    const needsLayout = recomputeLayout || !fullGraph.nodes.every(n => n.type === 'stitch' || (n.x !== undefined && n.y !== undefined));
    if (needsLayout) {
      computeHierarchicalPositions(visibleGraph, knotGroups);
    }

    // Stop existing simulation if any
    if (simulation) {
      simulation.stop();
    }

    // Create a dummy simulation just for D3's link handling
    // We don't actually run it - just use it to convert link IDs to node references
    simulation = d3.forceSimulation(visibleGraph.nodes as any)
      .force('link', d3.forceLink(visibleGraph.links as any)
        .id((d: any) => d.id))
      .stop(); // Stop immediately without any ticks

    // Function to render positions
    const renderPositions = () => {
      // Update links - calculate edge-to-edge positions
      link
        .attr('x1', (d: any) => {
          const source = typeof d.source === 'object' ? d.source : visibleGraph.nodes.find(n => n.id === d.source);
          const target = typeof d.target === 'object' ? d.target : visibleGraph.nodes.find(n => n.id === d.target);
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
          const source = typeof d.source === 'object' ? d.source : visibleGraph.nodes.find(n => n.id === d.source);
          const target = typeof d.target === 'object' ? d.target : visibleGraph.nodes.find(n => n.id === d.target);
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
          const source = typeof d.source === 'object' ? d.source : visibleGraph.nodes.find(n => n.id === d.source);
          const target = typeof d.target === 'object' ? d.target : visibleGraph.nodes.find(n => n.id === d.target);
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
          const source = typeof d.source === 'object' ? d.source : visibleGraph.nodes.find(n => n.id === d.source);
          const target = typeof d.target === 'object' ? d.target : visibleGraph.nodes.find(n => n.id === d.target);
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

      // Update knot containers to encompass their stitches
      containers.each(function(d: any) {
        const knotNode = visibleGraph.nodes.find(n => n.id === d.knotId);
        if (!knotNode || knotNode.x === undefined || knotNode.y === undefined) return;

        const stitches = d.stitches;
        if (stitches.length === 0) {
          return;
        }

        // Use stored container dimensions if available
        const containerWidth = (knotNode as any).containerWidth;
        const containerHeight = (knotNode as any).containerHeight;

        if (containerWidth && containerHeight) {
          // Position container to align with knot's top edge
          const knotY = knotNode.y || 0;
          const knotHeight = 50;
          const containerY = knotY - knotHeight / 2; // Top edge of knot

          d3.select(this)
            .attr('x', (knotNode.x || 0) - containerWidth / 2)
            .attr('y', containerY)
            .attr('width', containerWidth)
            .attr('height', containerHeight);
        } else {
          // Fallback: calculate bounding box
          const allNodes = [knotNode, ...stitches];
          const xs = allNodes.map(n => n.x || 0);
          const ys = allNodes.map(n => n.y || 0);

          const minX = Math.min(...xs) - 50;
          const maxX = Math.max(...xs) + 50;
          const minY = Math.min(...ys) - 50;
          const maxY = Math.max(...ys) + 50;

          d3.select(this)
            .attr('x', minX)
            .attr('y', minY)
            .attr('width', maxX - minX)
            .attr('height', maxY - minY);
        }
      });
    };

    // Update links
    link = linksLayer
      .selectAll<SVGLineElement, GraphLink>('line')
      .data(visibleGraph.links, (d: GraphLink) => {
        const sourceId = typeof d.source === 'string' ? d.source : (d.source as any).id;
        const targetId = typeof d.target === 'string' ? d.target : (d.target as any).id;
        return `${sourceId}-${targetId}`;
      })
      .join('line')
      .attr('stroke', d => d.isConditional ? '#f39c12' : '#95a5a6')
      .attr('stroke-width', 2)
      .attr('stroke-opacity', 0.6)
      .attr('marker-end', d => `url(#${d.isConditional ? 'arrow-conditional' : 'arrow'})`);

    // Update knot container rectangles
    const knotContainerData = Array.from(knotGroups.entries())
      .map(([knotId, stitches]) => ({ knotId, stitches }))
      .filter(d => d.stitches.length > 0); // Only show containers for expanded knots with stitches

    containers = knotContainers
      .selectAll<SVGRectElement, any>('rect')
      .data(knotContainerData, (d: any) => d.knotId)
      .join('rect')
      .attr('class', 'knot-container')
      .attr('fill', 'rgba(52, 152, 219, 0.1)')
      .attr('stroke', '#3498db')
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', '5,5')
      .attr('rx', 10);

    // Update nodes
    node = nodesLayer
      .selectAll<SVGGElement, GraphNode>('g')
      .data(visibleGraph.nodes, (d: GraphNode) => d.id)
      .join(
        enter => {
          const nodeEnter = enter.append('g')
            .attr('class', d => `node-${d.type}`)
            .call(d3.drag<any, any>()
              .on('start', dragStarted)
              .on('drag', dragged)
              .on('end', dragEnded));

          // Add rounded rectangle
          nodeEnter.append('rect')
            .attr('class', 'node-rect')
            .attr('width', d => {
              if (d.type === 'knot' && (d as any).containerWidth) {
                return (d as any).containerWidth - 4; // Slight inset from container
              }
              return d.type === 'knot' ? 100 : 80;
            })
            .attr('height', d => d.type === 'knot' ? 50 : 40)
            .attr('x', d => {
              if (d.type === 'knot' && (d as any).containerWidth) {
                return -((d as any).containerWidth - 4) / 2;
              }
              return d.type === 'knot' ? -50 : -40;
            })
            .attr('y', d => d.type === 'knot' ? -25 : -20)
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
            .attr('font-size', d => d.type === 'knot' ? '13px' : '11px')
            .attr('font-weight', d => d.type === 'knot' ? 'bold' : 'normal')
            .style('pointer-events', 'none')
            .style('user-select', 'none');

          // Add type indicator (small icon in top-left corner)
          nodeEnter.append('text')
            .attr('class', 'node-icon')
            .attr('x', d => d.type === 'knot' ? -42 : -32)
            .attr('y', d => d.type === 'knot' ? -15 : -10)
            .attr('text-anchor', 'start')
            .attr('font-size', '12px')
            .style('pointer-events', 'none');

          // Add collapse indicator (only for knots with stitches)
          nodeEnter.filter(d => d.type === 'knot' && knotHasStitches(d.id))
            .append('text')
            .attr('class', 'collapse-indicator')
            .attr('x', 42)
            .attr('y', -15)
            .attr('text-anchor', 'end')
            .attr('font-size', '14px')
            .style('pointer-events', 'none')
            .style('user-select', 'none');

          // Add tooltip
          nodeEnter.append('title');

          // Add click handler for knots with stitches to toggle collapse
          nodeEnter.filter(d => d.type === 'knot' && knotHasStitches(d.id))
            .on('click', function(event, d) {
              event.stopPropagation();
              d.collapsed = !d.collapsed;
              updateVisualization();
            });

          return nodeEnter;
        },
        update => update,
        exit => exit.remove()
      );

    // Update node content
    node.select('.node-rect')
      .attr('width', d => {
        if (d.type === 'knot' && (d as any).containerWidth) {
          return (d as any).containerWidth - 4;
        }
        return d.type === 'knot' ? 100 : 80;
      })
      .attr('x', d => {
        if (d.type === 'knot' && (d as any).containerWidth) {
          return -((d as any).containerWidth - 4) / 2;
        }
        return d.type === 'knot' ? -50 : -40;
      });

    node.select('.node-icon')
      .text(d => {
        if (d.type === 'knot') {
          return d.collapsed ? '📦' : '📦';
        }
        return '📎';
      });

    node.select('.collapse-indicator')
      .text(d => d.collapsed ? '⊕' : '⊖')
      .attr('fill', '#ecf0f1');

    node.select('title')
      .text(d => {
        if (d.type === 'knot' && knotHasStitches(d.id)) {
          return `Knot: ${d.id} (click to ${d.collapsed ? 'expand' : 'collapse'})`;
        } else if (d.type === 'knot') {
          return `Knot: ${d.id}`;
        } else {
          return `Stitch: ${d.id}`;
        }
      });

    // Render the final positions (no animation)
    renderPositions();
  }

  // Drag functions (no animation, just direct position updates)
  let stitchOffsets: Map<string, { x: number; y: number }> | null = null;

  function dragStarted(event: any) {
    event.subject.fx = event.subject.x;
    event.subject.fy = event.subject.y;

    // If dragging a knot, store the initial offset of each stitch from the knot
    if (event.subject.type === 'knot') {
      stitchOffsets = new Map();
      const knotId = event.subject.id;

      node.each(function(d: any) {
        if (d.type === 'stitch' && d.knotName === knotId) {
          stitchOffsets!.set(d.id, {
            x: (d.x || 0) - event.subject.x,
            y: (d.y || 0) - event.subject.y
          });
        }
      });
    }
  }

  function dragged(event: any) {
    // Update the dragged node's position
    event.subject.fx = event.x;
    event.subject.fy = event.y;
    event.subject.x = event.x;
    event.subject.y = event.y;

    // Find and update the visual position of the dragged node more robustly
    node.each(function(d: any) {
      if (d === event.subject) {
        d3.select(this).attr('transform', `translate(${d.x},${d.y})`);
      }
    });

    // If dragging a knot, move its stitches using stored offsets
    if (event.subject.type === 'knot' && stitchOffsets) {
      const knotId = event.subject.id;

      node.each(function(d: any) {
        if (d.type === 'stitch' && d.knotName === knotId) {
          const offset = stitchOffsets!.get(d.id);
          if (offset) {
            // Position stitch relative to knot's current position
            d.x = event.subject.x + offset.x;
            d.y = event.subject.y + offset.y;
            d3.select(this).attr('transform', `translate(${d.x},${d.y})`);
          }
        }
      });

      // Update container position immediately after moving stitches
      const containerWidth = (event.subject as any).containerWidth;
      const containerHeight = (event.subject as any).containerHeight;

      if (containerWidth && containerHeight) {
        containers.each(function(d: any) {
          if (d.knotId === knotId) {
            const knotHeight = 50;
            const containerY = event.subject.y - knotHeight / 2;

            d3.select(this)
              .attr('x', event.subject.x - containerWidth / 2)
              .attr('y', containerY)
              .attr('width', containerWidth)
              .attr('height', containerHeight);
          }
        });
      }
    }

    // Update all connected links (for both the knot and its stitches)
    link.each(function(d: any) {
      const source = typeof d.source === 'object' ? d.source : fullGraph.nodes.find((n: GraphNode) => n.id === d.source);
      const target = typeof d.target === 'object' ? d.target : fullGraph.nodes.find((n: GraphNode) => n.id === d.target);

      // Update if either end of the link is affected
      if (source === event.subject || target === event.subject ||
          (event.subject.type === 'knot' && (source?.knotName === event.subject.id || target?.knotName === event.subject.id))) {

        if (source && target) {
          // Calculate edge-to-edge positions
          const sourceDims = getNodeDimensions(source);
          const sourceIntersection = getIntersectionPoint(
            source.x || 0, source.y || 0,
            sourceDims.width, sourceDims.height,
            target.x || 0, target.y || 0
          );

          const targetDims = getNodeDimensions(target);
          const targetIntersection = getIntersectionPoint(
            target.x || 0, target.y || 0,
            targetDims.width, targetDims.height,
            source.x || 0, source.y || 0
          );

          d3.select(this)
            .attr('x1', sourceIntersection.x)
            .attr('y1', sourceIntersection.y)
            .attr('x2', targetIntersection.x)
            .attr('y2', targetIntersection.y);
        }
      }
    });
  }

  function dragEnded(event: any) {
    event.subject.fx = null;
    event.subject.fy = null;
    stitchOffsets = null;
  }

  // Add zoom behavior
  const zoom = d3.zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.1, 4])
    .on('zoom', (event) => {
      g.attr('transform', event.transform);
    });

  svg.call(zoom as any);

  // Add legend
  const legend = svg.append('g')
    .attr('class', 'legend')
    .attr('transform', `translate(20, ${height - 120})`);

  // Legend background
  legend.append('rect')
    .attr('x', -10)
    .attr('y', -10)
    .attr('width', 150)
    .attr('height', 110)
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

  // Conditional divert legend
  legend.append('line')
    .attr('x1', 0)
    .attr('y1', 50)
    .attr('x2', 30)
    .attr('y2', 50)
    .attr('stroke', '#f39c12')
    .attr('stroke-width', 2);

  legend.append('text')
    .attr('x', 35)
    .attr('y', 55)
    .attr('fill', '#ecf0f1')
    .attr('font-size', '11px')
    .text('Conditional');

  // Collapse/expand legend
  legend.append('text')
    .attr('x', 0)
    .attr('y', 75)
    .attr('fill', '#ecf0f1')
    .attr('font-size', '11px')
    .text('⊖ = expanded');

  legend.append('text')
    .attr('x', 0)
    .attr('y', 90)
    .attr('fill', '#ecf0f1')
    .attr('font-size', '11px')
    .text('⊕ = collapsed');

  // Initial render
  updateVisualization();
}
