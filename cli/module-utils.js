const fs = require('fs');
const path = require('path');
const readline = require('readline');

const COURSE_DIR = path.resolve(process.cwd(), 'course');

/**
 * Prompt the user for input with an optional default value.
 */
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
 * Pad a number to two digits: 1 -> "01", 12 -> "12".
 */
function pad(n) {
  return String(n).padStart(2, '0');
}

/**
 * Rename a module folder to use a new numeric prefix and update its _category_.json.
 * Returns { from, to } describing the rename, or null if no change was needed.
 */
function renameModule(folderName, newPrefix) {
  const newFolderName = folderName.replace(/^\d+/, pad(newPrefix));
  if (newFolderName === folderName) return null;

  const oldFolder = path.join(COURSE_DIR, folderName);
  const newFolder = path.join(COURSE_DIR, newFolderName);

  fs.renameSync(oldFolder, newFolder);

  // Update _category_.json if it exists
  const categoryFile = path.join(newFolder, '_category_.json');
  if (fs.existsSync(categoryFile)) {
    const category = JSON.parse(fs.readFileSync(categoryFile, 'utf8'));
    category.position = newPrefix;
    fs.writeFileSync(categoryFile, JSON.stringify(category, null, 2) + '\n', 'utf8');
  }

  return { from: folderName, to: newFolderName };
}

/**
 * Create a readline interface.
 */
function createRL() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

/**
 * Convert a name to a folder slug: lowercase, hyphenated.
 * "My New Module" -> "my-new-module"
 */
function toSlug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Print the list of existing modules.
 */
function printModules(modules) {
  if (modules.length === 0) return;
  console.log('Existing modules:');
  for (const m of modules) {
    console.log(`  ${pad(m.prefix)} - ${m.folderName}`);
  }
  console.log();
}

module.exports = {
  COURSE_DIR,
  prompt,
  getExistingModules,
  pad,
  toSlug,
  renameModule,
  createRL,
  printModules,
};
