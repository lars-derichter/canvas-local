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

/**
 * Renumber modules at or above the given position by incrementing their prefix by 1.
 * Returns an array of { from, to } describing what was renamed.
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

  return renamed;
}

async function newModule() {
  const rl = createRL();

  console.log('[new-module] Create a new course module\n');

  const modules = getExistingModules();
  printModules(modules);

  let name;
  while (true) {
    name = await prompt(rl, 'Module name');
    if (name) break;
    console.log('  Module name is required. Please try again.');
  }

  const nextAvailable = modules.length > 0
    ? modules[modules.length - 1].prefix + 1
    : 1;

  let position;
  while (true) {
    const positionStr = await prompt(rl, 'Position number', pad(nextAvailable));
    position = parseInt(positionStr, 10);
    if (!isNaN(position) && position >= 1 && position <= 99) break;
    console.log('  Position must be a number between 1 and 99. Please try again.');
  }
  rl.close();

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
    'utf8'
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

module.exports = newModule;
