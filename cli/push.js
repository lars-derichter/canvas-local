const fs = require('fs');
const path = require('path');
const readline = require('readline');

const { scanCourse } = require('../lib/convert/course-scanner');
const { parseFrontmatter, updateFrontmatter } = require('../lib/convert/frontmatter');
const { markdownToHtml } = require('../lib/convert/markdown-to-html');
const { createModule, updateModule, createModuleItem, deleteModule: deleteCanvasModule, listModuleItems, deleteModuleItem } = require('../lib/canvas/modules');
const { createPage, updatePage } = require('../lib/canvas/pages');
const { createAssignment, updateAssignment } = require('../lib/canvas/assignments');
const { uploadFile } = require('../lib/canvas/files');
const { ensureIcons, getIconUrls } = require('../lib/canvas/icons');
const { buildLinkMap, resolveRelativeLink, extractFileReferences } = require('../lib/convert/link-resolver');
const { SYNC_FILE, loadSyncFile, saveSyncFile } = require('./sync-utils');
const log = require('./logger');

const COURSE_DIR = path.resolve(process.cwd(), 'course');

async function push(options) {
  const courseId = process.env.CANVAS_COURSE_ID;
  if (!courseId) {
    console.error('[push] Error: CANVAS_COURSE_ID is not set. Run "npx course init" first.');
    process.exit(1);
  }

  const dryRun = options.dryRun || false;
  const moduleFilter = options.module || null;
  const prune = options.prune || false;

  const syncData = loadSyncFile();
  const modules = scanCourse(COURSE_DIR);

  if (modules.length === 0) {
    console.log('[push] No modules found in course/ directory.');
    return;
  }

  const filteredModules = moduleFilter
    ? modules.filter((m) => m.folderName === moduleFilter)
    : modules;

  if (moduleFilter && filteredModules.length === 0) {
    console.error(`[push] Error: Module "${moduleFilter}" not found in course/ directory.`);
    process.exit(1);
  }

  console.log(`[push] Found ${filteredModules.length} module(s) to push.`);
  if (dryRun) console.log('[push] DRY RUN - no changes will be made.\n');

  // Ensure admonition icons are uploaded to Canvas
  if (!dryRun) {
    await ensureIcons(courseId, syncData);
    saveSyncFile(syncData);
  }
  const iconUrls = getIconUrls(syncData);

  // Initialize file tracking
  if (!syncData.files) syncData.files = {};

  // Pre-populate sync items from frontmatter so the link map is available
  // even if .canvas-sync.json items were empty (e.g. after reset or first use)
  for (const mod of modules) {
    if (!syncData.modules[mod.folderName]) {
      syncData.modules[mod.folderName] = { items: {} };
    }
    if (!syncData.modules[mod.folderName].items) {
      syncData.modules[mod.folderName].items = {};
    }
    const allItems = flattenItems(mod.items);
    for (const item of allItems) {
      if (item.relativePath && item.frontmatter && item.frontmatter.canvas_id) {
        const existing = syncData.modules[mod.folderName].items[item.relativePath];
        if (!existing) {
          syncData.modules[mod.folderName].items[item.relativePath] = {
            canvas_id: item.frontmatter.canvas_id,
            canvas_type: item.canvasType || 'page',
          };
        }
      }
    }
  }

  // Build link map from sync state for resolving internal links
  let { relativeToCanvas } = buildLinkMap(syncData);

  // Track items that had unresolved internal links for a second pass
  const unresolvedItems = [];

  const errors = [];
  const totalModules = filteredModules.length;

  for (let mi = 0; mi < filteredModules.length; mi++) {
    const mod = filteredModules[mi];
    console.log(`\n[push] Module ${mi + 1}/${totalModules}: ${mod.moduleName}`);
    try {
      await pushModule(courseId, mod, syncData, dryRun, iconUrls, relativeToCanvas, unresolvedItems);
    } catch (err) {
      console.error(`[push] Error pushing module "${mod.moduleName}": ${err.message}`);
      errors.push({ module: mod.moduleName, error: err.message });
    }
    // Save sync state after each module so progress is preserved on failure
    if (!dryRun) {
      saveSyncFile(syncData);
    }
  }

  // Report unresolved links in dry-run mode
  if (unresolvedItems.length > 0 && dryRun) {
    console.log(`\n[push] ${unresolvedItems.length} item(s) have unresolved internal links (will be resolved in a second pass during actual push):`);
    for (const { relativePath } of unresolvedItems) {
      console.log(`  - ${relativePath}`);
    }
  }

  // Second pass: re-push items that had unresolved internal links
  if (unresolvedItems.length > 0 && !dryRun) {
    console.log(`\n[push] Resolving internal links for ${unresolvedItems.length} item(s) that referenced newly-created pages...`);
    ({ relativeToCanvas } = buildLinkMap(syncData));

    for (const { courseId: cId, relativePath, filePath, canvasId, canvasType, iconUrls: iu } of unresolvedItems) {
      try {
        const linkResolver = (href) => {
          const { resolved } = resolveRelativeLink(href, relativePath, relativeToCanvas, cId);
          return resolved;
        };
        const fileResolver = buildFileResolver(relativePath, syncData);
        const raw = fs.readFileSync(filePath, 'utf8');
        const html = markdownToHtml(raw, { iconUrls: iu, linkResolver, fileResolver });

        if (canvasType === 'page') {
          await updatePage(cId, canvasId, { body: html });
        } else if (canvasType === 'assignment') {
          await updateAssignment(cId, canvasId, { description: html });
        }
        console.log(`  [push] Updated links in: ${relativePath}`);
      } catch (err) {
        console.error(`  [push] Error updating links in "${relativePath}": ${err.message}`);
        errors.push({ module: relativePath, error: err.message });
      }
    }
  }

  // Prune: remove Canvas modules that no longer exist locally
  if (prune && !moduleFilter) {
    await pruneDeletedModules(courseId, syncData, modules, dryRun, errors);
  }

  // Update last_sync timestamp
  syncData.last_sync = new Date().toISOString();

  if (!dryRun) {
    saveSyncFile(syncData);
    console.log(`\n[push] Sync file updated: ${SYNC_FILE}`);
  }

  if (errors.length > 0) {
    console.log(`\n[push] Completed with ${errors.length} error(s):`);
    for (const e of errors) {
      console.log(`  - ${e.module}: ${e.error}`);
    }
  } else {
    console.log('[push] Done.');
  }
}

