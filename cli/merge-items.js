const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const { prompt, createRL } = require('./module-utils');
const {
  getItems,
  printItems,
  selectModule,
  selectTargetDir,
  removeFromSyncState,
} = require('./item-utils');
const { renumberSequential } = require('./renumber');
const { writeMarkdown } = require('../lib/convert/format-markdown');
const { recordRenames } = require('./sync-renames');

/**
 * Core merge logic: append source body into target, delete source, renumber.
 * Exported as _mergeFiles for testing.
 *
 * Async because the merged file goes out through `writeMarkdown`, which formats
 * it first. Joining two bodies is exactly the moment stray blank lines and an
 * unwrapped paragraph appear, and leaving them would show up as an edit in the
 * author's next `npm run format`.
 *
 * @param {string} targetPath - Absolute path to the target file (keeps frontmatter).
 * @param {string} sourcePath - Absolute path to the source file (appended, then deleted).
 * @param {string} targetDir  - Directory containing both files.
 */
async function _mergeFiles(targetPath, sourcePath, targetDir) {
  const targetRaw = fs.readFileSync(targetPath, 'utf8');
  const sourceRaw = fs.readFileSync(sourcePath, 'utf8');

  const targetParsed = matter(targetRaw);
  const sourceParsed = matter(sourceRaw);

  // Combine bodies: target content + blank line + source content
  const targetContent = targetParsed.content.replace(/\n+$/, '');
  const sourceContent = sourceParsed.content.replace(/^\n+/, '');
  const merged = targetContent + '\n\n' + sourceContent;

  // Write merged content back to target (keeps target's frontmatter)
  const result = matter.stringify(merged, targetParsed.data);
  await writeMarkdown(targetPath, result);
  console.log(`[merge-items] Merged content into ${path.basename(targetPath)}`);

  // The source file is about to go, and so is the row keyed by its path.
  const removed = removeFromSyncState(sourcePath);
  if (removed) {
    console.log(`[merge-items] Removed ${removed} from sync state.`);
  }

  // Delete source file
  fs.unlinkSync(sourcePath);
  console.log(`[merge-items] Deleted ${path.basename(sourcePath)}`);

  // Renumber remaining items
  const renames = renumberSequential(targetDir, getItems);
  recordRenames([{ fromDir: targetDir, renames }]);
  if (renames.length > 0) {
    console.log('[merge-items] Renumbered remaining items:');
    for (const r of renames) {
      console.log(`  ${r.from} -> ${r.to}`);
    }
  }
}

async function mergeItems(options) {
  const opts = options || {};

  // Non-interactive mode (VS Code): --source and --target provided
  if (opts.source && opts.target) {
    const sourcePath = path.resolve(opts.source);
    const targetPath = path.resolve(opts.target);

    if (!fs.existsSync(sourcePath)) {
      console.error(
        `[merge-items] Error: Source file not found: ${sourcePath}`,
      );
      process.exit(1);
    }
    if (!fs.existsSync(targetPath)) {
      console.error(
        `[merge-items] Error: Target file not found: ${targetPath}`,
      );
      process.exit(1);
    }
    if (sourcePath === targetPath) {
      console.error(
        '[merge-items] Error: Source and target must be different files.',
      );
      process.exit(1);
    }
    if (
      path.extname(sourcePath) !== '.md' ||
      path.extname(targetPath) !== '.md'
    ) {
      console.error(
        '[merge-items] Error: Both files must be markdown (.md) files.',
      );
      process.exit(1);
    }

    const targetDir = path.dirname(targetPath);
    await _mergeFiles(targetPath, sourcePath, targetDir);
    return;
  }

  // Interactive mode
  const rl = createRL({
    command: 'merge-items',
    flags: '--source and --target',
  });

  console.log('[merge-items] Merge two items in a module\n');

  const { modulePath } = await selectModule(rl);
  const targetDir = await selectTargetDir(rl, modulePath);
  const items = getItems(targetDir);

  if (items.length < 2) {
    rl.close();
    console.log('[merge-items] Need at least two items to merge.');
    return;
  }

  printItems(items);

  const targetStr = await prompt(
    rl,
    'Target item (keeps frontmatter, receives content) (number)',
  );
  const targetPrefix = parseInt(targetStr, 10);
  const targetItem = items.find((i) => i.prefix === targetPrefix);

  if (!targetItem) {
    rl.close();
    console.error(
      `[merge-items] Error: No item found with number ${targetStr}.`,
    );
    process.exit(1);
  }
  if (targetItem.isDirectory || path.extname(targetItem.name) !== '.md') {
    rl.close();
    console.error('[merge-items] Error: Target must be a markdown (.md) file.');
    process.exit(1);
  }

  const sourceStr = await prompt(
    rl,
    'Source item (content appended, then deleted) (number)',
  );
  const sourcePrefix = parseInt(sourceStr, 10);
  const sourceItem = items.find((i) => i.prefix === sourcePrefix);

  if (!sourceItem) {
    rl.close();
    console.error(
      `[merge-items] Error: No item found with number ${sourceStr}.`,
    );
    process.exit(1);
  }
  if (sourceItem.isDirectory || path.extname(sourceItem.name) !== '.md') {
    rl.close();
    console.error('[merge-items] Error: Source must be a markdown (.md) file.');
    process.exit(1);
  }
  if (sourcePrefix === targetPrefix) {
    rl.close();
    console.error(
      '[merge-items] Error: Source and target must be different items.',
    );
    process.exit(1);
  }

  const confirm = await prompt(
    rl,
    `Merge ${sourceItem.name} into ${targetItem.name}? (y/N)`,
    'N',
  );
  rl.close();

  if (confirm.toLowerCase() !== 'y') {
    console.log('[merge-items] Cancelled.');
    return;
  }

  const targetPath = path.join(targetDir, targetItem.name);
  const sourcePath = path.join(targetDir, sourceItem.name);

  await _mergeFiles(targetPath, sourcePath, targetDir);
}

module.exports = mergeItems;
module.exports._mergeFiles = _mergeFiles;
