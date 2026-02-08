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
    .attr('refX', 20)
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
  function computeHierarchicalPositions(graph: Graph) {
    // Build adjacency map
    const adjacency = new Map<string, Set<string>>();
    graph.nodes.forEach(n => adjacency.set(n.id, new Set()));

    graph.links.forEach(link => {
      const sourceId = typeof link.source === 'string' ? link.source : (link.source as any).id;
      const targetId = typeof link.target === 'string' ? link.target : (link.target as any).id;
      adjacency.get(sourceId)?.add(targetId);
    });

    // Compute depth (distance from start) for each node using BFS
    const depths = new Map<string, number>();
    const visited = new Set<string>();
    const queue: Array<{ id: string; depth: number }> = [];

    // Start with the first knot in the structure (assume it's the entry point)
    if (graph.nodes.length > 0) {
      const firstKnot = graph.nodes.find(n => n.type === 'knot');
      if (firstKnot) {
        queue.push({ id: firstKnot.id, depth: 0 });
        visited.add(firstKnot.id);
        depths.set(firstKnot.id, 0);
      }
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

    // Assign positions to any unvisited nodes
    graph.nodes.forEach(n => {
      if (!depths.has(n.id)) {
        depths.set(n.id, 0);
      }
    });

    // Position nodes based on depth
    const depthSpacing = 300;
    const verticalSpacing = 150;

    // Group nodes by depth
    const nodesByDepth = new Map<number, GraphNode[]>();
    graph.nodes.forEach(n => {
      const depth = depths.get(n.id) || 0;
      if (!nodesByDepth.has(depth)) {
        nodesByDepth.set(depth, []);
      }
      nodesByDepth.get(depth)!.push(n);
    });

    // Assign x,y positions
    nodesByDepth.forEach((nodes, depth) => {
      nodes.forEach((node, index) => {
        node.x = width * 0.15 + depth * depthSpacing;
        node.y = height / 2 + (index - (nodes.length - 1) / 2) * verticalSpacing;
      });
    });
  }

  // Function to update the visualization
  function updateVisualization() {
    const visibleGraph = computeVisibleGraph(fullGraph);

    // Compute hierarchical positions
    computeHierarchicalPositions(visibleGraph);

    // Group nodes by knot for containment
    const knotGroups = new Map<string, GraphNode[]>();

    visibleGraph.nodes.forEach(n => {
      if (n.type === 'knot') {
        knotGroups.set(n.id, []);
      }
    });

    visibleGraph.nodes.forEach(n => {
      if (n.type === 'stitch' && n.knotName) {
        const stitches = knotGroups.get(n.knotName);
        if (stitches) {
          stitches.push(n);
        }
      }
    });

    // Stop existing simulation if any
    if (simulation) {
      simulation.stop();
    }

    // Create a minimal force simulation for maintaining link structure
    // but with animation disabled
    simulation = d3.forceSimulation(visibleGraph.nodes as any)
      .force('link', d3.forceLink(visibleGraph.links as any)
        .id((d: any) => d.id)
        .distance(150)
        .strength(0.3))
      .force('charge', d3.forceManyBody().strength(-300))
      .force('collision', d3.forceCollide().radius(50))
      .force('stitch-containment', () => {
        // Keep stitches close to their parent knot
        visibleGraph.nodes.forEach(n => {
          if (n.type === 'stitch' && n.knotName) {
            const parent = visibleGraph.nodes.find(p => p.id === n.knotName);
            if (parent && parent.x !== undefined && parent.y !== undefined) {
              const dx = (parent.x - (n.x || 0)) * 0.2;
              const dy = (parent.y - (n.y || 0)) * 0.2;
              n.x = (n.x || 0) + dx;
              n.y = (n.y || 0) + dy;
            }
          }
        });
      })
      .alphaDecay(0.5) // Fast decay
      .velocityDecay(0.8) // High friction
      .alpha(0.3) // Start with low energy
      .alphaMin(0.001); // Stop quickly

    // Run a few ticks then stop to get a stable layout without animation
    simulation.tick(50);
    simulation.stop();

    // Function to render positions
    const renderPositions = () => {
      // Update links
      link
        .attr('x1', (d: any) => d.source.x)
        .attr('y1', (d: any) => d.source.y)
        .attr('x2', (d: any) => d.target.x)
        .attr('y2', (d: any) => d.target.y);

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

        // Calculate bounding box for knot and its stitches
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

          // Add circle
          nodeEnter.append('circle')
            .attr('r', d => d.type === 'knot' ? 25 : 18)
            .attr('fill', d => d.type === 'knot' ? '#3498db' : '#2ecc71')
            .attr('stroke', '#ecf0f1')
            .attr('stroke-width', 2)
            .style('cursor', 'pointer');

          // Add label
          nodeEnter.append('text')
            .attr('class', 'node-label')
            .text(d => d.label)
            .attr('x', 0)
            .attr('y', d => d.type === 'knot' ? -30 : -23)
            .attr('text-anchor', 'middle')
            .attr('fill', '#ecf0f1')
            .attr('font-size', d => d.type === 'knot' ? '13px' : '11px')
            .attr('font-weight', d => d.type === 'knot' ? 'bold' : 'normal')
            .style('pointer-events', 'none')
            .style('user-select', 'none');

          // Add type indicator
          nodeEnter.append('text')
            .attr('class', 'node-icon')
            .attr('x', 0)
            .attr('y', 5)
            .attr('text-anchor', 'middle')
            .attr('font-size', d => d.type === 'knot' ? '18px' : '14px')
            .style('pointer-events', 'none');

          // Add collapse indicator (only for knots with stitches)
          nodeEnter.filter(d => d.type === 'knot' && knotHasStitches(d.id))
            .append('text')
            .attr('class', 'collapse-indicator')
            .attr('x', 20)
            .attr('y', -20)
            .attr('text-anchor', 'middle')
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
  function dragStarted(event: any) {
    event.subject.fx = event.subject.x;
    event.subject.fy = event.subject.y;
  }

  function dragged(event: any) {
    event.subject.fx = event.x;
    event.subject.fy = event.y;
    event.subject.x = event.x;
    event.subject.y = event.y;

    // Manually update the visual position
    d3.select(event.sourceEvent.target.parentNode)
      .attr('transform', `translate(${event.x},${event.y})`);

    // Update connected links
    link.each(function(d: any) {
      if (d.source === event.subject || d.target === event.subject) {
        d3.select(this)
          .attr('x1', d.source.x)
          .attr('y1', d.source.y)
          .attr('x2', d.target.x)
          .attr('y2', d.target.y);
      }
    });
  }

  function dragEnded(event: any) {
    event.subject.fx = null;
    event.subject.fy = null;
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
  legend.append('circle')
    .attr('cx', 0)
    .attr('cy', 0)
    .attr('r', 8)
    .attr('fill', '#3498db');

  legend.append('text')
    .attr('x', 15)
    .attr('y', 5)
    .attr('fill', '#ecf0f1')
    .attr('font-size', '11px')
    .text('Knot');

  // Stitch legend
  legend.append('circle')
    .attr('cx', 0)
    .attr('cy', 25)
    .attr('r', 8)
    .attr('fill', '#2ecc71');

  legend.append('text')
    .attr('x', 15)
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
