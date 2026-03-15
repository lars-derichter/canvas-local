const fs = require('fs');
const path = require('path');

const { listModules, listModuleItems } = require('../lib/canvas/modules');
const { getPage } = require('../lib/canvas/pages');
const { getAssignment } = require('../lib/canvas/assignments');
const { canvasItemToMarkdown } = require('../lib/convert/html-to-markdown');
const { buildLinkMap, resolveCanvasLink, buildFileMap } = require('../lib/convert/link-resolver');
const { downloadFile } = require('../lib/canvas/files');
const { SYNC_FILE, loadSyncFile, saveSyncFile } = require('./sync-utils');

const COURSE_DIR = path.resolve(process.cwd(), 'course');

/**
 * Create a numbered folder name from a module name and position.
 * "Introduction" at position 1 -> "01-introduction"
 */
function toFolderName(name, position) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const prefix = String(position).padStart(2, '0');
  return `${prefix}-${slug}`;
}

/**
 * Create a numbered file name from an item title and position.
 * "Welcome" at position 1 -> "01-welcome.md"
 */
function toFileName(title, position) {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const prefix = String(position).padStart(2, '0');
  return `${prefix}-${slug}.md`;
}

async function pull(options) {
  const courseId = process.env.CANVAS_COURSE_ID;
  if (!courseId) {
    console.error('[pull] Error: CANVAS_COURSE_ID is not set. Run "npx course init" first.');
    process.exit(1);
  }

  const force = options && options.force;
  const syncData = loadSyncFile();

  console.log(`[pull] Fetching modules for course ${courseId}...`);
  const modules = await listModules(courseId);

  if (!modules || modules.length === 0) {
    console.log('[pull] No modules found in Canvas course.');
    return;
  }

  console.log(`[pull] Found ${modules.length} module(s).\n`);

  // Initialize file tracking
  if (!syncData.files) syncData.files = {};

  // Build reverse link map for resolving Canvas internal links back to relative paths
  const { canvasToRelative } = buildLinkMap(syncData);

  // Build reverse file map for resolving Canvas file URLs back to local paths
  const { canvasToLocal } = buildFileMap(syncData);

  // Ensure course directory exists
  if (!fs.existsSync(COURSE_DIR)) {
    fs.mkdirSync(COURSE_DIR, { recursive: true });
  }

  const errors = [];
  const totalModules = modules.length;

  for (let mi = 0; mi < modules.length; mi++) {
    const mod = modules[mi];
    console.log(`[pull] Module ${mi + 1}/${totalModules}: ${mod.name}`);
    try {
      await pullModule(courseId, mod, syncData, force, canvasToRelative, canvasToLocal);
    } catch (err) {
      console.error(`[pull] Error pulling module "${mod.name}": ${err.message}`);
      errors.push({ module: mod.name, error: err.message });
    }
    // Save sync state after each module so progress is preserved on failure
    saveSyncFile(syncData);
  }

  // Update last_sync
  syncData.last_sync = new Date().toISOString();
  saveSyncFile(syncData);

  console.log(`\n[pull] Sync file updated: ${SYNC_FILE}`);

  if (errors.length > 0) {
    console.log(`\n[pull] Completed with ${errors.length} error(s):`);
    for (const e of errors) {
      console.log(`  - ${e.module}: ${e.error}`);
    }
  } else {
    console.log('[pull] Done.');
  }
}

