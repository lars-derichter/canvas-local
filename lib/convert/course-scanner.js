const fs = require('fs');
const path = require('path');
const log = require('../../cli/logger');
const { parseFrontmatter } = require('./frontmatter');

/**
 * Walk the course/ directory and produce a structured array of modules with
 * their items, suitable for syncing to Canvas.
 *
 * Conventions:
 *  - Folders directly under coursePath are modules.
 *  - Subfolders within a module become Canvas "SubHeader" items. A folder
 *    inside such a subfolder is one level too deep: it is skipped along with
 *    everything in it, and warned about by name.
 *  - Markdown files are module items; their canvas_type comes from frontmatter
 *    (defaults to 'page').
 *  - Non-markdown files are treated as canvas_type 'file'.
 *  - Numeric prefixes (00-99) on folders and files control ordering and are
 *    stripped to derive display titles.
 *  - Files and folders prefixed with `_` are internal (e.g. `_files/`,
 *    `_category_.json`) and are skipped — not synced to Canvas.
 *
 * @param {string} coursePath - Absolute path to the course/ directory.
 * @returns {Array<object>} Array of module descriptor objects.
 */
function scanCourse(coursePath) {
  const resolved = path.resolve(coursePath);
  const entries = fs.readdirSync(resolved, { withFileTypes: true });

  const modules = [];

  for (const entry of entries) {
    // Only directories at the top level are modules; underscore-prefixed
    // folders are internal (same convention as inside modules)
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('_')) continue;

    const folderName = entry.name;
    const modulePath = path.join(resolved, folderName);

    const module = {
      folderName,
      moduleName: readCategoryLabel(modulePath) || displayTitle(folderName),
      position: extractPosition(folderName),
      items: scanModuleItems(modulePath, folderName),
    };

    modules.push(module);
  }

  // Sort modules by position
  modules.sort((a, b) => a.position - b.position);

  return modules;
}

/**
 * Scan the contents of a single module folder, producing items and subheaders.
 */
function scanModuleItems(modulePath, moduleFolder) {
  const entries = fs.readdirSync(modulePath, { withFileTypes: true });
  const items = [];

  for (const entry of entries) {
    if (entry.name.startsWith('_')) continue;

    const fullPath = path.join(modulePath, entry.name);

    if (entry.isDirectory()) {
      // Subfolder becomes a SubHeader with nested items
      const subItems = scanSubfolderItems(fullPath, moduleFolder, entry.name);
      items.push({
        type: 'subheader',
        folderName: entry.name,
        title: readCategoryLabel(fullPath) || displayTitle(entry.name),
        position: extractPosition(entry.name),
        indent: 0,
        items: subItems,
      });
    } else if (entry.isFile()) {
      const item = buildFileItem(fullPath, entry.name, moduleFolder, null);
      if (item) items.push(item);
    }
  }

  // Sort by position
  items.sort((a, b) => a.position - b.position);

  return items;
}

/**
 * Scan files inside a subfolder (SubHeader). These items get indent: 1.
 *
 * A directory found here is a sub-subfolder, one level deeper than Canvas item
 * indent goes, so it is skipped along with everything in it. It is warned about
 * rather than dropped in silence: a whole folder of pages that never reached
 * Canvas and said nothing about it was the sharpest edge in the tool.
 * Underscore names are filtered out first, so `_files/` inside a subfolder
 * stays silent. That one is internal by design, not a mistake.
 *
 * The warning fires once per dropped folder per run: every module folder is
 * read once, every subfolder inside it is read once, and the walk stops here
 * instead of descending, so a deeper tree is announced by its topmost dropped
 * folder alone.
 */
