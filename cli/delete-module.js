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
const {
  deleteModule: deleteModuleFromState,
  loadState,
  renameFolders,
  saveState,
} = require('../lib/sync/state');

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

async function deleteModule(options = {}) {
  let sourceModule;

  if (options.module) {
    // Non-interactive mode (VS Code): requires --yes since there is no prompt
    if (!options.yes) {
      console.error(
        '[delete-module] Error: --module requires --yes to confirm deletion.',
      );
      process.exit(1);
    }
    const modules = getExistingModules();
    sourceModule = modules.find((m) => m.folderName === options.module);
    if (!sourceModule) {
      console.error(
        `[delete-module] Error: Module not found: ${options.module}`,
      );
      process.exit(1);
    }
  } else {
    const rl = createRL({
      command: 'delete-module',
      flags: '--module and --yes',
    });

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
    sourceModule = modules.find((m) => m.prefix === sourcePrefix);

    if (!sourceModule) {
      rl.close();
      console.error(
        `[delete-module] Error: No module found with number ${sourceStr}.`,
      );
      process.exit(1);
    }

    const confirm = await prompt(
      rl,
      `Delete ${sourceModule.folderName} and all its contents? (y/N)`,
      'N',
    );
    rl.close();

    if (confirm.toLowerCase() !== 'y') {
      console.log('[delete-module] Cancelled.');
      return;
    }
  }

  // Delete the folder
  const folderPath = path.join(COURSE_DIR, sourceModule.folderName);
  fs.rmSync(folderPath, { recursive: true });
  console.log(`[delete-module] Deleted ${sourceModule.folderName}/`);

  // Remove the module from sync state. The folder name is the key, so the
  // module the author just deleted is exactly the row that goes.
  const syncData = loadState({ allowNull: true });
  if (syncData) {
    deleteModuleFromState(syncData, sourceModule.folderName);
    // Dropping a module deliberately leaves its embedded-file rows behind —
    // removal is not relocation — so this command, which has just destroyed
    // the folder those files lived in, clears them itself.
    if (syncData.files) {
      for (const filePath of Object.keys(syncData.files)) {
        if (filePath.startsWith(sourceModule.folderName + '/')) {
          delete syncData.files[filePath];
        }
      }
    }
  }

  // Renumber remaining modules sequentially to close the gap
  const renames = renumberSequential(COURSE_DIR, getModuleEntries);

  if (renames.length > 0) {
    console.log('[delete-module] Renumbered remaining modules:');
    for (const r of renames) {
      console.log(`  ${r.from} -> ${r.to}`);
    }
    // A renumbered folder is a renamed one: its key, the paths of every item
    // inside it and its embedded-file rows all move together. In one batch,
    // because closing the gap slides every module into its neighbour's slot.
    if (syncData) renameFolders(syncData, renames);
  }

  if (syncData) {
    saveState(syncData);
    console.log('[delete-module] Sync state updated.');
  }
}

module.exports = deleteModule;
