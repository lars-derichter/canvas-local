const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { listModules, listModuleItems } = require('../lib/canvas/modules');
const { buildPageUrlToPageId, getPage } = require('../lib/canvas/pages');
const { getAssignment } = require('../lib/canvas/assignments');
const {
  getDiscussion,
  gradedDiscussionWarning,
} = require('../lib/canvas/discussions');
const { get } = require('../lib/canvas/client');
const { canvasItemToMarkdown } = require('../lib/convert/html-to-markdown');
const {
  parseFrontmatter,
  serializeFrontmatter,
} = require('../lib/convert/frontmatter');
const {
  buildLinkMap,
  resolveCanvasLink,
  buildFileMap,
} = require('../lib/convert/link-resolver');
const { downloadFile } = require('../lib/canvas/files');
const {
  SYNC_FILE,
  ensureModule,
  findModuleByCanvasId,
  getModule,
  loadState,
  renameFolder,
  renamePaths,
  saveState,
  setItem,
} = require('../lib/sync/state');
const { COURSE_DIR, safeReadJSON } = require('./module-utils');
const {
  toFolderName,
  toFileName,
  toFileSlug,
  computeRelativePath,
} = require('./naming');
const { confirmForcedPull } = require('./backup-warning');
const log = require('./logger');
const { loadCourseConfig } = require('../lib/config/course-config');

/**
 * Whether course/ already holds markdown a pull could overwrite. Used to tell
 * a first import onto an empty tree — harmless — from a forced pull over an
 * authored course, which is not.
 */
function courseHasMarkdown(courseDir = COURSE_DIR) {
  if (!fs.existsSync(courseDir)) return false;
  try {
    return fs
      .readdirSync(courseDir, { recursive: true })
      .some((entry) => String(entry).endsWith('.md'));
  } catch (err) {
    log.verbose(`Could not scan ${courseDir}: ${err.message}`);
    return false;
  }
}

async function pull(options) {
  const courseId = process.env.CANVAS_COURSE_ID;
  if (!courseId) {
    log.error(
      '[pull] Error: CANVAS_COURSE_ID is not set. Run "npx course init" first.',
    );
    process.exit(1);
  }

  const force = options && options.force;
  const syncData = loadState();

  log.info(`[pull] Fetching modules for course ${courseId}...`);
  const modules = await listModules(courseId);

  if (!modules || modules.length === 0) {
    log.info('[pull] No modules found in Canvas course.');
    return;
  }

  log.info(`[pull] Found ${modules.length} module(s).\n`);

  // From here on the pull writes to the working tree. Say so, and stop for an
  // answer when --force is about to overwrite an authored course blind.
  const proceed = await confirmForcedPull({
    syncData,
    force,
    hasLocalContent: courseHasMarkdown(),
  });
  if (!proceed) return;

  // Initialize file tracking
  if (!syncData.files) syncData.files = {};

  // Build reverse link map for resolving Canvas internal links back to relative paths
  const { canvasToRelative } = buildLinkMap(syncData);

  // Build reverse file map for resolving Canvas file URLs back to local paths
  const { canvasToLocal } = buildFileMap(syncData);

  // Resolve page_url -> page_id so a page renamed on Canvas is recognised by
  // the id its sync entry holds rather than by the slug that just changed.
  // Losing the map costs the rename detection and nothing else, so a failure
  // is a warning.
  let pageUrlToPageId = new Map();
  try {
    pageUrlToPageId = await buildPageUrlToPageId(courseId);
  } catch (err) {
    log.warn(
      `[pull] Could not fetch pages for rename detection: ${err.message}`,
    );
  }

  // Ensure course directory exists
  if (!fs.existsSync(COURSE_DIR)) {
    fs.mkdirSync(COURSE_DIR, { recursive: true });
  }

  const errors = [];
  const totalModules = modules.length;

  for (let mi = 0; mi < modules.length; mi++) {
    const mod = modules[mi];
    log.info(`[pull] Module ${mi + 1}/${totalModules}: ${mod.name}`);
    try {
      await pullModule(
        courseId,
        mod,
        syncData,
        force,
        canvasToRelative,
        canvasToLocal,
        pageUrlToPageId,
      );
    } catch (err) {
      log.error(`[pull] Error pulling module "${mod.name}": ${err.message}`);
      errors.push({ module: mod.name, error: err.message });
    }
    // Save sync state after each module so progress is preserved on failure
    saveState(syncData);
  }

  // Update last_sync
  syncData.last_sync = new Date().toISOString();
  saveState(syncData);

  log.info(`\n[pull] Sync file updated: ${SYNC_FILE}`);

  if (errors.length > 0) {
    log.info(`\n[pull] Completed with ${errors.length} error(s):`);
    for (const e of errors) {
      log.info(`  - ${e.module}: ${e.error}`);
    }
  } else {
    log.info('[pull] Done.');
  }
}

