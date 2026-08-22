const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const { prompt, pad, toSlug, createRL } = require('./module-utils');
const {
  getItems,
  printItems,
  selectModule,
  selectTargetDir,
} = require('./item-utils');
const { renumberUp } = require('./renumber');
const { writeMarkdown } = require('../lib/convert/format-markdown');
const { recordRenames } = require('./sync-renames');

/**
 * Count the number of lines occupied by frontmatter in the raw file.
 * Returns 0 if there is no frontmatter.
 */
function _frontmatterLineCount(rawContent) {
  const lines = rawContent.split('\n');
  if (lines[0] !== '---') return 0;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') return i + 1; // include closing ---
  }
  return 0;
}

/**
 * Core split logic: split file at bodyLine, create new file after original.
 * Exported as _splitFile for testing.
 *
 * Async because both halves go out through `writeMarkdown`, which formats them
 * first. A split rewrites the file it splits, so leaving either half
 * unformatted would put an edit into the author's tree that their next
 * `npm run format` undoes.
 *
 * @param {string} filePath  - Absolute path to the file to split.
 * @param {number} bodyLine  - 1-based line number within the body to split at (lines 1..N stay in original).
 * @param {string} newTitle  - Title for the new (second) file.
 * @param {string} targetDir - Directory containing the file.
 */
async function _splitFile(filePath, bodyLine, newTitle, targetDir) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = matter(raw);

  const bodyLines = parsed.content.split('\n');
  // Remove leading empty line that gray-matter sometimes adds
  if (bodyLines[0] === '') bodyLines.shift();

  if (bodyLine < 1 || bodyLine >= bodyLines.length) {
    console.error(
      `[split-item] Error: Line number must be between 1 and ${bodyLines.length - 1}.`,
    );
    process.exit(1);
  }

  const firstPart = bodyLines.slice(0, bodyLine).join('\n');
  const secondPart = bodyLines.slice(bodyLine).join('\n');

  // Write first part back to original file
  const firstResult = matter.stringify('\n' + firstPart + '\n', parsed.data);
  await writeMarkdown(filePath, firstResult);
  console.log(
    `[split-item] Updated ${path.basename(filePath)} (lines 1-${bodyLine})`,
  );

  // Determine position for new file
  const fileName = path.basename(filePath);
  const prefixMatch = fileName.match(/^(\d+)/);
  const originalPrefix = prefixMatch ? parseInt(prefixMatch[1], 10) : 1;
  const newPosition = originalPrefix + 1;

  // Renumber items at newPosition and above to make room
  const items = getItems(targetDir);
  if (items.some((i) => i.prefix >= newPosition)) {
    const renames = renumberUp(targetDir, items, newPosition);
    recordRenames([{ fromDir: targetDir, renames }]);
    if (renames.length > 0) {
      console.log('[split-item] Renumbered items to make room:');
      for (const r of renames) {
        console.log(`  ${r.from} -> ${r.to}`);
      }
    }
  }

  // Create new file with second part. A `canvas_id` is only ever there because
  // an older version of this tool wrote one; the halves of a split must not
  // both claim the same Canvas object, so it does not travel to the new file.
  const newFrontmatter = { ...parsed.data, title: newTitle };
  delete newFrontmatter.canvas_id;
  const slug = toSlug(newTitle);
  const newFileName = `${pad(newPosition)}-${slug}.md`;
  const newFilePath = path.join(targetDir, newFileName);
  const secondResult = matter.stringify(
    '\n' + secondPart + '\n',
    newFrontmatter,
  );
  await writeMarkdown(newFilePath, secondResult);
  console.log(`[split-item] Created ${newFileName} (remaining lines)`);
}

async function splitItem(options) {
  const opts = options || {};

  // Non-interactive mode (VS Code): --file and --line provided
  if (opts.file && opts.line) {
    const filePath = path.resolve(opts.file);

    if (!fs.existsSync(filePath)) {
      console.error(`[split-item] Error: File not found: ${filePath}`);
      process.exit(1);
    }
    if (path.extname(filePath) !== '.md') {
      console.error('[split-item] Error: File must be a markdown (.md) file.');
      process.exit(1);
    }

    const rawLine = parseInt(opts.line, 10);
    if (isNaN(rawLine)) {
      console.error('[split-item] Error: --line must be a number.');
      process.exit(1);
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    const fmLines = _frontmatterLineCount(raw);

    if (rawLine <= fmLines) {
      console.error('[split-item] Error: Split line falls within frontmatter.');
      process.exit(1);
    }

    // _splitFile drops the blank line gray-matter leaves at the start of the
    // body, so when the raw file has one right after the frontmatter the
    // body-line numbering starts one line later.
    const lines = raw.split('\n');
    const blankAfterFm = fmLines > 0 && lines[fmLines] === '' ? 1 : 0;
    const bodyLine = rawLine - fmLines - blankAfterFm;
    if (bodyLine < 1) {
      console.error(
        '[split-item] Error: Split line falls before the body content.',
      );
      process.exit(1);
    }
    const targetDir = path.dirname(filePath);

    // Determine title
    const parsed = matter(raw);
    const originalTitle = parsed.data.title || path.basename(filePath, '.md');
    const newTitle = opts.title || `${originalTitle} (Part 2)`;

    await _splitFile(filePath, bodyLine, newTitle, targetDir);
    return;
  }

  // Interactive mode
  const rl = createRL({ command: 'split-item', flags: '--file and --line' });

  console.log('[split-item] Split an item into two files\n');

  const { modulePath } = await selectModule(rl);
  const targetDir = await selectTargetDir(rl, modulePath);
  const items = getItems(targetDir);

  if (items.length === 0) {
    rl.close();
    console.log('[split-item] No items found.');
    return;
  }

  printItems(items);

  const itemStr = await prompt(rl, 'Item to split (number)');
  const itemPrefix = parseInt(itemStr, 10);
  const item = items.find((i) => i.prefix === itemPrefix);

  if (!item) {
    rl.close();
    console.error(`[split-item] Error: No item found with number ${itemStr}.`);
    process.exit(1);
  }
  if (item.isDirectory || path.extname(item.name) !== '.md') {
    rl.close();
    console.error('[split-item] Error: Item must be a markdown (.md) file.');
    process.exit(1);
  }

  const filePath = path.join(targetDir, item.name);
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = matter(raw);
  const bodyLines = parsed.content.split('\n');
  // Remove leading empty line that gray-matter sometimes adds
  const displayLines = bodyLines[0] === '' ? bodyLines.slice(1) : bodyLines;

  console.log(
    `\nFile has ${displayLines.length} body lines (after frontmatter).\n`,
  );

  const lineStr = await prompt(rl, 'Split after line number (body line)');
  const bodyLine = parseInt(lineStr, 10);

  if (isNaN(bodyLine) || bodyLine < 1 || bodyLine >= displayLines.length) {
    rl.close();
    console.error(
      `[split-item] Error: Line number must be between 1 and ${displayLines.length - 1}.`,
    );
    process.exit(1);
  }

  const originalTitle = parsed.data.title || path.basename(item.name, '.md');
  const defaultTitle = `${originalTitle} (Part 2)`;
  const newTitle = await prompt(rl, 'Title for the new file', defaultTitle);
  rl.close();

  if (!newTitle) {
    console.error('[split-item] Error: Title is required.');
    process.exit(1);
  }

  await _splitFile(filePath, bodyLine, newTitle, targetDir);
}

module.exports = splitItem;
module.exports._splitFile = _splitFile;
module.exports._frontmatterLineCount = _frontmatterLineCount;
