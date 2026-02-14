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
import { createMinimap, type MinimapController } from './minimap.js';

function cssVar(name: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function getNodeFill(type: NodeType): string {
    if (type === 'root') return cssVar('--graph-root-fill');
    if (type === 'stitch') return cssVar('--graph-stitch-fill');
    return cssVar('--graph-knot-fill');
}

const getNodeDimensions = (_node: GraphNode) => {
    return { width: 100, height: 50 };
};

function splitLabelParts(label: string): string[] {
    return label
        .replace(/([a-z])([A-Z])/g, '$1\0$2')
        .replace(/[_.]/g, m => m + '\0')
        .split('\0')
        .filter(s => s.length > 0);
}

function wrapLabel(textEl: SVGTextElement, label: string, maxWidth: number): void {
    textEl.textContent = label;
    if (textEl.getComputedTextLength() <= maxWidth) {
        textEl.setAttribute('y', '5');
        return;
    }

    const parts = splitLabelParts(label);
    let line1 = '';
    let remaining = '';

    for (let i = 0; i < parts.length; i++) {
        const candidate = line1 + parts[i];
        textEl.textContent = candidate;
        if (textEl.getComputedTextLength() > maxWidth && line1.length > 0) {
            remaining = parts.slice(i).join('');
            break;
        }
        line1 = candidate;
        if (i === parts.length - 1) {
            remaining = '';
        }
    }

    if (!remaining && textEl.getComputedTextLength() > maxWidth) {
        for (let i = label.length - 1; i > 0; i--) {
            textEl.textContent = label.substring(0, i);
            if (textEl.getComputedTextLength() <= maxWidth) {
                line1 = label.substring(0, i);
                remaining = label.substring(i);
                break;
            }
        }
    }

    if (!remaining) {
        textEl.textContent = label;
        textEl.setAttribute('y', '5');
        return;
    }

    let line2 = remaining;
    textEl.textContent = line2;
    if (textEl.getComputedTextLength() > maxWidth) {
        for (let i = line2.length - 1; i > 0; i--) {
            textEl.textContent = line2.substring(0, i) + '\u2026';
            if (textEl.getComputedTextLength() <= maxWidth) {
                line2 = line2.substring(0, i) + '\u2026';
                break;
            }
        }
    }

    textEl.textContent = '';
    const tspan1 = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
    tspan1.setAttribute('x', '0');
    tspan1.setAttribute('dy', '-0.4em');
    tspan1.textContent = line1;

    const tspan2 = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
    tspan2.setAttribute('x', '0');
    tspan2.setAttribute('dy', '1.2em');
    tspan2.textContent = line2;

    textEl.appendChild(tspan1);
    textEl.appendChild(tspan2);
}

const getIntersectionPoint = (
    cx: number, cy: number,
    width: number, height: number,
    tx: number, ty: number
) => {
    const dx = tx - cx;
    const dy = ty - cy;

    if (dx === 0 && dy === 0) {
        return { x: cx, y: cy };
    }

    const angle = Math.atan2(dy, dx);
    const hw = width / 2;
    const hh = height / 2;
    const absAngle = Math.abs(angle);
    const cornerAngle = Math.atan2(hh, hw);

    let x, y;

    if (absAngle <= cornerAngle) {
        x = cx + hw;
        y = cy + Math.tan(angle) * hw;
    } else if (absAngle <= Math.PI - cornerAngle) {
        if (angle > 0) {
            y = cy + hh;
            x = cx + hh / Math.tan(angle);
        } else {
            y = cy - hh;
            x = cx - hh / Math.tan(angle);
        }
    } else {
        x = cx - hw;
        y = cy - Math.tan(angle) * hw;
    }

    return { x, y };
};

/**
 * Computes edge-to-edge link endpoints for a source/target pair.
 */
function computeLinkEndpoints(d: any, nodes: GraphNode[]) {
    const source = typeof d.source === 'object' ? d.source : nodes.find(n => n.id === d.source);
    const target = typeof d.target === 'object' ? d.target : nodes.find(n => n.id === d.target);
    if (!source || !target) return { x1: 0, y1: 0, x2: 0, y2: 0 };

    const sourceDims = getNodeDimensions(source);
    const sourcePoint = getIntersectionPoint(
        source.x || 0, source.y || 0,
        sourceDims.width, sourceDims.height,
        target.x || 0, target.y || 0
    );

    const targetDims = getNodeDimensions(target);
    const targetPoint = getIntersectionPoint(
        target.x || 0, target.y || 0,
        targetDims.width, targetDims.height,
        source.x || 0, source.y || 0
    );

    return { x1: sourcePoint.x, y1: sourcePoint.y, x2: targetPoint.x, y2: targetPoint.y };
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
    const onNodeTest = options?.onNodeTest;
    const container = document.getElementById(containerId);
    if (!container) {
        console.error(`Container ${containerId} not found`);
        return null;
    }

    container.innerHTML = '';

    const graph = structureToGraph(structure);

    if (graph.nodes.length === 0) {
        container.innerHTML = '<div class="empty-message">No nodes to display</div>';
        return null;
    }

    const height = container.clientHeight;

    const svg = d3.select(`#${containerId}`)
        .append('svg')
        .attr('width', '100%')
        .attr('height', '100%');

    const g = svg.append('g');

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

    const linksLayer = g.append('g').attr('class', 'links');
    const nodesLayer = g.append('g').attr('class', 'nodes');

    const visitedHighlightsGroup = g.insert('g', '.links')
        .attr('class', 'visited-highlights');
    let visitedNodeMap: Map<string, number> = new Map();

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

    let simulation: d3.Simulation<d3.SimulationNodeDatum, undefined>;
    let link: d3.Selection<SVGLineElement, any, SVGGElement, unknown>;
    let node: d3.Selection<SVGGElement, GraphNode, SVGGElement, unknown>;
    let renderPositions: () => void;
    let selectedNodeId: string | null = null;

    // Minimap (created after zoom is set up)
    let minimap: MinimapController;

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

        const dismissHandler = () => {
            hideContextMenu();
            document.removeEventListener('click', dismissHandler);
        };
        setTimeout(() => document.addEventListener('click', dismissHandler), 0);
    }

    svg.on('mousedown.contextmenu', hideContextMenu);

    function updateVisualization() {
        const knotGroups = new Map<string, GraphNode[]>();

        graph.nodes.forEach(n => {
            if (n.type === 'knot') {
                knotGroups.set(n.id, []);
            }
        });

        graph.nodes.forEach(n => {
            if (n.type === 'stitch' && n.knotName) {
                const stitches = knotGroups.get(n.knotName);
                if (stitches) {
                    stitches.push(n);
                }
            }
        });

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

        const needsLayout = !graph.nodes.every(n => n.type === 'stitch' || (n.x !== undefined && n.y !== undefined));
        if (needsLayout) {
            computeHierarchicalPositions(graph, knotGroups, height);

            if (options?.initialTransform) {
                const t = options.initialTransform;
                const transform = d3.zoomIdentity.translate(t.x, t.y).scale(t.k);
                svg.call(zoom.transform as any, transform);
            } else {
                zoomToFit();
            }
        }

        if (simulation) {
            simulation.stop();
        }

        renderPositions = () => {
            link.each(function(d: any) {
                const endpoints = computeLinkEndpoints(d, graph.nodes);
                const el = d3.select(this);
                el.attr('x1', endpoints.x1)
                  .attr('y1', endpoints.y1)
                  .attr('x2', endpoints.x2)
                  .attr('y2', endpoints.y2);
            });

            node.attr('transform', (d: any) => `translate(${d.x},${d.y})`);

            if (currentHighlightedNodeId) {
                const hn = graph.nodes.find(n => n.id === currentHighlightedNodeId);
                if (hn) {
                    currentHighlight.attr('transform', `translate(${hn.x || 0},${hn.y || 0})`);
                }
            }

            visitedHighlightsGroup.selectAll<SVGRectElement, { id: string }>('rect')
                .attr('transform', d => {
                    const n = graph.nodes.find(n => n.id === d.id);
                    return n ? `translate(${n.x || 0},${n.y || 0})` : '';
                });
        };

        graph.nodes.forEach(n => {
            (n as any).targetX = n.x;
            (n as any).targetY = n.y;
        });

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
            .on('tick', () => { renderPositions(); minimap?.updatePositions(); });

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

                    nodeEnter.append('text')
                        .attr('class', 'node-label')
                        .attr('x', 0)
                        .attr('y', 5)
                        .attr('text-anchor', 'middle')
                        .attr('fill', cssVar('--graph-node-text'))
                        .attr('font-size', '12px')
                        .attr('font-weight', d => (d.type === 'knot' || d.type === 'root') ? 'bold' : 'normal')
                        .style('pointer-events', 'none')
                        .style('user-select', 'none')
                        .each(function(d) {
                            wrapLabel(this, d.label, 90);
                        });

                    nodeEnter.append('title')
                        .text(d => d.type === 'root' ? 'Root' : d.type === 'knot' ? `Knot: ${d.id}` : `Stitch: ${d.id}`);

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

        renderPositions();
    }

    // Drag handling
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
        event.subject.fx = event.x;
        event.subject.fy = event.y;

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
            event.subject.fx = null;
            event.subject.fy = null;
            event.subject.x = dragStartX;
            event.subject.y = dragStartY;
            simulation.alpha(0.1).restart();

            if (options?.onNodeClick) {
                nodesLayer.selectAll('.node-rect')
                    .attr('stroke', cssVar('--graph-node-stroke'))
                    .attr('stroke-width', 2);

                nodesLayer.selectAll<SVGGElement, GraphNode>('g')
                    .filter((d: GraphNode) => d.id === event.subject.id)
                    .select('.node-rect')
                    .attr('stroke', cssVar('--graph-selected-stroke'))
                    .attr('stroke-width', 3);

                selectedNodeId = event.subject.id;
                options.onNodeClick(event.subject.id, event.subject.type, event.subject.knotName);
            }
            return;
        }

        const newX = event.subject.fx;
        const newY = event.subject.fy;

        event.subject.x = newX;
        event.subject.y = newY;
        event.subject.targetX = newX;
        event.subject.targetY = newY;

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

        event.subject.fx = null;
        event.subject.fy = null;

        simulation.force('x', d3.forceX((d: any) => (d as any).targetX).strength(0.9));
        simulation.force('y', d3.forceY((d: any) => (d as any).targetY).strength(0.9));
        simulation.alpha(0.3).restart();
    }

    // Zoom behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.1, 4])
        .on('zoom', (event) => {
            g.attr('transform', event.transform);
            minimap?.updateViewport();
            if (options?.onTransformChange) {
                const t = event.transform;
                options.onTransformChange({ x: t.x, y: t.y, k: t.k });
            }
        });

    svg.call(zoom as any);

    function zoomToFit() {
        if (graph.nodes.length === 0) return;

        const currentWidth = container!.clientWidth;
        const currentHeight = container!.clientHeight;

        const padding = 50;
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

        minX -= padding;
        maxX += padding;
        minY -= padding;
        maxY += padding;

        const graphWidth = maxX - minX;
        const graphHeight = maxY - minY;

        const scale = Math.min(
            currentWidth / graphWidth,
            currentHeight / graphHeight,
            4
        );

        const translateX = (currentWidth - graphWidth * scale) / 2 - minX * scale;
        const translateY = (currentHeight - graphHeight * scale) / 2 - minY * scale;

        const transform = d3.zoomIdentity
            .translate(translateX, translateY)
            .scale(scale);

        svg.transition()
            .duration(750)
            .call(zoom.transform as any, transform);
    }

    // Legend
    const legend = svg.append('g')
        .attr('class', 'legend')
        .attr('transform', 'translate(20, 20)');

    legend.append('rect')
        .attr('x', -10)
        .attr('y', -10)
        .attr('width', 150)
        .attr('height', 75)
        .attr('fill', cssVar('--graph-legend-bg'))
        .attr('rx', 5);

    legend.append('rect')
        .attr('x', -8).attr('y', -8).attr('width', 35).attr('height', 16)
        .attr('rx', 4).attr('ry', 4)
        .attr('fill', cssVar('--graph-knot-fill'))
        .attr('stroke', cssVar('--graph-node-stroke')).attr('stroke-width', 1);
    legend.append('text')
        .attr('x', 35).attr('y', 5)
        .attr('fill', cssVar('--graph-legend-text')).attr('font-size', '11px')
        .text('Knot');

    legend.append('rect')
        .attr('x', -8).attr('y', 17).attr('width', 35).attr('height', 16)
        .attr('rx', 4).attr('ry', 4)
        .attr('fill', cssVar('--graph-stitch-fill'))
        .attr('stroke', cssVar('--graph-node-stroke')).attr('stroke-width', 1);
    legend.append('text')
        .attr('x', 35).attr('y', 30)
        .attr('fill', cssVar('--graph-legend-text')).attr('font-size', '11px')
        .text('Stitch');

    legend.append('rect')
        .attr('x', -8).attr('y', 42).attr('width', 35).attr('height', 16)
        .attr('rx', 4).attr('ry', 4)
        .attr('fill', cssVar('--graph-root-fill'))
        .attr('stroke', cssVar('--graph-node-stroke')).attr('stroke-width', 1);
    legend.append('text')
        .attr('x', 35).attr('y', 55)
        .attr('fill', cssVar('--graph-legend-text')).attr('font-size', '11px')
        .text('Root');

    // Initial render
    updateVisualization();

    // Create minimap
    minimap = createMinimap(container, graph, cssVar, getNodeFill, svg, zoom);
    minimap.updatePositions();
    minimap.updateViewport();

    // Select initial node if specified
    function selectNode(nodeId: string): void {
        const targetNode = graph.nodes.find(n => n.id === nodeId);
        if (!targetNode) return;

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

            visitedNodeMap = visited || new Map();

            const visitedArray: Array<{ id: string; opacity: number }> = [];
            visitedNodeMap.forEach((opacity, id) => {
                visitedArray.push({ id, opacity });
            });

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
                .attr('opacity', d => d.opacity)
                .attr('transform', d => {
                    const n = graph.nodes.find(n => n.id === d.id);
                    return n ? `translate(${n.x || 0},${n.y || 0})` : '';
                });

            minimap.updateColors(cssVar, getNodeFill, currentHighlightedNodeId, visitedNodeMap);
        },
        updateColors() {
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

            legend.select('rect').attr('fill', cssVar('--graph-legend-bg'));
            legend.selectAll('text').attr('fill', cssVar('--graph-legend-text'));

            const legendRects = legend.selectAll('rect').nodes() as SVGRectElement[];
            if (legendRects.length >= 4) {
                d3.select(legendRects[1]).attr('fill', cssVar('--graph-knot-fill')).attr('stroke', cssVar('--graph-node-stroke'));
                d3.select(legendRects[2]).attr('fill', cssVar('--graph-stitch-fill')).attr('stroke', cssVar('--graph-node-stroke'));
                d3.select(legendRects[3]).attr('fill', cssVar('--graph-root-fill')).attr('stroke', cssVar('--graph-node-stroke'));
            }

            minimap.updateColors(cssVar, getNodeFill, currentHighlightedNodeId, visitedNodeMap);
        }
    };
}
