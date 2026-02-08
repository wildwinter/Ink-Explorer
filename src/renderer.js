// Renderer script - displays Ink compilation results

window.addEventListener('DOMContentLoaded', () => {
  console.log('Dink Explorer loaded - use File > Load Ink... to compile an Ink file');
  showEmptyState();
});

function showEmptyState() {
  const structureOutput = document.getElementById('structure-output');
  const knotsOutput = document.getElementById('knots-output');

  structureOutput.innerHTML = '<div class="empty-message">Load an Ink file to view its structure</div>';
  knotsOutput.innerHTML = '<div class="empty-message">No Ink file loaded</div>';
}

// Listen for Ink compilation results from main process
window.api.onCompileResult((result) => {
  console.log('\n=== Ink Compilation Result ===\n');

  const structureOutput = document.getElementById('structure-output');
  const knotsOutput = document.getElementById('knots-output');

  if (result.success) {
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

    // Display knots and stitches in right pane
    if (result.structure.knots.length === 0) {
      knotsOutput.innerHTML = '<div class="empty-message">No knots found</div>';
    } else {
      let knotsHTML = '';
      result.structure.knots.forEach(knot => {
        knotsHTML += `<div class="knot-item">📦 ${knot.name}</div>`;
        knot.stitches.forEach(stitch => {
          knotsHTML += `<div class="stitch-item">📎 ${stitch}</div>`;
        });
      });
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