async function pushModule(courseId, mod, syncData, dryRun, iconUrls, relativeToCanvas, unresolvedItems) {
  const syncModule = syncData.modules[mod.folderName] || {};
  const canvasModuleId = syncModule.canvas_module_id;

  let moduleId;

  if (canvasModuleId) {
    console.log(`[push] Updating module: ${mod.moduleName} (id: ${canvasModuleId})`);
    if (!dryRun) {
      try {
        const result = await updateModule(courseId, canvasModuleId, {
          name: mod.moduleName,
          position: mod.position,
        });
        moduleId = result.id;
      } catch (err) {
        if (err.message.includes('404')) {
          console.warn(`[push] Module ${canvasModuleId} not found on Canvas, creating new`);
        } else {
          throw err;
        }
      }
    } else {
      moduleId = canvasModuleId;
    }
  }

  if (!moduleId && !dryRun) {
    console.log(`[push] Creating module: ${mod.moduleName}`);
    const result = await createModule(courseId, {
      name: mod.moduleName,
      position: mod.position,
    });
    moduleId = result.id;
  } else if (!moduleId) {
    moduleId = '<new>';
  }

  // Save module ID and initialize items tracking
  if (!dryRun) {
    syncData.modules[mod.folderName] = syncData.modules[mod.folderName] || {};
    syncData.modules[mod.folderName].canvas_module_id = moduleId;
    syncData.modules[mod.folderName].items = syncData.modules[mod.folderName].items || {};
  }

  // Upload embedded files (images, etc.) referenced from markdown content
  const flatItems = flattenItems(mod.items);
  const referencedFiles = new Set();

  if (!dryRun) {
    for (const item of flatItems) {
      if (!item.relativePath || !item.relativePath.endsWith('.md')) continue;
      const filePath = path.resolve(COURSE_DIR, item.relativePath);
      try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const refs = extractFileReferences(raw, item.relativePath);
        for (const ref of refs) referencedFiles.add(ref);
      } catch (_) {
        // File may not exist yet during dry run
      }
    }

    for (const ref of referencedFiles) {
      const localPath = path.resolve(COURSE_DIR, ref);
      if (!fs.existsSync(localPath)) {
        console.warn(`  [push] WARNING: Referenced file not found: ${ref}`);
        continue;
      }
      if (syncData.files[ref]) continue; // Already uploaded

      log.verbose(`Uploading embedded file: ${ref}`);
      try {
        const result = await uploadFile(courseId, localPath, { parentFolderPath: mod.folderName });
        syncData.files[ref] = {
          canvas_file_id: result.id,
          canvas_url: `/courses/${courseId}/files/${result.id}/preview`,
        };
      } catch (err) {
        console.error(`  [push] Error uploading file "${ref}": ${err.message}`);
      }
    }
  }

  // Process items (including subheader items)
  const totalItems = flatItems.length;

  for (let ii = 0; ii < flatItems.length; ii++) {
    const item = flatItems[ii];
    const itemTitle = item.title || item.file || 'unknown';
    log.verbose(`Item ${ii + 1}/${totalItems}: ${itemTitle}`);
    try {
      await pushItem(courseId, moduleId, item, dryRun, iconUrls, mod.folderName, relativeToCanvas, unresolvedItems, syncData);
      // Track item in sync file
      if (!dryRun && item.relativePath && item.frontmatter && item.frontmatter.canvas_id) {
        const itemSync = {
          canvas_id: item.frontmatter.canvas_id,
          canvas_type: item.canvasType || 'page',
        };
        // Store page slug for link resolution (pages use slugs in URLs, not numeric IDs)
        if (item._pageUrl) {
          itemSync.page_url = item._pageUrl;
        }
        syncData.modules[mod.folderName].items[item.relativePath] = itemSync;
      }
    } catch (err) {
      console.error(`  [push] Error pushing item "${itemTitle}": ${err.message}`);
    }
  }
}

