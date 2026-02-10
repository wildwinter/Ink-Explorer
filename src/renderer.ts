// Renderer script - displays Ink compilation results

import type { CompilationResult } from './ink/compiler.js';
import { createGraphVisualization } from './graphVisualizer.js';
import type { GraphController, NodeType } from './graphVisualizer.js';
import { UIManager } from './uiManager.js';
import { LiveInkController, LIVE_INK_HTML } from './liveInk.js';
import { extractKnotSource, extractStitchSource, extractRootSource } from './ink/sourceManager.js';

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

// Controllers
const uiManager = new UIManager();
const liveInkController = new LiveInkController();

window.addEventListener('DOMContentLoaded', () => {
  console.log('Ink Explorer loaded - use File > Load Ink... to examine an Ink file');
  showEmptyState();

  // Suppress Electron's native context menu (we use our own on graph nodes)
  document.addEventListener('contextmenu', (e) => e.preventDefault());

  // Set up IPC listener after DOM is ready and API is available
  if (window.api) {
    setupCompileResultListener();
    window.api.onToggleCodePane(() => uiManager.toggleCodePane());
    window.api.onThemeChanged((theme) => {
      uiManager.applyTheme(theme);
      // Force graph to re-read CSS variables
      if (currentGraphController) {
        // slight delay to ensure style recalc? usually not needed but safe
        requestAnimationFrame(() => currentGraphController?.updateColors());
      }
    });

    // Initialize Live Ink with API access
    liveInkController.init();
  } else {
    console.error('API not available - preload script may not have loaded correctly');
  }
});

function showEmptyState(): void {
  const structureOutput = document.getElementById('structure-output');

  if (structureOutput) {
    structureOutput.innerHTML = '<div class="empty-message">Load an Ink file to view its structure</div>';
  }

  // Show empty state in tabs
  uiManager.createTabs([
    {
      id: 'live-ink',
      label: 'Live Ink',
      content: LIVE_INK_HTML,
      type: 'html'
    }
  ]);

  // Connect Live Ink controller to the output container directly after creation
  const output = document.getElementById('live-ink-output');
  if (output) {
    liveInkController.setOutputContainer(output);
  }
}

/**
 * Saves the current per-file state (code pane, graph transform, selected node).
 */
function saveCurrentFileState(): void {
  if (!currentFilePath || !window.api) return;

  const codePaneOpen = uiManager.isCodePaneOpen();
  const graphTransform = currentGraphController ? currentGraphController.getTransform() : null;
  const selectedNodeId = currentGraphController ? currentGraphController.getSelectedNodeId() : null;

  window.api.saveFileState(currentFilePath, { codePaneOpen, graphTransform, selectedNodeId });
}

function debouncedSaveTransform(): void {
  if (transformSaveTimeout) clearTimeout(transformSaveTimeout);
  transformSaveTimeout = setTimeout(saveCurrentFileState, 500);
}

/**
 * Handles a node click from the graph visualizer.
 */
function handleNodeClick(nodeId: string, nodeType: NodeType, knotName?: string): void {
  if (!currentSourceFiles) return;

  let result: { source: string; filename: string } | null = null;
  let label: string;

  if (nodeType === 'root') {
    label = 'Root';
    const rootSource = extractRootSource(currentSourceFiles);
    if (rootSource) {
      uiManager.showCodePane(label, rootSource);
    } else {
      uiManager.showCodePane(label, 'No root content found');
    }
    saveCurrentFileState();
    return;
  } else if (nodeType === 'knot') {
    label = `Knot: ${nodeId}`;
    result = extractKnotSource(nodeId, currentSourceFiles);
  } else {
    // Stitch
    const parentKnot = knotName || nodeId.split('.')[0];
    const stitchName = nodeId.includes('.') ? nodeId.split('.').slice(1).join('.') : nodeId;
    label = `Stitch: ${parentKnot}.${stitchName}`;
    result = extractStitchSource(parentKnot, stitchName, currentSourceFiles);
  }

  if (result) {
    uiManager.showCodePane(`${label} [${result.filename}]`, result.source);
  } else {
    uiManager.showCodePane(label, `Source code not found for ${nodeId}`);
  }
  saveCurrentFileState();
}

/**
 * Starts a test from a specific node
 */
function startTestFromNode(nodeId: string, nodeType: NodeType, knotName?: string): void {
  if (uiManager) uiManager.switchTab('live-ink');
  liveInkController.startTestFromNode(nodeId, nodeType as any, knotName); // NodeType matches string union
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
            uiManager.showCodePanePrompt();
          } else {
            uiManager.showCodePanePrompt();
          }
        } else {
          uiManager.hideCodePane();
        }
      } else {
        uiManager.showCodePanePrompt();
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

      // Update Live Ink Controller with new data
      const ipcAny = result as any;
      liveInkController.setStoryJson(ipcAny.storyJson || null);
      liveInkController.setGraphController(currentGraphController);

      // Build list of knot/stitch path strings for visit-count tracking
      const struct = result.structure as any;
      const storyNodePaths: string[] = [];
      if (struct && struct.knots) {
        for (const knot of struct.knots) {
          storyNodePaths.push(knot.name);
          if (knot.stitches) {
            for (const stitch of knot.stitches) {
              storyNodePaths.push(`${knot.name}.${stitch.name}`);
            }
          }
        }
      }
      liveInkController.setStoryNodePaths(storyNodePaths);


      // Create tabs
      uiManager.createTabs([
        {
          id: 'live-ink',
          label: 'Live Ink',
          content: LIVE_INK_HTML,
          type: 'html'
        }
      ]);

      // Re-connect output container as tabs were recreated
      const output = document.getElementById('live-ink-output');
      if (output) {
        liveInkController.setOutputContainer(output);
      }
      liveInkController.init();

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

      liveInkController.setStoryJson(null);
      liveInkController.setGraphController(null);

      uiManager.hideCodePane();

      // Show error state
      structureOutput.innerHTML = '<div class="empty-message">Compilation failed</div>';

      uiManager.createTabs([
        {
          id: 'live-ink',
          label: 'Live Ink',
          content: LIVE_INK_HTML,
          type: 'html'
        }
      ]);

      const output = document.getElementById('live-ink-output');
      if (output) {
        liveInkController.setOutputContainer(output);
      }
      liveInkController.init();
    }

    console.log('\n===============================\n');
  });
}
