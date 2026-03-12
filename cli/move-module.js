const {
  COURSE_DIR,
  prompt,
  getExistingModules,
  createRL,
  printModules,
} = require('./module-utils');
const { reorder } = require('./renumber');

async function moveModule() {
  const rl = createRL();

  console.log('[move-module] Move a course module to a new position\n');

  const modules = getExistingModules();

  if (modules.length < 2) {
    rl.close();
    console.log('[move-module] Need at least 2 modules to reorder.');
    return;
  }

  printModules(modules);

  const sourceStr = await prompt(rl, 'Module to move (number)');
  const sourcePrefix = parseInt(sourceStr, 10);
  const sourceModule = modules.find((m) => m.prefix === sourcePrefix);

  if (!sourceModule) {
    rl.close();
    console.error(`[move-module] Error: No module found with number ${sourceStr}.`);
    process.exit(1);
  }

  const targetStr = await prompt(rl, 'New position');
  rl.close();

  const targetPosition = parseInt(targetStr, 10);
  if (isNaN(targetPosition) || targetPosition < 1 || targetPosition > modules.length) {
    console.error(`[move-module] Error: Position must be between 1 and ${modules.length}.`);
    process.exit(1);
  }

  if (sourcePrefix === targetPosition) {
    console.log('[move-module] Module is already at that position.');
    return;
  }

  // Map modules to the format expected by reorder()
  const entries = modules.map((m) => ({
    prefix: m.prefix,
    name: m.folderName,
    isDirectory: true,
  }));

  const renames = reorder(COURSE_DIR, entries, sourcePrefix, targetPosition);

  if (renames.length > 0) {
    console.log('[move-module] Reordered modules:');
    for (const r of renames) {
      console.log(`  ${r.from} -> ${r.to}`);
    }
  }
}

module.exports = moveModule;