/**
 * Write a folder's _category_.json with the Canvas-derived label and position,
 * preserving any other fields (collapsed, className, customProps, ...) the user
 * added locally.
 *
 * The Canvas module id no longer belongs here. `_category_.json` is Docusaurus's
 * file and the author's; the sync state, keyed by folder name, is the one place
 * that says which Canvas module a folder is.
 */
function writeCategoryFile(folderDir, label, position) {
  const catFile = path.join(folderDir, '_category_.json');
  const existing = safeReadJSON(catFile, {});
  const merged = { ...existing, label, position };
  fs.writeFileSync(catFile, JSON.stringify(merged, null, 2) + '\n', 'utf8');
}

async function pullModule(
  courseId,
  mod,
  syncData,
  force,
  canvasToRelative,
  canvasToLocal,
  pageUrlToPageId,
) {
  const position = mod.position || 0;
  const folderName = toFolderName(mod.name, position);
  const moduleDir = path.join(COURSE_DIR, folderName);

  log.info(`[pull] Module: ${mod.name} -> ${folderName}/`);

  // The folder is the key now, so a rename or a move on Canvas shows up as a
  // module whose Canvas id is already known under a different folder name.
  const existing = findModuleByCanvasId(syncData, mod.id);
  if (existing && existing[0] !== folderName) {
    const oldFolder = existing[0];
    const oldDir = path.join(COURSE_DIR, oldFolder);
    if (fs.existsSync(oldDir) && !fs.existsSync(moduleDir)) {
      log.verbose(`Module folder renamed: ${oldFolder}/ -> ${folderName}/`);
      fs.renameSync(oldDir, moduleDir);
    }
    // One call re-keys the module, the path of every item inside it and the
    // rows for the binaries under its `_files/`.
    renameFolder(syncData, oldFolder, folderName);
  }

  if (!fs.existsSync(moduleDir)) {
    fs.mkdirSync(moduleDir, { recursive: true });
  }

  // Track module in sync data. Every `setItem` below needs the module to be
  // there already, with its Canvas id: a module row that names no Canvas module
  // is one the next push cannot reconcile.
  ensureModule(syncData, folderName, {
    canvas_module_id: mod.id,
    name: mod.name,
    position,
  });

  // Write _category_.json for the module folder (preserving custom fields)
  writeCategoryFile(moduleDir, mod.name, position);

  // Fetch module items
  const items = await listModuleItems(courseId, mod.id);
  if (!items || items.length === 0) {
    log.info('  [pull] No items in this module.');
    return;
  }

  const totalItems = items.length;

  // ---- Phase 1: Compute target state ----
  // Walk items to determine what filenames/folders each item should have,
  // without writing anything yet.
  const planned = [];
  let modulePosition = 0;
  let subfolderPosition = 0;
  let currentSubfolderName = null;

  for (let ii = 0; ii < items.length; ii++) {
    const item = items[ii];

    if (item.type === 'SubHeader') {
      modulePosition++;
      subfolderPosition = 0;
      currentSubfolderName = toFolderName(item.title, modulePosition);
      planned.push({
        kind: 'subfolder',
        item,
        targetFolderName: currentSubfolderName,
        position: modulePosition,
        index: ii,
      });
      continue;
    }

    let pos, targetDir, subfolderName;
    if (item.indent > 0 && currentSubfolderName) {
      subfolderPosition++;
      pos = subfolderPosition;
      targetDir = path.join(moduleDir, currentSubfolderName);
      subfolderName = currentSubfolderName;
    } else {
      currentSubfolderName = null;
      modulePosition++;
      pos = modulePosition;
      targetDir = moduleDir;
      subfolderName = null;
    }

    const targetFileName = toFileName(
      item.title || loadCourseConfig().labels.pull.untitled,
      pos,
    );

    planned.push({
      kind: 'content',
      item,
      canvasItemType: item.type,
      targetFileName,
      targetDir,
      position: pos,
      subfolderName,
      index: ii,
    });
  }

  // Augment Page items with resolved page_id so reconciliation can match
  // renamed pages by canvas_id (page_url changes on rename, page_id doesn't)
  for (const p of planned) {
    if (p.item && p.item.type === 'Page' && p.item.page_url) {
      const pageId = pageUrlToPageId.get(p.item.page_url);
      if (pageId != null) {
        p.item._resolvedPageId = pageId;
      }
    }
  }

  // ---- Phase 2: Rename existing files to match new Canvas positions ----
  const renamed = reconcileExistingFiles(
    planned,
    syncData,
    folderName,
    moduleDir,
  );

  // Rebuild link maps if files were renamed so link resolution uses updated paths
  if (renamed) {
    const { canvasToRelative: newLinkMap } = buildLinkMap(syncData);
    canvasToRelative.clear();
    for (const [k, v] of newLinkMap) canvasToRelative.set(k, v);
  }

  // ---- Phase 3: Write content ----
  for (const p of planned) {
    log.verbose(
      `Item ${p.index + 1}/${totalItems}: ${p.item.title || p.item.type}`,
    );

    if (p.kind === 'subfolder') {
      const subfolderDir = path.join(moduleDir, p.targetFolderName);
      if (!fs.existsSync(subfolderDir)) {
        fs.mkdirSync(subfolderDir, { recursive: true });
      }
      log.verbose(`SubHeader: ${p.item.title} -> ${p.targetFolderName}/`);
      writeCategoryFile(subfolderDir, p.item.title, p.position);
      continue;
    }

    if (p.canvasItemType === 'File') {
      try {
        await pullFileItem(
          p.item,
          p.targetDir,
          p.targetFileName,
          syncData,
          force,
          folderName,
        );
      } catch (err) {
        log.error(
          `  [pull] Error pulling file "${p.item.title || 'unknown'}": ${err.message}`,
        );
      }
      continue;
    }

    try {
      await pullItem(
        courseId,
        p.item,
        p.targetDir,
        p.targetFileName,
        syncData,
        force,
        folderName,
        canvasToRelative,
        canvasToLocal,
      );
    } catch (err) {
      log.error(
        `  [pull] Error pulling item "${p.item.title || 'unknown'}": ${err.message}`,
      );
    }
  }
}