/**
 * Flatten items list, inserting SubHeader entries and their nested items.
 */
function flattenItems(items) {
  const result = [];
  for (const item of items) {
    if (item.type === 'subheader') {
      // Add the subheader itself as a module item
      result.push({
        type: 'subheader',
        title: item.title,
        position: item.position,
        indent: item.indent,
      });
      // Then add its child items
      if (item.items) {
        for (const child of item.items) {
          result.push(child);
        }
      }
    } else {
      result.push(item);
    }
  }
  // Reassign sequential positions so subfolder children get correct
  // absolute positions instead of their within-folder positions.
  for (let i = 0; i < result.length; i++) {
    result[i].position = i + 1;
  }
  return result;
}

async function pushItem(courseId, moduleId, item, dryRun, iconUrls, folderName, relativeToCanvas, unresolvedItems, syncData) {
  if (item.type === 'subheader') {
    log.verbose(`Adding SubHeader: ${item.title}`);
    if (!dryRun) {
      await createModuleItem(courseId, moduleId, {
        title: item.title,
        type: 'SubHeader',
        position: item.position,
        indent: item.indent,
      });
    }
    return;
  }

  const { canvasType, title, frontmatter, relativePath, position, indent } = item;
  const filePath = path.resolve(COURSE_DIR, relativePath);
  const canvasId = frontmatter.canvas_id || null;

  if (canvasType === 'page') {
    const pageUrl = await pushPage(courseId, moduleId, { title, filePath, relativePath, canvasId, position, indent, frontmatter }, dryRun, iconUrls, relativeToCanvas, unresolvedItems, syncData);
    if (pageUrl) item._pageUrl = pageUrl;
  } else if (canvasType === 'assignment') {
    await pushAssignment(courseId, moduleId, { title, filePath, relativePath, canvasId, position, indent, frontmatter }, dryRun, iconUrls, relativeToCanvas, unresolvedItems, syncData);
  } else if (canvasType === 'external_url') {
    await pushExternalUrl(courseId, moduleId, { title, position, indent, frontmatter }, dryRun);
  } else if (canvasType === 'file') {
    await pushFile(courseId, moduleId, { title, filePath, position, indent, folderName }, dryRun);
  } else {
    log.warn(`  [push] Skipping unknown type "${canvasType}": ${title}`);
  }
}

