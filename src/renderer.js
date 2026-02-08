// Renderer script - logs Ink compilation results

window.addEventListener('DOMContentLoaded', () => {
  console.log('Dink Explorer loaded - use File > Load Ink... to compile an Ink file');
});

// Listen for Ink compilation results from main process
window.api.onCompileResult((result) => {
  console.log('\n=== Ink Compilation Result ===\n');

  if (result.success) {
    console.log('✅ Ink compilation successful!');

    if (result.warnings.length > 0) {
      console.warn('⚠️ Warnings:', result.warnings);
    }

    console.log('\nStory Info:', {
      canContinue: result.storyInfo.canContinue,
      choiceCount: result.storyInfo.choiceCount,
      currentTags: result.storyInfo.currentTags,
      globalTags: result.storyInfo.globalTags
    });
  } else {
    console.error('❌ Ink compilation failed!');
    console.error('Errors:', result.errors);

    if (result.warnings.length > 0) {
      console.warn('Warnings:', result.warnings);
    }
  }

  console.log('\n===============================\n');
});