/**
 * The path the last sync recorded for a Canvas item, or null.
 *
 * This is the one lookup that still runs the other way round. Everything else
 * in v4 asks "what does the state say about this path"; a pull starts from a
 * Canvas item and has to find out which local file it used to be, so it scans
 * the module's rows for one whose stored identity matches. Cheap — a module
 * holds a handful of rows — and it needs no map to keep in step with the
 * renames happening around it.
 *
 * The identities are tried most reliable first: a page slug, a launch URL, then
 * the numeric ids. `_resolvedPageId` comes before `content_id` because a page's
 * slug changes when Canvas regenerates it from a new title and the wiki page id
 * behind it does not.
 *
 * @param {object} item        - A Canvas module item.
 * @param {object} moduleItems - The module's `items` map, keyed by path.
 * @returns {string|null}
 */
function findOldSyncPath(item, moduleItems) {
  const rows = Object.entries(moduleItems || {});
  const firstMatch = (matches) => {
    for (const [itemPath, row] of rows) if (matches(row)) return itemPath;
    return null;
  };

  if (item.page_url) {
    const found = firstMatch(
      (row) =>
        row.page_url != null && String(row.page_url) === String(item.page_url),
    );
    if (found) return found;
  }
  if (item.external_url) {
    const found = firstMatch((row) => row.external_url === item.external_url);
    if (found) return found;
  }
  for (const id of [item._resolvedPageId, item.content_id, item.id]) {
    if (id == null) continue;
    const found = firstMatch(
      (row) => row.canvas_id != null && String(row.canvas_id) === String(id),
    );
    if (found) return found;
  }
  return null;
}

/**
 * Recover leftover temp files/folders from a previously failed rename operation.
 */
