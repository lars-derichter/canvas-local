const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const {
  prompt,
  pad,
  toSlug,
  createRL,
  safeReadJSON,
} = require('./module-utils');
const {
  getItems,
  printItems,
  selectModule,
  selectTargetDir,
} = require('./item-utils');
const { recordRenames } = require('./sync-renames');
const { writeMarkdown } = require('../lib/convert/format-markdown');
const { serializeFrontmatter } = require('../lib/convert/frontmatter');

/**
 * Core rename: renames a file or subsection folder inside targetDir,
 * updating the frontmatter title (.md) or _category_.json label (folder).
 * Returns the new entry name.
 *
 * Async because rewriting the title re-serialises the whole file through
 * `writeMarkdown`, which formats it first — otherwise renaming an item is
 * enough on its own to leave the file in a shape `npm run format` disagrees
 * with.
 */
async function renameEntry(targetDir, entryName, newName) {
  const oldPath = path.join(targetDir, entryName);
  const isDirectory = fs.statSync(oldPath).isDirectory();
  const prefixMatch = entryName.match(/^(\d+)/);
  const prefix = prefixMatch ? parseInt(prefixMatch[1], 10) : 0;

  if (isDirectory) {
    // Subsection: rename folder and update _category_.json
    const newSlug = toSlug(newName);
    const newFolderName = `${pad(prefix)}-${newSlug}`;
    const newPath = path.join(targetDir, newFolderName);

    if (newFolderName !== entryName) {
      fs.renameSync(oldPath, newPath);
    }

    const catFile = path.join(newPath, '_category_.json');
    const cat = safeReadJSON(catFile);
    cat.label = newName;
    if (cat.position == null) cat.position = prefix;
    fs.writeFileSync(catFile, JSON.stringify(cat, null, 2) + '\n', 'utf8');

    return newFolderName;
  }

  // File: rename and update frontmatter title if markdown
  const ext = path.extname(entryName);
  const newSlug = toSlug(newName);
  const newFileName = `${pad(prefix)}-${newSlug}${ext}`;
  const newPath = path.join(targetDir, newFileName);

  if (ext === '.md') {
    // Update frontmatter title
    const raw = fs.readFileSync(oldPath, 'utf8');
    const parsed = matter(raw);
    parsed.data.title = newName;
    const updated = serializeFrontmatter(parsed.data, parsed.content);
    await writeMarkdown(oldPath, updated);
  }

  if (newFileName !== entryName) {
    fs.renameSync(oldPath, newPath);
  }

  return newFileName;
}

async function renameItem(options = {}) {
  // Non-interactive mode (VS Code): --path and --name provided
  if (options.path && options.name) {
    const itemPath = path.resolve(options.path);
    if (!fs.existsSync(itemPath)) {
      console.error(`[rename-item] Error: Not found: ${itemPath}`);
      process.exit(1);
    }
    const targetDir = path.dirname(itemPath);
    const oldEntryName = path.basename(itemPath);
    const newEntryName = await renameEntry(
      targetDir,
      oldEntryName,
      options.name,
    );
    recordRenames([
      {
        fromDir: targetDir,
        renames: [{ from: oldEntryName, to: newEntryName }],
      },
    ]);
    console.log(
      `[rename-item] Renamed ${path.basename(itemPath)} -> ${newEntryName}`,
    );
    return;
  }

  const rl = createRL({ command: 'rename-item', flags: '--path and --name' });

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
    console.error(
      `[rename-item] Error: No item found with number ${sourceStr}.`,
    );
    process.exit(1);
  }

  const newName = await prompt(rl, 'New name');
  rl.close();

  if (!newName) {
    console.error('[rename-item] Error: Name is required.');
    process.exit(1);
  }

  const newEntryName = await renameEntry(targetDir, item.name, newName);
  recordRenames([
    { fromDir: targetDir, renames: [{ from: item.name, to: newEntryName }] },
  ]);
  console.log(`[rename-item] Renamed ${item.name} -> ${newEntryName}`);
}

module.exports = renameItem;
module.exports._renameEntry = renameEntry;
