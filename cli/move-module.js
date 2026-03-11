const fs = require('fs');
const path = require('path');
const {
  COURSE_DIR,
  prompt,
  getExistingModules,
  pad,
  renameModule,
  createRL,
  printModules,
} = require('./module-utils');

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

  // Build the new order:
  // 1. Remove the source module from the list
  const remaining = modules.filter((m) => m.prefix !== sourcePrefix);
  // 2. Insert it at the target position (0-indexed: targetPosition - 1)
  remaining.splice(targetPosition - 1, 0, sourceModule);

  // 3. Rename all folders sequentially, using a temp name first to avoid collisions
  const tempPrefix = '__move_temp_';
  const renames = [];

  // First pass: rename all to temporary names
  for (let i = 0; i < remaining.length; i++) {
    const mod = remaining[i];
    const tempName = `${tempPrefix}${pad(i + 1)}-${mod.folderName.replace(/^\d+-/, '')}`;
    const oldPath = path.join(COURSE_DIR, mod.folderName);
    const tempPath = path.join(COURSE_DIR, tempName);
    fs.renameSync(oldPath, tempPath);
    remaining[i] = { ...mod, _tempName: tempName };
  }

  // Second pass: rename from temp to final names
  for (let i = 0; i < remaining.length; i++) {
    const mod = remaining[i];
    const newPrefix = i + 1;
    const newFolderName = mod.folderName.replace(/^\d+/, pad(newPrefix));
    const tempPath = path.join(COURSE_DIR, mod._tempName);
    const finalPath = path.join(COURSE_DIR, newFolderName);

    fs.renameSync(tempPath, finalPath);

    // Update _category_.json
    const categoryFile = path.join(finalPath, '_category_.json');
    if (fs.existsSync(categoryFile)) {
      const category = JSON.parse(fs.readFileSync(categoryFile, 'utf8'));
      category.position = newPrefix;
      fs.writeFileSync(categoryFile, JSON.stringify(category, null, 2) + '\n', 'utf8');
    }

    if (newFolderName !== mod.folderName) {
      renames.push({ from: mod.folderName, to: newFolderName });
    }
  }

  // Summary
  if (renames.length > 0) {
    console.log('[move-module] Reordered modules:');
    for (const r of renames) {
      console.log(`  ${r.from} -> ${r.to}`);
    }
  }
}

module.exports = moveModule;