function cleanupTempFiles(moduleDir, tempPrefix) {
  try {
    for (const entry of fs.readdirSync(moduleDir)) {
      if (!entry.startsWith(tempPrefix)) continue;
      const finalName = entry.slice(tempPrefix.length);
      const tempPath = path.join(moduleDir, entry);
      const finalPath = path.join(moduleDir, finalName);
      if (!fs.existsSync(finalPath)) {
        fs.renameSync(tempPath, finalPath);
        log.verbose(`Recovered temp file: ${entry} -> ${finalName}`);
      } else {
        const stat = fs.statSync(tempPath);
        if (stat.isDirectory()) {
          fs.rmSync(tempPath, { recursive: true });
        } else {
          fs.unlinkSync(tempPath);
        }
        log.verbose(`Removed leftover temp: ${entry}`);
      }
    }
  } catch (err) {
    log.warn(
      `[pull] Warning: could not clean up temp files in ${moduleDir}: ${err.message}`,
    );
  }
}

/**
 * Detect and execute subfolder renames using a two-pass temp-name approach.
 * Returns true if any renames were performed.
 */
function reconcileSubfolders(
  planned,
  state,
  folderName,
  moduleDir,
  moduleEntry,
  tempPrefix,
) {
  const renames = [];
  for (const p of planned) {
    if (p.kind !== 'subfolder') continue;

    const children = planned.filter(
      (c) => c.kind !== 'subfolder' && c.subfolderName === p.targetFolderName,
    );
    for (const child of children) {
      const oldRelPath = findOldSyncPath(child.item, moduleEntry.items);
      if (!oldRelPath) continue;

      const relToModule = oldRelPath.slice(folderName.length + 1);
      const slashIdx = relToModule.indexOf('/');
      if (slashIdx > 0) {
        const oldSubName = relToModule.slice(0, slashIdx);
        if (
          oldSubName !== p.targetFolderName &&
          fs.existsSync(path.join(moduleDir, oldSubName))
        ) {
          renames.push({ oldName: oldSubName, newName: p.targetFolderName });
        }
      }
      break;
    }
  }

  if (renames.length === 0) return false;

  try {
    // Pass 1: rename to temp names
    for (const sr of renames) {
      sr._tempName = tempPrefix + sr.newName;
      fs.renameSync(
        path.join(moduleDir, sr.oldName),
        path.join(moduleDir, sr._tempName),
      );
    }
    // Pass 2: rename to final names and update sync state
    for (const sr of renames) {
      fs.renameSync(
        path.join(moduleDir, sr._tempName),
        path.join(moduleDir, sr.newName),
      );
      log.verbose(`Renamed subfolder: ${sr.oldName}/ -> ${sr.newName}/`);

      // One directory move: `renamePaths` re-keys every row underneath it,
      // the subfolder's own `_files/` rows included.
      renamePaths(state, [
        {
          from: `${folderName}/${sr.oldName}`,
          to: `${folderName}/${sr.newName}`,
        },
      ]);
    }
  } catch (err) {
    for (const sr of renames) {
      if (sr._tempName && fs.existsSync(path.join(moduleDir, sr._tempName))) {
        try {
          fs.renameSync(
            path.join(moduleDir, sr._tempName),
            path.join(moduleDir, sr.newName),
          );
        } catch {
          /* Leave temp folder for next run's cleanup */
        }
      }
    }
    throw err;
  }

  return true;
}

/**
 * Detect and execute file renames using a two-pass temp-name approach.
 * Returns true if any renames were performed.
 */
