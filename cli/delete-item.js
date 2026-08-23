const fs = require('fs');
const path = require('path');
const { prompt, createRL, COURSE_DIR } = require('./module-utils');
const {
  getItems,
  printItems,
  selectModule,
  selectTargetDir,
} = require('./item-utils');
const { renumberSequential } = require('./renumber');
const { recordRenames } = require('./sync-renames');

/**
 * Core delete: removes the entry and renumbers the remaining siblings.
 *
 * The sync row for what it deletes stays behind, on purpose. A base row is the
 * only thing that separates "the author deleted this" from "this tool has never
 * seen it": drop it and the live Canvas page pairs with no local file and no
 * base, which the planner reads as a page to write into `course/` — the next
 * sync restores the item the author just deleted. Drop it and `--prune-canvas`
 * has nothing to offer either, because a prune candidate *is* a base row. Left
 * where it is, the item is reported under `Orphaned on Canvas` and a prune can
 * reach it; when the Canvas object goes too, the planner drops the row itself.
 *
 * A directory is the same story, one level up: every row underneath it stays,
 * and each becomes an orphan of its own.
 */
function deleteEntry(targetDir, entryName) {
  const itemPath = path.join(targetDir, entryName);
  const isDirectory = fs.statSync(itemPath).isDirectory();

  if (isDirectory) {
    fs.rmSync(itemPath, { recursive: true });
  } else {
    fs.unlinkSync(itemPath);
  }
  console.log(`[delete-item] Deleted ${entryName}`);

  // Renumber remaining items
  const renames = renumberSequential(targetDir, getItems);
  recordRenames([{ fromDir: targetDir, renames }]);
  if (renames.length > 0) {
    console.log('[delete-item] Renumbered remaining items:');
    for (const r of renames) {
      console.log(`  ${r.from} -> ${r.to}`);
    }
  }
}

/**
 * Derive the module folder name from an absolute path inside course/.
 */
function moduleFolderOf(absPath) {
  const rel = path.relative(COURSE_DIR, absPath);
  if (rel.startsWith('..')) return null;
  return rel.split(path.sep)[0];
}

async function deleteItem(options = {}) {
  // Non-interactive mode (VS Code): --path provided; requires --yes since
  // there is no prompt to confirm.
  if (options.path) {
    if (!options.yes) {
      console.error(
        '[delete-item] Error: --path requires --yes to confirm deletion.',
      );
      process.exit(1);
    }
    const itemPath = path.resolve(options.path);
    if (!fs.existsSync(itemPath)) {
      console.error(`[delete-item] Error: Not found: ${itemPath}`);
      process.exit(1);
    }
    const folderName = moduleFolderOf(itemPath);
    if (!folderName) {
      console.error(
        '[delete-item] Error: Path is not inside the course/ directory.',
      );
      process.exit(1);
    }
    deleteEntry(path.dirname(itemPath), path.basename(itemPath));
    return;
  }

  const rl = createRL({ command: 'delete-item', flags: '--path and --yes' });

  console.log('[delete-item] Delete an item from a module\n');

  const { modulePath } = await selectModule(rl);
  const targetDir = await selectTargetDir(rl, modulePath);
  const items = getItems(targetDir);

  if (items.length === 0) {
    rl.close();
    console.log('[delete-item] No items found.');
    return;
  }

  printItems(items);

  const sourceStr = await prompt(rl, 'Item to delete (number)');
  const sourcePrefix = parseInt(sourceStr, 10);
  const item = items.find((i) => i.prefix === sourcePrefix);

  if (!item) {
    rl.close();
    console.error(
      `[delete-item] Error: No item found with number ${sourceStr}.`,
    );
    process.exit(1);
  }

  const label = item.isDirectory
    ? `${item.name}/ and all its contents`
    : item.name;
  const confirm = await prompt(rl, `Delete ${label}? (y/N)`, 'N');
  rl.close();

  if (confirm.toLowerCase() !== 'y') {
    console.log('[delete-item] Cancelled.');
    return;
  }

  deleteEntry(targetDir, item.name);
}

module.exports = deleteItem;
