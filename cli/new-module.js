const fs = require('fs');
const path = require('path');
const {
  COURSE_DIR,
  prompt,
  getExistingModules,
  pad,
  toSlug,
  renameModule,
  createRL,
  printModules,
} = require('./module-utils');
const { recordRenames } = require('./sync-renames');

/**
 * Renumber modules at or above the given position by incrementing their prefix by 1.
 * Returns an array of { from, to } describing what was renamed.
 *
 * Records what it renamed, rather than handing the list back for the caller to
 * record the way `cli/renumber.js` does. Those helpers are composed by ten
 * commands that batch renames across two directories and record once at the
 * end; this one belongs to this command alone, so renaming and recording is a
 * single operation and cannot be half-used.
 *
 * Recording is not bookkeeping here. The sync state keys a module by its folder
 * name, and every item and embedded file inside it by a path that begins with
 * that name, so a folder renumbered without re-keying leaves rows addressing a
 * folder that is not there any more. Content survives it — hash-based rename
 * detection re-keys the items — but nothing detects a module: the shifted
 * folders read as new modules to create on Canvas, the pages are moved out of
 * the live Canvas modules they were in and into the new ones, and those live
 * modules are left orphaned for `--prune-canvas` to delete along with any
 * embedded file whose row moved with none of them.
 *
 * `COURSE_DIR` as `fromDir` is what picks `renameFolders` over `renamePaths`: a
 * module folder has a key of its own, and it has to move together with
 * everything filed under it.
 */
function renumberModulesUp(modules, fromPosition) {
  const toRenumber = modules
    .filter((m) => m.prefix >= fromPosition)
    .sort((a, b) => b.prefix - a.prefix); // rename highest first to avoid collisions

  const renamed = [];
  for (const mod of toRenumber) {
    const result = renameModule(mod.folderName, mod.prefix + 1);
    if (result) renamed.push(result);
  }

  recordRenames([{ fromDir: COURSE_DIR, renames: renamed }]);

  return renamed;
}

/**
 * Core creation shared by interactive and flag-driven paths.
 */
function createModuleFolder(modules, name, position) {
  // Renumber if there's a conflict
  const conflicting = modules.some((m) => m.prefix >= position);
  let renamed = [];
  if (conflicting) {
    renamed = renumberModulesUp(modules, position);
  }

  // Create the new module folder and _category_.json
  const slug = toSlug(name);
  const folderName = `${pad(position)}-${slug}`;
  const folderPath = path.join(COURSE_DIR, folderName);

  fs.mkdirSync(folderPath, { recursive: true });

  const category = {
    label: name,
    position,
  };
  fs.writeFileSync(
    path.join(folderPath, '_category_.json'),
    JSON.stringify(category, null, 2) + '\n',
    'utf8',
  );

  // Summary
  console.log(`\n[new-module] Created ${folderName}/`);
  if (renamed.length > 0) {
    console.log('[new-module] Renumbered existing modules:');
    for (const r of renamed) {
      console.log(`  ${r.from} -> ${r.to}`);
    }
  }
}

async function newModule(options = {}) {
  // Non-interactive mode (VS Code): --name provided
  if (options.name) {
    const modules = getExistingModules();
    const nextAvailable =
      modules.length > 0 ? modules[modules.length - 1].prefix + 1 : 1;
    const position = options.position
      ? parseInt(options.position, 10)
      : nextAvailable;
    if (isNaN(position) || position < 1 || position > 99) {
      console.error(
        '[new-module] Error: Position must be a number between 1 and 99.',
      );
      process.exit(1);
    }
    createModuleFolder(modules, options.name, position);
    return;
  }

  const rl = createRL({ command: 'new-module', flags: '--name' });

  console.log('[new-module] Create a new course module\n');

  const modules = getExistingModules();
  printModules(modules);

  let name;
  while (true) {
    name = await prompt(rl, 'Module name');
    if (name) break;
    console.log('  Module name is required. Please try again.');
  }

  const nextAvailable =
    modules.length > 0 ? modules[modules.length - 1].prefix + 1 : 1;

  let position;
  while (true) {
    const positionStr = await prompt(rl, 'Position number', pad(nextAvailable));
    position = parseInt(positionStr, 10);
    if (!isNaN(position) && position >= 1 && position <= 99) break;
    console.log(
      '  Position must be a number between 1 and 99. Please try again.',
    );
  }
  rl.close();

  createModuleFolder(modules, name, position);
}

module.exports = newModule;