function reconcileFileRenames(
  planned,
  state,
  folderName,
  moduleEntry,
  tempPrefix,
) {
  const renames = [];
  for (const p of planned) {
    if (p.kind === 'subfolder') continue;

    const targetRelPath = p.subfolderName
      ? path.posix.join(folderName, p.subfolderName, p.targetFileName)
      : path.posix.join(folderName, p.targetFileName);

    const oldRelPath = findOldSyncPath(p.item, moduleEntry.items);
    if (!oldRelPath || oldRelPath === targetRelPath) continue;

    const oldAbsPath = path.resolve(COURSE_DIR, oldRelPath);
    const newAbsPath = path.resolve(COURSE_DIR, targetRelPath);
    if (!fs.existsSync(oldAbsPath)) continue;

    renames.push({
      oldAbsPath,
      newAbsPath,
      oldRelPath,
      newRelPath: targetRelPath,
    });
  }

  if (renames.length === 0) return false;

  try {
    // Pass 1: rename to temp names
    for (const r of renames) {
      const dir = path.dirname(r.newAbsPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      r._tempPath = path.join(dir, tempPrefix + path.basename(r.newAbsPath));
      fs.renameSync(r.oldAbsPath, r._tempPath);
    }
    // Pass 2: rename to final names
    for (const r of renames) {
      fs.renameSync(r._tempPath, r.newAbsPath);
      log.verbose(
        `Renamed: ${path.basename(r.oldRelPath)} -> ${path.basename(r.newRelPath)}`,
      );
    }
    // …and then re-key the rows, once the whole batch has landed, so a pair of
    // files that swapped names does not collide halfway through.
    renamePaths(
      state,
      renames.map((r) => ({ from: r.oldRelPath, to: r.newRelPath })),
    );
  } catch (err) {
    for (const r of renames) {
      if (r._tempPath && fs.existsSync(r._tempPath)) {
        try {
          fs.renameSync(r._tempPath, r.newAbsPath);
        } catch {
          /* Leave temp file for next run's cleanup */
        }
      }
    }
    throw err;
  }

  return true;
}

/**
 * Rename existing local files/folders to match new Canvas positions.
 * Returns true if any renames were performed.
 */
function reconcileExistingFiles(planned, state, folderName, moduleDir) {
  const moduleEntry = getModule(state, folderName);
  const tempPrefix = '__pull_temp_';

  cleanupTempFiles(moduleDir, tempPrefix);
  const subfoldersRenamed = reconcileSubfolders(
    planned,
    state,
    folderName,
    moduleDir,
    moduleEntry,
    tempPrefix,
  );
  const filesRenamed = reconcileFileRenames(
    planned,
    state,
    folderName,
    moduleEntry,
    tempPrefix,
  );

  return subfoldersRenamed || filesRenamed;
}

/**
 * Decide whether a pull may overwrite a local file, and say why not.
 *
 * There are three states here, not two. A file that does not exist yet is
 * always safe to write, so a first import onto an empty tree is unaffected. A
 * file older than the last sync is Canvas's own output coming back, so it is
 * safe too. Everything else is local work that a write would destroy: a file
 * touched since the last sync, and — the case that used to be overwritten
 * silently — a file that cannot be judged at all because there is no sync
 * state to compare it against (right after `reset-sync-state`, or on a clone
 * that never synced). "Cannot tell" is not "unmodified": skip it, and let
 * --force say otherwise.
 *
 * @param {string} filePath
 * @param {object} syncData - Loaded sync state; may be empty.
 * @param {boolean} force   - --force writes regardless.
 * @returns {string|null} Why the file was skipped, or null when it may be written.
 */
function overwriteSkipReason(filePath, syncData, force) {
  if (force) return null;
  if (!fs.existsSync(filePath)) return null;

  const lastSync = syncData && syncData.last_sync;
  if (!lastSync) {
    return 'no sync state, cannot tell if it was modified; use --force to overwrite';
  }

  const stat = fs.statSync(filePath);
  if (stat.mtime > new Date(lastSync)) {
    return 'locally modified since last sync, use --force to overwrite';
  }
  return null;
}

/**
 * Read the frontmatter of the local file a pull is about to overwrite, so keys
 * Canvas knows nothing about survive. Returns an empty object when the file is
 * new or unreadable — a pull must not fail over a malformed local file.
 */
function readLocalFrontmatter(filePath) {
  if (!fs.existsSync(filePath)) return {};
  try {
    return parseFrontmatter(fs.readFileSync(filePath, 'utf8')).data || {};
  } catch (err) {
    log.verbose(`Could not read frontmatter of ${filePath}: ${err.message}`);
    return {};
  }
}

function sha256File(filePath) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(filePath))
    .digest('hex');
}

/**
 * Pull a File item from Canvas — download the binary to _files/ and create
 * a markdown wrapper so the item appears in the Docusaurus sidebar.
 */
