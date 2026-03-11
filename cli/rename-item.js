const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const { prompt, pad, toSlug, createRL } = require('./module-utils');
const { getItems, printItems, selectModule, selectTargetDir } = require('./item-utils');

async function renameItem() {
  const rl = createRL();

  console.log('[rename-item] Rename an item\n');

  const { modulePath } = await selectModule(rl);
  const targetDir = await selectTargetDir(rl, modulePath);
  const items = getItems(targetDir);

  if (items.length === 0) {
    rl.close();
    console.log('[rename-item] No items found.');
    return;
  }

  printItems(items);

  const sourceStr = await prompt(rl, 'Item to rename (number)');
  const sourcePrefix = parseInt(sourceStr, 10);
  const item = items.find((i) => i.prefix === sourcePrefix);

  if (!item) {
    rl.close();
    console.error(`[rename-item] Error: No item found with number ${sourceStr}.`);
    process.exit(1);
  }

  const newName = await prompt(rl, 'New name');
  rl.close();

  if (!newName) {
    console.error('[rename-item] Error: Name is required.');
    process.exit(1);
  }

  const oldPath = path.join(targetDir, item.name);

  if (item.isDirectory) {
    // Subsection: rename folder and update _category_.json
    const newSlug = toSlug(newName);
    const newFolderName = `${pad(sourcePrefix)}-${newSlug}`;
    const newPath = path.join(targetDir, newFolderName);

    if (newFolderName !== item.name) {
      fs.renameSync(oldPath, newPath);
    }

    const catFile = path.join(newPath, '_category_.json');
    if (fs.existsSync(catFile)) {
      const cat = JSON.parse(fs.readFileSync(catFile, 'utf8'));
      cat.label = newName;
      fs.writeFileSync(catFile, JSON.stringify(cat, null, 2) + '\n', 'utf8');
    } else {
      fs.writeFileSync(catFile, JSON.stringify({ label: newName, position: sourcePrefix }, null, 2) + '\n', 'utf8');
    }

    console.log(`[rename-item] Renamed ${item.name} -> ${newFolderName}`);
  } else {
    // File: rename and update frontmatter title if markdown
    const ext = path.extname(item.name);
    const newSlug = toSlug(newName);
    const newFileName = `${pad(sourcePrefix)}-${newSlug}${ext}`;
    const newPath = path.join(targetDir, newFileName);

    if (ext === '.md') {
      // Update frontmatter title
      const raw = fs.readFileSync(oldPath, 'utf8');
      const parsed = matter(raw);
      parsed.data.title = newName;
      const updated = matter.stringify(parsed.content, parsed.data);
      fs.writeFileSync(oldPath, updated, 'utf8');
    }

    if (newFileName !== item.name) {
      fs.renameSync(oldPath, newPath);
    }

    console.log(`[rename-item] Renamed ${item.name} -> ${newFileName}`);
  }
}

module.exports = renameItem;
