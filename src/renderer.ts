// Renderer script - displays Ink compilation results

import type { CompilationResult } from './ink/compiler.js';
import { createGraphVisualization } from './graphVisualizer.js';
import type { GraphController } from './graphVisualizer.js';
import { highlightInkSyntax } from './syntaxHighlighter.js';
import { Story } from 'inkjs';

// Extend Window interface for our API
declare global {
  interface Window {
    api: {
      onCompileResult: (callback: (result: CompilationResult) => void) => void;
      onToggleCodePane: (callback: () => void) => void;
      saveFileState: (filePath: string, state: unknown) => void;
      onThemeChanged: (callback: (theme: 'light' | 'dark') => void) => void;
      savePref: (key: string, value: string) => void;
      loadPref: (key: string) => Promise<string | null>;
    };
  }
}

// Module-level state
let currentSourceFiles: Map<string, string> | null = null;
let currentFilePath: string | null = null;
let currentGraphController: GraphController | null = null;
let transformSaveTimeout: ReturnType<typeof setTimeout> | null = null;

// Live Ink state
let currentStoryJson: string | null = null;
let currentStartNode: string | null = null;
let liveInkStory: InstanceType<typeof Story> | null = null;
let liveInkStateStack: Array<{ state: string; turnElement: HTMLElement }> = [];
let liveInkCurrentTurn: HTMLElement | null = null;
let liveInkIsDinkMode = false;
let liveInkFollowEnabled = false;

function applyTheme(theme: 'light' | 'dark'): void {
  document.documentElement.setAttribute('data-theme', theme);
  if (currentGraphController) {
    currentGraphController.updateColors();
  }
}

window.addEventListener('DOMContentLoaded', () => {
  console.log('Dink Explorer loaded - use File > Load Ink... to compile an Ink file');
  showEmptyState();

  // Suppress Electron's native context menu (we use our own on graph nodes)
  document.addEventListener('contextmenu', (e) => e.preventDefault());

  // Set up close button for code pane
  const closeBtn = document.getElementById('code-pane-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', hideCodePane);
  }

  // Set up IPC listener after DOM is ready and API is available
  if (window.api) {
    setupCompileResultListener();
    window.api.onToggleCodePane(toggleCodePane);
    window.api.onThemeChanged(applyTheme);
  } else {
    console.error('API not available - preload script may not have loaded correctly');
  }
});

/**
 * Creates tabs for the right pane
 */
function createTabs(tabs: Array<{ id: string; label: string; content: string; type: 'html' | 'text' }>) {
  const tabButtonsContainer = document.getElementById('tab-buttons');
  const tabsContentContainer = document.getElementById('tabs-content');

  if (!tabButtonsContainer || !tabsContentContainer) {
    console.error('Tab containers not found');
    return;
  }

  // Clear existing tabs
  tabButtonsContainer.innerHTML = '';
  tabsContentContainer.innerHTML = '';

  // Create tab buttons and content
  tabs.forEach((tab, index) => {
    // Create button
    const button = document.createElement('button');
    button.className = `tab-button${index === 0 ? ' active' : ''}`;
    button.textContent = tab.label;
    button.onclick = () => switchTab(tab.id);
    tabButtonsContainer.appendChild(button);

    // Create content
    const content = document.createElement('div');
    content.className = `tab-content${index === 0 ? ' active' : ''}`;
    content.id = `tab-${tab.id}`;

    if (tab.type === 'html') {
      content.innerHTML = tab.content;
    } else {
      const pre = document.createElement('pre');
      pre.textContent = tab.content;
      content.appendChild(pre);
    }

    tabsContentContainer.appendChild(content);
  });
}

/**
 * Switches to a specific tab
 */
function switchTab(tabId: string) {
  // Update button states
  const buttons = document.querySelectorAll('.tab-button');
  buttons.forEach((button, index) => {
    document.getElementById(`tab-${document.querySelectorAll('.tab-content')[index].id.replace('tab-', '')}`);
    if (button.textContent === tabId || document.querySelectorAll('.tab-content')[index].id === `tab-${tabId}`) {
      button.classList.add('active');
      document.querySelectorAll('.tab-content')[index].classList.add('active');
    } else {
      button.classList.remove('active');
      document.querySelectorAll('.tab-content')[index].classList.remove('active');
    }
  });

  // Update content visibility
  const contents = document.querySelectorAll('.tab-content');
  contents.forEach(content => {
    if (content.id === `tab-${tabId}`) {
      content.classList.add('active');
    } else {
      content.classList.remove('active');
    }
  });

}

