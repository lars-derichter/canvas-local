const fs = require('fs');
const path = require('path');
const readline = require('readline');

const COURSE_DIR = path.resolve(process.cwd(), 'course');

function prompt(rl, question, defaultValue) {
  const suffix = defaultValue ? ` (${defaultValue})` : '';
  return new Promise((resolve) => {
    rl.question(`${question}${suffix}: `, (answer) => {
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

/**
 * Read existing module folders and return sorted array of { prefix, folderName }.
 */
function getExistingModules() {
  const entries = fs.readdirSync(COURSE_DIR, { withFileTypes: true });
  const modules = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const match = entry.name.match(/^(\d+)/);
    if (match) {
      modules.push({ prefix: parseInt(match[1], 10), folderName: entry.name });
    }
  }

  modules.sort((a, b) => a.prefix - b.prefix);
  return modules;
}

/**
 * Convert a module name to a folder slug: lowercase, hyphenated.
 * "My New Module" -> "my-new-module"
 */
function toSlug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Pad a number to two digits: 1 -> "01", 12 -> "12".
 */
function pad(n) {
  return String(n).padStart(2, '0');
}

/**
 * Renumber modules at or above the given position by incrementing their prefix by 1.
 * Returns an array of { from, to } describing what was renamed.
 */
function renumberModules(modules, fromPosition) {
  const toRenumber = modules
    .filter((m) => m.prefix >= fromPosition)
    .sort((a, b) => b.prefix - a.prefix); // rename highest first to avoid collisions

  const renamed = [];

  for (const mod of toRenumber) {
    const newPrefix = mod.prefix + 1;
    const oldFolder = path.join(COURSE_DIR, mod.folderName);
    const newFolderName = mod.folderName.replace(/^\d+/, pad(newPrefix));
    const newFolder = path.join(COURSE_DIR, newFolderName);

    fs.renameSync(oldFolder, newFolder);

    // Update _category_.json if it exists
    const categoryFile = path.join(newFolder, '_category_.json');
    if (fs.existsSync(categoryFile)) {
      const category = JSON.parse(fs.readFileSync(categoryFile, 'utf8'));
      category.position = newPrefix;
      fs.writeFileSync(categoryFile, JSON.stringify(category, null, 2) + '\n', 'utf8');
    }

    renamed.push({ from: mod.folderName, to: newFolderName });
  }

  return renamed;
}

async function newModule() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('[new-module] Create a new course module\n');

  const modules = getExistingModules();

  if (modules.length > 0) {
    console.log('Existing modules:');
    for (const m of modules) {
      console.log(`  ${pad(m.prefix)} - ${m.folderName}`);
    }
    console.log();
  }

  const name = await prompt(rl, 'Module name');
  if (!name) {
    rl.close();
    console.error('[new-module] Error: Module name is required.');
    process.exit(1);
  }

  const nextAvailable = modules.length > 0
    ? modules[modules.length - 1].prefix + 1
    : 1;

  const positionStr = await prompt(rl, 'Position number', pad(nextAvailable));
  rl.close();

  const position = parseInt(positionStr, 10);
  if (isNaN(position) || position < 0 || position > 99) {
    console.error('[new-module] Error: Position must be a number between 0 and 99.');
    process.exit(1);
  }

  // Renumber if there's a conflict
  const conflicting = modules.some((m) => m.prefix >= position);
  let renamed = [];
  if (conflicting) {
    renamed = renumberModules(modules, position);
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