async function pullFileItem(
  item,
  targetDir,
  targetFileName,
  syncData,
  force,
  folderName,
) {
  const title = item.title || loadCourseConfig().labels.pull.untitled;
  const contentId = item.content_id;
  if (!contentId) {
    log.info(`  [pull] Skipping file "${title}": no content_id`);
    return;
  }

  const wrapperPath = path.join(targetDir, targetFileName);

  const wrapperSkip = overwriteSkipReason(wrapperPath, syncData, force);
  if (wrapperSkip) {
    log.info(`    [pull] SKIPPED ${targetFileName} (${wrapperSkip})`);
    return;
  }

  // Derive the binary filename from the Canvas File's display_name, which
  // carries the real extension. The module item title is only a display label
  // (e.g. "Workflow Diagram") and loses the extension, so fall back to it only
  // when the metadata fetch fails. Slugify so pulled files follow the repo's
  // lowercase-hyphenated naming convention.
  let fileMeta = null;
  try {
    fileMeta = await get(`/api/v1/files/${contentId}`);
  } catch (err) {
    log.warn(
      `    [pull] Could not fetch file metadata for "${title}": ${err.message}`,
    );
  }
  const displayName = fileMeta && fileMeta.display_name;
  const originalName = toFileSlug(displayName || title);

  const filesDir = path.join(targetDir, '_files');
  const binaryPath = path.join(filesDir, originalName);

  // Never clobber a binary the user edited locally; and skip the download
  // entirely when nothing changed on Canvas since the last sync.
  const binaryExists = fs.existsSync(binaryPath);
  const binarySkip = overwriteSkipReason(binaryPath, syncData, force);
  if (binarySkip) {
    log.info(
      `    [pull] SKIPPED download of _files/${originalName} (${binarySkip})`,
    );
  } else {
    const remoteChanged =
      !syncData.last_sync ||
      !fileMeta ||
      !fileMeta.updated_at ||
      new Date(fileMeta.updated_at) > new Date(syncData.last_sync);
    if (!binaryExists || force || remoteChanged) {
      if (!fs.existsSync(filesDir)) {
        fs.mkdirSync(filesDir, { recursive: true });
      }
      log.verbose(`Downloading file: ${title}`);
      await downloadFile(contentId, binaryPath);
      log.verbose(`Wrote _files/${originalName}`);
    } else {
      log.verbose(
        `Unchanged on Canvas, skipping download: _files/${originalName}`,
      );
    }
  }

  // Create markdown wrapper, keeping any keys the author added to it.
  const fileRef = `_files/${originalName}`;
  const wrapperData = {
    title,
    canvas_type: 'file',
    file_ref: fileRef,
  };
  for (const [key, value] of Object.entries(
    readLocalFrontmatter(wrapperPath),
  )) {
    if (key in wrapperData) continue;
    wrapperData[key] = value;
  }
  fs.writeFileSync(wrapperPath, serializeFrontmatter(wrapperData, ''), 'utf8');
  log.verbose(`Wrote ${targetFileName}`);

  // Update sync state
  const relativePath = computeRelativePath(folderName, wrapperPath, COURSE_DIR);
  setItem(syncData, folderName, relativePath, {
    canvas_type: 'file',
    canvas_id: contentId,
    module_item_id: item.id,
  });
}

/**
 * Say so when the topic just fetched is graded, and hand it straight back so
 * this can wrap the fetch.
 */
function warnIfGradedDiscussion(topic) {
  const line = gradedDiscussionWarning(topic);
  if (line) log.warn(`    [pull] ${line}`);
  return topic;
}

/**
 * Strategy definitions for each pullable Canvas item type.
 * Each strategy defines how to extract the identifier, fetch content,
 * get the HTML body, and build the sync state entry.
 */
