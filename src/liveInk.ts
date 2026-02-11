/**
 * Live Ink Controller
 * Handles the interactive playback of Ink stories
 */

import { Story } from 'inkjs';
import type { GraphController } from './graphVisualizer.js';

// Regex for parsing Dinky tags
const dinkyRegex = /^(\s*)([A-Z0-9_]+)(\s*)(\(.*?\)|)(\s*)(:)(\s*)(\(.*?\)|)(\s*)((?:[^/#]|\/(?![/*]))*)/;

export const LIVE_INK_HTML = `
<div class="live-ink-container">
  <div class="live-ink-toolbar">
    <div class="live-ink-btn" id="live-ink-test" title="Test from selected node">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="6 3 20 12 6 21 6 3"/>
      </svg>
    </div>
    <div class="live-ink-btn" id="live-ink-restart" title="Restart">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="19 20 9 12 19 4 19 20"/>
        <line x1="5" y1="19" x2="5" y2="5"/>
      </svg>
    </div>
    <div class="live-ink-btn disabled" id="live-ink-back" title="Step Back">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M9 14 4 9l5-5"/>
        <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11"/>
      </svg>
    </div>
    <div class="live-ink-separator"></div>
    <div class="live-ink-btn" id="live-ink-centre" title="Centre graph on current node">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="3"/>
        <path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>
      </svg>
    </div>
    <label class="live-ink-follow" title="Automatically centre graph when the active node changes">
      <input type="checkbox" id="live-ink-follow"/>
      <span>Follow</span>
    </label>
    <span class="live-ink-status" id="live-ink-status"></span>
  </div>
  <div class="live-ink-output" id="live-ink-output">
    <div class="live-ink-prompt">Select a node and click Test, or right-click a node to test from that point.</div>
  </div>
</div>`;

export class LiveInkController {

    private currentStoryJson: string | object | null = null;
    private currentStartNode: string | null = null;
    private liveInkStory: InstanceType<typeof Story> | null = null;
    private liveInkStateStack: Array<{
        state: string;
        turnElement: HTMLElement;
        currentNodeId: string | null;
        previousNodeId: string | null;
        visitedNodes: Map<string, number>;
    }> = [];
    private liveInkCurrentTurn: HTMLElement | null = null;
    private liveInkIsDinkMode = false;
    private liveInkFollowEnabled = true;
    private liveInkCurrentNodeId: string | null = null;
    private liveInkPreviousNodeId: string | null = null;
    private liveInkVisitedNodes: Map<string, number> = new Map();
    private storyNodePaths: string[] = [];

    private graphController: GraphController | null = null;
    private outputContainer: HTMLElement | null = null;

    constructor() {
        this.setupEventListeners();
    }

    public setGraphController(controller: GraphController | null) {
        this.graphController = controller;
    }

    public setStoryNodePaths(paths: string[]) {
        this.storyNodePaths = paths;
    }

    public setStoryJson(json: string | object | null) {
        this.currentStoryJson = json;
        // Reset state when story changes?
        this.currentStartNode = null;
    }

    public setOutputContainer(element: HTMLElement) {
        this.outputContainer = element;
    }

    private setupEventListeners() {
        // Only wire up if elements exist (they might be created later)
        document.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            if (target.closest('#live-ink-test')) {
                e.preventDefault();
                this.handleTestClick();
            } else if (target.closest('#live-ink-restart')) {
                e.preventDefault();
                if (this.currentStoryJson) this.startLiveInk(this.currentStoryJson, this.currentStartNode);
            } else if (target.closest('#live-ink-back')) {
                e.preventDefault();
                this.goBack();
            } else if (target.closest('#live-ink-centre')) {
                e.preventDefault();
                this.centreOnCurrentNode();
            }
        });

        // Delegation for follow checkbox change would be tricky since it might not exist yet
        // Can just attach when initializing or using a mutation observer, 
        // but renderer.ts called initLiveInk() after creating tabs.
        // We can expose an init method.
    }

    public init() {
        const followCheckbox = document.getElementById('live-ink-follow') as HTMLInputElement | null;
        if (followCheckbox) {
            // Load saved preference
            if (window.api && window.api.loadPref) {
                window.api.loadPref('liveInkFollow').then(val => {
                    this.liveInkFollowEnabled = val === null ? true : val === 'true';
                    if (followCheckbox) followCheckbox.checked = this.liveInkFollowEnabled;
                });
            } else {
                // Determine from current state if no API
                followCheckbox.checked = this.liveInkFollowEnabled;
            }

            followCheckbox.onchange = () => {
                this.liveInkFollowEnabled = followCheckbox.checked;
                if (window.api && window.api.savePref) {
                    window.api.savePref('liveInkFollow', String(this.liveInkFollowEnabled));
                }
                if (this.liveInkFollowEnabled) this.centreOnCurrentNode();
            };
        }
    }

    private handleTestClick() {
        if (!this.currentStoryJson) return;
        // Use the currently selected graph node as the starting point
        const selectedId = this.graphController?.getSelectedNodeId();
        if (selectedId) {
            // Determine node type from the id
            if (selectedId === '__root__') {
                this.startTestFromNode(selectedId, 'root');
            } else {
                const isStitch = selectedId.includes('.');
                const nodeType = isStitch ? 'stitch' : 'knot';
                const knotName = isStitch ? selectedId.split('.')[0] : undefined;
                this.startTestFromNode(selectedId, nodeType, knotName);
            }
        } else {
            // No node selected — start from beginning
            this.currentStartNode = null;
            this.startLiveInk(this.currentStoryJson, null);
        }
    }

    public startTestFromNode(nodeId: string, nodeType: 'knot' | 'stitch' | 'root', knotName?: string) {
        if (!this.currentStoryJson) return;
        this.currentStartNode = this.nodeIdToPath(nodeId, nodeType, knotName);

        // We assume the caller handles tab switching if needed
        this.startLiveInk(this.currentStoryJson, this.currentStartNode);
    }

    public startLiveInk(storyJson: string | object, startPath?: string | null) {
        if (!this.outputContainer) {
            console.error('Live Ink output container not set');
            return;
        }

        this.outputContainer.innerHTML = '';
        this.liveInkStateStack = [];
        this.liveInkCurrentTurn = null;
        this.liveInkIsDinkMode = false;
        this.liveInkCurrentNodeId = null;
        this.liveInkPreviousNodeId = null;
        this.liveInkVisitedNodes.clear();

        // Re-bind listeners/state in case of re-render
        this.init();

        this.updateButtons();
        if (this.graphController) this.graphController.highlightCurrentNode(null);

        // Using global document approach as in original, but could scopes this
        const statusEl = document.getElementById('live-ink-status');
        if (statusEl) {
            statusEl.textContent = startPath ? `Testing: ${startPath}` : 'Testing from start';
        }

        try {
            const json = typeof storyJson === 'string' ? JSON.parse(storyJson) : storyJson;
            this.liveInkStory = new Story(json);

            // Detect Dink mode via global tags
            if (this.liveInkStory.globalTags && this.liveInkStory.globalTags.some((tag: string) => tag.trim() === 'dink')) {
                this.liveInkIsDinkMode = true;
            }

            if (startPath) {
                try {
                    // Check knot tags for dink mode
                    if (!this.liveInkIsDinkMode) {
                        const tags = this.liveInkStory.TagsForContentAtPath(startPath);
                        if (tags && tags.some((tag: string) => tag.trim() === 'dink')) {
                            this.liveInkIsDinkMode = true;
                        }
                    }
                    this.liveInkStory.ChoosePathString(startPath);
                } catch (e) {
                    const p = document.createElement('p');
                    p.style.color = 'orange';
                    p.textContent = `Warning: Could not find "${startPath}". Starting from beginning.`;
                    this.outputContainer.appendChild(p);
                }
            } else {
                // Starting from the beginning — set root as the initial node
                // so it gets tracked as visited when the story advances
                this.liveInkCurrentNodeId = '__root__';
            }

            this.continueLiveInk();
        } catch (e) {
            const p = document.createElement('p');
            p.style.color = 'red';
            p.textContent = 'Runtime Error: ' + (e instanceof Error ? e.message : String(e));
            this.outputContainer.appendChild(p);
        }
    }

    private continueLiveInk() {
        if (!this.liveInkStory) return;
        if (!this.outputContainer) return;

        this.liveInkCurrentTurn = document.createElement('div');
        this.liveInkCurrentTurn.className = 'turn';
        this.outputContainer.appendChild(this.liveInkCurrentTurn);

        // Snapshot visit counts before processing
        const visitCountsBefore = new Map<string, number>();
        for (const nodePath of this.storyNodePaths) {
            visitCountsBefore.set(nodePath, this.liveInkStory.state.VisitCountAtPathString(nodePath) || 0);
        }

        // Seed the previous node
        const seenNodeIds: string[] = [];
        if (this.liveInkCurrentNodeId) {
            seenNodeIds.push(this.liveInkCurrentNodeId);
        }

        // Capture current position before the loop
        const initialPath = this.liveInkStory.state.currentPathString;
        if (initialPath) {
            const parsed = this.pathToNodeId(initialPath);
            if (parsed) this.liveInkCurrentNodeId = parsed;
        }

        while (this.liveInkStory.canContinue) {
            const text = this.liveInkStory.Continue();

            // Track current knot/stitch for graph highlight
            const pathStr = this.liveInkStory.state.currentPathString;
            if (pathStr) {
                const parsed = this.pathToNodeId(pathStr);
                if (parsed) this.liveInkCurrentNodeId = parsed;
            }

            if (!text) continue;

            // Detect dink mode dynamically from knot/line tags
            if (!this.liveInkIsDinkMode && this.liveInkStory.currentTags) {
                if (this.liveInkStory.currentTags.some((tag: string) => tag.trim() === 'dink')) {
                    this.liveInkIsDinkMode = true;
                }
            }

            const p = document.createElement('p');

            if (this.liveInkIsDinkMode) {
                const match = text.match(dinkyRegex);
                if (match) {
                    let html = '';
                    html += this.escapeHtml(match[1]);
                    html += `<span class="dinky-name">${this.escapeHtml(match[2])}</span>`;
                    html += this.escapeHtml(match[3]);
                    if (match[4]) html += `<span class="dinky-qualifier">${this.escapeHtml(match[4])}</span>`;
                    html += this.escapeHtml(match[5]);
                    html += this.escapeHtml(match[6]);
                    html += this.escapeHtml(match[7]);
                    if (match[8]) html += `<span class="dinky-direction">${this.escapeHtml(match[8])}</span>`;
                    html += this.escapeHtml(match[9]);
                    html += `<span class="dinky-text">${this.escapeHtml(match[10])}</span>`;
                    p.innerHTML = html;
                } else {
                    p.textContent = text;
                }
            } else {
                p.textContent = text;
            }

            this.liveInkCurrentTurn.appendChild(p);
        }

        // After the loop, currentPathString may be null at choice points.
        if (this.liveInkStory.currentChoices.length > 0) {
            const choicePath = (this.liveInkStory.currentChoices[0] as any).sourcePath;
            if (choicePath) {
                const parsed = this.pathToNodeId(choicePath);
                if (parsed) this.liveInkCurrentNodeId = parsed;
            }
        } else {
            const finalPath = this.liveInkStory.state.currentPathString;
            if (finalPath) {
                const parsed = this.pathToNodeId(finalPath);
                if (parsed) this.liveInkCurrentNodeId = parsed;
            }
        }

        // Comparer visit counts
        for (const nodePath of this.storyNodePaths) {
            const before = visitCountsBefore.get(nodePath) || 0;
            const after = this.liveInkStory.state.VisitCountAtPathString(nodePath) || 0;
            if (after > before && !seenNodeIds.includes(nodePath)) {
                seenNodeIds.push(nodePath);
            }
        }

        // 1. Fade all existing visited nodes
        for (const [id, opacity] of this.liveInkVisitedNodes) {
            const next = opacity - 0.10;
            if (next <= 0) {
                this.liveInkVisitedNodes.delete(id);
            } else {
                this.liveInkVisitedNodes.set(id, next);
            }
        }

        // 2. Add intermediate nodes to the visited set (resetting opacity)
        for (const id of seenNodeIds) {
            if (id !== this.liveInkCurrentNodeId) {
                this.liveInkVisitedNodes.set(id, 0.75);
            }
        }

        // 3. Handle Current -> Previous transition
        if (this.liveInkCurrentNodeId !== this.liveInkPreviousNodeId) {
            // Previous current node becomes visited at 75%
            if (this.liveInkPreviousNodeId) {
                this.liveInkVisitedNodes.set(this.liveInkPreviousNodeId, 0.75);
            }
            this.liveInkPreviousNodeId = this.liveInkCurrentNodeId;
        }

        // 4. Current node shouldn't appear in the visited set
        if (this.liveInkCurrentNodeId) {
            this.liveInkVisitedNodes.delete(this.liveInkCurrentNodeId);
        }

        // Save state for back navigation (including highlight state)
        const state = this.liveInkStory.state.toJson();
        this.liveInkStateStack.push({
            state,
            turnElement: this.liveInkCurrentTurn,
            currentNodeId: this.liveInkCurrentNodeId,
            previousNodeId: this.liveInkPreviousNodeId,
            visitedNodes: new Map(this.liveInkVisitedNodes),
        });
        this.updateButtons();
        this.updateCurrentNodeHighlight();


        if (this.liveInkStory.currentChoices.length > 0) {
            this.renderChoices();
        } else {
            const endP = document.createElement('p');
            endP.innerHTML = '<em>End of story</em>';
            endP.style.textAlign = 'center';
            endP.style.marginTop = '40px';
            this.liveInkCurrentTurn.appendChild(endP);
            endP.scrollIntoView({ behavior: 'smooth' });
        }
    }

    private renderChoices() {
        if (!this.liveInkStory || !this.liveInkCurrentTurn) return;

        // Clear existing choices in this turn
        this.liveInkCurrentTurn.querySelectorAll('.choice').forEach(c => c.remove());

        this.liveInkStory.currentChoices.forEach((choice: any, index: number) => {
            const p = document.createElement('p');
            p.className = 'choice';
            const a = document.createElement('a');
            a.href = '#';
            a.textContent = choice.text;
            a.onclick = (e) => {
                e.preventDefault();
                if (!this.liveInkStory) return;
                this.liveInkStory.ChooseChoiceIndex(index);
                // Remove choices before continuing
                if (this.liveInkCurrentTurn) {
                    this.liveInkCurrentTurn.querySelectorAll('.choice').forEach(c => c.remove());
                }
                this.continueLiveInk();
            };
            p.appendChild(a);
            this.liveInkCurrentTurn!.appendChild(p);
        });

        // Scroll last choice into view
        const lastChoice = this.liveInkCurrentTurn.querySelector('.choice:last-child');
        if (lastChoice) lastChoice.scrollIntoView({ behavior: 'smooth' });
    }

    private goBack() {
        if (this.liveInkStateStack.length === 0) return;

        const currentStep = this.liveInkStateStack.pop()!;
        if (currentStep.turnElement && currentStep.turnElement.parentNode) {
            currentStep.turnElement.remove();
        }

        if (this.liveInkStateStack.length === 0) {
            // Stack empty — restart
            if (this.currentStoryJson) this.startLiveInk(this.currentStoryJson, this.currentStartNode);
            return;
        }

        const prevState = this.liveInkStateStack[this.liveInkStateStack.length - 1];
        try {
            if (this.liveInkStory) {
                this.liveInkStory.state.LoadJson(prevState.state);
            }
        } catch (e) {
            console.error('Failed to restore state:', e);
        }

        this.liveInkCurrentTurn = prevState.turnElement;

        // Restore highlight state from the stack
        this.liveInkCurrentNodeId = prevState.currentNodeId;
        this.liveInkPreviousNodeId = prevState.previousNodeId;
        this.liveInkVisitedNodes = new Map(prevState.visitedNodes);

        this.renderChoices();
        this.updateButtons();
        this.updateCurrentNodeHighlight();
    }

    private updateButtons() {
        const backBtn = document.getElementById('live-ink-back');
        if (backBtn) {
            if (this.liveInkStateStack.length <= 1) {
                backBtn.classList.add('disabled');
            } else {
                backBtn.classList.remove('disabled');
            }
        }
    }

    private centreOnCurrentNode() {
        if (!this.graphController || !this.liveInkCurrentNodeId) return;
        this.graphController.centreOnNode(this.liveInkCurrentNodeId);
    }

    private updateCurrentNodeHighlight() {
        if (!this.graphController) return;
        this.graphController.highlightCurrentNode(this.liveInkCurrentNodeId, this.liveInkVisitedNodes);
        if (this.liveInkFollowEnabled) this.centreOnCurrentNode();
    }

    // Helper: nodeId to Path
    private nodeIdToPath(nodeId: string, nodeType: 'knot' | 'stitch' | 'root', knotName?: string): string | null {
        if (nodeType === 'root') return null;
        if (nodeType === 'knot') return nodeId;
        const parentKnot = knotName || nodeId.split('.')[0];
        const stitchName = nodeId.includes('.') ? nodeId.split('.').slice(1).join('.') : nodeId;
        return `${parentKnot}.${stitchName}`;
    }

    // Helper: Path to nodeId
    private pathToNodeId(pathStr: string): string | null {
        const parts = pathStr.split('.').filter(p => /^[A-Za-z_]/.test(p) && /^[A-Za-z0-9_]+$/.test(p));
        if (parts.length === 0) return null;
        return parts.join('.');
    }

    private escapeHtml(text: string): string {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}
