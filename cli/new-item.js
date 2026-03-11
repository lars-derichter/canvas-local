const fs = require('fs');
const path = require('path');
const { prompt, pad, toSlug, createRL } = require('./module-utils');
const { getItems, printItems, selectModule, selectTargetDir } = require('./item-utils');

const VALID_TYPES = ['page', 'assignment', 'url', 'subsection', 'file'];

function getNextPosition(items) {
  if (items.length === 0) return 1;
  return items[items.length - 1].prefix + 1;
}

function renumberItemsUp(dirPath, items, fromPosition) {
  const toRenumber = items
    .filter((i) => i.prefix >= fromPosition)
    .sort((a, b) => b.prefix - a.prefix);

  const renamed = [];
  for (const item of toRenumber) {
    const newName = item.name.replace(/^\d+/, pad(item.prefix + 1));
    if (newName === item.name) continue;
    fs.renameSync(
      path.join(dirPath, item.name),
      path.join(dirPath, newName)
    );
    // Update _category_.json for subsections
    if (item.isDirectory) {
      const catFile = path.join(dirPath, newName, '_category_.json');
      if (fs.existsSync(catFile)) {
        const cat = JSON.parse(fs.readFileSync(catFile, 'utf8'));
        cat.position = item.prefix + 1;
        fs.writeFileSync(catFile, JSON.stringify(cat, null, 2) + '\n', 'utf8');
      }
    }
    renamed.push({ from: item.name, to: newName });
  }
  return renamed;
}

async function newItem() {
  const rl = createRL();

  console.log('[new-item] Create a new item in a module\n');

  const { modulePath, folderName } = await selectModule(rl);
  const targetDir = await selectTargetDir(rl, modulePath);
  const items = getItems(targetDir);
  printItems(items);

  const typeInput = await prompt(rl, `Item type (${VALID_TYPES.join('/')})`);
  const type = typeInput.toLowerCase();

  if (!VALID_TYPES.includes(type)) {
    rl.close();
    console.error(`[new-item] Error: Invalid type. Must be one of: ${VALID_TYPES.join(', ')}`);
    process.exit(1);
  }

  // Subsections only at module root
  if (type === 'subsection' && targetDir !== modulePath) {
    rl.close();
    console.error('[new-item] Error: Subsections can only be created at module root level.');
    process.exit(1);
  }

  let createdName;

  if (type === 'file') {
    const filePath = await prompt(rl, 'Path to file');
    if (!filePath || !fs.existsSync(filePath)) {
      rl.close();
      console.error('[new-item] Error: File not found.');
      process.exit(1);
    }

    const positionStr = await prompt(rl, 'Position', pad(getNextPosition(items)));
    rl.close();
    const position = parseInt(positionStr, 10);

    // Renumber if conflict
    if (items.some((i) => i.prefix >= position)) {
      renumberItemsUp(targetDir, items, position);
    }

    const originalName = path.basename(filePath);
    createdName = `${pad(position)}-${originalName}`;
    fs.copyFileSync(filePath, path.join(targetDir, createdName));
  } else if (type === 'subsection') {
    const name = await prompt(rl, 'Subsection name');
    if (!name) {
      rl.close();
      console.error('[new-item] Error: Name is required.');
      process.exit(1);
    }

    const positionStr = await prompt(rl, 'Position', pad(getNextPosition(items)));
    rl.close();
    const position = parseInt(positionStr, 10);

    if (items.some((i) => i.prefix >= position)) {
      renumberItemsUp(targetDir, items, position);
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
    const name = await prompt(rl, 'Item name');
    if (!name) {
      rl.close();
      console.error('[new-item] Error: Name is required.');
      process.exit(1);
    }

    let extraFrontmatter = '';

    if (type === 'assignment') {
      const points = await prompt(rl, 'Points possible', '100');
      extraFrontmatter = `points_possible: ${points}\nsubmission_types:\n  - online_upload\n`;
    } else if (type === 'url') {
      const url = await prompt(rl, 'URL');
      if (!url) {
        rl.close();
        console.error('[new-item] Error: URL is required.');
        process.exit(1);
      }
      extraFrontmatter = `external_url: ${url}\n`;
    }

    const positionStr = await prompt(rl, 'Position', pad(getNextPosition(items)));
    rl.close();
    const position = parseInt(positionStr, 10);

    if (items.some((i) => i.prefix >= position)) {
      renumberItemsUp(targetDir, items, position);
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
