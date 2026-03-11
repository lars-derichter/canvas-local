const fs = require('fs');
const path = require('path');

const { scanCourse } = require('../lib/convert/course-scanner');

const COURSE_DIR = path.resolve(process.cwd(), 'course');
const SYNC_FILE = path.resolve(process.cwd(), '.canvas-sync.json');

function loadSyncFile() {
  if (fs.existsSync(SYNC_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(SYNC_FILE, 'utf8'));
    } catch (_) {
      // Fall through
    }
  }
  return null;
}

async function status() {
  const syncData = loadSyncFile();

  if (!syncData) {
    console.log('[status] No .canvas-sync.json found. Run "course-cli init" first.');
    return;
  }

  if (!fs.existsSync(COURSE_DIR)) {
    console.log('[status] No course/ directory found. Nothing to report.');
    return;
  }

  const modules = scanCourse(COURSE_DIR);
  const syncModules = syncData.modules || {};
  const localFolders = new Set(modules.map((m) => m.folderName));
  const syncFolders = new Set(Object.keys(syncModules));

  let notPushedModules = 0;
  let notPushedItems = 0;
  let syncedModules = 0;
  let syncedItems = 0;
  let deletedModules = 0;

  console.log('[status] Comparing local course/ with .canvas-sync.json\n');

  // Check local modules against sync file
  for (const mod of modules) {
    const syncMod = syncModules[mod.folderName];
    const hasModuleId = syncMod && syncMod.canvas_module_id;

    if (!hasModuleId) {
      console.log(`  NEW     module: ${mod.folderName} (${mod.moduleName})`);
      notPushedModules++;
    } else {
      console.log(`  SYNCED  module: ${mod.folderName} (canvas_module_id: ${syncMod.canvas_module_id})`);
      syncedModules++;
    }

    // Check items
    const flatItems = flattenItems(mod.items);
    for (const item of flatItems) {
      if (item.type === 'subheader') continue;

      const canvasId = item.frontmatter && item.frontmatter.canvas_id;
      if (canvasId) {
        console.log(`    SYNCED  ${item.relativePath} (canvas_id: ${canvasId})`);
        syncedItems++;
      } else {
        console.log(`    NEW     ${item.relativePath}`);
        notPushedItems++;
      }
    }
  }

  // Check for modules in sync file that are not found locally
  for (const folder of syncFolders) {
    if (!localFolders.has(folder)) {
      console.log(`  DELETED module: ${folder} (exists in sync file but not locally)`);
      deletedModules++;
    }
  }

  // Summary
  console.log('\n[status] Summary:');
  console.log(`  Modules synced:      ${syncedModules}`);
  console.log(`  Modules not pushed:  ${notPushedModules}`);
  console.log(`  Modules deleted:     ${deletedModules}`);
  console.log(`  Items synced:        ${syncedItems}`);
  console.log(`  Items not pushed:    ${notPushedItems}`);

  if (syncData.last_sync) {
    console.log(`\n  Last sync: ${syncData.last_sync}`);
  } else {
    console.log('\n  Last sync: never');
  }
}

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

module.exports = status;
