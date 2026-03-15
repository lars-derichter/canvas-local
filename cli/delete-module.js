const fs = require('fs');
const path = require('path');
const {
  COURSE_DIR,
  prompt,
  getExistingModules,
  createRL,
  printModules,
} = require('./module-utils');
const { renumberSequential } = require('./renumber');
const { loadSyncFile, saveSyncFile } = require('./sync-utils');

/**
 * Get module entries in the format expected by renumberSequential.
 */
function getModuleEntries(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const modules = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const match = entry.name.match(/^(\d+)/);
    if (match) {
      modules.push({
        prefix: parseInt(match[1], 10),
        name: entry.name,
        isDirectory: true,
      });
    }
  }

  modules.sort((a, b) => a.prefix - b.prefix);
  return modules;
}

async function deleteModule() {
  const rl = createRL();

  console.log('[delete-module] Delete a course module\n');

  const modules = getExistingModules();

  if (modules.length === 0) {
    rl.close();
    console.log('[delete-module] No modules found.');
    return;
  }

  printModules(modules);

  const sourceStr = await prompt(rl, 'Module to delete (number)');
  const sourcePrefix = parseInt(sourceStr, 10);
  const sourceModule = modules.find((m) => m.prefix === sourcePrefix);

  if (!sourceModule) {
    rl.close();
    console.error(`[delete-module] Error: No module found with number ${sourceStr}.`);
    process.exit(1);
  }

  const confirm = await prompt(rl, `Delete ${sourceModule.folderName} and all its contents? (y/N)`, 'N');
  rl.close();

  if (confirm.toLowerCase() !== 'y') {
    console.log('[delete-module] Cancelled.');
    return;
  }

  // Delete the folder
  const folderPath = path.join(COURSE_DIR, sourceModule.folderName);
  fs.rmSync(folderPath, { recursive: true });
  console.log(`[delete-module] Deleted ${sourceModule.folderName}/`);

  // Remove from sync state and update renamed module keys
  const syncData = loadSyncFile({ allowNull: true });
  if (syncData && syncData.modules) {
    delete syncData.modules[sourceModule.folderName];
  }

  // Renumber remaining modules sequentially to close the gap
  const renames = renumberSequential(COURSE_DIR, getModuleEntries);

  if (renames.length > 0) {
    console.log('[delete-module] Renumbered remaining modules:');
    for (const r of renames) {
      console.log(`  ${r.from} -> ${r.to}`);
    }
    // Update sync state keys for renamed modules
    if (syncData && syncData.modules) {
      for (const { from, to } of renames) {
        if (syncData.modules[from]) {
          syncData.modules[to] = syncData.modules[from];
          delete syncData.modules[from];
        }
      }
    }
  }

  if (syncData) {
    saveSyncFile(syncData);
    console.log('[delete-module] Sync state updated.');
  }
}

module.exports = deleteModule;
