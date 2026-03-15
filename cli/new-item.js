const fs = require('fs');
const path = require('path');
const { prompt, pad, toSlug, createRL } = require('./module-utils');
const { getItems, printItems, selectModule, selectTargetDir } = require('./item-utils');
const { renumberUp } = require('./renumber');

const VALID_TYPES = ['page', 'assignment', 'url', 'subsection', 'file'];

function getNextPosition(items) {
  if (items.length === 0) return 1;
  return items[items.length - 1].prefix + 1;
}

async function newItem() {
  const rl = createRL();

  console.log('[new-item] Create a new item in a module\n');

  const { modulePath, folderName } = await selectModule(rl);
  const targetDir = await selectTargetDir(rl, modulePath);
  const items = getItems(targetDir);
  printItems(items);

  let type;
  while (true) {
    const typeInput = await prompt(rl, `Item type (${VALID_TYPES.join('/')})`);
    type = typeInput.toLowerCase();
    if (!VALID_TYPES.includes(type)) {
      console.log(`  Invalid type. Must be one of: ${VALID_TYPES.join(', ')}. Please try again.`);
      continue;
    }
    if (type === 'subsection' && targetDir !== modulePath) {
      console.log('  Subsections can only be created at module root level. Please choose another type.');
      continue;
    }
    break;
  }

  let createdName;

  if (type === 'file') {
    let filePath;
    while (true) {
      filePath = await prompt(rl, 'Path to file');
      if (filePath && fs.existsSync(filePath)) break;
      console.log('  File not found. Please try again.');
    }

    const positionStr = await prompt(rl, 'Position', pad(getNextPosition(items)));
    rl.close();
    const position = parseInt(positionStr, 10);

    // Renumber if conflict
    if (items.some((i) => i.prefix >= position)) {
      renumberUp(targetDir, items, position);
    }

    const originalName = path.basename(filePath);
    createdName = `${pad(position)}-${originalName}`;
    fs.copyFileSync(filePath, path.join(targetDir, createdName));
  } else if (type === 'subsection') {
    let name;
    while (true) {
      name = await prompt(rl, 'Subsection name');
      if (name) break;
      console.log('  Name is required. Please try again.');
    }

    const positionStr = await prompt(rl, 'Position', pad(getNextPosition(items)));
    rl.close();
    const position = parseInt(positionStr, 10);

    if (items.some((i) => i.prefix >= position)) {
      renumberUp(targetDir, items, position);
    }

    const slug = toSlug(name);
    createdName = `${pad(position)}-${slug}`;
    const subPath = path.join(targetDir, createdName);
    fs.mkdirSync(subPath, { recursive: true });
    fs.writeFileSync(
      path.join(subPath, '_category_.json'),
      JSON.stringify({ label: name, position }, null, 2) + '\n',
      'utf8'
    );
  } else {
    // page, assignment, url
    let name;
    while (true) {
      name = await prompt(rl, 'Item name');
      if (name) break;
      console.log('  Name is required. Please try again.');
    }

    let extraFrontmatter = '';

    if (type === 'assignment') {
      const points = await prompt(rl, 'Points possible', '100');
      extraFrontmatter = `points_possible: ${points}\nsubmission_types:\n  - online_upload\n`;
    } else if (type === 'url') {
      let url;
      while (true) {
        url = await prompt(rl, 'URL');
        if (!url) { console.log('  URL is required. Please try again.'); continue; }
        try { new URL(url); break; } catch (_) {
          console.log(`  "${url}" is not a valid URL. Please try again.`);
        }
      }
      extraFrontmatter = `external_url: ${url}\n`;
    }

    const positionStr = await prompt(rl, 'Position', pad(getNextPosition(items)));
    rl.close();
    const position = parseInt(positionStr, 10);

    if (items.some((i) => i.prefix >= position)) {
      renumberUp(targetDir, items, position);
    }

    const canvasType = type === 'url' ? 'external_url' : type;
    const slug = toSlug(name);
    createdName = `${pad(position)}-${slug}.md`;

    const content = [
      '---',
      `title: ${name}`,
      `canvas_type: ${canvasType}`,
      extraFrontmatter ? extraFrontmatter.trimEnd() : null,
      '---',
      '',
      `# ${name}`,
      '',
    ].filter((line) => line !== null).join('\n');

    fs.writeFileSync(path.join(targetDir, createdName), content, 'utf8');
  }

  console.log(`\n[new-item] Created ${createdName} in ${path.relative(process.cwd(), targetDir)}/`);
}

module.exports = newItem;
