const fs = require('fs');
const path = require('path');

const { scanCourse } = require('../lib/convert/course-scanner');
const { listModules, listModuleItems } = require('../lib/canvas/modules');

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

async function status(options) {
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

  // Remote comparison
  if (options && options.remote) {
    await compareWithCanvas(syncData, modules);
  }
}

/**
 * Fetch modules and items from Canvas and compare with local state.
 */
async function compareWithCanvas(syncData, localModules) {
  const courseId = process.env.CANVAS_COURSE_ID;
  if (!courseId) {
    console.log('\n[status] Cannot compare with Canvas: CANVAS_COURSE_ID is not set.');
    return;
  }

  console.log('\n[status] Fetching Canvas course data for comparison...');

  let canvasModules;
  try {
    canvasModules = await listModules(courseId);
  } catch (err) {
    console.error(`[status] Error fetching Canvas modules: ${err.message}`);
    return;
  }

  if (!canvasModules || canvasModules.length === 0) {
    console.log('[status] No modules found on Canvas.');
    return;
  }

  const syncModules = syncData.modules || {};

  // Build a map of canvas module IDs to local folder names
  const canvasIdToLocal = {};
  for (const [folder, data] of Object.entries(syncModules)) {
    if (data.canvas_module_id) {
      canvasIdToLocal[data.canvas_module_id] = folder;
    }
  }

  let canvasOnlyModules = 0;
  let matchedModules = 0;
  let canvasOnlyItems = 0;
  let matchedItems = 0;

  console.log('\n[status] Canvas vs Local comparison:\n');

  for (const canvasMod of canvasModules) {
    const localFolder = canvasIdToLocal[canvasMod.id];

    if (!localFolder) {
      console.log(`  CANVAS-ONLY module: "${canvasMod.name}" (id: ${canvasMod.id})`);
      canvasOnlyModules++;
      continue;
    }

    console.log(`  MATCHED    module: "${canvasMod.name}" <-> ${localFolder}`);
    matchedModules++;

    // Compare items within the module
    try {
      const canvasItems = await listModuleItems(courseId, canvasMod.id);
      if (!canvasItems) continue;

      // Build a set of local canvas_ids for this module
      const localMod = localModules.find((m) => m.folderName === localFolder);
      const localCanvasIds = new Set();
      if (localMod) {
        const flatItems = flattenItems(localMod.items);
        for (const item of flatItems) {
          if (item.frontmatter && item.frontmatter.canvas_id) {
            localCanvasIds.add(String(item.frontmatter.canvas_id));
          }
        }
      }

      for (const canvasItem of canvasItems) {
        if (canvasItem.type === 'SubHeader') continue;

        const contentId = canvasItem.content_id || canvasItem.page_url || canvasItem.id;
        if (localCanvasIds.has(String(contentId))) {
          matchedItems++;
        } else {
          console.log(`    CANVAS-ONLY item: "${canvasItem.title}" (type: ${canvasItem.type})`);
          canvasOnlyItems++;
        }
      }
    } catch (err) {
      console.error(`    [status] Error fetching items for module "${canvasMod.name}": ${err.message}`);
    }
  }

  console.log('\n[status] Remote comparison summary:');
  console.log(`  Canvas modules matched locally:  ${matchedModules}`);
  console.log(`  Canvas-only modules:             ${canvasOnlyModules}`);
  console.log(`  Canvas items matched locally:    ${matchedItems}`);
  console.log(`  Canvas-only items:               ${canvasOnlyItems}`);
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
