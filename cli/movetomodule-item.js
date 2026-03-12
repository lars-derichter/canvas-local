const fs = require('fs');
const path = require('path');
const { prompt, pad, createRL, getExistingModules, printModules, COURSE_DIR } = require('./module-utils');
const { getItems, printItems, selectModule, selectTargetDir } = require('./item-utils');
const { renumberSequential, renumberUp } = require('./renumber');

async function moveToModule() {
  const rl = createRL();

  console.log('[movetomodule] Move an item to a different module\n');

  // Source selection
  console.log('--- Source ---');
  const source = await selectModule(rl);
  const sourceDir = await selectTargetDir(rl, source.modulePath);
  const sourceItems = getItems(sourceDir);

  if (sourceItems.length === 0) {
    rl.close();
    console.log('[movetomodule] No items to move.');
    return;
  }

  printItems(sourceItems);

  const itemStr = await prompt(rl, 'Item to move (number)');
  const itemPrefix = parseInt(itemStr, 10);
  const item = sourceItems.find((i) => i.prefix === itemPrefix);

  if (!item) {
    rl.close();
    console.error(`[movetomodule] Error: No item found with number ${itemStr}.`);
    process.exit(1);
  }

  // Destination selection
  console.log('\n--- Destination ---');
  const modules = getExistingModules();
  printModules(modules);

  const destModuleStr = await prompt(rl, 'Destination module (number)');
  const destModulePrefix = parseInt(destModuleStr, 10);
  const destMod = modules.find((m) => m.prefix === destModulePrefix);

  if (!destMod) {
    rl.close();
    console.error(`[movetomodule] Error: No module found with number ${destModuleStr}.`);
    process.exit(1);
  }

  const destModulePath = path.join(COURSE_DIR, destMod.folderName);
  const destDir = await selectTargetDir(rl, destModulePath);
  const destItems = getItems(destDir);

  const defaultPos = destItems.length > 0 ? destItems[destItems.length - 1].prefix + 1 : 1;
  const posStr = await prompt(rl, 'Position in destination', pad(defaultPos));
  rl.close();

  const position = parseInt(posStr, 10);

  // Make room at destination
  if (destItems.some((i) => i.prefix >= position)) {
    renumberUp(destDir, destItems, position);
  }

  // Move the item
  const newName = item.name.replace(/^\d+/, pad(position));
  const sourcePath = path.join(sourceDir, item.name);
  const destPath = path.join(destDir, newName);

  fs.renameSync(sourcePath, destPath);

  // Renumber source to close gap
  const sourceRenames = renumberSequential(sourceDir, getItems);

  console.log(`[movetomodule] Moved ${item.name} -> ${path.relative(process.cwd(), destPath)}`);
  if (sourceRenames.length > 0) {
    console.log('[movetomodule] Renumbered source:');
    for (const r of sourceRenames) {
      console.log(`  ${r.from} -> ${r.to}`);
    }
  }
}

module.exports = moveToModule;
