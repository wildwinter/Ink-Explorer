// Renderer script - runs in browser context
// Compiles test Ink file and logs results

window.addEventListener('DOMContentLoaded', async () => {
  console.log('Dink Explorer loaded');

  // Path to test Ink file (relative to app root)
  const inkPath = 'tests/dink/main.ink';

  try {
    console.log(`Compiling Ink file: ${inkPath}...`);
    const result = await window.api.compileInk(inkPath);

    if (result.success) {
      console.log('✅ Ink compilation successful!');

      if (result.warnings.length > 0) {
        console.warn('⚠️ Warnings:', result.warnings);
      }

      console.log('Story Info:', {
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
  } catch (error) {
    console.error('❌ Failed to compile Ink:', error);
  }
});