async function pushPage(courseId, moduleId, { title, filePath, relativePath, canvasId, position, indent, frontmatter }, dryRun, iconUrls, relativeToCanvas, unresolvedItems, syncData) {
  const raw = fs.readFileSync(filePath, 'utf8');

  // Create link resolver that tracks unresolved internal links
  let hasUnresolved = false;
  const linkResolver = (href) => {
    const { resolved, wasInternal } = resolveRelativeLink(href, relativePath, relativeToCanvas, courseId);
    if (wasInternal) hasUnresolved = true;
    return resolved;
  };

  // Create file resolver for images and non-.md file references
  const fileResolver = buildFileResolver(relativePath, syncData);

  const html = markdownToHtml(raw, { iconUrls, linkResolver, fileResolver });

  let pageId = canvasId;
  let pageSlug = null;

  if (canvasId) {
    log.verbose(`Updating page: ${title} (id: ${canvasId})`);
    if (!dryRun) {
      try {
        const result = await updatePage(courseId, canvasId, { title, body: html });
        pageId = result.page_id || result.url;
        pageSlug = result.url;
      } catch (err) {
        if (err.message.includes('404')) {
          console.warn(`    [push] Page ${canvasId} not found on Canvas, creating new`);
          canvasId = null;
        } else {
          throw err;
        }
      }
    }
  }

  if (!canvasId) {
    log.verbose(`Creating page: ${title}`);
    if (!dryRun) {
      const result = await createPage(courseId, { title, body: html });
      pageId = result.page_id || result.url;
      pageSlug = result.url;
      // Write canvas_id back to frontmatter
      updateFrontmatter(filePath, { canvas_id: pageId });
      frontmatter.canvas_id = pageId;
      log.verbose(`Wrote canvas_id=${pageId} to ${relativePath}`);
    }
  }

  // Create module item linking to the page (Canvas requires page_url for Page type)
  if (!dryRun && pageSlug) {
    await createModuleItem(courseId, moduleId, {
      title,
      type: 'Page',
      pageUrl: pageSlug,
      position,
      indent,
    });
  }

  // Track for second pass if there were unresolved internal links
  if (hasUnresolved && !dryRun && pageId) {
    unresolvedItems.push({ courseId, relativePath, filePath, canvasId: pageId, canvasType: 'page', iconUrls });
  }

  return pageSlug || null;
}

async function pushAssignment(courseId, moduleId, { title, filePath, relativePath, canvasId, position, indent, frontmatter }, dryRun, iconUrls, relativeToCanvas, unresolvedItems, syncData) {
  const raw = fs.readFileSync(filePath, 'utf8');

  // Create link resolver that tracks unresolved internal links
  let hasUnresolved = false;
  const linkResolver = (href) => {
    const { resolved, wasInternal } = resolveRelativeLink(href, relativePath, relativeToCanvas, courseId);
    if (wasInternal) hasUnresolved = true;
    return resolved;
  };

  // Create file resolver for images and non-.md file references
  const fileResolver = buildFileResolver(relativePath, syncData);

  const html = markdownToHtml(raw, { iconUrls, linkResolver, fileResolver });

  const assignmentOpts = {
    name: title,
    description: html,
  };

  // Map frontmatter fields to assignment options
  if (frontmatter.points_possible != null) assignmentOpts.pointsPossible = frontmatter.points_possible;
  if (frontmatter.submission_types) assignmentOpts.submissionTypes = frontmatter.submission_types;
  if (frontmatter.due_at) assignmentOpts.dueAt = frontmatter.due_at;
  if (frontmatter.published != null) assignmentOpts.published = frontmatter.published;

  let assignmentId = canvasId;

  if (canvasId) {
    log.verbose(`Updating assignment: ${title} (id: ${canvasId})`);
    if (!dryRun) {
      try {
        const result = await updateAssignment(courseId, canvasId, assignmentOpts);
        assignmentId = result.id;
      } catch (err) {
        if (err.message.includes('404')) {
          console.warn(`    [push] Assignment ${canvasId} not found on Canvas, creating new`);
          canvasId = null;
        } else {
          throw err;
        }
      }
    }
  }

  if (!canvasId) {
    log.verbose(`Creating assignment: ${title}`);
    if (!dryRun) {
      const result = await createAssignment(courseId, assignmentOpts);
      assignmentId = result.id;
      updateFrontmatter(filePath, { canvas_id: assignmentId });
      frontmatter.canvas_id = assignmentId;
      log.verbose(`Wrote canvas_id=${assignmentId} to ${relativePath}`);
    }
  }

  // Create module item linking to the assignment
  if (!dryRun && assignmentId) {
    await createModuleItem(courseId, moduleId, {
      title,
      type: 'Assignment',
      contentId: assignmentId,
      position,
      indent,
    });
  }

  // Track for second pass if there were unresolved internal links
  if (hasUnresolved && !dryRun && assignmentId) {
    unresolvedItems.push({ courseId, relativePath, filePath, canvasId: assignmentId, canvasType: 'assignment', iconUrls });
  }
}

