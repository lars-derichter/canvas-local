const fs = require('fs');
const path = require('path');
const {
  prompt,
  pad,
  createRL,
  getExistingModules,
  printModules,
  COURSE_DIR,
} = require('./module-utils');
const {
  getItems,
  printItems,
  selectModule,
  selectTargetDir,
} = require('./item-utils');
const {
  renumberSequential,
  renumberUp,
  updateCategoryPosition,
} = require('./renumber');
const { recordRenames } = require('./sync-renames');

/**
 * Core move: shift destination items to make room, move the file, renumber
 * the source directory to close the gap.
 */
function moveEntry(sourceDir, entryName, destDir, position) {
  const destItems = getItems(destDir);

  // Make room at destination
  const destRenames = destItems.some((i) => i.prefix >= position)
    ? renumberUp(destDir, destItems, position)
    : [];

  const newName = entryName.replace(/^\d+/, pad(position));
  const sourcePath = path.join(sourceDir, entryName);
  const destPath = path.join(destDir, newName);

  if (fs.existsSync(destPath)) {
    console.error(
      `[movetomodule] Error: ${newName} already exists in the destination.`,
    );
    process.exit(1);
  }

  fs.renameSync(sourcePath, destPath);

  // A moved subsection keeps its own _category_.json; align its position to
  // the new prefix (renumberUp/renumberSequential only fix the other entries).
  if (fs.statSync(destPath).isDirectory()) {
    updateCategoryPosition(destDir, newName, position);
  }

  // Renumber source to close gap
  const sourceRenames = renumberSequential(sourceDir, getItems);

  // All three in the order they happened, so the row lands in the destination
  // module rather than in the slot the shift above has just vacated.
  recordRenames([
    { fromDir: destDir, renames: destRenames },
    {
      fromDir: sourceDir,
      toDir: destDir,
      renames: [{ from: entryName, to: newName }],
    },
    { fromDir: sourceDir, renames: sourceRenames },
  ]);

  console.log(
    `[movetomodule] Moved ${entryName} -> ${path.relative(process.cwd(), destPath)}`,
  );
  if (sourceRenames.length > 0) {
    console.log('[movetomodule] Renumbered source:');
    for (const r of sourceRenames) {
      console.log(`  ${r.from} -> ${r.to}`);
    }
  }
}

async function moveToModule(options = {}) {
  // Non-interactive mode (VS Code): --path and --to-module provided
  if (options.path && options.toModule) {
    const itemPath = path.resolve(options.path);
    if (!fs.existsSync(itemPath)) {
      console.error(`[movetomodule] Error: Not found: ${itemPath}`);
      process.exit(1);
    }
    let destDir = path.join(COURSE_DIR, options.toModule);
    if (!fs.existsSync(destDir) || !fs.statSync(destDir).isDirectory()) {
      console.error(
        `[movetomodule] Error: Destination module not found: ${options.toModule}`,
      );
      process.exit(1);
    }
    if (options.toSubsection) {
      destDir = path.join(destDir, options.toSubsection);
      if (!fs.existsSync(destDir) || !fs.statSync(destDir).isDirectory()) {
        console.error(
          `[movetomodule] Error: Destination subsection not found: ${options.toSubsection}`,
        );
        process.exit(1);
      }
    }
    const destItems = getItems(destDir);
    const defaultPos =
      destItems.length > 0 ? destItems[destItems.length - 1].prefix + 1 : 1;
    const position = options.position
      ? parseInt(options.position, 10)
      : defaultPos;
    if (isNaN(position) || position < 1 || position > 99) {
      console.error(
        '[movetomodule] Error: Position must be a number between 1 and 99.',
      );
      process.exit(1);
    }
    moveEntry(
      path.dirname(itemPath),
      path.basename(itemPath),
      destDir,
      position,
    );
    return;
  }

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
    console.error(
      `[movetomodule] Error: No item found with number ${itemStr}.`,
    );
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
    console.error(
      `[movetomodule] Error: No module found with number ${destModuleStr}.`,
    );
    process.exit(1);
  }

  const destModulePath = path.join(COURSE_DIR, destMod.folderName);
  const destDir = await selectTargetDir(rl, destModulePath);
  const destItems = getItems(destDir);

  const defaultPos =
    destItems.length > 0 ? destItems[destItems.length - 1].prefix + 1 : 1;
  let position;
  while (true) {
    const posStr = await prompt(rl, 'Position in destination', pad(defaultPos));
    position = parseInt(posStr, 10);
    if (!isNaN(position) && position >= 1 && position <= 99) break;
    console.log(
      '  Position must be a number between 1 and 99. Please try again.',
    );
  }
  rl.close();

  moveEntry(sourceDir, item.name, destDir, position);
}

module.exports = moveToModule;
module.exports._moveEntry = moveEntry;
