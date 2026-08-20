const fs = require('fs');
const path = require('path');
const {
  COURSE_DIR,
  prompt,
  getExistingModules,
  pad,
  printModules,
} = require('./module-utils');
const {
  allItems,
  deleteItem,
  loadState,
  saveState,
  toPosixPath,
} = require('../lib/sync/state');

const SKIP_FILES = new Set(['_category_.json']);

/**
 * List items (files and folders) in a directory, excluding _category_.json.
 * Returns sorted array of { prefix, name, isDirectory }.
 */
function getItems(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const items = [];

  for (const entry of entries) {
    if (SKIP_FILES.has(entry.name)) continue;
    const match = entry.name.match(/^(\d+)/);
    if (match) {
      items.push({
        prefix: parseInt(match[1], 10),
        name: entry.name,
        isDirectory: entry.isDirectory(),
      });
    }
  }

  items.sort((a, b) => a.prefix - b.prefix);
  return items;
}

/**
 * Print items with type indicators.
 */
function printItems(items) {
  if (items.length === 0) {
    console.log('  (no items)\n');
    return;
  }
  console.log('Items:');
  for (const item of items) {
    const type = item.isDirectory ? '[subsection]' : '';
    console.log(`  ${pad(item.prefix)} - ${item.name} ${type}`);
  }
  console.log();
}

/**
 * Try to auto-detect the current module from the invocation directory.
 * Uses process.cwd() (where `npx course` runs) and falls back to INIT_CWD
 * (which npm sets when invoked via `npm run` scripts, where cwd is the
 * package root). Returns { modulePath, folderName } or null.
 */
function detectModule() {
  const courseDir = path.resolve(COURSE_DIR);
  const candidates = [process.cwd(), process.env.INIT_CWD].filter(Boolean);

  for (const candidate of candidates) {
    const detected = detectModuleFrom(path.resolve(candidate), courseDir);
    if (detected) return detected;
  }
  return null;
}

function detectModuleFrom(resolved, courseDir) {
  // Check if we're inside a module folder under course/
  if (!resolved.startsWith(courseDir + path.sep)) return null;

  const relative = resolved.slice(courseDir.length + 1);
  const moduleFolderName = relative.split(path.sep)[0];

  if (!moduleFolderName) return null;

  const modulePath = path.join(courseDir, moduleFolderName);
  if (!fs.existsSync(modulePath) || !fs.statSync(modulePath).isDirectory())
    return null;

  return { modulePath, folderName: moduleFolderName };
}

/**
 * Auto-detect or prompt for module selection.
 * Returns { modulePath, folderName }.
 */
async function selectModule(rl) {
  const detected = detectModule();
  if (detected) {
    console.log(`Auto-detected module: ${detected.folderName}\n`);
    return detected;
  }

  const modules = getExistingModules();
  if (modules.length === 0) {
    console.error('Error: No modules found.');
    process.exit(1);
  }

  if (modules.length === 1) {
    const mod = modules[0];
    console.log(`Auto-selected module: ${mod.folderName}\n`);
    return {
      modulePath: path.join(COURSE_DIR, mod.folderName),
      folderName: mod.folderName,
    };
  }

  printModules(modules);

  const moduleStr = await prompt(rl, 'Which module? (number)');
  const modulePrefix = parseInt(moduleStr, 10);
  const mod = modules.find((m) => m.prefix === modulePrefix);

  if (!mod) {
    console.error(`Error: No module found with number ${moduleStr}.`);
    process.exit(1);
  }

  return {
    modulePath: path.join(COURSE_DIR, mod.folderName),
    folderName: mod.folderName,
  };
}

/**
 * If the module has subsections, prompt user to choose module root or a subsection.
 * Returns the chosen directory path.
 */
async function selectTargetDir(rl, modulePath) {
  const items = getItems(modulePath);
  const subsections = items.filter((i) => i.isDirectory);

  if (subsections.length === 0) {
    return modulePath;
  }

  console.log('Target location:');
  console.log('  [0] Module root');
  for (let i = 0; i < subsections.length; i++) {
    console.log(`  [${i + 1}] ${subsections[i].name}`);
  }
  console.log();

  const choice = await prompt(rl, 'Where to add? (number)', '0');
  const idx = parseInt(choice, 10);

  if (idx === 0) return modulePath;
  if (idx >= 1 && idx <= subsections.length) {
    return path.join(modulePath, subsections[idx - 1].name);
  }

  console.error('Error: Invalid selection.');
  process.exit(1);
}

/**
 * Remove the sync-state row for an item that is about to be deleted.
 *
 * Must still be called BEFORE the file is removed, but no longer because the
 * frontmatter holds the identity: a directory is recognised by asking the
 * filesystem what it is, and every row underneath it goes. A single file needs
 * nothing from disk at all — its repo-relative path is the key.
 *
 * The module is not named either. A path is unique across the whole state, so
 * the row is found wherever it lives, which is also what makes this correct for
 * a file the author had already moved to another module by hand.
 *
 * @param {string} absItemPath - Absolute path of the file or directory.
 * @returns {string|null} The relative path removed, or null when nothing matched.
 */
function removeFromSyncState(absItemPath) {
  const state = loadState({ allowNull: true });
  if (!state || !state.modules) return null;

  const relativePath = toPosixPath(path.relative(COURSE_DIR, absItemPath));

  const isDirectory =
    fs.existsSync(absItemPath) && fs.statSync(absItemPath).isDirectory();
  const doomed = isDirectory
    ? allItems(state)
        .map((row) => row.itemPath)
        .filter((itemPath) => itemPath.startsWith(relativePath + '/'))
    : [relativePath];

  let removed = 0;
  for (const itemPath of doomed) {
    if (deleteItem(state, itemPath)) removed++;
  }

  if (removed === 0) return null;
  saveState(state);
  return relativePath;
}

module.exports = {
  getItems,
  printItems,
  detectModule,
  selectModule,
  selectTargetDir,
  removeFromSyncState,
};
