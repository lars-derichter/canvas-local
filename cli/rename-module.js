const fs = require('fs');
const path = require('path');
const {
  COURSE_DIR,
  prompt,
  getExistingModules,
  pad,
  toSlug,
  createRL,
  printModules,
  safeReadJSON,
} = require('./module-utils');

async function renameModule() {
  const rl = createRL();

  console.log('[rename-module] Rename a course module\n');

  const modules = getExistingModules();

  if (modules.length === 0) {
    rl.close();
    console.log('[rename-module] No modules found.');
    return;
  }

  printModules(modules);

  const sourceStr = await prompt(rl, 'Module to rename (number)');
  const sourcePrefix = parseInt(sourceStr, 10);
  const sourceModule = modules.find((m) => m.prefix === sourcePrefix);

  if (!sourceModule) {
    rl.close();
    console.error(`[rename-module] Error: No module found with number ${sourceStr}.`);
    process.exit(1);
  }

  const newName = await prompt(rl, 'New name');
  rl.close();

  if (!newName) {
    console.error('[rename-module] Error: Name is required.');
    process.exit(1);
  }

  const newSlug = toSlug(newName);
  const newFolderName = `${pad(sourcePrefix)}-${newSlug}`;
  const oldFolder = path.join(COURSE_DIR, sourceModule.folderName);
  const newFolder = path.join(COURSE_DIR, newFolderName);

  // Rename folder
  if (newFolderName !== sourceModule.folderName) {
    fs.renameSync(oldFolder, newFolder);
  }

  // Update _category_.json
  const categoryFile = path.join(newFolder, '_category_.json');
  if (fs.existsSync(categoryFile)) {
    const category = safeReadJSON(categoryFile);
    category.label = newName;
    fs.writeFileSync(categoryFile, JSON.stringify(category, null, 2) + '\n', 'utf8');
  } else {
    const category = { label: newName, position: sourcePrefix };
    fs.writeFileSync(categoryFile, JSON.stringify(category, null, 2) + '\n', 'utf8');
  }

  console.log(`[rename-module] Renamed ${sourceModule.folderName} -> ${newFolderName}`);
}

module.exports = renameModule;
