const fs = require('fs');
const path = require('path');

const { listModules, listModuleItems } = require('../lib/canvas/modules');
const { getPage } = require('../lib/canvas/pages');
const { getAssignment } = require('../lib/canvas/assignments');
const { canvasItemToMarkdown } = require('../lib/convert/html-to-markdown');

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
  return {
    canvas_base_url: process.env.CANVAS_API_URL || '',
    course_id: Number(process.env.CANVAS_COURSE_ID) || 0,
    modules: {},
    last_sync: null,
  };
}

function saveSyncFile(syncData) {
  fs.writeFileSync(SYNC_FILE, JSON.stringify(syncData, null, 2) + '\n', 'utf8');
}

/**
 * Create a numbered folder name from a module name and position.
 * "Introduction" at position 1 -> "01-introduction"
 */
function toFolderName(name, position) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const prefix = String(position).padStart(2, '0');
  return `${prefix}-${slug}`;
}

/**
 * Create a numbered file name from an item title and position.
 * "Welcome" at position 1 -> "01-welcome.md"
 */
function toFileName(title, position) {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const prefix = String(position).padStart(2, '0');
  return `${prefix}-${slug}.md`;
}

async function pull() {
  const courseId = process.env.CANVAS_COURSE_ID;
  if (!courseId) {
    console.error('[pull] Error: CANVAS_COURSE_ID is not set. Run "course-cli init" first.');
    process.exit(1);
  }

  const syncData = loadSyncFile();

  console.log(`[pull] Fetching modules for course ${courseId}...`);
  const modules = await listModules(courseId);

  if (!modules || modules.length === 0) {
    console.log('[pull] No modules found in Canvas course.');
    return;
  }

  console.log(`[pull] Found ${modules.length} module(s).\n`);

  // Ensure course directory exists
  if (!fs.existsSync(COURSE_DIR)) {
    fs.mkdirSync(COURSE_DIR, { recursive: true });
  }

  const errors = [];

  for (const mod of modules) {
    try {
      await pullModule(courseId, mod, syncData);
    } catch (err) {
      console.error(`[pull] Error pulling module "${mod.name}": ${err.message}`);
      errors.push({ module: mod.name, error: err.message });
    }
    // Save sync state after each module so progress is preserved on failure
    saveSyncFile(syncData);
  }

  // Update last_sync
  syncData.last_sync = new Date().toISOString();
  saveSyncFile(syncData);

  console.log(`\n[pull] Sync file updated: ${SYNC_FILE}`);

  if (errors.length > 0) {
    console.log(`\n[pull] Completed with ${errors.length} error(s):`);
    for (const e of errors) {
      console.log(`  - ${e.module}: ${e.error}`);
    }
  } else {
    console.log('[pull] Done.');
  }
}

async function pullModule(courseId, mod, syncData) {
  const position = mod.position || 0;
  const folderName = toFolderName(mod.name, position);
  const moduleDir = path.join(COURSE_DIR, folderName);

  console.log(`[pull] Module: ${mod.name} -> ${folderName}/`);

  if (!fs.existsSync(moduleDir)) {
    fs.mkdirSync(moduleDir, { recursive: true });
  }

  // Track module in sync data
  syncData.modules[folderName] = syncData.modules[folderName] || {};
  syncData.modules[folderName].canvas_module_id = mod.id;

  // Write _category_.json for the module folder
  const categoryData = {
    label: mod.name,
    position,
  };
  fs.writeFileSync(
    path.join(moduleDir, '_category_.json'),
    JSON.stringify(categoryData, null, 2) + '\n',
    'utf8'
  );

  // Fetch module items
  const items = await listModuleItems(courseId, mod.id);
  if (!items || items.length === 0) {
    console.log('  [pull] No items in this module.');
    return;
  }

  let itemPosition = 0;
  let currentSubfolder = null; // Track active subfolder for indented items

  for (const item of items) {
    itemPosition++;

    if (item.type === 'SubHeader') {
      // Create a subfolder for this SubHeader
      const subfolderName = toFolderName(item.title, itemPosition);
      const subfolderDir = path.join(moduleDir, subfolderName);

      console.log(`  [pull] SubHeader: ${item.title} -> ${subfolderName}/`);

      if (!fs.existsSync(subfolderDir)) {
        fs.mkdirSync(subfolderDir, { recursive: true });
      }

      // Write _category_.json for the subfolder
      const categoryData = {
        label: item.title,
        position: itemPosition,
      };
      fs.writeFileSync(
        path.join(subfolderDir, '_category_.json'),
        JSON.stringify(categoryData, null, 2) + '\n',
        'utf8'
      );

      currentSubfolder = subfolderDir;
      continue;
    }

    // Items with indent > 0 go into the current subfolder
    const targetDir = (item.indent > 0 && currentSubfolder)
      ? currentSubfolder
      : moduleDir;

    // If indent is 0, we're no longer inside a subfolder
    if (item.indent === 0) {
      currentSubfolder = null;
    }

    try {
      await pullItem(courseId, item, targetDir, itemPosition);
    } catch (err) {
      console.error(`  [pull] Error pulling item "${item.title || 'unknown'}": ${err.message}`);
    }
  }
}

async function pullItem(courseId, item, moduleDir, position) {
  const itemType = item.type;
  const title = item.title || 'Untitled';

  if (itemType === 'Page') {
    const pageUrl = item.page_url;
    if (!pageUrl) {
      console.log(`  [pull] Skipping page "${title}": no page_url`);
      return;
    }

    console.log(`  [pull] Fetching page: ${title}`);
    const page = await getPage(courseId, pageUrl);
    const markdown = canvasItemToMarkdown(page, 'page');
    const fileName = toFileName(title, position);
    const filePath = path.join(moduleDir, fileName);
    fs.writeFileSync(filePath, markdown, 'utf8');
    console.log(`    [pull] Wrote ${fileName}`);
    return;
  }

  if (itemType === 'Assignment') {
    const contentId = item.content_id;
    if (!contentId) {
      console.log(`  [pull] Skipping assignment "${title}": no content_id`);
      return;
    }

    console.log(`  [pull] Fetching assignment: ${title}`);
    const assignment = await getAssignment(courseId, contentId);
    const markdown = canvasItemToMarkdown(assignment, 'assignment');
    const fileName = toFileName(title, position);
    const filePath = path.join(moduleDir, fileName);
    fs.writeFileSync(filePath, markdown, 'utf8');
    console.log(`    [pull] Wrote ${fileName}`);
    return;
  }

  if (itemType === 'ExternalUrl') {
    console.log(`  [pull] Fetching external URL: ${title}`);
    const markdown = canvasItemToMarkdown(
      { title, external_url: item.external_url, id: item.id },
      'external_url'
    );
    const fileName = toFileName(title, position);
    const filePath = path.join(moduleDir, fileName);
    fs.writeFileSync(filePath, markdown, 'utf8');
    console.log(`    [pull] Wrote ${fileName}`);
    return;
  }

  // File, Discussion, Quiz, ExternalTool, etc.
  console.log(`  [pull] Skipping unsupported item type "${itemType}": ${title}`);
}

module.exports = pull;
