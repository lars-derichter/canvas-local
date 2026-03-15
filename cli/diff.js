const fs = require('fs');
const path = require('path');

const { scanCourse } = require('../lib/convert/course-scanner');
const { loadSyncFile } = require('./sync-utils');

const COURSE_DIR = path.resolve(process.cwd(), 'course');

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
  const syncData = loadSyncFile({ allowNull: true });

  if (!syncData) {
    console.log('[diff] No .canvas-sync.json found. Nothing has been synced yet.');
    return;
  }

  if (!fs.existsSync(COURSE_DIR)) {
    console.log('[diff] No course/ directory found.');
    return;
  }

  const modules = scanCourse(COURSE_DIR);
  const syncModules = syncData.modules || {};

  const localFolders = new Set(modules.map((m) => m.folderName));
  const syncFolders = new Set(Object.keys(syncModules));

  let newModules = 0;
  let deletedModules = 0;
  let newItems = 0;
  let modifiedItems = 0;
  let unchangedItems = 0;

  console.log('[diff] Comparing local files against last sync state\n');

  // Check local modules
  for (const mod of modules) {
    const syncMod = syncModules[mod.folderName];
    const hasModuleId = syncMod && syncMod.canvas_module_id;

    if (!hasModuleId) {
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
    const syncItems = (syncMod && syncMod.items) || {};
    let moduleHasChanges = false;

    for (const item of flatItems) {
      if (item.type === 'subheader') continue;

      const canvasId = item.frontmatter && item.frontmatter.canvas_id;
      if (!canvasId) {
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

    // Check for items in sync state but not on disk (deleted locally)
    for (const relPath of Object.keys(syncItems)) {
      const filePath = path.join(COURSE_DIR, relPath);
      if (!fs.existsSync(filePath)) {
        if (!moduleHasChanges) {
          console.log(`  ~ module: ${mod.folderName}`);
          moduleHasChanges = true;
        }
        console.log(`    - DEL   ${relPath}`);
      }
    }
  }

  // Modules in sync but not local (deleted)
  for (const folder of syncFolders) {
    if (!localFolders.has(folder)) {
      console.log(`  - DEL module: ${folder}`);
      deletedModules++;
    }
  }

  // Summary
  console.log('\n[diff] Summary:');
  console.log(`  New modules:      ${newModules}`);
  console.log(`  Deleted modules:  ${deletedModules}`);
  console.log(`  New items:        ${newItems}`);
  console.log(`  Modified items:   ${modifiedItems}`);
  console.log(`  Unchanged items:  ${unchangedItems}`);

  if (newModules === 0 && deletedModules === 0 && newItems === 0 && modifiedItems === 0) {
    console.log('\n  No changes detected since last sync.');
  }
}

module.exports = diff;