function showEmptyState(): void {
  const structureOutput = document.getElementById('structure-output');

  if (structureOutput) {
    structureOutput.innerHTML = '<div class="empty-message">Load an Ink file to view its structure</div>';
  }

  // Show empty state in tabs
  createTabs([
    {
      id: 'live-ink',
      label: 'Live Ink',
      content: LIVE_INK_HTML,
      type: 'html'
    }
  ]);
}

/**
 * Extracts the source code for a knot (including all its stitches) from the raw Ink source files.
 */
function extractKnotSource(knotName: string, sourceFiles: Map<string, string>): { source: string; filename: string } | null {
  const knotPattern = new RegExp(`^={2,}\\s*${escapeRegExp(knotName)}\\s*={0,3}\\s*$`, 'm');
  const nextKnotPattern = /^={2,}\s*[a-zA-Z_][a-zA-Z0-9_]*\s*={0,3}\s*$/m;

  for (const [filename, content] of sourceFiles) {
    const match = knotPattern.exec(content);
    if (match) {
      const startIndex = match.index;
      // Find the next knot declaration after this one
      const rest = content.substring(startIndex + match[0].length);
      const nextMatch = nextKnotPattern.exec(rest);
      if (nextMatch) {
        return { source: content.substring(startIndex, startIndex + match[0].length + nextMatch.index).trimEnd(), filename };
      }
      // No next knot — take everything to the end
      return { source: content.substring(startIndex).trimEnd(), filename };
    }
  }
  return null;
}

/**
 * Extracts the source code for a single stitch from the raw Ink source files.
 */
function extractStitchSource(knotName: string, stitchName: string, sourceFiles: Map<string, string>): { source: string; filename: string } | null {
  const knotResult = extractKnotSource(knotName, sourceFiles);
  if (!knotResult) return null;

  const { source: knotSource, filename } = knotResult;
  const stitchPattern = new RegExp(`^=(?!=)\\s*${escapeRegExp(stitchName)}\\s*$`, 'm');
  const match = stitchPattern.exec(knotSource);
  if (!match) return null;

  const startIndex = match.index;
  const rest = knotSource.substring(startIndex + match[0].length);
  // Next stitch or end of knot
  const nextStitchPattern = /^=(?!=)\s*[a-zA-Z_][a-zA-Z0-9_]*\s*$/m;
  const nextMatch = nextStitchPattern.exec(rest);
  if (nextMatch) {
    return { source: knotSource.substring(startIndex, startIndex + match[0].length + nextMatch.index).trimEnd(), filename };
  }
  return { source: knotSource.substring(startIndex).trimEnd(), filename };
}

/**
 * Extracts root content (everything before the first knot or stitch) from each source file.
 */
