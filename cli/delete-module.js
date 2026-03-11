const fs = require('fs');
const path = require('path');
const {
  COURSE_DIR,
  prompt,
  getExistingModules,
  pad,
  renameModule,
  createRL,
  printModules,
} = require('./module-utils');

async function deleteModule() {
  const rl = createRL();

  console.log('[delete-module] Delete a course module\n');

  const modules = getExistingModules();

  if (modules.length === 0) {
    rl.close();
    console.log('[delete-module] No modules found.');
    return;
  }

  printModules(modules);

  const sourceStr = await prompt(rl, 'Module to delete (number)');
  const sourcePrefix = parseInt(sourceStr, 10);
  const sourceModule = modules.find((m) => m.prefix === sourcePrefix);

  if (!sourceModule) {
    rl.close();
    console.error(`[delete-module] Error: No module found with number ${sourceStr}.`);
    process.exit(1);
  }

  const confirm = await prompt(rl, `Delete ${sourceModule.folderName} and all its contents? (y/N)`, 'N');
  rl.close();

  if (confirm.toLowerCase() !== 'y') {
    console.log('[delete-module] Cancelled.');
    return;
  }

  // Delete the folder
  const folderPath = path.join(COURSE_DIR, sourceModule.folderName);
  fs.rmSync(folderPath, { recursive: true });
  console.log(`[delete-module] Deleted ${sourceModule.folderName}/`);

  // Renumber remaining modules sequentially to close the gap
  const remaining = modules.filter((m) => m.prefix !== sourcePrefix);

  // Rename from highest to lowest first to avoid collisions for modules moving down,
  // then lowest to highest for modules moving up. Use temp names to be safe.
  const renames = [];
  const tempPrefix = '__delete_temp_';

  // First pass: rename to temp names
  for (let i = 0; i < remaining.length; i++) {
    const mod = remaining[i];
    const tempName = `${tempPrefix}${pad(i + 1)}-${mod.folderName.replace(/^\d+-/, '')}`;
    fs.renameSync(
      path.join(COURSE_DIR, mod.folderName),
      path.join(COURSE_DIR, tempName)
    );
    remaining[i] = { ...mod, _tempName: tempName };
  }

  // Second pass: rename from temp to final sequential names
  for (let i = 0; i < remaining.length; i++) {
    const mod = remaining[i];
    const newPrefix = i + 1;
    const newFolderName = mod.folderName.replace(/^\d+/, pad(newPrefix));
    const tempPath = path.join(COURSE_DIR, mod._tempName);
    const finalPath = path.join(COURSE_DIR, newFolderName);

    fs.renameSync(tempPath, finalPath);

    // Update _category_.json
    const categoryFile = path.join(finalPath, '_category_.json');
    if (fs.existsSync(categoryFile)) {
      const category = JSON.parse(fs.readFileSync(categoryFile, 'utf8'));
      category.position = newPrefix;
      fs.writeFileSync(categoryFile, JSON.stringify(category, null, 2) + '\n', 'utf8');
    }

    if (newFolderName !== mod.folderName) {
      renames.push({ from: mod.folderName, to: newFolderName });
    }
  }

  if (renames.length > 0) {
    console.log('[delete-module] Renumbered remaining modules:');
    for (const r of renames) {
      console.log(`  ${r.from} -> ${r.to}`);
    }
  }
}

module.exports = deleteModule;
