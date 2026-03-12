const fs = require('fs');
const path = require('path');
const { parseFrontmatter } = require('./frontmatter');

// Files to skip when scanning
const SKIP_FILES = new Set(['_category_.json']);

/**
 * Walk the course/ directory and produce a structured array of modules with
 * their items, suitable for syncing to Canvas.
 *
 * Conventions:
 *  - Folders directly under coursePath are modules.
 *  - Subfolders within a module become Canvas "SubHeader" items.
 *  - Markdown files are module items; their canvas_type comes from frontmatter
 *    (defaults to 'page').
 *  - Non-markdown files are treated as canvas_type 'file'.
 *  - Numeric prefixes (00-99) on folders and files control ordering and are
 *    stripped to derive display titles.
 *
 * @param {string} coursePath - Absolute path to the course/ directory.
 * @returns {Array<object>} Array of module descriptor objects.
 */
function scanCourse(coursePath) {
  const resolved = path.resolve(coursePath);
  const entries = fs.readdirSync(resolved, { withFileTypes: true });

  const modules = [];

  for (const entry of entries) {
    // Only directories at the top level are modules
    if (!entry.isDirectory()) continue;

    const folderName = entry.name;
    const modulePath = path.join(resolved, folderName);

    const module = {
      folderName,
      moduleName: displayTitle(folderName),
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
    if (SKIP_FILES.has(entry.name)) continue;

    const fullPath = path.join(modulePath, entry.name);

    if (entry.isDirectory()) {
      // Subfolder becomes a SubHeader with nested items
      const subItems = scanSubfolderItems(fullPath, moduleFolder, entry.name);
      items.push({
        type: 'subheader',
        folderName: entry.name,
        title: displayTitle(entry.name),
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
 */
function scanSubfolderItems(subfolderPath, moduleFolder, subfolderName) {
  const entries = fs.readdirSync(subfolderPath, { withFileTypes: true });
  const items = [];

  for (const entry of entries) {
    if (SKIP_FILES.has(entry.name)) continue;
    if (!entry.isFile()) continue;

    const fullPath = path.join(subfolderPath, entry.name);
    const item = buildFileItem(fullPath, entry.name, moduleFolder, subfolderName);
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
      console.warn(`[warn] Failed to parse frontmatter in ${fileName}: ${err.message}`);
    }
  }

  const canvasType = isMarkdown
    ? (frontmatter.canvas_type || 'page')
    : 'file';

  const relativePath = subfolderName
    ? path.join(moduleFolder, subfolderName, fileName)
    : path.join(moduleFolder, fileName);

  return {
    type: 'item',
    file: fileName,
    relativePath,
    title: displayTitle(fileName.replace(/\.md$/, '')),
    position: extractPosition(fileName),
    canvasType,
    indent: 0,
    frontmatter,
  };
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
 * Strips numeric prefix, replaces hyphens with spaces, and title-cases.
 *
 * "01-welcome" -> "Welcome"
 * "02-getting-started" -> "Getting Started"
 */
function displayTitle(name) {
  // Strip numeric prefix (e.g. "01-" or "99-")
  const stripped = name.replace(/^\d+-/, '');
  // Replace hyphens and underscores with spaces
  const spaced = stripped.replace(/[-_]+/g, ' ').trim();
  // Title case
  return spaced.replace(/\b\w/g, (c) => c.toUpperCase());
}

module.exports = {
  scanCourse,
};
