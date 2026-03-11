const fs = require('fs');
const path = require('path');
const { prompt, pad, createRL } = require('./module-utils');
const { getItems, printItems, selectModule, selectTargetDir } = require('./item-utils');

/**
 * Renumber items sequentially to close gaps after removal.
 */
function renumberSequential(dirPath) {
  const items = getItems(dirPath);
  const tempPrefix = '__delete_item_temp_';
  const renames = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const tempName = `${tempPrefix}${pad(i + 1)}-${item.name.replace(/^\d+-/, '')}`;
    fs.renameSync(path.join(dirPath, item.name), path.join(dirPath, tempName));
    items[i] = { ...item, _tempName: tempName };
  }

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const newPrefix = i + 1;
    const newName = item.name.replace(/^\d+/, pad(newPrefix));
    fs.renameSync(path.join(dirPath, item._tempName), path.join(dirPath, newName));
    if (item.isDirectory) {
      const catFile = path.join(dirPath, newName, '_category_.json');
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

  return renames;
}

async function deleteItem() {
  const rl = createRL();

  console.log('[delete-item] Delete an item from a module\n');

  const { modulePath } = await selectModule(rl);
  const targetDir = await selectTargetDir(rl, modulePath);
  const items = getItems(targetDir);

  if (items.length === 0) {
    rl.close();
    console.log('[delete-item] No items found.');
    return;
  }

  printItems(items);

  const sourceStr = await prompt(rl, 'Item to delete (number)');
  const sourcePrefix = parseInt(sourceStr, 10);
  const item = items.find((i) => i.prefix === sourcePrefix);

  if (!item) {
    rl.close();
    console.error(`[delete-item] Error: No item found with number ${sourceStr}.`);
    process.exit(1);
  }

  const label = item.isDirectory ? `${item.name}/ and all its contents` : item.name;
  const confirm = await prompt(rl, `Delete ${label}? (y/N)`, 'N');
  rl.close();

  if (confirm.toLowerCase() !== 'y') {
    console.log('[delete-item] Cancelled.');
    return;
  }

  const itemPath = path.join(targetDir, item.name);
  if (item.isDirectory) {
    fs.rmSync(itemPath, { recursive: true });
  } else {
    fs.unlinkSync(itemPath);
  }
  console.log(`[delete-item] Deleted ${item.name}`);

  // Renumber remaining items
  const renames = renumberSequential(targetDir);
  if (renames.length > 0) {
    console.log('[delete-item] Renumbered remaining items:');
    for (const r of renames) {
      console.log(`  ${r.from} -> ${r.to}`);
    }
  }
}

module.exports = deleteItem;
