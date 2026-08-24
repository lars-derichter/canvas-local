const fs = require('fs');
const path = require('path');
const { prompt, createRL } = require('./module-utils');
const {
  getItems,
  printItems,
  selectModule,
  selectTargetDir,
} = require('./item-utils');
const { reorder } = require('./renumber');
const { recordRenames } = require('./sync-renames');

async function moveItem(options = {}) {
  // Non-interactive mode (VS Code): --path and --position provided
  if (options.path && options.position) {
    const itemPath = path.resolve(options.path);
    if (!fs.existsSync(itemPath)) {
      console.error(`[move-item] Error: Not found: ${itemPath}`);
      process.exit(1);
    }
    const targetDir = path.dirname(itemPath);
    const items = getItems(targetDir);
    const entryName = path.basename(itemPath);
    const sourceItem = items.find((i) => i.name === entryName);
    if (!sourceItem) {
      console.error(
        `[move-item] Error: ${entryName} has no numeric prefix or is not a course item.`,
      );
      process.exit(1);
    }
    const targetPosition = parseInt(options.position, 10);
    if (
      isNaN(targetPosition) ||
      targetPosition < 1 ||
      targetPosition > items.length
    ) {
      console.error(
        `[move-item] Error: Position must be between 1 and ${items.length}.`,
      );
      process.exit(1);
    }
    const renames = reorder(
      targetDir,
      items,
      sourceItem.prefix,
      targetPosition,
    );
    recordRenames([{ fromDir: targetDir, renames }]);
    if (renames.length > 0) {
      console.log('[move-item] Reordered items:');
      for (const r of renames) {
        console.log(`  ${r.from} -> ${r.to}`);
      }
    } else {
      console.log('[move-item] Item is already at that position.');
    }
    return;
  }

  const rl = createRL({ command: 'move-item', flags: '--path and --position' });

  console.log('[move-item] Move an item to a new position\n');

  const { modulePath } = await selectModule(rl);
  const targetDir = await selectTargetDir(rl, modulePath);
  const items = getItems(targetDir);

  if (items.length < 2) {
    rl.close();
    console.log('[move-item] Need at least 2 items to reorder.');
    return;
  }

  printItems(items);

  let sourceItem;
  while (true) {
    const sourceStr = await prompt(rl, 'Item to move (number)');
    const sourcePrefix = parseInt(sourceStr, 10);
    sourceItem = items.find((i) => i.prefix === sourcePrefix);
    if (sourceItem) break;
    console.log(`  No item found with number ${sourceStr}. Please try again.`);
  }

  let targetPosition;
  while (true) {
    const targetStr = await prompt(rl, 'New position');
    targetPosition = parseInt(targetStr, 10);
    if (
      !isNaN(targetPosition) &&
      targetPosition >= 1 &&
      targetPosition <= items.length
    )
      break;
    console.log(
      `  Position must be between 1 and ${items.length}. Please try again.`,
    );
  }
  rl.close();

  // Ordinal against ordinal, as in move-module: the prefix is not the
  // position when the numbering is gapped or starts at 00.
  if (items.indexOf(sourceItem) + 1 === targetPosition) {
    console.log('[move-item] Item is already at that position.');
    return;
  }

  const renames = reorder(targetDir, items, sourceItem.prefix, targetPosition);
  recordRenames([{ fromDir: targetDir, renames }]);

  if (renames.length > 0) {
    console.log('[move-item] Reordered items:');
    for (const r of renames) {
      console.log(`  ${r.from} -> ${r.to}`);
    }
  }
}

module.exports = moveItem;
