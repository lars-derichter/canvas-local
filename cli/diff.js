const fs = require('fs');
const path = require('path');

const { scanCourse } = require('../lib/convert/course-scanner');
const { getItem, getModule, loadState } = require('../lib/sync/state');
const { COURSE_DIR } = require('./module-utils');

/**
 * Flatten items list, expanding subheader children.
 */
function flattenItems(items) {
  const result = [];
  for (const item of items) {
    if (item.type === 'subheader') {
      result.push(item);
      if (item.items) {
        for (const child of item.items) {
          result.push(child);
        }
      }
    } else {
      result.push(item);
    }
  }
  return result;
}

async function diff() {
  const syncData = loadState({ allowNull: true });

  if (!syncData) {
    console.log(
      '[diff] No .canvas-sync.json found. Nothing has been synced yet.',
    );
    return;
  }

  if (!fs.existsSync(COURSE_DIR)) {
    console.log('[diff] No course/ directory found.');
    return;
  }

  const modules = scanCourse(COURSE_DIR);
  const syncModules = syncData.modules || {};

  const localFolders = new Set(modules.map((m) => m.folderName));

  let newModules = 0;
  let deletedModules = 0;
  let newItems = 0;
  let modifiedItems = 0;
  let unchangedItems = 0;

  console.log('[diff] Comparing local files against last sync state\n');

  // Check local modules
  for (const mod of modules) {
    const syncMod = getModule(syncData, mod.folderName);

    if (!syncMod) {
      console.log(`  + NEW module: ${mod.folderName}`);
      newModules++;
      const flatItems = flattenItems(mod.items);
      for (const item of flatItems) {
        if (item.type === 'subheader') continue;
        console.log(`    + NEW   ${item.relativePath}`);
        newItems++;
      }
      continue;
    }

    const flatItems = flattenItems(mod.items);
    let moduleHasChanges = false;

    for (const item of flatItems) {
      if (item.type === 'subheader') continue;

      if (!getItem(syncData, item.relativePath)) {
        if (!moduleHasChanges) {
          console.log(`  ~ module: ${mod.folderName}`);
          moduleHasChanges = true;
        }
        console.log(`    + NEW   ${item.relativePath}`);
        newItems++;
        continue;
      }

      // Check if file was modified since last sync
      if (syncData.last_sync) {
        const filePath = path.join(COURSE_DIR, item.relativePath);
        if (fs.existsSync(filePath)) {
          const mtime = fs.statSync(filePath).mtime;
          if (mtime > new Date(syncData.last_sync)) {
            if (!moduleHasChanges) {
              console.log(`  ~ module: ${mod.folderName}`);
              moduleHasChanges = true;
            }
            console.log(`    ~ MOD   ${item.relativePath}`);
            modifiedItems++;
            continue;
          }
        }
      }

      unchangedItems++;
    }

    // Rows the sync state holds for files that are no longer on disk. The path
    // is the key, so "still present" is a question the filesystem answers on
    // its own — no identity has to be matched to ask it.
    for (const itemPath of Object.keys(syncMod.items || {})) {
      if (fs.existsSync(path.join(COURSE_DIR, itemPath))) continue;
      if (!moduleHasChanges) {
        console.log(`  ~ module: ${mod.folderName}`);
        moduleHasChanges = true;
      }
      console.log(`    - DEL   ${itemPath}`);
    }
  }

  // Modules in sync but not local (deleted)
  for (const folder of Object.keys(syncModules)) {
    if (localFolders.has(folder)) continue;
    console.log(`  - DEL module: ${folder}`);
    deletedModules++;
  }

  // Summary
  console.log('\n[diff] Summary:');
  console.log(`  New modules:      ${newModules}`);
  console.log(`  Deleted modules:  ${deletedModules}`);
  console.log(`  New items:        ${newItems}`);
  console.log(`  Modified items:   ${modifiedItems}`);
  console.log(`  Unchanged items:  ${unchangedItems}`);

  if (
    newModules === 0 &&
    deletedModules === 0 &&
    newItems === 0 &&
    modifiedItems === 0
  ) {
    console.log('\n  No changes detected since last sync.');
  }
}

module.exports = diff;
