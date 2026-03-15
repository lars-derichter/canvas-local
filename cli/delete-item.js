const fs = require('fs');
const path = require('path');
const { prompt, createRL, COURSE_DIR } = require('./module-utils');
const { getItems, printItems, selectModule, selectTargetDir } = require('./item-utils');
const { renumberSequential } = require('./renumber');
const { loadSyncFile, saveSyncFile } = require('./sync-utils');

async function deleteItem() {
  const rl = createRL();

  console.log('[delete-item] Delete an item from a module\n');

  const { modulePath, folderName } = await selectModule(rl);
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

  // Remove from sync state
  const syncData = loadSyncFile({ allowNull: true });
  if (syncData && syncData.modules && syncData.modules[folderName]) {
    const syncModule = syncData.modules[folderName];
    if (syncModule.items) {
      const relativePath = path.relative(COURSE_DIR, path.join(targetDir, item.name));
      if (syncModule.items[relativePath]) {
        delete syncModule.items[relativePath];
        saveSyncFile(syncData);
        console.log(`[delete-item] Removed ${relativePath} from sync state.`);
      }
    }
  }

  // Renumber remaining items
  const renames = renumberSequential(targetDir, getItems);
  if (renames.length > 0) {
    console.log('[delete-item] Renumbered remaining items:');
    for (const r of renames) {
      console.log(`  ${r.from} -> ${r.to}`);
    }
  }
}

module.exports = deleteItem;