const pullStrategies = {
  Page: {
    getId: (item) => item.page_url,
    idLabel: 'page_url',
    fetch: (courseId, id) => getPage(courseId, id),
    getBody: (result) => result.body || '',
    canvasType: 'page',
    buildSyncEntry: (item, result) => ({
      canvas_type: 'page',
      canvas_id: result.page_id || result.url,
      page_url: item.page_url,
      module_item_id: item.id,
    }),
  },
  Assignment: {
    getId: (item) => item.content_id,
    idLabel: 'content_id',
    fetch: (courseId, id) => getAssignment(courseId, id),
    getBody: (result) => result.description || '',
    canvasType: 'assignment',
    buildSyncEntry: (item) => ({
      canvas_type: 'assignment',
      canvas_id: item.content_id,
      module_item_id: item.id,
    }),
  },
  Discussion: {
    // Announcements are discussion topics too, but a module item never points
    // at one, so fetching the topic the item names can only be a discussion.
    getId: (item) => item.content_id,
    idLabel: 'content_id',
    fetch: async (courseId, id) =>
      warnIfGradedDiscussion(await getDiscussion(courseId, id)),
    getBody: (result) => result.message || '',
    canvasType: 'discussion',
    buildSyncEntry: (item) => ({
      canvas_type: 'discussion',
      canvas_id: item.content_id,
      module_item_id: item.id,
    }),
  },
  Quiz: {
    // A quiz has no markdown source and never gets one: its questions come from
    // a QTI package that Canvas imported by hand, and pulling them back would
    // invent a source this project cannot push. What is written is a reference
    // file, so the quiz keeps its place among the module's items.
    //
    // Writing it also closes a gap in the file numbering. Phase 1 above numbers
    // every module item before phase 3 decides whether to write anything for
    // it, so an item that phase 3 skips still consumes its position: a quiz
    // between two pages used to leave 01- and 03- with nothing at 02-.
    getId: (item) => item.content_id,
    idLabel: 'content_id',
    fetch: null, // nothing to fetch: the questions are not ours to hold
    getBody: null,
    canvasType: 'quiz',
    buildSyncEntry: (item) => ({
      canvas_type: 'quiz',
      canvas_id: item.content_id,
      module_item_id: item.id,
    }),
  },
  ExternalUrl: {
    getId: (item) => item.id,
    idLabel: null, // always present, no precondition check
    fetch: null, // no API fetch needed
    getBody: null,
    canvasType: 'external_url',
    buildSyncEntry: (item) => ({
      canvas_type: 'external_url',
      canvas_id: item.id,
      module_item_id: item.id,
      external_url: item.external_url,
    }),
  },
  ExternalTool: {
    // An LTI link has no Canvas object behind it to fetch: the module item's
    // own external_url is the whole of it, and Canvas resolves the tool from
    // that URL on every launch.
    getId: (item) => item.id,
    idLabel: null, // always present, no precondition check
    fetch: null, // no API fetch needed
    getBody: null,
    canvasType: 'external_tool',
    buildSyncEntry: (item) => ({
      canvas_type: 'external_tool',
      canvas_id: item.id,
      module_item_id: item.id,
      external_url: item.external_url,
    }),
  },
};

async function pullItem(
  courseId,
  item,
  moduleDir,
  targetFileName,
  syncData,
  force,
  folderName,
  canvasToRelative,
  canvasToLocal,
) {
  const title = item.title || loadCourseConfig().labels.pull.untitled;
  const strategy = pullStrategies[item.type];

  if (!strategy) {
    log.warn(
      `  [pull] Skipping unsupported item type "${item.type}": ${title}`,
    );
    return;
  }

  // Check precondition (e.g. page_url or content_id must be present)
  const itemId = strategy.getId(item);
  if (strategy.idLabel && !itemId) {
    log.info(
      `  [pull] Skipping ${item.type.toLowerCase()} "${title}": no ${strategy.idLabel}`,
    );
    return;
  }

  const filePath = path.join(moduleDir, targetFileName);

  const skipReason = overwriteSkipReason(filePath, syncData, force);
  if (skipReason) {
    log.info(`    [pull] SKIPPED ${targetFileName} (${skipReason})`);
    return;
  }

  const relativePath = computeRelativePath(folderName, filePath, COURSE_DIR);
  const existingFrontmatter = readLocalFrontmatter(filePath);
  let markdown;
  let fetchResult = null;

  if (strategy.fetch) {
    log.verbose(`Fetching ${strategy.canvasType}: ${title}`);
    fetchResult = await strategy.fetch(courseId, itemId);
    const body = strategy.getBody(fetchResult);
    const linkResolver = (href) =>
      resolveCanvasLink(href, relativePath, canvasToRelative);
    await downloadReferencedFiles(
      courseId,
      body,
      folderName,
      syncData,
      canvasToLocal,
    );
    const fileResolver = createPullFileResolver(
      courseId,
      relativePath,
      canvasToLocal,
    );
    markdown = canvasItemToMarkdown(fetchResult, strategy.canvasType, {
      linkResolver,
      fileResolver,
      existingFrontmatter,
    });
  } else {
    log.verbose(`Fetching ${strategy.canvasType}: ${title}`);
    markdown = canvasItemToMarkdown(
      {
        title,
        external_url: item.external_url,
        // A quiz item names the quiz it links in content_id; the two link types
        // have no content behind them and carry none.
        content_id: item.content_id,
        id: item.id,
        new_tab: item.new_tab,
      },
      strategy.canvasType,
      { existingFrontmatter },
    );
  }

  fs.writeFileSync(filePath, markdown, 'utf8');
  log.verbose(`Wrote ${targetFileName}`);

  // The path is the key, and `setItem` is what makes it unique across the whole
  // state: an item Canvas moved into this module loses its row in the old one.
  setItem(
    syncData,
    folderName,
    relativePath,
    strategy.buildSyncEntry(item, fetchResult),
  );
}

