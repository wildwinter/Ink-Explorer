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

  // Create force simulation
  const simulation = d3.forceSimulation(graph.nodes as any)
    .force('link', d3.forceLink(graph.links as any)
      .id((d: any) => d.id)
      .distance(100))
    .force('charge', d3.forceManyBody().strength(-500))
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force('collision', d3.forceCollide().radius(40));

  // Create links
  const link = g.append('g')
    .selectAll('line')
    .data(graph.links)
    .join('line')
    .attr('stroke', d => d.isConditional ? '#f39c12' : '#95a5a6')
    .attr('stroke-width', 2)
    .attr('stroke-opacity', 0.6)
    .attr('marker-end', d => `url(#${d.isConditional ? 'arrow-conditional' : 'arrow'})`);

  // Create nodes
  const node = g.append('g')
    .selectAll('g')
    .data(graph.nodes)
    .join('g')
    .call(d3.drag<any, any>()
      .on('start', dragStarted)
      .on('drag', dragged)
      .on('end', dragEnded));

  // Add circles for nodes
  node.append('circle')
    .attr('r', 20)
    .attr('fill', d => d.type === 'knot' ? '#3498db' : '#2ecc71')
    .attr('stroke', '#ecf0f1')
    .attr('stroke-width', 2)
    .style('cursor', 'pointer');

  // Add labels
  node.append('text')
    .text(d => d.label)
    .attr('x', 0)
    .attr('y', -25)
    .attr('text-anchor', 'middle')
    .attr('fill', '#ecf0f1')
    .attr('font-size', '12px')
    .attr('font-weight', 'bold')
    .style('pointer-events', 'none')
    .style('user-select', 'none');

  // Add type indicator
  node.append('text')
    .text(d => d.type === 'knot' ? '📦' : '📎')
    .attr('x', 0)
    .attr('y', 5)
    .attr('text-anchor', 'middle')
    .attr('font-size', '16px')
    .style('pointer-events', 'none');

  // Add tooltips
  node.append('title')
    .text(d => `${d.type === 'knot' ? 'Knot' : 'Stitch'}: ${d.id}`);

  // Update positions on simulation tick
  simulation.on('tick', () => {
    link
      .attr('x1', (d: any) => d.source.x)
      .attr('y1', (d: any) => d.source.y)
      .attr('x2', (d: any) => d.target.x)
      .attr('y2', (d: any) => d.target.y);

    node.attr('transform', (d: any) => `translate(${d.x},${d.y})`);
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