/**
 * Build a file resolver callback for a given markdown file.
 * Resolves relative file paths to Canvas file URLs using syncData.files.
 */
function buildFileResolver(currentFilePath, syncData) {
  return (href) => {
    if (!href || /^(https?:\/\/|\/\/|#|mailto:)/.test(href)) return null;
    if (href.endsWith('.md')) return null;

    const currentDir = path.posix.dirname(currentFilePath);
    const resolved = path.posix.normalize(path.posix.join(currentDir, href));
    const entry = syncData.files[resolved];
    if (!entry) return null;

    const baseUrl = syncData.canvas_base_url || '';
    return `${baseUrl}${entry.canvas_url}`;
  };
}

async function pushExternalUrl(courseId, moduleId, { title, position, indent, frontmatter }, dryRun) {
  const url = frontmatter.external_url;
  if (!url) {
    console.warn(`  [push] WARNING: Skipping "${title}" — canvas_type is external_url but external_url field is missing in frontmatter`);
    return;
  }

  console.log(`  [push] Creating external URL module item: ${title} -> ${url}`);
  if (!dryRun) {
    await createModuleItem(courseId, moduleId, {
      title,
      type: 'ExternalUrl',
      externalUrl: url,
      position,
      indent,
      newTab: frontmatter.new_tab !== false,
    });
  }
}

async function pushFile(courseId, moduleId, { title, filePath, position, indent, folderName }, dryRun) {
  console.log(`  [push] Uploading file: ${title}`);
  if (!dryRun) {
    const result = await uploadFile(courseId, filePath, { parentFolderPath: folderName });
    const fileId = result.id;

    await createModuleItem(courseId, moduleId, {
      title,
      type: 'File',
      contentId: fileId,
      position,
      indent,
    });
    console.log(`    [push] Uploaded file id=${fileId}`);
  }
}

/**
 * Detect modules in the sync file that no longer exist locally and delete them from Canvas.
 */
async function pruneDeletedModules(courseId, syncData, localModules, dryRun, errors) {
  const localFolders = new Set(localModules.map((m) => m.folderName));
  const syncModules = syncData.modules || {};
  const toDelete = [];

  for (const [folder, data] of Object.entries(syncModules)) {
    if (!localFolders.has(folder) && data.canvas_module_id) {
      toDelete.push({ folder, canvasModuleId: data.canvas_module_id });
    }
  }

  if (toDelete.length === 0) {
    console.log('\n[push] Prune: no deleted modules to remove from Canvas.');
    return;
  }

  console.log(`\n[push] Prune: ${toDelete.length} locally-deleted module(s) to remove from Canvas:`);
  for (const { folder } of toDelete) {
    console.log(`  - ${folder}`);
  }

  if (!dryRun) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise((resolve) => {
      rl.question('[push] Delete these modules from Canvas? (y/N) ', resolve);
    });
    rl.close();

    if (answer.toLowerCase() !== 'y') {
      console.log('[push] Prune cancelled.');
      return;
    }
  }

  for (const { folder, canvasModuleId } of toDelete) {
    console.log(`  [push] Pruning module: ${folder} (canvas_module_id: ${canvasModuleId})`);
    if (!dryRun) {
      try {
        await deleteCanvasModule(courseId, canvasModuleId);
        delete syncData.modules[folder];
        console.log(`    [push] Deleted from Canvas.`);
      } catch (err) {
        console.error(`    [push] Error deleting module "${folder}": ${err.message}`);
        errors.push({ module: folder, error: err.message });
      }
    }
  }
}

module.exports = push;