async function pullModule(courseId, mod, syncData, force, canvasToRelative, canvasToLocal) {
  const position = mod.position || 0;
  const folderName = toFolderName(mod.name, position);
  const moduleDir = path.join(COURSE_DIR, folderName);

  console.log(`[pull] Module: ${mod.name} -> ${folderName}/`);

  if (!fs.existsSync(moduleDir)) {
    fs.mkdirSync(moduleDir, { recursive: true });
  }

  // Track module in sync data
  syncData.modules[folderName] = syncData.modules[folderName] || {};
  syncData.modules[folderName].canvas_module_id = mod.id;

  // Write _category_.json for the module folder
  const categoryData = {
    label: mod.name,
    position,
  };
  fs.writeFileSync(
    path.join(moduleDir, '_category_.json'),
    JSON.stringify(categoryData, null, 2) + '\n',
    'utf8'
  );

  // Fetch module items
  const items = await listModuleItems(courseId, mod.id);
  if (!items || items.length === 0) {
    console.log('  [pull] No items in this module.');
    return;
  }

  const totalItems = items.length;
  let itemPosition = 0;
  let currentSubfolder = null; // Track active subfolder for indented items

  for (let ii = 0; ii < items.length; ii++) {
    const item = items[ii];
    itemPosition++;
    console.log(`  [pull] Item ${ii + 1}/${totalItems}: ${item.title || item.type}`);

    if (item.type === 'SubHeader') {
      // Create a subfolder for this SubHeader
      const subfolderName = toFolderName(item.title, itemPosition);
      const subfolderDir = path.join(moduleDir, subfolderName);

      console.log(`  [pull] SubHeader: ${item.title} -> ${subfolderName}/`);

      if (!fs.existsSync(subfolderDir)) {
        fs.mkdirSync(subfolderDir, { recursive: true });
      }

      // Write _category_.json for the subfolder
      const categoryData = {
        label: item.title,
        position: itemPosition,
      };
      fs.writeFileSync(
        path.join(subfolderDir, '_category_.json'),
        JSON.stringify(categoryData, null, 2) + '\n',
        'utf8'
      );

      currentSubfolder = subfolderDir;
      continue;
    }

    // Items with indent > 0 go into the current subfolder
    const targetDir = (item.indent > 0 && currentSubfolder)
      ? currentSubfolder
      : moduleDir;

    // If indent is 0, we're no longer inside a subfolder
    if (item.indent === 0) {
      currentSubfolder = null;
    }

    try {
      await pullItem(courseId, item, targetDir, itemPosition, syncData, force, folderName, canvasToRelative, canvasToLocal);
    } catch (err) {
      console.error(`  [pull] Error pulling item "${item.title || 'unknown'}": ${err.message}`);
    }
  }
}

/**
 * Check if a local file has been modified since the last sync.
 * Returns true if the file exists and was modified after last_sync.
 */
function isLocallyModified(filePath, syncData) {
  if (!fs.existsSync(filePath)) return false;
  if (!syncData.last_sync) return false;

  const stat = fs.statSync(filePath);
  const lastSync = new Date(syncData.last_sync);
  return stat.mtime > lastSync;
}

async function pullItem(courseId, item, moduleDir, position, syncData, force, folderName, canvasToRelative, canvasToLocal) {
  const itemType = item.type;
  const title = item.title || 'Untitled';

  if (itemType === 'Page') {
    const pageUrl = item.page_url;
    if (!pageUrl) {
      console.log(`  [pull] Skipping page "${title}": no page_url`);
      return;
    }

    const fileName = toFileName(title, position);
    const filePath = path.join(moduleDir, fileName);

    if (!force && isLocallyModified(filePath, syncData)) {
      console.log(`    [pull] SKIPPED ${fileName} (locally modified since last sync, use --force to overwrite)`);
      return;
    }

    console.log(`  [pull] Fetching page: ${title}`);
    const page = await getPage(courseId, pageUrl);
    const relativePath = path.posix.join(folderName, path.relative(path.join(COURSE_DIR, folderName), path.join(moduleDir, fileName)).split(path.sep).join('/'));
    const linkResolver = (href) => resolveCanvasLink(href, relativePath, canvasToRelative);
    const fileResolver = await buildPullFileResolver(courseId, page.body || '', relativePath, folderName, syncData, canvasToLocal);
    const markdown = canvasItemToMarkdown(page, 'page', { linkResolver, fileResolver });
    fs.writeFileSync(filePath, markdown, 'utf8');
    console.log(`    [pull] Wrote ${fileName}`);
    return;
  }

  if (itemType === 'Assignment') {
    const contentId = item.content_id;
    if (!contentId) {
      console.log(`  [pull] Skipping assignment "${title}": no content_id`);
      return;
    }

    const fileName = toFileName(title, position);
    const filePath = path.join(moduleDir, fileName);

    if (!force && isLocallyModified(filePath, syncData)) {
      console.log(`    [pull] SKIPPED ${fileName} (locally modified since last sync, use --force to overwrite)`);
      return;
    }

    console.log(`  [pull] Fetching assignment: ${title}`);
    const assignment = await getAssignment(courseId, contentId);
    const relativePath = path.posix.join(folderName, path.relative(path.join(COURSE_DIR, folderName), path.join(moduleDir, fileName)).split(path.sep).join('/'));
    const linkResolver = (href) => resolveCanvasLink(href, relativePath, canvasToRelative);
    const fileResolver = await buildPullFileResolver(courseId, assignment.description || '', relativePath, folderName, syncData, canvasToLocal);
    const markdown = canvasItemToMarkdown(assignment, 'assignment', { linkResolver, fileResolver });
    fs.writeFileSync(filePath, markdown, 'utf8');
    console.log(`    [pull] Wrote ${fileName}`);
    return;
  }

  if (itemType === 'ExternalUrl') {
    const fileName = toFileName(title, position);
    const filePath = path.join(moduleDir, fileName);

    if (!force && isLocallyModified(filePath, syncData)) {
      console.log(`    [pull] SKIPPED ${fileName} (locally modified since last sync, use --force to overwrite)`);
      return;
    }

    console.log(`  [pull] Fetching external URL: ${title}`);
    const markdown = canvasItemToMarkdown(
      { title, external_url: item.external_url, id: item.id },
      'external_url'
    );
    fs.writeFileSync(filePath, markdown, 'utf8');
    console.log(`    [pull] Wrote ${fileName}`);
    return;
  }

  // File, Discussion, Quiz, ExternalTool, etc.
  console.log(`  [pull] Skipping unsupported item type "${itemType}": ${title}`);
}

