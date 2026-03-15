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
    if (!isNaN(targetPosition) && targetPosition >= 1 && targetPosition <= items.length) break;
    console.log(`  Position must be between 1 and ${items.length}. Please try again.`);
  }
  rl.close();

  if (sourceItem.prefix === targetPosition) {
    console.log('[move-item] Item is already at that position.');
    return;
  }

  const renames = reorder(targetDir, items, sourceItem.prefix, targetPosition);

  if (renames.length > 0) {
    console.log('[move-item] Reordered items:');
    for (const r of renames) {
      console.log(`  ${r.from} -> ${r.to}`);
    }
  }
}

module.exports = moveItem;
