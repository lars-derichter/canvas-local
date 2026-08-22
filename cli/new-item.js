const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const { prompt, pad, toSlug, createRL, COURSE_DIR } = require('./module-utils');
const {
  getItems,
  printItems,
  selectModule,
  selectTargetDir,
} = require('./item-utils');
const { renumberUp } = require('./renumber');
const { writeMarkdown } = require('../lib/convert/format-markdown');
const { recordRenames } = require('./sync-renames');

const VALID_TYPES = ['page', 'assignment', 'url', 'subsection', 'file'];

function getNextPosition(items) {
  if (items.length === 0) return 1;
  return items[items.length - 1].prefix + 1;
}

/**
 * Prompt for a position until the input is a number between 1 and 99.
 */
async function promptPosition(rl, items) {
  while (true) {
    const positionStr = await prompt(
      rl,
      'Position',
      pad(getNextPosition(items)),
    );
    const position = parseInt(positionStr, 10);
    if (!isNaN(position) && position >= 1 && position <= 99) return position;
    console.log(
      '  Position must be a number between 1 and 99. Please try again.',
    );
  }
}

/**
 * Create the item on disk. Shared by the interactive and flag-driven paths.
 * Returns the created entry name.
 *
 * Async because the markdown goes out through `writeMarkdown`, which formats it
 * first: a file this tool writes must be the file `npm run format` would leave,
 * or the author's very next format run shows up as an edit they did not make.
 */
async function createEntry(
  targetDir,
  type,
  { name, position, url, points, filePath },
) {
  const items = getItems(targetDir);
  if (items.some((i) => i.prefix >= position)) {
    recordRenames([
      { fromDir: targetDir, renames: renumberUp(targetDir, items, position) },
    ]);
  }

  if (type === 'file') {
    const originalName = path.basename(filePath);
    const createdName = `${pad(position)}-${originalName}`;
    fs.copyFileSync(filePath, path.join(targetDir, createdName));
    return createdName;
  }

  if (type === 'subsection') {
    const createdName = `${pad(position)}-${toSlug(name)}`;
    const subPath = path.join(targetDir, createdName);
    fs.mkdirSync(subPath, { recursive: true });
    fs.writeFileSync(
      path.join(subPath, '_category_.json'),
      JSON.stringify({ label: name, position }, null, 2) + '\n',
      'utf8',
    );
    return createdName;
  }

  const frontmatterData = { title: name };
  if (type === 'assignment') {
    frontmatterData.canvas_type = 'assignment';
    frontmatterData.points_possible = points != null ? points : 100;
    frontmatterData.submission_types = ['online_upload'];
  } else if (type === 'url') {
    frontmatterData.canvas_type = 'external_url';
    frontmatterData.external_url = url;
  } else {
    frontmatterData.canvas_type = 'page';
  }

  const createdName = `${pad(position)}-${toSlug(name)}.md`;
  // matter.stringify produces valid YAML for titles with colons, quotes, ...
  const content = matter.stringify(`\n# ${name}\n`, frontmatterData);
  await writeMarkdown(path.join(targetDir, createdName), content);
  return createdName;
}

async function newItem(options = {}) {
  // Non-interactive mode (VS Code): --module, --type, and --name/--file provided
  if (options.module && options.type) {
    const type = options.type.toLowerCase();
    if (!VALID_TYPES.includes(type)) {
      console.error(
        `[new-item] Error: Invalid type "${type}". Must be one of: ${VALID_TYPES.join(', ')}.`,
      );
      process.exit(1);
    }
    let targetDir = path.join(COURSE_DIR, options.module);
    if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
      console.error(`[new-item] Error: Module not found: ${options.module}`);
      process.exit(1);
    }
    if (options.subsection) {
      if (type === 'subsection') {
        console.error(
          '[new-item] Error: Subsections can only be created at module root level.',
        );
        process.exit(1);
      }
      targetDir = path.join(targetDir, options.subsection);
      if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
        console.error(
          `[new-item] Error: Subsection not found: ${options.subsection}`,
        );
        process.exit(1);
      }
    }

    let filePath = null;
    if (type === 'file') {
      if (!options.file || !fs.existsSync(options.file)) {
        console.error(
          '[new-item] Error: --file must point to an existing file.',
        );
        process.exit(1);
      }
      filePath = path.resolve(options.file);
    } else if (!options.name) {
      console.error('[new-item] Error: --name is required.');
      process.exit(1);
    }
    if (type === 'url') {
      try {
        new URL(options.url);
      } catch {
        console.error('[new-item] Error: --url must be a valid URL.');
        process.exit(1);
      }
    }

    const items = getItems(targetDir);
    const position = options.position
      ? parseInt(options.position, 10)
      : getNextPosition(items);
    if (isNaN(position) || position < 1 || position > 99) {
      console.error(
        '[new-item] Error: Position must be a number between 1 and 99.',
      );
      process.exit(1);
    }

    const createdName = await createEntry(targetDir, type, {
      name: options.name,
      position,
      url: options.url,
      points: options.points != null ? parseInt(options.points, 10) : undefined,
      filePath,
    });
    console.log(
      `\n[new-item] Created ${createdName} in ${path.relative(process.cwd(), targetDir)}/`,
    );
    return;
  }

  const rl = createRL({ command: 'new-item', flags: '--module and --type' });

  console.log('[new-item] Create a new item in a module\n');

  const { modulePath } = await selectModule(rl);
  const targetDir = await selectTargetDir(rl, modulePath);
  const items = getItems(targetDir);
  printItems(items);

  let type;
  while (true) {
    const typeInput = await prompt(rl, `Item type (${VALID_TYPES.join('/')})`);
    type = typeInput.toLowerCase();
    if (!VALID_TYPES.includes(type)) {
      console.log(
        `  Invalid type. Must be one of: ${VALID_TYPES.join(', ')}. Please try again.`,
      );
      continue;
    }
    if (type === 'subsection' && targetDir !== modulePath) {
      console.log(
        '  Subsections can only be created at module root level. Please choose another type.',
      );
      continue;
    }
    break;
  }

  let name = null;
  let url = null;
  let points = null;
  let filePath = null;

  if (type === 'file') {
    while (true) {
      filePath = await prompt(rl, 'Path to file');
      if (filePath && fs.existsSync(filePath)) break;
      console.log('  File not found. Please try again.');
    }
  } else {
    while (true) {
      name = await prompt(
        rl,
        type === 'subsection' ? 'Subsection name' : 'Item name',
      );
      if (name) break;
      console.log('  Name is required. Please try again.');
    }

    if (type === 'assignment') {
      const pointsStr = await prompt(rl, 'Points possible', '100');
      points = parseInt(pointsStr, 10) || 100;
    } else if (type === 'url') {
      while (true) {
        url = await prompt(rl, 'URL');
        if (!url) {
          console.log('  URL is required. Please try again.');
          continue;
        }
        try {
          new URL(url);
          break;
        } catch {
          console.log(`  "${url}" is not a valid URL. Please try again.`);
        }
      }
    }
  }

  const position = await promptPosition(rl, items);
  rl.close();

  const createdName = await createEntry(targetDir, type, {
    name,
    position,
    url,
    points,
    filePath,
  });

  console.log(
    `\n[new-item] Created ${createdName} in ${path.relative(process.cwd(), targetDir)}/`,
  );
}

module.exports = newItem;
module.exports._createEntry = createEntry;
module.exports._promptPosition = promptPosition;
