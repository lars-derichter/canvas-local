const { prompt, createRL } = require('./module-utils');
const { getItems, printItems, selectModule, selectTargetDir } = require('./item-utils');
const { reorder } = require('./renumber');

async function moveItem() {
  const rl = createRL();

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

  const sourceStr = await prompt(rl, 'Item to move (number)');
  const sourcePrefix = parseInt(sourceStr, 10);
  const sourceItem = items.find((i) => i.prefix === sourcePrefix);

  if (!sourceItem) {
    rl.close();
    console.error(`[move-item] Error: No item found with number ${sourceStr}.`);
    process.exit(1);
  }

  const targetStr = await prompt(rl, 'New position');
  rl.close();

  const targetPosition = parseInt(targetStr, 10);
  if (isNaN(targetPosition) || targetPosition < 1 || targetPosition > items.length) {
    console.error(`[move-item] Error: Position must be between 1 and ${items.length}.`);
    process.exit(1);
  }

  if (sourcePrefix === targetPosition) {
    console.log('[move-item] Item is already at that position.');
    return;
  }

  const renames = reorder(targetDir, items, sourcePrefix, targetPosition);

  if (renames.length > 0) {
    console.log('[move-item] Reordered items:');
    for (const r of renames) {
      console.log(`  ${r.from} -> ${r.to}`);
    }
  }
}

module.exports = moveItem;