/**
 * Scan HTML for Canvas file URLs and download any files not already tracked locally.
 * Updates syncData.files and canvasToLocal map as files are downloaded.
 */
async function downloadReferencedFiles(
  courseId,
  html,
  folderName,
  syncData,
  canvasToLocal,
) {
  const filePattern = /\/courses\/\d+\/files\/(\d+)/g;
  const fileIds = new Set();
  let match;
  while ((match = filePattern.exec(html)) !== null) {
    fileIds.add(match[1]);
  }

  // Exclude alert icon file IDs — these are handled by html-to-markdown conversion
  if (syncData.icons) {
    for (const icon of Object.values(syncData.icons)) {
      fileIds.delete(String(icon.canvas_file_id));
    }
  }

  for (const fileId of fileIds) {
    const canvasUrlPattern = `/courses/${courseId}/files/${fileId}/preview`;
    if (canvasToLocal.has(canvasUrlPattern)) {
      const localPath = canvasToLocal.get(canvasUrlPattern);
      if (fs.existsSync(path.resolve(COURSE_DIR, localPath))) continue;
    }

    try {
      const fileMeta = await get(`/api/v1/files/${fileId}`);
      const fileName = fileMeta.display_name || `file-${fileId}`;
      const localRelPath = path.posix.join(folderName, '_files', fileName);
      const destPath = path.resolve(COURSE_DIR, localRelPath);

      log.info(`    [pull] Downloading file: ${fileName}`);
      await downloadFile(fileId, destPath);

      syncData.files[localRelPath] = {
        canvas_file_id: Number(fileId),
        canvas_url: canvasUrlPattern,
        // Record the hash so the next push recognises the file as unchanged.
        sha256: sha256File(destPath),
      };
      canvasToLocal.set(canvasUrlPattern, localRelPath);
    } catch (err) {
      log.error(`    [pull] Error downloading file ${fileId}: ${err.message}`);
    }
  }
}

/**
 * Create a resolver that converts Canvas file URLs to relative paths
 * from the perspective of the given markdown file.
 */
function createPullFileResolver(courseId, currentFilePath, canvasToLocal) {
  return (href) => {
    if (!href) return null;

    let urlPath = href;
    try {
      const url = new URL(href, 'https://placeholder.com');
      urlPath = url.pathname;
    } catch {
      // Already a path
    }

    const fileMatch = urlPath.match(/\/courses\/\d+\/files\/(\d+)/);
    if (!fileMatch) return null;

    const fId = fileMatch[1];
    const pattern = `/courses/${courseId}/files/${fId}/preview`;
    const localPath = canvasToLocal.get(pattern);
    if (!localPath) return null;

    const currentDir = path.posix.dirname(currentFilePath);
    let relative = path.posix.relative(currentDir, localPath);
    if (!relative.startsWith('.') && !relative.startsWith('/')) {
      relative = './' + relative;
    }
    return relative;
  };
}

module.exports = pull;
// Exported for testing
pull._findOldSyncPath = findOldSyncPath;
pull._overwriteSkipReason = overwriteSkipReason;
pull._courseHasMarkdown = courseHasMarkdown;
pull._createPullFileResolver = createPullFileResolver;
pull._pullStrategies = pullStrategies;
// Exported for reuse by the sync engine, which writes the same files pull does
pull._writeCategoryFile = writeCategoryFile;
pull._downloadReferencedFiles = downloadReferencedFiles;
