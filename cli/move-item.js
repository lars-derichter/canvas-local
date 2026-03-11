const fs = require('fs');
const path = require('path');
const { prompt, pad, createRL } = require('./module-utils');
const { getItems, printItems, selectModule, selectTargetDir } = require('./item-utils');

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

  // Build new order
  const remaining = items.filter((i) => i.prefix !== sourcePrefix);
  remaining.splice(targetPosition - 1, 0, sourceItem);

  // Two-pass rename via temp names to avoid collisions
  const tempPrefix = '__item_move_temp_';
  const renames = [];

  for (let i = 0; i < remaining.length; i++) {
    const item = remaining[i];
    const tempName = `${tempPrefix}${pad(i + 1)}-${item.name.replace(/^\d+-/, '')}`;
    fs.renameSync(
      path.join(targetDir, item.name),
      path.join(targetDir, tempName)
    );
    remaining[i] = { ...item, _tempName: tempName };
  }

  for (let i = 0; i < remaining.length; i++) {
    const item = remaining[i];
    const newPrefix = i + 1;
    const newName = item.name.replace(/^\d+/, pad(newPrefix));

    fs.renameSync(
      path.join(targetDir, item._tempName),
      path.join(targetDir, newName)
    );

    // Update _category_.json for subsections
    if (item.isDirectory) {
      const catFile = path.join(targetDir, newName, '_category_.json');
      if (fs.existsSync(catFile)) {
        const cat = JSON.parse(fs.readFileSync(catFile, 'utf8'));
        cat.position = newPrefix;
        fs.writeFileSync(catFile, JSON.stringify(cat, null, 2) + '\n', 'utf8');
      }
    }

    if (newName !== item.name) {
      renames.push({ from: item.name, to: newName });
    }
  }

  if (renames.length > 0) {
    console.log('[move-item] Reordered items:');
    for (const r of renames) {
      console.log(`  ${r.from} -> ${r.to}`);
    }
  }
}

module.exports = moveItem;
