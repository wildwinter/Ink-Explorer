/**
 * Minimap for the graph visualization.
 * Renders a small overview of the full graph with a viewport indicator using Canvas.
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

    // Create Canvas
    const canvas = document.createElement('canvas');
    // Handle High DPI displays
    const dpr = window.devicePixelRatio || 1;
    canvas.width = MINIMAP_WIDTH * dpr;
    canvas.height = MINIMAP_HEIGHT * dpr;
    canvas.style.width = `${MINIMAP_WIDTH}px`;
    canvas.style.height = `${MINIMAP_HEIGHT}px`;

    minimapDiv.appendChild(canvas);

    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);

    // Track state for rendering
    let currentHighlightedId: string | null = null;
    let currentVisitedMap: Map<string, number> = new Map();

    // Mutable references to functions so they can be updated
    let currentCssVar = cssVar;
    let currentGetNodeFill = getNodeFill;

    // Helper to get fresh colors
    const getColors = () => ({
        bg: currentCssVar('--graph-minimap-bg'),
        stroke: currentCssVar('--graph-minimap-stroke'),
        link: currentCssVar('--graph-minimap-link'),
        viewportFill: currentCssVar('--graph-minimap-viewport-fill'),
        viewportStroke: currentCssVar('--graph-minimap-viewport-stroke'),
        highlight: currentCssVar('--graph-current-arrow')
    });

    let currentColors = getColors();

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

    function render() {
        ctx.clearRect(0, 0, MINIMAP_WIDTH, MINIMAP_HEIGHT);

        // 1. Background
        ctx.fillStyle = currentColors.bg;
        ctx.strokeStyle = currentColors.stroke;
        ctx.lineWidth = 1;

        // Rounded rect background
        const r = 4;
        ctx.beginPath();
        ctx.moveTo(r, 0);
        ctx.lineTo(MINIMAP_WIDTH - r, 0);
        ctx.quadraticCurveTo(MINIMAP_WIDTH, 0, MINIMAP_WIDTH, r);
        ctx.lineTo(MINIMAP_WIDTH, MINIMAP_HEIGHT - r);
        ctx.quadraticCurveTo(MINIMAP_WIDTH, MINIMAP_HEIGHT, MINIMAP_WIDTH - r, MINIMAP_HEIGHT);
        ctx.lineTo(r, MINIMAP_HEIGHT);
        ctx.quadraticCurveTo(0, MINIMAP_HEIGHT, 0, MINIMAP_HEIGHT - r);
        ctx.lineTo(0, r);
        ctx.quadraticCurveTo(0, 0, r, 0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        const mm = computeMapping();

        // 2. Links
        ctx.strokeStyle = currentColors.link;
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        graph.links.forEach(link => {
            const s = typeof link.source === 'object' ? link.source : graph.nodes.find(n => n.id === link.source);
            const t = typeof link.target === 'object' ? link.target : graph.nodes.find(n => n.id === link.target);

            if (s && t && s.x !== undefined && s.y !== undefined && t.x !== undefined && t.y !== undefined) {
                const x1 = s.x * mm.scale + mm.offsetX;
                const y1 = s.y * mm.scale + mm.offsetY;
                const x2 = t.x * mm.scale + mm.offsetX;
                const y2 = t.y * mm.scale + mm.offsetY;
                ctx.moveTo(x1, y1);
                ctx.lineTo(x2, y2);
            }
        });
        ctx.stroke();

        // 3. Nodes
        graph.nodes.forEach(node => {
            if (node.x === undefined || node.y === undefined) return;

            const x = node.x * mm.scale + mm.offsetX - 4; // Center horizontally (width 8)
            const y = node.y * mm.scale + mm.offsetY - 2; // Center vertically (height 4)

            ctx.fillStyle = computeNodeFill(node, currentCssVar, currentGetNodeFill, currentHighlightedId, currentVisitedMap);

            // Draw rounded rect for node (8x4, radius 1)
            const w = 8;
            const h = 4;
            const nr = 1;

            ctx.beginPath();
            ctx.moveTo(x + nr, y);
            ctx.lineTo(x + w - nr, y);
            ctx.quadraticCurveTo(x + w, y, x + w, y + nr);
            ctx.lineTo(x + w, y + h - nr);
            ctx.quadraticCurveTo(x + w, y + h, x + w - nr, y + h);
            ctx.lineTo(x + nr, y + h);
            ctx.quadraticCurveTo(x, y + h, x, y + h - nr);
            ctx.lineTo(x, y + nr);
            ctx.quadraticCurveTo(x, y, x + nr, y);
            ctx.fill();
        });

        // 4. Viewport Rect
        const cw = container.clientWidth;
        const ch = container.clientHeight;
        // @ts-ignore
        const t = d3.zoomTransform(svg.node()!);

        const visLeft = -t.x / t.k;
        const visTop = -t.y / t.k;
        const visWidth = cw / t.k;
        const visHeight = ch / t.k;

        const vx = visLeft * mm.scale + mm.offsetX;
        const vy = visTop * mm.scale + mm.offsetY;
        const vw = visWidth * mm.scale;
        const vh = visHeight * mm.scale;

        ctx.fillStyle = currentColors.viewportFill;
        ctx.strokeStyle = currentColors.viewportStroke;
        ctx.lineWidth = 1;
        ctx.fillRect(vx, vy, vw, vh);
        ctx.strokeRect(vx, vy, vw, vh);
    }

    function navigateFromMinimap(event: any) {
        const [mx, my] = d3.pointer(event, canvas); // get pointer relative to canvas
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

    d3.select(canvas).call(d3.drag<HTMLCanvasElement, unknown>()
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
            render();
        },
        updateViewport() {
            render();
        },
        updateColors(cssVarFn, getNodeFillFn, currentHighlightedNodeId, visitedNodeMap) {
            currentCssVar = cssVarFn;
            currentGetNodeFill = getNodeFillFn;
            currentColors = getColors();
            currentHighlightedId = currentHighlightedNodeId;
            currentVisitedMap = visitedNodeMap;
            render();
        },
        getNodeFillForHighlight: computeNodeFill
    };
}
