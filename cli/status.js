const fs = require('fs');
const path = require('path');

const { scanCourse } = require('../lib/convert/course-scanner');
const { listModules, listModuleItems } = require('../lib/canvas/modules');
const {
  findModuleByCanvasId,
  getItem,
  getModule,
  loadState,
} = require('../lib/sync/state');
const { COURSE_DIR } = require('./module-utils');

async function status(options) {
  const syncData = loadState({ allowNull: true });

  if (!syncData) {
    console.log(
      '[status] No .canvas-sync.json found. Run "npx course init" first.',
    );
    return;
  }

  if (!fs.existsSync(COURSE_DIR)) {
    console.log('[status] No course/ directory found. Nothing to report.');
    return;
  }

  const modules = scanCourse(COURSE_DIR);
  const syncModules = syncData.modules || {};
  const localFolders = new Set(modules.map((m) => m.folderName));

  let notPushedModules = 0;
  let notPushedItems = 0;
  let syncedModules = 0;
  let syncedItems = 0;
  let deletedModules = 0;
  let modifiedItems = 0;

  console.log('[status] Comparing local course/ with .canvas-sync.json\n');

  // Check local modules against sync file
  for (const mod of modules) {
    const entry = getModule(syncData, mod.folderName);

    if (!entry) {
      console.log(`  NEW     module: ${mod.folderName} (${mod.moduleName})`);
      notPushedModules++;
    } else {
      console.log(
        `  SYNCED  module: ${mod.folderName} (canvas_module_id: ${entry.canvas_module_id})`,
      );
      syncedModules++;
    }

    // Check items
    const flatItems = flattenItems(mod.items);
    for (const item of flatItems) {
      if (item.type === 'subheader') continue;

      // The sync state answers whether an item has been pushed; the file says
      // nothing about it any more.
      const row = getItem(syncData, item.relativePath);
      if (row) {
        // Check if locally modified since last sync
        const filePath = path.join(COURSE_DIR, item.relativePath);
        let modified = false;
        if (syncData.last_sync && fs.existsSync(filePath)) {
          const mtime = fs.statSync(filePath).mtime;
          modified = mtime > new Date(syncData.last_sync);
        }
        if (modified) {
          console.log(
            `    MODIFIED ${item.relativePath} (changed since last sync)`,
          );
          modifiedItems++;
        } else {
          console.log(
            `    SYNCED  ${item.relativePath} (canvas_id: ${row.entry.canvas_id})`,
          );
        }
        syncedItems++;
      } else {
        console.log(`    NEW     ${item.relativePath}`);
        notPushedItems++;
      }
    }
  }

  // Check for modules in sync file that are not found locally
  for (const folder of Object.keys(syncModules)) {
    if (localFolders.has(folder)) continue;
    console.log(
      `  DELETED module: ${folder} (exists in sync file but not locally)`,
    );
    deletedModules++;
  }

  // Summary
  console.log('\n[status] Summary:');
  console.log(`  Modules synced:      ${syncedModules}`);
  console.log(`  Modules not pushed:  ${notPushedModules}`);
  console.log(`  Modules deleted:     ${deletedModules}`);
  console.log(`  Items synced:        ${syncedItems}`);
  console.log(`  Items modified:      ${modifiedItems}`);
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
    console.log(
      '\n[status] Cannot compare with Canvas: CANVAS_COURSE_ID is not set.',
    );
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

  let canvasOnlyModules = 0;
  let matchedModules = 0;
  let canvasOnlyItems = 0;
  let matchedItems = 0;

  console.log('\n[status] Canvas vs Local comparison:\n');

  for (const canvasMod of canvasModules) {
    const found = findModuleByCanvasId(syncData, canvasMod.id);

    if (!found) {
      console.log(
        `  CANVAS-ONLY module: "${canvasMod.name}" (id: ${canvasMod.id})`,
      );
      canvasOnlyModules++;
      continue;
    }

    const [localFolder, entry] = found;
    console.log(`  MATCHED    module: "${canvasMod.name}" <-> ${localFolder}`);
    matchedModules++;

    // Compare items within the module
    try {
      const canvasItems = await listModuleItems(courseId, canvasMod.id);
      if (!canvasItems) continue;

      // The Canvas identities this module's synced items hold. A local file
      // carries none any more, so the sync state is the only side that can
      // answer, and only for a module whose files are still on disk.
      const localMod = localModules.find((m) => m.folderName === localFolder);
      const localCanvasIds = new Set();
      if (localMod) {
        for (const [itemPath, row] of Object.entries(entry.items || {})) {
          if (!fs.existsSync(path.join(COURSE_DIR, itemPath))) continue;
          if (row.canvas_id != null) localCanvasIds.add(String(row.canvas_id));
          if (row.page_url != null) localCanvasIds.add(String(row.page_url));
        }
      }

      for (const canvasItem of canvasItems) {
        if (canvasItem.type === 'SubHeader') continue;

        const contentId =
          canvasItem.content_id || canvasItem.page_url || canvasItem.id;
        if (localCanvasIds.has(String(contentId))) {
          matchedItems++;
        } else {
          console.log(
            `    CANVAS-ONLY item: "${canvasItem.title}" (type: ${canvasItem.type})`,
          );
          canvasOnlyItems++;
        }
      }
    } catch (err) {
      console.error(
        `    [status] Error fetching items for module "${canvasMod.name}": ${err.message}`,
      );
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