function scanSubfolderItems(subfolderPath, moduleFolder, subfolderName) {
  const entries = fs.readdirSync(subfolderPath, { withFileTypes: true });
  const items = [];

  for (const entry of entries) {
    if (entry.name.startsWith('_')) continue;

    if (entry.isDirectory()) {
      log.warn(
        `[warn] Skipping ${moduleFolder}/${subfolderName}/${entry.name}/ and everything in it: a module takes one level of subfolders and this is one deeper. Move its files into ${moduleFolder}/${subfolderName}/, or make it a subfolder of ${moduleFolder}/.`,
      );
      continue;
    }

    if (!entry.isFile()) continue;

    const fullPath = path.join(subfolderPath, entry.name);
    const item = buildFileItem(
      fullPath,
      entry.name,
      moduleFolder,
      subfolderName,
    );
    if (item) {
      item.indent = 1;
      items.push(item);
    }
  }

  items.sort((a, b) => a.position - b.position);
  return items;
}

/**
 * Build a single item descriptor for a file.
 */
function buildFileItem(fullPath, fileName, moduleFolder, subfolderName) {
  const isMarkdown = fileName.endsWith('.md');

  let frontmatter = {};
  if (isMarkdown) {
    try {
      const raw = fs.readFileSync(fullPath, 'utf8');
      frontmatter = parseFrontmatter(raw).data;
    } catch (err) {
      log.warn(
        `[warn] Failed to parse frontmatter in ${fileName}: ${err.message}`,
      );
    }
  }

  const canvasType = isMarkdown ? frontmatter.canvas_type || 'page' : 'file';

  const relativePath = subfolderName
    ? path.join(moduleFolder, subfolderName, fileName)
    : path.join(moduleFolder, fileName);

  return {
    type: 'item',
    file: fileName,
    relativePath,
    title: frontmatter.title || displayTitle(fileName.replace(/\.md$/, '')),
    position: extractPosition(fileName),
    canvasType,
    indent: 0,
    frontmatter,
  };
}

/**
 * Read the `label` field from a folder's `_category_.json`, if present.
 * Returns null when the file is missing, unparseable, or has no label.
 */
function readCategoryLabel(folderPath) {
  const categoryFile = path.join(folderPath, '_category_.json');
  try {
    const raw = fs.readFileSync(categoryFile, 'utf8');
    const data = JSON.parse(raw);
    return typeof data.label === 'string' && data.label.length > 0
      ? data.label
      : null;
  } catch (err) {
    if (err.code !== 'ENOENT') {
      log.warn(`[warn] Failed to read ${categoryFile}: ${err.message}`);
    }
    return null;
  }
}

/**
 * Extract the numeric prefix from a name like "01-introduction" -> 1.
 * Returns 0 if there is no numeric prefix.
 */
function extractPosition(name) {
  const match = name.match(/^(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * Derive a human-readable display title from a filename or folder name.
 * Strips numeric prefix, replaces hyphens with spaces, and capitalises the
 * first word only.
 *
 * "01-welcome" -> "Welcome"
 * "02-getting-started" -> "Getting started"
 *
 * Sentence case rather than title case, because title case is a rule of one
 * language and this derivation runs on every course. Capitalising every word
 * of a Dutch or French folder name is wrong there, and it mangles a name that
 * is not a phrase at all ("15-e2e-sub" -> "E2e Sub"). Letters the author
 * already capitalised are left alone, so "01-rest-API" stays "Rest API". A
 * title that wants different capitalisation gets it from frontmatter `title:`
 * or from a `_category_.json` label, both of which win over this.
 */
function displayTitle(name) {
  // Strip numeric prefix (e.g. "01-" or "99-")
  const stripped = name.replace(/^\d+-/, '');
  // Replace hyphens and underscores with spaces
  const spaced = stripped.replace(/[-_]+/g, ' ').trim();
  // Sentence case: only the first character is raised
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Flatten a module's items list, expanding each subheader into the subheader
 * itself followed by its child items. Preserves order.
 *
 * @param {Array<object>} items - Items from a scanned module.
 * @returns {Array<object>} Flat list of items and subheaders.
 */
function flattenItems(items) {
  const result = [];
  for (const item of items) {
    if (item.type === 'subheader') {
      result.push(item);
      if (item.items) {
        for (const child of item.items) result.push(child);
      }
    } else {
      result.push(item);
    }
  }
  return result;
}

module.exports = {
  scanCourse,
  extractPosition,
  displayTitle,
  flattenItems,
};
