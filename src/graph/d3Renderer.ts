/**
 * D3 Renderer for Ink Story Graph
 */

import * as d3 from 'd3';
import type { StoryStructure } from '../ink/analyzer.js';
import {
    structureToGraph,
    computeHierarchicalPositions,
    type GraphNode,
    type NodeType,
    type GraphOptions,
    type GraphController
} from './layout.js';

function cssVar(name: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function getNodeFill(type: NodeType): string {
    if (type === 'root') return cssVar('--graph-root-fill');
    if (type === 'stitch') return cssVar('--graph-stitch-fill');
    return cssVar('--graph-knot-fill');
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

/**
 * Creates an interactive graph visualization
 */
export function createGraphVisualization(
    containerId: string,
    structure: StoryStructure,
    options?: GraphOptions
): GraphController | null {
    const onNodeClick = options?.onNodeClick;
    const onNodeTest = options?.onNodeTest;
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
        .attr('fill', cssVar('--graph-link-stroke'));

    // Create layers
    const linksLayer = g.append('g').attr('class', 'links');
    const nodesLayer = g.append('g').attr('class', 'nodes');

    // Visited-node highlights (fading red borders behind everything)
    const visitedHighlightsGroup = g.insert('g', '.links')
        .attr('class', 'visited-highlights');
    let visitedNodeMap: Map<string, number> = new Map();

    // Current-node indicator — filled rect larger than the node, drawn behind it
    const currentHighlight = g.insert('rect', '.links')
        .attr('class', 'current-highlight')
        .attr('width', 116)
        .attr('height', 66)
        .attr('x', -58)
        .attr('y', -33)
        .attr('rx', 12)
        .attr('ry', 12)
        .attr('fill', cssVar('--graph-current-arrow'))
        .attr('stroke', 'none')
        .style('display', 'none');
    let currentHighlightedNodeId: string | null = null;

    // Variables to hold D3 selections and simulation
    let simulation: d3.Simulation<d3.SimulationNodeDatum, undefined>;
    let link: d3.Selection<SVGLineElement, any, SVGGElement, unknown>;
    let node: d3.Selection<SVGGElement, GraphNode, SVGGElement, unknown>;
    let renderPositions: () => void;
    let selectedNodeId: string | null = null;

    // Minimap update functions (assigned after minimap is created)
    let updateMinimapViewport: () => void = () => { };
    let updateMinimapPositions: () => void = () => { };

    // Context menu for right-click "Test" on nodes
    let contextMenuEl: HTMLDivElement | null = null;

    function hideContextMenu() {
        if (contextMenuEl && contextMenuEl.parentNode) {
            contextMenuEl.remove();
        }
        contextMenuEl = null;
    }

    function showContextMenu(x: number, y: number, d: GraphNode) {
        hideContextMenu();

        contextMenuEl = document.createElement('div');
        contextMenuEl.className = 'graph-context-menu';
        contextMenuEl.style.left = `${x}px`;
        contextMenuEl.style.top = `${y}px`;

        const testItem = document.createElement('div');
        testItem.className = 'graph-context-menu-item';
        testItem.textContent = `Test "${d.label}"`;
        testItem.onclick = () => {
            hideContextMenu();
            if (onNodeTest) {
                onNodeTest(d.id, d.type, d.knotName);
            }
        };

        contextMenuEl.appendChild(testItem);
        document.body.appendChild(contextMenuEl);

        // Dismiss on click elsewhere
        const dismissHandler = () => {
            hideContextMenu();
            document.removeEventListener('click', dismissHandler);
        };
        // Defer so the current event doesn't immediately dismiss
        setTimeout(() => document.addEventListener('click', dismissHandler), 0);
    }

    // Dismiss context menu on scroll/zoom
    svg.on('mousedown.contextmenu', hideContextMenu);

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
            computeHierarchicalPositions(graph, knotGroups, height);

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

            // Update current-node highlight position
            if (currentHighlightedNodeId) {
                const hn = graph.nodes.find(n => n.id === currentHighlightedNodeId);
                if (hn) {
                    currentHighlight.attr('transform', `translate(${hn.x || 0},${hn.y || 0})`);
                }
            }

            // Update visited highlight positions
            visitedHighlightsGroup.selectAll<SVGRectElement, { id: string }>('rect')
                .attr('transform', d => {
                    const n = graph.nodes.find(n => n.id === d.id);
                    return n ? `translate(${n.x || 0},${n.y || 0})` : '';
                });
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
            .selectAll<SVGLineElement, any>('line')
            .data(graph.links, (d: any) => {
                const sourceId = typeof d.source === 'string' ? d.source : (d.source as any).id;
                const targetId = typeof d.target === 'string' ? d.target : (d.target as any).id;
                return `${sourceId}-${targetId}`;
            })
            .join('line')
            .attr('stroke', cssVar('--graph-link-stroke'))
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
                        .attr('fill', d => getNodeFill(d.type))
                        .attr('stroke', cssVar('--graph-node-stroke'))
                        .attr('stroke-width', 2)
                        .style('cursor', 'pointer');

                    // Add label
                    nodeEnter.append('text')
                        .attr('class', 'node-label')
                        .text(d => d.label)
                        .attr('x', 0)
                        .attr('y', 5)
                        .attr('text-anchor', 'middle')
                        .attr('fill', cssVar('--graph-node-text'))
                        .attr('font-size', '12px')
                        .attr('font-weight', d => (d.type === 'knot' || d.type === 'root') ? 'bold' : 'normal')
                        .style('pointer-events', 'none')
                        .style('user-select', 'none');

                    // Add tooltip
                    nodeEnter.append('title')
                        .text(d => d.type === 'root' ? 'Root' : d.type === 'knot' ? `Knot: ${d.id}` : `Stitch: ${d.id}`);

                    // Add click handler (only fires if not dragging)
                    if (onNodeClick) {
                        nodeEnter.on('click', (event: MouseEvent, d: GraphNode) => {
                            // Ignore if this was a drag
                            if (wasDragged) return;

                            // Highlight selected node
                            nodesLayer.selectAll('.node-rect')
                                .attr('stroke', cssVar('--graph-node-stroke'))
                                .attr('stroke-width', 2);
                            d3.select(event.currentTarget as Element).select('.node-rect')
                                .attr('stroke', cssVar('--graph-selected-stroke'))
                                .attr('stroke-width', 3);

                            selectedNodeId = d.id;
                            onNodeClick(d.id, d.type, d.knotName);
                        });
                    }

                    // Add right-click context menu
                    if (onNodeTest) {
                        nodeEnter.on('contextmenu', (event: MouseEvent, d: GraphNode) => {
                            event.preventDefault();
                            event.stopPropagation();
                            showContextMenu(event.clientX, event.clientY, d);
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
        .attr('height', 75)
        .attr('fill', cssVar('--graph-legend-bg'))
        .attr('rx', 5);

    // Knot legend
    legend.append('rect')
        .attr('x', -8)
        .attr('y', -8)
        .attr('width', 35)
        .attr('height', 16)
        .attr('rx', 4)
        .attr('ry', 4)
        .attr('fill', cssVar('--graph-knot-fill'))
        .attr('stroke', cssVar('--graph-node-stroke'))
        .attr('stroke-width', 1);

    legend.append('text')
        .attr('x', 35)
        .attr('y', 5)
        .attr('fill', cssVar('--graph-legend-text'))
        .attr('font-size', '11px')
        .text('Knot');

    // Stitch legend
    legend.append('rect')
        .attr('x', -8)
        .attr('y', 17)
        .attr('width', 35)
        .attr('height', 16)
        .attr('rx', 4)
        .attr('ry', 4)
        .attr('fill', cssVar('--graph-stitch-fill'))
        .attr('stroke', cssVar('--graph-node-stroke'))
        .attr('stroke-width', 1);

    legend.append('text')
        .attr('x', 35)
        .attr('y', 30)
        .attr('fill', cssVar('--graph-legend-text'))
        .attr('font-size', '11px')
        .text('Stitch');

    // Root legend
    legend.append('rect')
        .attr('x', -8)
        .attr('y', 42)
        .attr('width', 35)
        .attr('height', 16)
        .attr('rx', 4)
        .attr('ry', 4)
        .attr('fill', cssVar('--graph-root-fill'))
        .attr('stroke', cssVar('--graph-node-stroke'))
        .attr('stroke-width', 1);

    legend.append('text')
        .attr('x', 35)
        .attr('y', 55)
        .attr('fill', cssVar('--graph-legend-text'))
        .attr('font-size', '11px')
        .text('Root');

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
        .attr('fill', cssVar('--graph-minimap-bg'))
        .attr('stroke', cssVar('--graph-minimap-stroke'))
        .attr('stroke-width', 1)
        .attr('rx', 4);

    const minimapG = minimapSvg.append('g');

    // Simplified links
    const minimapLinkSel = minimapG.selectAll<SVGLineElement, any>('line')
        .data(graph.links)
        .join('line')
        .attr('stroke', cssVar('--graph-minimap-link'))
        .attr('stroke-width', 0.5);

    // Simplified nodes
    const minimapNodeSel = minimapG.selectAll<SVGRectElement, GraphNode>('rect.mm-node')
        .data(graph.nodes)
        .join('rect')
        .attr('class', 'mm-node')
        .attr('width', 8)
        .attr('height', 4)
        .attr('rx', 1)
        .attr('fill', d => getNodeFill(d.type));

    // Viewport rectangle (shows current visible area)
    const viewportRect = minimapSvg.append('rect')
        .attr('fill', cssVar('--graph-minimap-viewport-fill'))
        .attr('stroke', cssVar('--graph-minimap-viewport-stroke'))
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
        // @ts-ignore
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
        // @ts-ignore
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
            .attr('stroke', cssVar('--graph-node-stroke'))
            .attr('stroke-width', 2);
        nodesLayer.selectAll<SVGGElement, GraphNode>('.node')
            .filter(d => d.id === nodeId)
            .select('.node-rect')
            .attr('stroke', cssVar('--graph-selected-stroke'))
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
        selectNode,
        centreOnNode(nodeId: string): void {
            const targetNode = graph.nodes.find(n => n.id === nodeId);
            if (!targetNode) return;
            const svgNode = svg.node();
            if (!svgNode) return;
            const cw = svgNode.clientWidth;
            const ch = svgNode.clientHeight;
            const t = d3.zoomTransform(svgNode);
            const transform = d3.zoomIdentity
                .translate(cw / 2 - (targetNode.x || 0) * t.k, ch / 2 - (targetNode.y || 0) * t.k)
                .scale(t.k);
            svg.transition().duration(300).call(zoom.transform as any, transform);
        },
        highlightCurrentNode(nodeId: string | null, visited?: Map<string, number>): void {
            // Update current highlight
            if (!nodeId) {
                currentHighlightedNodeId = null;
                currentHighlight.style('display', 'none');
            } else {
                const targetNode = graph.nodes.find(n => n.id === nodeId);
                if (targetNode) {
                    currentHighlightedNodeId = nodeId;
                    currentHighlight
                        .attr('transform', `translate(${targetNode.x || 0},${targetNode.y || 0})`)
                        .attr('fill', cssVar('--graph-current-arrow'))
                        .style('display', null);
                }
            }

            // Update visited highlights
            visitedNodeMap = visited || new Map();

            const visitedArray: Array<{ id: string; opacity: number }> = [];
            visitedNodeMap.forEach((opacity, id) => {
                visitedArray.push({ id, opacity });
            });

            // Update visited highlights
            const visitedSelection = visitedHighlightsGroup
                .selectAll<SVGRectElement, { id: string; opacity: number }>('rect')
                .data(visitedArray, d => d.id);

            visitedSelection.exit().remove();

            visitedSelection.enter()
                .append('rect')
                .attr('width', 116)
                .attr('height', 66)
                .attr('x', -58)
                .attr('y', -33)
                .attr('rx', 12)
                .attr('ry', 12)
                .attr('fill', cssVar('--graph-current-arrow'))
                .attr('stroke', 'none')
                .merge(visitedSelection)
                .attr('opacity', d => d.opacity) // Use opacity for the whole element since fill is solid
                .attr('transform', d => {
                    const n = graph.nodes.find(n => n.id === d.id);
                    return n ? `translate(${n.x || 0},${n.y || 0})` : '';
                });

            // Update minimap nodes
            minimapNodeSel.attr('fill', d => {
                if (d.id === currentHighlightedNodeId) return cssVar('--graph-current-arrow');
                const opacity = visitedNodeMap.get(d.id);
                if (opacity !== undefined) {
                    const baseColor = getNodeFill(d.type);
                    const highlightColor = cssVar('--graph-current-arrow');
                    // Interpolate between base color (0) and highlight color (1)
                    // We map opacity 0.0-0.75 to an interpolation value
                    // Let's treat 0.75 as "full strength" for visibility
                    return d3.interpolateRgb(baseColor, highlightColor)(Math.min(1, opacity / 0.75));
                }
                return getNodeFill(d.type);
            });
        },
        updateColors() {
            // Re-apply colors from CSS variables
            svg.select('defs marker path')
                .attr('fill', cssVar('--graph-link-stroke'));

            link.attr('stroke', cssVar('--graph-link-stroke'));

            node.select('.node-rect')
                .attr('fill', d => getNodeFill(d.type))
                .attr('stroke', (d) => d.id === selectedNodeId ?
                    cssVar('--graph-selected-stroke') : cssVar('--graph-node-stroke'));

            node.select('text')
                .attr('fill', cssVar('--graph-node-text'));

            if (currentHighlight) {
                currentHighlight.attr('fill', cssVar('--graph-current-arrow'));
            }

            visitedHighlightsGroup.selectAll('rect')
                .attr('fill', cssVar('--graph-current-arrow'))
                .attr('stroke', 'none');

            // Legend
            legend.select('rect').attr('fill', cssVar('--graph-legend-bg'));
            legend.selectAll('text').attr('fill', cssVar('--graph-legend-text'));

            // Re-select legend items to update them properly
            // The previous index-based selection was fragile. Let's trust the order we created them.
            // Items are: Bg, Knot, Stitch, Root
            const legendRects = legend.selectAll('rect').nodes() as SVGRectElement[];
            if (legendRects.length >= 4) {
                d3.select(legendRects[1]).attr('fill', cssVar('--graph-knot-fill')).attr('stroke', cssVar('--graph-node-stroke'));
                d3.select(legendRects[2]).attr('fill', cssVar('--graph-stitch-fill')).attr('stroke', cssVar('--graph-node-stroke'));
                d3.select(legendRects[3]).attr('fill', cssVar('--graph-root-fill')).attr('stroke', cssVar('--graph-node-stroke'));
            }

            // Minimap
            // Background
            minimapSvg.select('rect').attr('fill', cssVar('--graph-minimap-bg'))
                .attr('stroke', cssVar('--graph-minimap-stroke'));
            minimapLinkSel.attr('stroke', cssVar('--graph-minimap-link'));
            minimapNodeSel.attr('fill', d => {
                if (d.id === currentHighlightedNodeId) return cssVar('--graph-current-arrow');
                const opacity = visitedNodeMap.get(d.id);
                if (opacity !== undefined) {
                    const baseColor = getNodeFill(d.type);
                    const highlightColor = cssVar('--graph-current-arrow');
                    return d3.interpolateRgb(baseColor, highlightColor)(Math.min(1, opacity / 0.75));
                }
                return getNodeFill(d.type);
            });
            viewportRect.attr('fill', cssVar('--graph-minimap-viewport-fill'))
                .attr('stroke', cssVar('--graph-minimap-viewport-stroke'));
        }
    };
}
