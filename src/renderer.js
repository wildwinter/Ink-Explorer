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

    // Display knots and stitches with their exits in right pane
    if (result.structure.knots.length === 0) {
      knotsOutput.innerHTML = '<div class="empty-message">No knots found</div>';
    } else {
      let knotsHTML = '<div class="structure-explorer">';

      result.structure.knots.forEach(knot => {
        knotsHTML += `<div class="knot-container">`;
        knotsHTML += `<div class="knot-header">📦 ${knot.name}</div>`;

        // Show knot exits if any
        if (knot.exits && knot.exits.length > 0) {
          knotsHTML += `<div class="exits-container">`;
          knotsHTML += `<div class="exits-label">Exits:</div>`;
          knot.exits.forEach(exit => {
            knotsHTML += `<div class="exit-item">→ ${exit}</div>`;
          });
          knotsHTML += `</div>`;
        }

        // Show stitches with their exits
        if (knot.stitches && knot.stitches.length > 0) {
          knotsHTML += `<div class="stitches-container">`;
          knot.stitches.forEach(stitch => {
            knotsHTML += `<div class="stitch-container">`;
            knotsHTML += `<div class="stitch-header">📎 ${stitch.name}</div>`;

            if (stitch.exits && stitch.exits.length > 0) {
              knotsHTML += `<div class="exits-container">`;
              knotsHTML += `<div class="exits-label">Exits:</div>`;
              stitch.exits.forEach(exit => {
                knotsHTML += `<div class="exit-item">→ ${exit}</div>`;
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
