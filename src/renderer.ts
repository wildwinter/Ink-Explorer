// Renderer script - displays Ink compilation results

import type { CompilationResult } from './ink/compiler.js';
import type { StitchInfo } from './ink/analyzer.js';
import { createGraphVisualization } from './graphVisualizer.js';

// Extend Window interface for our API
declare global {
  interface Window {
    api: {
      onCompileResult: (callback: (result: CompilationResult) => void) => void;
      onToggleCodePane: (callback: () => void) => void;
    };
  }
}

// Module-level state for source extraction
let currentSourceFiles: Map<string, string> | null = null;

window.addEventListener('DOMContentLoaded', () => {
  console.log('Dink Explorer loaded - use File > Load Ink... to compile an Ink file');
  showEmptyState();

  // Set up close button for code pane
  const closeBtn = document.getElementById('code-pane-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', hideCodePane);
  }

  // Set up IPC listener after DOM is ready and API is available
  if (window.api) {
    setupCompileResultListener();
    window.api.onToggleCodePane(toggleCodePane);
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
      id: 'structure',
      label: 'Structure',
      content: '<div class="empty-message">No Ink file loaded</div>',
      type: 'html'
    }
  ]);
}

/**
 * Extracts the source code for a knot (including all its stitches) from the raw Ink source files.
 */
function extractKnotSource(knotName: string, sourceFiles: Map<string, string>): { source: string; filename: string } | null {
  const knotPattern = new RegExp(`^===\\s+${escapeRegExp(knotName)}\\s*={0,3}\\s*$`, 'm');
  const nextKnotPattern = /^===\s+[a-zA-Z_][a-zA-Z0-9_]*\s*={0,3}\s*$/m;

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
  const stitchPattern = new RegExp(`^=\\s+${escapeRegExp(stitchName)}\\s*$`, 'm');
  const match = stitchPattern.exec(knotSource);
  if (!match) return null;

  const startIndex = match.index;
  const rest = knotSource.substring(startIndex + match[0].length);
  // Next stitch or end of knot
  const nextStitchPattern = /^=\s+[a-zA-Z_][a-zA-Z0-9_]*\s*$/m;
  const nextMatch = nextStitchPattern.exec(rest);
  if (nextMatch) {
    return { source: knotSource.substring(startIndex, startIndex + match[0].length + nextMatch.index).trimEnd(), filename };
  }
  return { source: knotSource.substring(startIndex).trimEnd(), filename };
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
  sourceEl.textContent = source;
  pane.style.display = 'flex';
}

function hideCodePane(): void {
  const pane = document.getElementById('code-pane');
  if (pane) pane.style.display = 'none';
}

function toggleCodePane(): void {
  const pane = document.getElementById('code-pane');
  if (!pane) return;
  if (pane.style.display === 'none') {
    // Show with a default message if no node selected yet
    const sourceEl = document.getElementById('code-pane-source');
    if (sourceEl && !sourceEl.textContent) {
      const titleEl = document.getElementById('code-pane-title');
      if (titleEl) titleEl.textContent = 'Ink Source';
      sourceEl.textContent = 'Click a knot or stitch in the graph to view its source code.';
    }
    pane.style.display = 'flex';
  } else {
    pane.style.display = 'none';
  }
}

/**
 * Handles a node click from the graph visualizer.
 */
function handleNodeClick(nodeId: string, nodeType: 'knot' | 'stitch', knotName?: string): void {
  if (!currentSourceFiles) return;

  let result: { source: string; filename: string } | null;
  let label: string;

  if (nodeType === 'knot') {
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
      currentSourceFiles = result.sourceFiles || null;
      hideCodePane();

      // Display interactive graph in left pane
      structureOutput.innerHTML = ''; // Clear previous content
      createGraphVisualization('structure-output', result.structure, handleNodeClick);

      // Build structure tab content
      let structureHTML = '';
      if (result.structure.knots.length === 0) {
        structureHTML = '<div class="empty-message">No knots found</div>';
      } else {
        structureHTML = '<div class="structure-explorer">';

        result.structure.knots.forEach(knot => {
          structureHTML += `<div class="knot-container">`;
          structureHTML += `<div class="knot-header">📦 ${escapeHtml(knot.name)}</div>`;

          // Show knot exits if any
          if (knot.exits && knot.exits.length > 0) {
            structureHTML += `<div class="exits-container">`;
            structureHTML += `<div class="exits-label">Exits:</div>`;
            knot.exits.forEach(exit => {
              structureHTML += `<div class="exit-item">→ ${escapeHtml(exit)}</div>`;
            });
            structureHTML += `</div>`;
          }

          // Show stitches with their exits
          if (knot.stitches && knot.stitches.length > 0) {
            structureHTML += `<div class="stitches-container">`;
            knot.stitches.forEach((stitch: StitchInfo) => {
              structureHTML += `<div class="stitch-container">`;
              structureHTML += `<div class="stitch-header">📎 ${escapeHtml(stitch.name)}</div>`;

              if (stitch.exits && stitch.exits.length > 0) {
                structureHTML += `<div class="exits-container">`;
                structureHTML += `<div class="exits-label">Exits:</div>`;
                stitch.exits.forEach(exit => {
                  structureHTML += `<div class="exit-item">→ ${escapeHtml(exit)}</div>`;
                });
                structureHTML += `</div>`;
              }

              structureHTML += `</div>`;
            });
            structureHTML += `</div>`;
          }

          structureHTML += `</div>`;
        });

        structureHTML += '</div>';
      }

      // Create tabs array
      const tabs: Array<{ id: string; label: string; content: string; type: 'html' | 'text' }> = [
        {
          id: 'structure',
          label: 'Structure',
          content: structureHTML,
          type: 'html'
        }
      ];

      // Add source file tabs
      if (result.sourceFiles) {
        // Convert Map to array and sort by filename
        const sourceFilesArray = Array.from(result.sourceFiles.entries()).sort((a, b) => a[0].localeCompare(b[0]));

        sourceFilesArray.forEach(([filename, content]) => {
          tabs.push({
            id: `source-${filename}`,
            label: filename,
            content: content,
            type: 'text' as const
          });
        });
      }

      // Create tabs
      createTabs(tabs);

    } else {
      console.error('❌ Ink compilation failed!');
      console.error('Errors:', result.errors);

      if (result.warnings.length > 0) {
        console.warn('Warnings:', result.warnings);
      }

      // Clear code pane state on failure
      currentSourceFiles = null;
      hideCodePane();

      // Show error state
      structureOutput.innerHTML = '<div class="empty-message">Compilation failed</div>';

      createTabs([
        {
          id: 'structure',
          label: 'Structure',
          content: '<div class="empty-message">Fix compilation errors to view structure</div>',
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
