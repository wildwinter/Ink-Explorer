/**
 * Minimap for the graph visualization.
 * Renders a small overview of the full graph with a viewport indicator.
 */

import * as d3 from 'd3';
import type { Graph, GraphNode, NodeType } from './layout.js';

const MINIMAP_WIDTH = 100;
const MINIMAP_HEIGHT = 70;
const MINIMAP_PADDING = 30;

export interface MinimapController {
    updatePositions(): void;
    updateViewport(): void;
    updateColors(
        cssVar: (name: string) => string,
        getNodeFill: (type: NodeType) => string,
        currentHighlightedNodeId: string | null,
        visitedNodeMap: Map<string, number>
    ): void;
    getNodeFillForHighlight(
        d: GraphNode,
        cssVar: (name: string) => string,
        getNodeFill: (type: NodeType) => string,
        currentHighlightedNodeId: string | null,
        visitedNodeMap: Map<string, number>
    ): string;
}

export function createMinimap(
    container: HTMLElement,
    graph: Graph,
    cssVar: (name: string) => string,
    getNodeFill: (type: NodeType) => string,
    svg: d3.Selection<SVGSVGElement, unknown, any, any>,
    zoom: d3.ZoomBehavior<SVGSVGElement, unknown>
): MinimapController {
    const minimapDiv = document.createElement('div');
    minimapDiv.className = 'minimap';
    container.appendChild(minimapDiv);

    const minimapSvg = d3.select(minimapDiv)
        .append('svg')
        .attr('width', MINIMAP_WIDTH)
        .attr('height', MINIMAP_HEIGHT);

    minimapSvg.append('rect')
        .attr('width', MINIMAP_WIDTH)
        .attr('height', MINIMAP_HEIGHT)
        .attr('fill', cssVar('--graph-minimap-bg'))
        .attr('stroke', cssVar('--graph-minimap-stroke'))
        .attr('stroke-width', 1)
        .attr('rx', 4);

    const minimapG = minimapSvg.append('g');

    const minimapLinkSel = minimapG.selectAll<SVGLineElement, any>('line')
        .data(graph.links)
        .join('line')
        .attr('stroke', cssVar('--graph-minimap-link'))
        .attr('stroke-width', 0.5);

    const minimapNodeSel = minimapG.selectAll<SVGRectElement, GraphNode>('rect.mm-node')
        .data(graph.nodes)
        .join('rect')
        .attr('class', 'mm-node')
        .attr('width', 8)
        .attr('height', 4)
        .attr('rx', 1)
        .attr('fill', d => getNodeFill(d.type));

    const viewportRect = minimapSvg.append('rect')
        .attr('fill', cssVar('--graph-minimap-viewport-fill'))
        .attr('stroke', cssVar('--graph-minimap-viewport-stroke'))
        .attr('stroke-width', 1)
        .style('pointer-events', 'none');

    function computeMapping() {
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

    function navigateFromMinimap(event: any) {
        const [mx, my] = d3.pointer(event, minimapSvg.node());
        const mm = computeMapping();

        const graphX = (mx - mm.offsetX) / mm.scale;
        const graphY = (my - mm.offsetY) / mm.scale;

        const cw = container.clientWidth;
        const ch = container.clientHeight;
        // @ts-ignore
        const t = d3.zoomTransform(svg.node()!);

        const newTransform = d3.zoomIdentity
            .translate(cw / 2 - graphX * t.k, ch / 2 - graphY * t.k)
            .scale(t.k);
        svg.call(zoom.transform as any, newTransform);
    }

    minimapSvg.call(d3.drag<SVGSVGElement, unknown>()
        .on('start drag', navigateFromMinimap) as any);

    function computeNodeFill(
        d: GraphNode,
        cssVarFn: (name: string) => string,
        getNodeFillFn: (type: NodeType) => string,
        currentHighlightedNodeId: string | null,
        visitedNodeMap: Map<string, number>
    ): string {
        if (d.id === currentHighlightedNodeId) return cssVarFn('--graph-current-arrow');
        const opacity = visitedNodeMap.get(d.id);
        if (opacity !== undefined) {
            const baseColor = getNodeFillFn(d.type);
            const highlightColor = cssVarFn('--graph-current-arrow');
            return d3.interpolateRgb(baseColor, highlightColor)(Math.min(1, opacity / 0.75));
        }
        return getNodeFillFn(d.type);
    }

    return {
        updatePositions() {
            const mm = computeMapping();

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
        },
        updateViewport() {
            const mm = computeMapping();
            const cw = container.clientWidth;
            const ch = container.clientHeight;
            // @ts-ignore
            const t = d3.zoomTransform(svg.node()!);

            const visLeft = -t.x / t.k;
            const visTop = -t.y / t.k;
            const visWidth = cw / t.k;
            const visHeight = ch / t.k;

            viewportRect
                .attr('x', visLeft * mm.scale + mm.offsetX)
                .attr('y', visTop * mm.scale + mm.offsetY)
                .attr('width', visWidth * mm.scale)
                .attr('height', visHeight * mm.scale);
        },
        updateColors(cssVarFn, getNodeFillFn, currentHighlightedNodeId, visitedNodeMap) {
            minimapSvg.select('rect').attr('fill', cssVarFn('--graph-minimap-bg'))
                .attr('stroke', cssVarFn('--graph-minimap-stroke'));
            minimapLinkSel.attr('stroke', cssVarFn('--graph-minimap-link'));
            minimapNodeSel.attr('fill', d => computeNodeFill(d, cssVarFn, getNodeFillFn, currentHighlightedNodeId, visitedNodeMap));
            viewportRect.attr('fill', cssVarFn('--graph-minimap-viewport-fill'))
                .attr('stroke', cssVarFn('--graph-minimap-viewport-stroke'));
        },
        getNodeFillForHighlight: computeNodeFill
    };
}
