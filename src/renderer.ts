// Renderer script - displays Ink compilation results

import type { CompilationResult } from './ink/compiler.js';
import type { StitchInfo } from './ink/analyzer.js';

// Extend Window interface for our API
declare global {
  interface Window {
    api: {
      onCompileResult: (callback: (result: CompilationResult) => void) => void;
    };
  }
}

window.addEventListener('DOMContentLoaded', () => {
  console.log('Dink Explorer loaded - use File > Load Ink... to compile an Ink file');
  showEmptyState();

  // Set up IPC listener after DOM is ready and API is available
  if (window.api) {
    setupCompileResultListener();
  } else {
    console.error('API not available - preload script may not have loaded correctly');
  }
});

function showEmptyState(): void {
  const structureOutput = document.getElementById('structure-output');
  const knotsOutput = document.getElementById('knots-output');

  if (structureOutput) {
    structureOutput.innerHTML = '<div class="empty-message">Load an Ink file to view its structure</div>';
  }
  if (knotsOutput) {
    knotsOutput.innerHTML = '<div class="empty-message">No Ink file loaded</div>';
  }
}

// Set up listener for Ink compilation results from main process
function setupCompileResultListener(): void {
  window.api.onCompileResult((result) => {
    console.log('\n=== Ink Compilation Result ===\n');

    const structureOutput = document.getElementById('structure-output');
    const knotsOutput = document.getElementById('knots-output');

    if (!structureOutput || !knotsOutput) {
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

      // Display story info in left pane
      const storyInfoHTML = `
        <pre>${JSON.stringify({
          canContinue: result.storyInfo.canContinue,
          choiceCount: result.storyInfo.choiceCount,
          currentTags: result.storyInfo.currentTags,
          globalTags: result.storyInfo.globalTags,
          knotCount: result.structure.knots.length,
          stitchCount: result.structure.knots.reduce((sum, k) => sum + k.stitches.length, 0)
        }, null, 2)}</pre>
      `;
      structureOutput.innerHTML = storyInfoHTML;

      // Display knots and stitches with their exits in right pane
      if (result.structure.knots.length === 0) {
        knotsOutput.innerHTML = '<div class="empty-message">No knots found</div>';
      } else {
        let knotsHTML = '<div class="structure-explorer">';

        result.structure.knots.forEach(knot => {
          knotsHTML += `<div class="knot-container">`;
          knotsHTML += `<div class="knot-header">📦 ${escapeHtml(knot.name)}</div>`;

          // Show knot exits if any
          if (knot.exits && knot.exits.length > 0) {
            knotsHTML += `<div class="exits-container">`;
            knotsHTML += `<div class="exits-label">Exits:</div>`;
            knot.exits.forEach(exit => {
              knotsHTML += `<div class="exit-item">→ ${escapeHtml(exit)}</div>`;
            });
            knotsHTML += `</div>`;
          }

          // Show stitches with their exits
          if (knot.stitches && knot.stitches.length > 0) {
            knotsHTML += `<div class="stitches-container">`;
            knot.stitches.forEach((stitch: StitchInfo) => {
              knotsHTML += `<div class="stitch-container">`;
              knotsHTML += `<div class="stitch-header">📎 ${escapeHtml(stitch.name)}</div>`;

              if (stitch.exits && stitch.exits.length > 0) {
                knotsHTML += `<div class="exits-container">`;
                knotsHTML += `<div class="exits-label">Exits:</div>`;
                stitch.exits.forEach(exit => {
                  knotsHTML += `<div class="exit-item">→ ${escapeHtml(exit)}</div>`;
                });
                knotsHTML += `</div>`;
              }

              knotsHTML += `</div>`;
            });
            knotsHTML += `</div>`;
          }

          knotsHTML += `</div>`;
        });

        knotsHTML += '</div>';
        knotsOutput.innerHTML = knotsHTML;
      }

    } else {
      console.error('❌ Ink compilation failed!');
      console.error('Errors:', result.errors);

      if (result.warnings.length > 0) {
        console.warn('Warnings:', result.warnings);
      }

      // Show error state
      structureOutput.innerHTML = '<div class="empty-message">Compilation failed</div>';
      knotsOutput.innerHTML = '<div class="empty-message">Fix compilation errors to view structure</div>';
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
