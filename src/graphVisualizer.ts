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

  // Convert structure to graph
  const graph = structureToGraph(structure);

  if (graph.nodes.length === 0) {
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

  // Group nodes by knot for containment
  const knotGroups = new Map<string, GraphNode[]>();
  const knotNodes: GraphNode[] = [];

  graph.nodes.forEach(node => {
    if (node.type === 'knot') {
      knotNodes.push(node);
      knotGroups.set(node.id, []);
    }
  });

  graph.nodes.forEach(node => {
    if (node.type === 'stitch' && node.knotName) {
      const stitches = knotGroups.get(node.knotName);
      if (stitches) {
        stitches.push(node);
      }
    }
  });

  // Create force simulation with containment
  const simulation = d3.forceSimulation(graph.nodes as any)
    .force('link', d3.forceLink(graph.links as any)
      .id((d: any) => d.id)
      .distance(150))
    .force('charge', d3.forceManyBody().strength(-800))
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force('collision', d3.forceCollide().radius(50))
    .force('stitch-containment', () => {
      // Keep stitches close to their parent knot
      graph.nodes.forEach(node => {
        if (node.type === 'stitch' && node.knotName) {
          const parent = graph.nodes.find(n => n.id === node.knotName);
          if (parent && parent.x !== undefined && parent.y !== undefined) {
            const dx = (parent.x - (node.x || 0)) * 0.1;
            const dy = (parent.y - (node.y || 0)) * 0.1;
            node.x = (node.x || 0) + dx;
            node.y = (node.y || 0) + dy;
          }
        }
      });
    });

  // Create container layer for knot groups
  const knotContainers = g.append('g').attr('class', 'knot-containers');

  // Create links layer
  const linksLayer = g.append('g').attr('class', 'links');

  // Create nodes layer
  const nodesLayer = g.append('g').attr('class', 'nodes');

  // Create links
  const link = linksLayer
    .selectAll('line')
    .data(graph.links)
    .join('line')
    .attr('stroke', d => d.isConditional ? '#f39c12' : '#95a5a6')
    .attr('stroke-width', 2)
    .attr('stroke-opacity', 0.6)
    .attr('marker-end', d => `url(#${d.isConditional ? 'arrow-conditional' : 'arrow'})`);

  // Create knot container rectangles
  const knotContainerData = Array.from(knotGroups.entries()).map(([knotId, stitches]) => ({
    knotId,
    stitches
  }));

  const containers = knotContainers
    .selectAll('rect')
    .data(knotContainerData)
    .join('rect')
    .attr('class', 'knot-container')
    .attr('fill', 'rgba(52, 152, 219, 0.1)')
    .attr('stroke', '#3498db')
    .attr('stroke-width', 2)
    .attr('stroke-dasharray', '5,5')
    .attr('rx', 10);

  // Create nodes
  const node = nodesLayer
    .selectAll('g')
    .data(graph.nodes)
    .join('g')
    .attr('class', d => `node-${d.type}`)
    .call(d3.drag<any, any>()
      .on('start', dragStarted)
      .on('drag', dragged)
      .on('end', dragEnded));

  // Add circles for nodes
  node.append('circle')
    .attr('r', d => d.type === 'knot' ? 25 : 18)
    .attr('fill', d => d.type === 'knot' ? '#3498db' : '#2ecc71')
    .attr('stroke', '#ecf0f1')
    .attr('stroke-width', 2)
    .style('cursor', 'pointer');

  // Add labels
  node.append('text')
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
  node.append('text')
    .text(d => d.type === 'knot' ? '📦' : '📎')
    .attr('x', 0)
    .attr('y', 5)
    .attr('text-anchor', 'middle')
    .attr('font-size', d => d.type === 'knot' ? '18px' : '14px')
    .style('pointer-events', 'none');

  // Add tooltips
  node.append('title')
    .text(d => `${d.type === 'knot' ? 'Knot' : 'Stitch'}: ${d.id}`);

  // Update positions on simulation tick
  simulation.on('tick', () => {
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
      const knotNode = graph.nodes.find(n => n.id === d.knotId);
      if (!knotNode || knotNode.x === undefined || knotNode.y === undefined) return;

      const stitches = d.stitches;
      if (stitches.length === 0) {
        // No stitches, just draw around the knot
        d3.select(this)
          .attr('x', knotNode.x - 60)
          .attr('y', knotNode.y - 60)
          .attr('width', 120)
          .attr('height', 120);
      } else {
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
      }
    });
  });

  // Add zoom behavior
  const zoom = d3.zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.1, 4])
    .on('zoom', (event) => {
      g.attr('transform', event.transform);
    });

  svg.call(zoom as any);

  // Drag functions
  function dragStarted(event: any) {
    if (!event.active) simulation.alphaTarget(0.3).restart();
    event.subject.fx = event.subject.x;
    event.subject.fy = event.subject.y;
  }

  function dragged(event: any) {
    event.subject.fx = event.x;
    event.subject.fy = event.y;
  }

  function dragEnded(event: any) {
    if (!event.active) simulation.alphaTarget(0);
    event.subject.fx = null;
    event.subject.fy = null;
  }

  // Add legend
  const legend = svg.append('g')
    .attr('class', 'legend')
    .attr('transform', `translate(20, ${height - 100})`);

  // Legend background
  legend.append('rect')
    .attr('x', -10)
    .attr('y', -10)
    .attr('width', 150)
    .attr('height', 90)
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
}