function extractRootSource(sourceFiles: Map<string, string>): string {
  const firstKnotOrStitch = /^={1,3}\s*[a-zA-Z_][a-zA-Z0-9_]*\s*={0,3}\s*$/m;
  const sections: string[] = [];

  for (const [filename, content] of sourceFiles) {
    const match = firstKnotOrStitch.exec(content);
    const preamble = match ? content.substring(0, match.index).trimEnd() : content.trimEnd();
    if (preamble.length > 0) {
      sections.push(`// --------- ${filename} ---------\n${preamble}\n`);
    }
  }

  return sections.join('\n');
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Saves the current per-file state (code pane, graph transform, selected node).
 */
function saveCurrentFileState(): void {
  if (!currentFilePath || !window.api) return;
  const pane = document.getElementById('code-pane');
  const codePaneOpen = pane ? pane.style.display !== 'none' : true;
  const graphTransform = currentGraphController ? currentGraphController.getTransform() : null;
  const selectedNodeId = currentGraphController ? currentGraphController.getSelectedNodeId() : null;
  window.api.saveFileState(currentFilePath, { codePaneOpen, graphTransform, selectedNodeId });
}

function debouncedSaveTransform(): void {
  if (transformSaveTimeout) clearTimeout(transformSaveTimeout);
  transformSaveTimeout = setTimeout(saveCurrentFileState, 500);
}

/**
 * Shows the code pane with the given title and source code.
 */
function showCodePane(title: string, source: string): void {
  const pane = document.getElementById('code-pane');
  const titleEl = document.getElementById('code-pane-title');
  const sourceEl = document.getElementById('code-pane-source');
  if (!pane || !titleEl || !sourceEl) return;

  titleEl.textContent = title;
  sourceEl.innerHTML = highlightInkSyntax(source);
  pane.style.display = 'flex';
}

function hideCodePane(): void {
  const pane = document.getElementById('code-pane');
  if (pane) pane.style.display = 'none';
  saveCurrentFileState();
}

function showCodePanePrompt(): void {
  const pane = document.getElementById('code-pane');
  const titleEl = document.getElementById('code-pane-title');
  const sourceEl = document.getElementById('code-pane-source');
  if (!pane || !titleEl || !sourceEl) return;

  titleEl.textContent = 'Ink Source';
  sourceEl.innerHTML = '<span class="code-pane-prompt">Click on a node to view the code</span>';
  pane.style.display = 'flex';
}

function toggleCodePane(): void {
  const pane = document.getElementById('code-pane');
  if (!pane) return;
  if (pane.style.display === 'none') {
    pane.style.display = 'flex';
  } else {
    pane.style.display = 'none';
  }
  saveCurrentFileState();
}

/**
 * Handles a node click from the graph visualizer.
 */
function handleNodeClick(nodeId: string, nodeType: 'knot' | 'stitch' | 'root', knotName?: string): void {
  if (!currentSourceFiles) return;

  let result: { source: string; filename: string } | null;
  let label: string;

  if (nodeType === 'root') {
    label = 'Root';
    const rootSource = extractRootSource(currentSourceFiles);
    if (rootSource) {
      showCodePane(label, rootSource);
    } else {
      showCodePane(label, 'No root content found');
    }
    saveCurrentFileState();
    return;
  } else if (nodeType === 'knot') {
    label = `Knot: ${nodeId}`;
    result = extractKnotSource(nodeId, currentSourceFiles);
  } else {
    const parentKnot = knotName || nodeId.split('.')[0];
    const stitchName = nodeId.includes('.') ? nodeId.split('.').slice(1).join('.') : nodeId;
    label = `Stitch: ${parentKnot}.${stitchName}`;
    result = extractStitchSource(parentKnot, stitchName, currentSourceFiles);
  }

  if (result) {
    showCodePane(`${label} [${result.filename}]`, result.source);
  } else {
    showCodePane(label, `Source code not found for ${nodeId}`);
  }
  saveCurrentFileState();
}

// --- Live Ink playback -------------------------------------------------------

const LIVE_INK_HTML = `
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

const dinkyRegex = /^(\s*)([A-Z0-9_]+)(\s*)(\(.*?\)|)(\s*)(:)(\s*)(\(.*?\)|)(\s*)((?:[^/#]|\/(?![/*]))*)/;

/**
 * Computes the Ink path string for a given node.
 */
function nodeIdToPath(nodeId: string, nodeType: 'knot' | 'stitch' | 'root', knotName?: string): string | null {
  if (nodeType === 'root') return null;
  if (nodeType === 'knot') return nodeId;
  const parentKnot = knotName || nodeId.split('.')[0];
  const stitchName = nodeId.includes('.') ? nodeId.split('.').slice(1).join('.') : nodeId;
  return `${parentKnot}.${stitchName}`;
}

/**
 * Parses an inkjs internal path string into a graph node ID.
 * Ink paths look like "KnotName.0.3" or "KnotName.StitchName.0.c-0.4";
 * we keep only valid Ink identifier components (letters/digits/underscores
 * starting with a letter or underscore) and drop numeric indices and
 * internal markers like "c-0", "g-0", "s0", etc.
 */
function pathToNodeId(pathStr: string): string | null {
  const parts = pathStr.split('.').filter(p => /^[A-Za-z_]/.test(p) && /^[A-Za-z0-9_]+$/.test(p));
  if (parts.length === 0) return null;
  return parts.join('.');
}

// Tracks the last known graph-node ID seen during Live Ink execution.
let liveInkCurrentNodeId: string | null = null;

function centreOnCurrentNode(): void {
  if (!currentGraphController || !liveInkCurrentNodeId) return;
  currentGraphController.centreOnNode(liveInkCurrentNodeId);
}

function updateCurrentNodeHighlight(): void {
  if (!currentGraphController) return;
  currentGraphController.highlightCurrentNode(liveInkCurrentNodeId);
  if (liveInkFollowEnabled) centreOnCurrentNode();
}

/**
 * Starts a Live Ink test from the given node, switching to the Live Ink tab.
 */
function startTestFromNode(nodeId: string, nodeType: 'knot' | 'stitch' | 'root', knotName?: string): void {
  if (!currentStoryJson) return;
  currentStartNode = nodeIdToPath(nodeId, nodeType, knotName);
  switchTab('live-ink');
  startLiveInk(currentStoryJson, currentStartNode);
}

function initLiveInk(): void {
  const testBtn = document.getElementById('live-ink-test');
  const restartBtn = document.getElementById('live-ink-restart');
  const backBtn = document.getElementById('live-ink-back');
  if (testBtn) {
    testBtn.onclick = (e) => {
      e.preventDefault();
      if (!currentStoryJson) return;
      // Use the currently selected graph node as the starting point
      const selectedId = currentGraphController?.getSelectedNodeId();
      if (selectedId) {
        // Determine node type from the id
        if (selectedId === '__root__') {
          startTestFromNode(selectedId, 'root');
        } else {
          const isStitch = selectedId.includes('.');
          const nodeType = isStitch ? 'stitch' : 'knot';
          const knotName = isStitch ? selectedId.split('.')[0] : undefined;
          startTestFromNode(selectedId, nodeType, knotName);
        }
      } else {
        // No node selected — start from beginning
        currentStartNode = null;
        startLiveInk(currentStoryJson, null);
      }
    };
  }
  if (restartBtn) {
    restartBtn.onclick = (e) => {
      e.preventDefault();
      if (currentStoryJson) startLiveInk(currentStoryJson, currentStartNode);
    };
  }
  if (backBtn) {
    backBtn.onclick = (e) => {
      e.preventDefault();
      liveInkGoBack();
    };
  }

  const centreBtn = document.getElementById('live-ink-centre');
  if (centreBtn) {
    centreBtn.onclick = (e) => {
      e.preventDefault();
      centreOnCurrentNode();
    };
  }

  const followCheckbox = document.getElementById('live-ink-follow') as HTMLInputElement | null;
  if (followCheckbox) {
    // Load saved preference
    window.api.loadPref('liveInkFollow').then(val => {
      liveInkFollowEnabled = val === 'true';
      followCheckbox.checked = liveInkFollowEnabled;
    });
    followCheckbox.onchange = () => {
      liveInkFollowEnabled = followCheckbox.checked;
      window.api.savePref('liveInkFollow', String(liveInkFollowEnabled));
      if (liveInkFollowEnabled) centreOnCurrentNode();
    };
  }
}

function updateLiveInkButtons(): void {
  const backBtn = document.getElementById('live-ink-back');
  if (backBtn) {
    if (liveInkStateStack.length <= 1) {
      backBtn.classList.add('disabled');
    } else {
      backBtn.classList.remove('disabled');
    }
  }
}

function startLiveInk(storyJson: string, startPath?: string | null): void {
  const output = document.getElementById('live-ink-output');
  const status = document.getElementById('live-ink-status');
  if (!output) return;

  output.innerHTML = '';
  liveInkStateStack = [];
  liveInkCurrentTurn = null;
  liveInkIsDinkMode = false;
  liveInkCurrentNodeId = null;

  updateLiveInkButtons();
  if (currentGraphController) currentGraphController.highlightCurrentNode(null);

  if (status) {
    status.textContent = startPath ? `Testing: ${startPath}` : 'Testing from start';
  }

  try {
    const json = typeof storyJson === 'string' ? JSON.parse(storyJson) : storyJson;
    liveInkStory = new Story(json);

    // Detect Dink mode via global tags
    if (liveInkStory.globalTags && liveInkStory.globalTags.some((tag: string) => tag.trim() === 'dink')) {
      liveInkIsDinkMode = true;
    }

    if (startPath) {
      try {
        // Check knot tags for dink mode
        if (!liveInkIsDinkMode) {
          const tags = liveInkStory.TagsForContentAtPath(startPath);
          if (tags && tags.some((tag: string) => tag.trim() === 'dink')) {
            liveInkIsDinkMode = true;
          }
        }
        liveInkStory.ChoosePathString(startPath);
      } catch (e) {
        const p = document.createElement('p');
        p.style.color = 'orange';
        p.textContent = `Warning: Could not find "${startPath}". Starting from beginning.`;
        output.appendChild(p);
      }
    }

    continueLiveInk();
  } catch (e) {
    const p = document.createElement('p');
    p.style.color = 'red';
    p.textContent = 'Runtime Error: ' + (e instanceof Error ? e.message : String(e));
    output.appendChild(p);

  }
}

function continueLiveInk(): void {
  if (!liveInkStory) return;
  const output = document.getElementById('live-ink-output');
  if (!output) return;

  liveInkCurrentTurn = document.createElement('div');
  liveInkCurrentTurn.className = 'turn';
  output.appendChild(liveInkCurrentTurn);

  // Capture current position before the loop — handles knots that start
  // directly with choices (no text content), where canContinue is already false.
  const initialPath = liveInkStory.state.currentPathString;
  if (initialPath) {
    const parsed = pathToNodeId(initialPath);
    if (parsed) liveInkCurrentNodeId = parsed;
  }

  while (liveInkStory.canContinue) {
    const text = liveInkStory.Continue();

    // Track current knot/stitch for graph highlight
    const pathStr = liveInkStory.state.currentPathString;
    if (pathStr) {
      const parsed = pathToNodeId(pathStr);
      if (parsed) liveInkCurrentNodeId = parsed;
    }

    if (!text) continue;

    // Detect dink mode dynamically from knot/line tags
    if (!liveInkIsDinkMode && liveInkStory.currentTags) {
      if (liveInkStory.currentTags.some((tag: string) => tag.trim() === 'dink')) {
        liveInkIsDinkMode = true;
      }
    }

    const p = document.createElement('p');

    if (liveInkIsDinkMode) {
      const match = text.match(dinkyRegex);
      if (match) {
        let html = '';
        html += escapeHtml(match[1]);
        html += `<span class="dinky-name">${escapeHtml(match[2])}</span>`;
        html += escapeHtml(match[3]);
        if (match[4]) html += `<span class="dinky-qualifier">${escapeHtml(match[4])}</span>`;
        html += escapeHtml(match[5]);
        html += escapeHtml(match[6]);
        html += escapeHtml(match[7]);
        if (match[8]) html += `<span class="dinky-direction">${escapeHtml(match[8])}</span>`;
        html += escapeHtml(match[9]);
        html += `<span class="dinky-text">${escapeHtml(match[10])}</span>`;
        p.innerHTML = html;
      } else {
        p.textContent = text;
      }
    } else {
      p.textContent = text;
    }

    liveInkCurrentTurn.appendChild(p);
  }

  // After the loop, currentPathString may be null at choice points. Use the
  // first choice's sourcePath as a reliable indicator of the current location.
  if (liveInkStory.currentChoices.length > 0) {
    const choicePath = (liveInkStory.currentChoices[0] as any).sourcePath;
    if (choicePath) {
      const parsed = pathToNodeId(choicePath);
      if (parsed) liveInkCurrentNodeId = parsed;
    }
  } else {
    const finalPath = liveInkStory.state.currentPathString;
    if (finalPath) {
      const parsed = pathToNodeId(finalPath);
      if (parsed) liveInkCurrentNodeId = parsed;
    }
  }

  // Save state for back navigation
  const state = liveInkStory.state.toJson();
  liveInkStateStack.push({ state, turnElement: liveInkCurrentTurn });
  updateLiveInkButtons();
  updateCurrentNodeHighlight();

  if (liveInkStory.currentChoices.length > 0) {
    renderLiveInkChoices();
  } else {
    const endP = document.createElement('p');
    endP.innerHTML = '<em>End of story</em>';
    endP.style.textAlign = 'center';
    endP.style.marginTop = '40px';
    liveInkCurrentTurn.appendChild(endP);
    endP.scrollIntoView({ behavior: 'smooth' });
  }
}

function renderLiveInkChoices(): void {
  if (!liveInkStory || !liveInkCurrentTurn) return;

  // Clear existing choices in this turn
  liveInkCurrentTurn.querySelectorAll('.choice').forEach(c => c.remove());

  liveInkStory.currentChoices.forEach((choice: any, index: number) => {
    const p = document.createElement('p');
    p.className = 'choice';
    const a = document.createElement('a');
    a.href = '#';
    a.textContent = choice.text;
    a.onclick = (e) => {
      e.preventDefault();
      if (!liveInkStory) return;
      liveInkStory.ChooseChoiceIndex(index);
      // Remove choices before continuing
      if (liveInkCurrentTurn) {
        liveInkCurrentTurn.querySelectorAll('.choice').forEach(c => c.remove());
      }
      continueLiveInk();
    };
    p.appendChild(a);
    liveInkCurrentTurn!.appendChild(p);
  });

  // Scroll last choice into view
  const lastChoice = liveInkCurrentTurn.querySelector('.choice:last-child');
  if (lastChoice) lastChoice.scrollIntoView({ behavior: 'smooth' });
}

function liveInkGoBack(): void {
  if (liveInkStateStack.length === 0) return;

  const currentStep = liveInkStateStack.pop()!;
  if (currentStep.turnElement && currentStep.turnElement.parentNode) {
    currentStep.turnElement.remove();
  }

  if (liveInkStateStack.length === 0) {
    // Stack empty — restart
    if (currentStoryJson) startLiveInk(currentStoryJson, currentStartNode);
    return;
  }

  const prevState = liveInkStateStack[liveInkStateStack.length - 1];
  try {
    if (liveInkStory) {
      liveInkStory.state.LoadJson(prevState.state);
    }
  } catch (e) {
    console.error('Failed to restore state:', e);
  }

  liveInkCurrentTurn = prevState.turnElement;
  renderLiveInkChoices();
  updateLiveInkButtons();
  updateCurrentNodeHighlight();
}

// Set up listener for Ink compilation results from main process
function setupCompileResultListener(): void {
  window.api.onCompileResult((result) => {
    console.log('\n=== Ink Compilation Result ===\n');

    const structureOutput = document.getElementById('structure-output');

    if (!structureOutput) {
      console.error('Output elements not found');
      return;
    }

    if (result.success && result.storyInfo && result.structure) {
      console.log('✅ Ink compilation successful!');

      if (result.warnings.length > 0) {
        console.warn('⚠️ Warnings:', result.warnings);
      }

      console.log('\nStory Info:', result.storyInfo);
      console.log('\nStructure:', result.structure);

      // Store source files for code pane extraction
      // sourceFiles arrives as a plain object from IPC serialization, convert to Map
      if (result.sourceFiles) {
        const files = result.sourceFiles as unknown as Record<string, string>;
        currentSourceFiles = files instanceof Map ? files : new Map(Object.entries(files));
      } else {
        currentSourceFiles = null;
      }

      // Extract per-file state sent from main process
      const ipcResult = result as any;
      currentFilePath = ipcResult.filePath || null;
      const savedState = ipcResult.savedFileState as { codePaneOpen: boolean; graphTransform: { x: number; y: number; k: number } | null; selectedNodeId: string | null } | null;

      // Restore code pane visibility
      if (savedState) {
        if (savedState.codePaneOpen) {
          if (savedState.selectedNodeId) {
            // Will be populated when selectNode triggers handleNodeClick
            showCodePanePrompt();
          } else {
            showCodePanePrompt();
          }
        } else {
          hideCodePane();
        }
      } else {
        showCodePanePrompt();
      }

      // Display interactive graph in left pane
      structureOutput.innerHTML = ''; // Clear previous content
      currentGraphController = createGraphVisualization('structure-output', result.structure, {
        onNodeClick: handleNodeClick,
        onNodeTest: startTestFromNode,
        onTransformChange: debouncedSaveTransform,
        initialTransform: savedState?.graphTransform || undefined,
        initialSelectedNodeId: savedState?.selectedNodeId
      });

      // Store story JSON for Live Ink
      const ipcAny = result as any;
      currentStoryJson = ipcAny.storyJson || null;
      currentStartNode = null;
  

      // Create tabs
      createTabs([
        {
          id: 'live-ink',
          label: 'Live Ink',
          content: LIVE_INK_HTML,
          type: 'html'
        }
      ]);

      // Wire up Live Ink buttons after DOM insertion
      initLiveInk();

    } else {
      console.error('❌ Ink compilation failed!');
      console.error('Errors:', result.errors);

      if (result.warnings.length > 0) {
        console.warn('Warnings:', result.warnings);
      }

      // Clear state on failure
      currentSourceFiles = null;
      currentFilePath = null;
      currentGraphController = null;
      currentStoryJson = null;
      currentStartNode = null;
  
      liveInkStory = null;
      hideCodePane();

      // Show error state
      structureOutput.innerHTML = '<div class="empty-message">Compilation failed</div>';

      createTabs([
        {
          id: 'live-ink',
          label: 'Live Ink',
          content: LIVE_INK_HTML,
          type: 'html'
        }
      ]);
    }

    console.log('\n===============================\n');
  });
}

// Helper function to escape HTML
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
