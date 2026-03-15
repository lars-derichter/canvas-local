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

  let sourceModule;
  while (true) {
    const sourceStr = await prompt(rl, 'Module to move (number)');
    const sourceModule.prefix = parseInt(sourceStr, 10);
    sourceModule = modules.find((m) => m.prefix === sourceModule.prefix);
    if (sourceModule) break;
    console.log(`  No module found with number ${sourceStr}. Please try again.`);
  }

  let targetPosition;
  while (true) {
    const targetStr = await prompt(rl, 'New position');
    targetPosition = parseInt(targetStr, 10);
    if (!isNaN(targetPosition) && targetPosition >= 1 && targetPosition <= modules.length) break;
    console.log(`  Position must be between 1 and ${modules.length}. Please try again.`);
  }
  rl.close();

  if (sourceModule.prefix === targetPosition) {
    console.log('[move-module] Module is already at that position.');
    return;
  }

  // Map modules to the format expected by reorder()
  const entries = modules.map((m) => ({
    prefix: m.prefix,
    name: m.folderName,
    isDirectory: true,
  }));

  const renames = reorder(COURSE_DIR, entries, sourceModule.prefix, targetPosition);

  if (renames.length > 0) {
    console.log('[move-module] Reordered modules:');
    for (const r of renames) {
      console.log(`  ${r.from} -> ${r.to}`);
    }
  }
}

module.exports = moveModule;