/**
 * Scan HTML for Canvas file URLs, download files locally, and return a resolver callback.
 */
async function buildPullFileResolver(courseId, html, currentFilePath, folderName, syncData, canvasToLocal) {
  // Find all Canvas file references in the HTML
  const filePattern = /\/courses\/\d+\/files\/(\d+)/g;
  const fileIds = new Set();
  let match;
  while ((match = filePattern.exec(html)) !== null) {
    fileIds.add(match[1]);
  }

  if (fileIds.size === 0) return null;

  // Download files that aren't already tracked locally
  const filesDir = path.join(COURSE_DIR, folderName, '_files');
  for (const fileId of fileIds) {
    // Check if already in canvasToLocal map
    const canvasUrlPattern = `/courses/${courseId}/files/${fileId}/preview`;
    if (canvasToLocal.has(canvasUrlPattern)) {
      const localPath = canvasToLocal.get(canvasUrlPattern);
      if (fs.existsSync(path.resolve(COURSE_DIR, localPath))) continue;
    }

    try {
      // Get file metadata to determine filename
      const { get } = require('../lib/canvas/client');
      const fileMeta = await get(`/api/v1/files/${fileId}`);
      const fileName = fileMeta.display_name || `file-${fileId}`;
      const localRelPath = path.posix.join(folderName, '_files', fileName);
      const destPath = path.resolve(COURSE_DIR, localRelPath);

      // Download the file
      console.log(`    [pull] Downloading file: ${fileName}`);
      await downloadFile(fileId, destPath);

      // Track in sync data
      syncData.files[localRelPath] = {
        canvas_file_id: Number(fileId),
        canvas_url: canvasUrlPattern,
      };

      // Update the canvasToLocal map for immediate use
      canvasToLocal.set(canvasUrlPattern, localRelPath);
    } catch (err) {
      console.error(`    [pull] Error downloading file ${fileId}: ${err.message}`);
    }
  }

  // Return a resolver that converts Canvas file URLs to relative paths
  return (href) => {
    if (!href) return null;

    // Strip domain if present
    let urlPath = href;
    try {
      const url = new URL(href, 'https://placeholder.com');
      urlPath = url.pathname;
    } catch {
      // Already a path
    }

    // Try to match against known file URLs
    const fileMatch = urlPath.match(/\/courses\/\d+\/files\/(\d+)/);
    if (!fileMatch) return null;

    const fId = fileMatch[1];
    const pattern = `/courses/${courseId}/files/${fId}/preview`;
    const localPath = canvasToLocal.get(pattern);
    if (!localPath) return null;

    // Compute relative path from current file
    const currentDir = path.posix.dirname(currentFilePath);
    let relative = path.posix.relative(currentDir, localPath);
    if (!relative.startsWith('.') && !relative.startsWith('/')) {
      relative = './' + relative;
    }
    return relative;
  };
}

module.exports = pull;
