const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');

const { scanCourse } = require('../lib/convert/course-scanner');
const {
  parseFrontmatter,
  serializeFrontmatter,
} = require('../lib/convert/frontmatter');
const { markdownToHtml } = require('../lib/convert/markdown-to-html');
const { loadCourseConfig } = require('../lib/config/course-config');
const {
  createModule,
  updateModule,
  deleteModule: deleteCanvasModule,
  listModules,
  listModuleItems,
  deleteModuleItem,
} = require('../lib/canvas/modules');
const {
  reconcileModuleItems,
  applyModuleItems,
  moduleItemKeys,
  describeLeftoverItem,
} = require('../lib/sync/apply');
const {
  createPage,
  updatePage,
  deletePage,
  listPages,
} = require('../lib/canvas/pages');
const {
  createAssignment,
  updateAssignment,
  deleteAssignment,
  getAssignment,
  listAssignments,
  getSubmissionStates,
  hasStudentSubmissions,
  isQuizBackedAssignment,
} = require('../lib/canvas/assignments');
const {
  createDiscussion,
  updateDiscussion,
  deleteDiscussion,
  getDiscussion,
  isGradedDiscussion,
  discussionAssignmentId,
  gradedDiscussionWarning,
} = require('../lib/canvas/discussions');
const {
  listExternalTools,
  findToolForUrl,
  describeInstalledTools,
} = require('../lib/canvas/external-tools');
const { listQuizzes } = require('../lib/canvas/quizzes');
const { uploadFile, deleteFile } = require('../lib/canvas/files');
const { get } = require('../lib/canvas/client');
const { ensureIcons, getIconUrls } = require('../lib/canvas/icons');
const {
  buildLinkMap,
  resolveRelativeLink,
  extractFileReferences,
} = require('../lib/convert/link-resolver');
const {
  SYNC_FILE,
  allItems,
  deleteItem,
  deleteModule: deleteModuleFromState,
  ensureModule,
  getItem,
  getModule,
  loadState,
  saveState,
  setItem,
  toPosixPath,
} = require('../lib/sync/state');
const { COURSE_DIR } = require('./module-utils');
const {
  BACKUP_HINT,
  confirmFirstPush,
  countSubmissionRisk,
  submissionRiskSuffix,
  submissionWarningLines,
} = require('./backup-warning');
const log = require('./logger');

async function push(options) {
  const courseId = process.env.CANVAS_COURSE_ID;
  if (!courseId) {
    log.error(
      '[push] Error: CANVAS_COURSE_ID is not set. Run "npx course init" first.',
    );
    process.exit(1);
  }

  const dryRun = options.dryRun || false;
  const moduleFilter = options.module || null;
  const prune = options.prune || false;

  const syncData = loadState();
  const modules = scanCourse(COURSE_DIR);

  if (modules.length === 0) {
    log.info('[push] No modules found in course/ directory.');
    return;
  }

  const filteredModules = moduleFilter
    ? modules.filter((m) => m.folderName === moduleFilter)
    : modules;

  if (moduleFilter && filteredModules.length === 0) {
    log.error(
      `[push] Error: Module "${moduleFilter}" not found in course/ directory.`,
    );
    process.exit(1);
  }

  log.info(`[push] Found ${filteredModules.length} module(s) to push.`);
  if (dryRun) log.info('[push] DRY RUN - no changes will be made.\n');

  // First push to a course that already has content: say what push is about to
  // take over before it does.
  const proceed = await confirmFirstPush({
    courseId,
    syncData,
    dryRun,
    fetchCounts: async () => {
      const [remoteModules, pages, assignments] = await Promise.all([
        listModules(courseId),
        listPages(courseId),
        listAssignments(courseId),
      ]);
      return {
        modules: remoteModules.length,
        pages: pages.length,
        assignments: assignments.length,
        files: 0,
      };
    },
  });
  if (!proceed) return;

  // Three of the fields an assignment update sends move grades that are
  // already in the gradebook. Say so before the update goes out.
  await warnGradeImpact(courseId, syncData, filteredModules);

  // Ensure alert icons are uploaded to Canvas
  if (!dryRun) {
    await ensureIcons(courseId, syncData);
    saveState(syncData);
  }
  const iconUrls = getIconUrls(syncData);

  // Initialize file tracking
  if (!syncData.files) syncData.files = {};

  // Build link map from sync state for resolving internal links
  let { relativeToCanvas } = buildLinkMap(syncData);

  // Track items that had unresolved internal links for a second pass
  const unresolvedItems = [];

  // A module item Canvas holds that its own module's files did not account for
  // cannot be judged while that module is being pushed: it may be one another
  // module is about to claim. The verdict waits until every module has spoken.
  const ledger = createItemLedger();

  const errors = [];
  const totalModules = filteredModules.length;

  for (let mi = 0; mi < filteredModules.length; mi++) {
    const mod = filteredModules[mi];
    log.info(`\n[push] Module ${mi + 1}/${totalModules}: ${mod.moduleName}`);
    try {
      await pushModule(
        courseId,
        mod,
        syncData,
        dryRun,
        iconUrls,
        relativeToCanvas,
        unresolvedItems,
        errors,
        ledger,
      );
    } catch (err) {
      log.error(
        `[push] Error pushing module "${mod.moduleName}": ${err.message}`,
      );
      errors.push({ module: mod.moduleName, error: err.message });
    }
    // Save sync state after each module so progress is preserved on failure
    if (!dryRun) {
      saveState(syncData);
    }
  }

  // Every module has had its say, so a leftover can finally be told apart from
  // an item that simply moved.
  await resolveLeftoverItems(courseId, ledger, dryRun, errors);

  // Report unresolved links in dry-run mode
  if (unresolvedItems.length > 0 && dryRun) {
    log.info(
      `\n[push] ${unresolvedItems.length} item(s) have unresolved internal links (will be resolved in a second pass during actual push):`,
    );
    for (const { relativePath } of unresolvedItems) {
      log.info(`  - ${relativePath}`);
    }
  }

  // Second pass: re-push items that had unresolved internal links
  if (unresolvedItems.length > 0 && !dryRun) {
    log.info(
      `\n[push] Resolving internal links for ${unresolvedItems.length} item(s) that referenced newly-created pages...`,
    );
    ({ relativeToCanvas } = buildLinkMap(syncData));

    for (const {
      courseId: cId,
      relativePath,
      filePath,
      canvasId,
      canvasType,
      iconUrls: iu,
    } of unresolvedItems) {
      try {
        const linkResolver = (href) => {
          const { resolved } = resolveRelativeLink(
            href,
            relativePath,
            relativeToCanvas,
            cId,
          );
          return resolved;
        };
        const fileResolver = buildFileResolver(relativePath, syncData);
        const raw = fs.readFileSync(filePath, 'utf8');
        const html = markdownToHtml(raw, {
          iconUrls: iu,
          alertTitles: loadCourseConfig().labels.alerts,
          linkResolver,
          fileResolver,
        });

        if (canvasType === 'page') {
          await updatePage(cId, canvasId, { body: html });
        } else if (canvasType === 'assignment') {
          await updateAssignment(cId, canvasId, { description: html });
        } else if (canvasType === 'discussion') {
          await updateDiscussion(cId, canvasId, { message: html });
        }
        log.info(`  [push] Updated links in: ${relativePath}`);
      } catch (err) {
        log.error(
          `  [push] Error updating links in "${relativePath}": ${err.message}`,
        );
        errors.push({ module: relativePath, error: err.message });
      }
    }
  }

  // Prune: remove Canvas modules and items that no longer exist locally
  if (prune) {
    await pruneDeleted(
      courseId,
      syncData,
      modules,
      filteredModules,
      moduleFilter,
      dryRun,
      errors,
    );
  }

  // Update last_sync timestamp
  syncData.last_sync = new Date().toISOString();

  if (!dryRun) {
    saveState(syncData);
    log.info(`\n[push] Sync file updated: ${SYNC_FILE}`);
  }

  if (errors.length > 0) {
    log.info(`\n[push] Completed with ${errors.length} error(s):`);
    for (const e of errors) {
      log.info(`  - ${e.module}: ${e.error}`);
    }
    process.exitCode = 1;
  } else {
    log.info('[push] Done.');
  }
}

/**
 * The Canvas module a local folder is, or null when it is not on Canvas yet.
 *
 * One lookup, in the one place that knows: the sync state, keyed by the folder
 * name. The folder used to carry a copy of this id in its `_category_.json`,
 * and reconciling the two copies is what produced the drift bugs this schema
 * exists to end.
 */
function resolveModuleId(syncData, folderName) {
  const entry = getModule(syncData, folderName);
  if (!entry || entry.canvas_module_id == null) return null;
  return Number(entry.canvas_module_id);
}

/**
 * Record what a push resolved about an item, under its repo-relative path.
 *
 * `setItem` makes the path unique across the whole state, so an item the author
 * moved to another module loses its row in the one it left — no separate
 * bookkeeping, and no chance of the same file being claimed twice.
 *
 * Fields the caller did not resolve are left as the previous sync recorded
 * them, fingerprints included: this only knows about identity, and blanking a
 * hash it never computed would make the next sync call the item changed.
 */
function recordItem(
  syncData,
  folder,
  item,
  { canvasId, pageUrl, moduleItemId } = {},
) {
  const canvasType = item.canvasType || 'page';
  const externalUrl = item.frontmatter && item.frontmatter.external_url;

  const previous = getItem(syncData, item.relativePath);
  const entry = previous ? { ...previous.entry } : {};
  entry.canvas_type = canvasType;
  if (canvasId != null) entry.canvas_id = canvasId;
  if (pageUrl) entry.page_url = pageUrl;
  if (moduleItemId != null) entry.module_item_id = moduleItemId;
  // Both link types live only as a module item, so the launch URL is the only
  // identity of theirs that survives a run.
  if (isModuleItemOnlyType(canvasType) && externalUrl)
    entry.external_url = externalUrl;

  return setItem(syncData, folder, item.relativePath, entry);
}

async function pushModule(
  courseId,
  mod,
  syncData,
  dryRun,
  iconUrls,
  relativeToCanvas,
  unresolvedItems,
  errors,
  ledger,
) {
  const existingModuleId = resolveModuleId(syncData, mod.folderName);

  // What Canvas holds in this module right now, read before the first write so
  // the reconcile at the end can match its own items back to it. Ordinary
  // input, nothing to refuse over. A dry run reads it too: the reconcile is
  // pure, so it can say what a real run would do without doing any of it.
  const liveItems = await readModuleItems(courseId, existingModuleId);

  let moduleId;

  if (existingModuleId) {
    log.info(
      `[push] Updating module: ${mod.moduleName} (id: ${existingModuleId})`,
    );
    if (!dryRun) {
      try {
        const result = await updateModule(courseId, existingModuleId, {
          name: mod.moduleName,
          position: mod.position,
        });
        moduleId = result.id;
      } catch (err) {
        if (err.message.includes('404')) {
          log.warn(
            `[push] Module ${existingModuleId} not found on Canvas, creating new`,
          );
        } else {
          throw err;
        }
      }
    } else {
      moduleId = existingModuleId;
    }
  }

  if (!moduleId && !dryRun) {
    log.info(`[push] Creating module: ${mod.moduleName}`);
    const result = await createModule(courseId, {
      name: mod.moduleName,
      position: mod.position,
    });
    moduleId = result.id;
  } else if (!moduleId) {
    moduleId = '<new>';
  }

  if (!dryRun) {
    // Recording the module before its items is not bookkeeping order but a
    // precondition: `setItem` refuses a row whose module names no Canvas
    // module, because the next push could not reconcile one.
    ensureModule(syncData, mod.folderName, {
      canvas_module_id: moduleId,
      name: mod.moduleName,
      position: mod.position,
    });
  }

  // A module Canvas recreated under a new id starts empty, whatever the old one
  // held: matching against the items of a module that is gone would place every
  // item twice.
  const live = existingModuleId === moduleId ? liveItems : [];

  // Upload embedded files (images, etc.) referenced from markdown content
  const flatItems = flattenItems(mod.items);

  if (!dryRun) {
    const referencedFiles = new Set();
    for (const item of flatItems) {
      if (!item.relativePath || !item.relativePath.endsWith('.md')) continue;
      const filePath = path.resolve(COURSE_DIR, item.relativePath);
      try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const refs = extractFileReferences(raw, item.relativePath);
        for (const ref of refs) referencedFiles.add(ref);
      } catch {
        // File may not exist yet during dry run
      }
    }

    for (const ref of referencedFiles) {
      const localPath = path.resolve(COURSE_DIR, ref);
      if (!fs.existsSync(localPath)) {
        log.warn(`  [push] WARNING: Referenced file not found: ${ref}`);
        continue;
      }

      // Re-upload when the content changed since the last sync (hash mismatch)
      // or when the file has never been uploaded.
      const hash = sha256File(localPath);
      const tracked = syncData.files[ref];
      if (tracked && tracked.sha256 === hash) continue;
      if (tracked && tracked.sha256 === undefined) {
        // Entry predates hash tracking: upload once more to be safe and record the hash.
        log.verbose(
          `No stored hash for ${ref}, re-uploading to establish baseline`,
        );
      }

      log.verbose(`Uploading embedded file: ${ref}`);
      try {
        const result = await uploadFile(courseId, localPath, {
          parentFolderPath: mod.folderName,
        });
        syncData.files[ref] = {
          canvas_file_id: result.id,
          canvas_url: `/courses/${courseId}/files/${result.id}/preview`,
          sha256: hash,
        };
      } catch (err) {
        log.error(`  [push] Error uploading file "${ref}": ${err.message}`);
        errors.push({ module: ref, error: err.message });
      }
    }
  }

  // Process items (including subheader items)
  const totalItems = flatItems.length;

  // What the module should contain when this is over, in order, each entry
  // shaped as `createModuleItem` takes it. Pushing the content is one job and
  // arranging the module is another: the list is gathered here as each item's
  // Canvas identity comes back, and reconciled against Canvas in one pass
  // afterwards, so an item that is already in the right place at the right
  // title costs no request at all.
  const desired = [];
  // Every item that made it into `desired`, keyed by its position in it, so the
  // module item ids the reconcile settles can be recorded against the right
  // file. A text header has no file and so is not in here.
  const placedItems = new Map();

  for (let ii = 0; ii < flatItems.length; ii++) {
    const item = flatItems[ii];
    const itemTitle = item.title || item.file || 'unknown';
    log.verbose(`Item ${ii + 1}/${totalItems}: ${itemTitle}`);
    try {
      const moduleItem = await pushItem(
        courseId,
        moduleId,
        item,
        dryRun,
        iconUrls,
        mod.folderName,
        relativeToCanvas,
        unresolvedItems,
        syncData,
      );
      if (moduleItem) {
        if (item.relativePath) placedItems.set(desired.length, item);
        desired.push(moduleItem);
        // The filename is the address and `title:` is the display name, so an
        // item this push placed carries its title in the file from now on.
        // Without it, renaming the file would rename the Canvas item too.
        if (!dryRun) writeTitleIfAbsent(item);
      }
      // Track the item under its path. The module-item-only types have no id
      // until the reconcile has run, so they wait for it below.
      if (
        !dryRun &&
        item.relativePath &&
        item._canvasId != null &&
        !isModuleItemOnlyType(item.canvasType)
      ) {
        recordItem(syncData, mod.folderName, item, {
          canvasId: item._canvasId,
          pageUrl: item._pageUrl,
        });
      }
    } catch (err) {
      log.error(`  [push] Error pushing item "${itemTitle}": ${err.message}`);
      errors.push({
        module: `${mod.folderName}/${itemTitle}`,
        error: err.message,
      });
    }
  }

  const plan = reconcileModuleItems({ live, desired });
  recordItemClaims(ledger, moduleId, desired);
  recordLeftoverItems(ledger, mod, moduleId, plan.leftover);

  if (dryRun) {
    log.info(
      `[push] DRY RUN: module items — ${plan.create.length} to create, ` +
        `${plan.update.length} to update, ${plan.unchanged.length} already ` +
        `correct, ${plan.leftover.length} with no local source.`,
    );
    return;
  }

  const applied = await applyModuleItems(courseId, moduleId, plan);

  for (const failure of applied.errors) {
    const label = failure.desired.title || 'unknown';
    log.error(
      `  [push] Error placing item "${label}" in the module: ${failure.error}`,
    );
    errors.push({
      module: `${mod.folderName}/${label}`,
      error: failure.error,
    });
  }

  recordModuleItemIds(syncData, mod.folderName, applied.placed, placedItems);
}

/**
 * The items Canvas holds in a module, as plain input to the reconcile.
 *
 * A module that is not on Canvas yet, or a 404 on one that was, holds nothing:
 * push is about to create it. Any other failure is fatal to this module and has
 * to stay that way — a reconcile that believes the module is empty places every
 * item a second time, so the whole course would double.
 */
async function readModuleItems(courseId, existingModuleId) {
  if (!existingModuleId) return [];
  try {
    return (await listModuleItems(courseId, existingModuleId)) || [];
  } catch (err) {
    if (err.message.includes('404')) return [];
    throw new Error(
      `could not list the items Canvas holds in this module (${err.message}). ` +
        'Push matches its own items against that list before it writes, so a ' +
        'module it could not read is left untouched rather than filled with ' +
        'a second copy of everything.',
    );
  }
}

/**
 * Whether this type exists only as a module item, with no Canvas object of its
 * own behind it. Both get their `canvas_id` from the reconcile rather than from
 * a create of their own.
 */
function isModuleItemOnlyType(canvasType) {
  return canvasType === 'external_url' || canvasType === 'external_tool';
}

/**
 * Record the module item id the reconcile settled on, for every item that ended
 * up in the module.
 *
 * Every type gets one, not just the two that need it as their identity. The
 * module item is a Canvas object in its own right — it carries the title, the
 * indent and the position — and the id is the only way to address it without
 * searching the list again. Now that the reconcile keeps those ids stable, one
 * that is written down stays true, and the planner matches the reference types
 * on it.
 *
 * For an external URL and an LTI link the module item is the whole of the
 * thing, so its id is their `canvas_id` too. Nothing goes into the file: the id
 * used to be written there as well, which made the frontmatter a second, older
 * copy of something Canvas alone decides — and one a `reset-sync-state` could
 * not reach, because the file it lived in was not the file being reset.
 */
function recordModuleItemIds(syncData, folder, placed, placedItems) {
  if (placedItems.size === 0) return;
  for (const entry of placed) {
    const item = placedItems.get(entry.index);
    if (!item || entry.id == null) continue;
    recordItem(syncData, folder, item, {
      canvasId: isModuleItemOnlyType(item.canvasType) ? entry.id : undefined,
      moduleItemId: entry.id,
    });
    log.verbose(`Recorded module item ${entry.id} for ${item.relativePath}`);
  }
}

/**
 * Write `title:` into a markdown item's frontmatter when it has none.
 *
 * The Canvas title otherwise falls back to the de-prefixed filename, which
 * quietly couples the two: renaming the file renames the Canvas item, and
 * `renumber` renames files by the dozen. Writing the title once breaks that
 * coupling for good — the filename becomes the address, `title:` the display
 * name — and it is written once, because a file that already has one is left
 * exactly as it is.
 *
 * The key goes first in the block: it is the one an author reads.
 */
function writeTitleIfAbsent(item) {
  if (!item.relativePath || !item.relativePath.endsWith('.md')) return;
  if (!item.frontmatter || item.frontmatter.title != null) return;

  const filePath = path.resolve(COURSE_DIR, item.relativePath);
  try {
    const { data, content } = parseFrontmatter(
      fs.readFileSync(filePath, 'utf8'),
    );
    if (data.title != null) return;
    fs.writeFileSync(
      filePath,
      serializeFrontmatter({ title: item.title, ...data }, content),
      'utf8',
    );
    item.frontmatter.title = item.title;
    log.verbose(`Wrote title "${item.title}" to ${item.relativePath}`);
  } catch (err) {
    log.warn(
      `  [push] Could not write the title into ${item.relativePath}: ${err.message}`,
    );
  }
}

/**
 * The run's module-item ledger.
 *
 * `claims` maps every identity some module's local files laid claim to onto the
 * modules that claimed it; `leftovers` holds every live item a module's own
 * files did not account for. The two only mean anything together, and only once
 * the whole run is in — see `resolveLeftoverItems`.
 */
function createItemLedger() {
  return { claims: new Map(), leftovers: [] };
}

/** Note which module laid claim to which identity, for the leftover verdict. */
function recordItemClaims(ledger, moduleId, desired) {
  for (const want of desired) {
    for (const key of moduleItemKeys(want, 'desired')) {
      if (!ledger.claims.has(key)) ledger.claims.set(key, new Set());
      ledger.claims.get(key).add(String(moduleId));
    }
  }
}

/** Hold one module's unclaimed live items until the run can judge them. */
function recordLeftoverItems(ledger, mod, moduleId, leftover) {
  for (const item of leftover) {
    ledger.leftovers.push({
      moduleId: String(moduleId),
      moduleName: mod.moduleName,
      folderName: mod.folderName,
      item,
      keys: moduleItemKeys(item, 'live'),
    });
  }
}

/**
 * Whether another module in this run claimed the identity of this leftover.
 *
 * Deliberately another module and not any module: two subheaders in one module
 * under a title the local tree uses once is a duplicate, not a move, and this
 * is not the mechanism that decides what to do about that.
 */
function movedToAnotherModule(ledger, entry) {
  return entry.keys.some((key) => {
    const owners = ledger.claims.get(key);
    if (!owners) return false;
    for (const owner of owners) if (owner !== entry.moduleId) return true;
    return false;
  });
}

/**
 * Settle every module item Canvas holds that its own module's local files did
 * not account for, now that the whole run is in.
 *
 * Two unrelated things land in that pile, and only the finished run tells them
 * apart. An item another module claimed this run **moved**: `movetomodule-item`
 * renames the file into the other folder and touches Canvas not at all, so push
 * is what finishes the job — and leaving the old listing behind would show the
 * author the same page in two modules, which is worse than the rebuild this
 * commit replaced. So the stale listing goes, flag or no flag: the author
 * already asked for the move.
 *
 * An item **nobody** claimed was added in Canvas by hand, or belongs to
 * something outside this repository. It is left exactly where it is and merely
 * named. Removing one of those is pruning, and pruning waits for its flag.
 *
 * Removing a module item is not removing content. A module item is a listing;
 * the page, assignment, discussion, quiz or file behind it is a separate Canvas
 * object that nothing here touches, and after a move it is listed by the module
 * it moved to. An external URL and an LTI link are the one nuance — the module
 * item is the whole of them — but a moved one has just been created in its new
 * module, so nothing is lost there either.
 */
async function resolveLeftoverItems(courseId, ledger, dryRun, errors) {
  const moved = [];
  const strays = [];
  for (const entry of ledger.leftovers) {
    (movedToAnotherModule(ledger, entry) ? moved : strays).push(entry);
  }

  if (moved.length > 0) {
    log.info(
      `\n[push] ${moved.length} item(s) moved to another module this run, and ` +
        `${dryRun ? 'would be removed' : 'were removed'} from the module they left:`,
    );
    for (const entry of moved) {
      log.info(
        `${describeLeftoverItem(entry.item)}  (was in "${entry.moduleName}")`,
      );
      if (dryRun) continue;
      try {
        await deleteModuleItem(courseId, entry.moduleId, entry.item.id);
      } catch (err) {
        if (err.message.includes('404')) {
          log.verbose(`Module item ${entry.item.id} was already gone`);
          continue;
        }
        log.error(
          `  [push] Could not remove "${entry.item.title}" from ` +
            `"${entry.moduleName}": ${err.message}`,
        );
        errors.push({
          module: entry.folderName,
          error:
            `could not remove the moved item "${entry.item.title}" from this ` +
            `module (${err.message}), so it is listed in two modules`,
        });
      }
    }
    log.info(
      '[push] Only the listing went: the page, assignment, discussion, quiz or ' +
        'file behind a module item is a separate Canvas object and is untouched, ' +
        'and the module it moved to lists it now.',
    );
  }

  if (strays.length === 0) return;

  const byModule = new Map();
  for (const entry of strays) {
    if (!byModule.has(entry.moduleId)) byModule.set(entry.moduleId, []);
    byModule.get(entry.moduleId).push(entry);
  }
  for (const entries of byModule.values()) {
    const { moduleName, folderName } = entries[0];
    log.info(
      `\n[push] ${entries.length} item(s) in the Canvas module "${moduleName}" ` +
        `have no source file in course/${folderName}/:`,
    );
    for (const entry of entries) log.info(describeLeftoverItem(entry.item));
  }
  log.info(
    '[push] They were left untouched, in place and in order. Push only writes ' +
      'the items it can account for; nothing here removes one.',
  );
}

function sha256File(filePath) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(filePath))
    .digest('hex');
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

/**
 * Push one item's content to Canvas and hand back the module item that should
 * point at it, or null when there is nothing to place — a skipped item, a type
 * push does not know, or a dry run, which writes nothing and therefore resolves
 * no identity to place anything by.
 *
 * The module item is returned rather than created here: the caller collects the
 * whole list and reconciles it against Canvas in one pass.
 */
async function pushItem(
  courseId,
  moduleId,
  item,
  dryRun,
  iconUrls,
  folderName,
  relativeToCanvas,
  unresolvedItems,
  syncData,
) {
  if (item.type === 'subheader') {
    log.verbose(`Adding SubHeader: ${item.title}`);
    // A text header has no Canvas object behind it, so it is fully described
    // from the folder structure — a dry run knows it exactly.
    return {
      title: item.title,
      type: 'SubHeader',
      position: item.position,
      indent: item.indent,
    };
  }

  const { canvasType, title, frontmatter, relativePath, position, indent } =
    item;
  const filePath = path.resolve(COURSE_DIR, relativePath);
  // Which Canvas object this file is, asked of the one place that knows. The
  // file itself no longer carries the answer.
  const stored = getItem(syncData, relativePath);
  const canvasId = (stored && stored.entry.canvas_id) || null;

  if (canvasType === 'page') {
    const { pageUrl, moduleItem, resolvedId } = await pushContentItem(
      courseId,
      {
        title,
        filePath,
        relativePath,
        canvasId,
        position,
        indent,
        frontmatter,
      },
      dryRun,
      iconUrls,
      relativeToCanvas,
      unresolvedItems,
      syncData,
      pageStrategy,
    );
    if (pageUrl) item._pageUrl = pageUrl;
    item._canvasId = resolvedId;
    return moduleItem;
  } else if (canvasType === 'assignment') {
    const { moduleItem, resolvedId } = await pushContentItem(
      courseId,
      {
        title,
        filePath,
        relativePath,
        canvasId,
        position,
        indent,
        frontmatter,
      },
      dryRun,
      iconUrls,
      relativeToCanvas,
      unresolvedItems,
      syncData,
      assignmentStrategy,
    );
    item._canvasId = resolvedId;
    return moduleItem;
  } else if (canvasType === 'discussion') {
    const { moduleItem, resolvedId } = await pushContentItem(
      courseId,
      {
        title,
        filePath,
        relativePath,
        canvasId,
        position,
        indent,
        frontmatter,
      },
      dryRun,
      iconUrls,
      relativeToCanvas,
      unresolvedItems,
      syncData,
      discussionStrategy,
    );
    item._canvasId = resolvedId;
    return moduleItem;
  } else if (canvasType === 'external_url') {
    return pushExternalUrl({ title, position, indent, frontmatter });
  } else if (canvasType === 'external_tool') {
    return pushExternalTool(
      courseId,
      { title, position, indent, frontmatter },
      dryRun,
    );
  } else if (canvasType === 'quiz') {
    const moduleItem = await pushQuiz(
      courseId,
      { title, canvasId, position, indent, frontmatter },
      dryRun,
    );
    if (moduleItem) item._canvasId = moduleItem.contentId;
    return moduleItem;
  } else if (canvasType === 'file') {
    // Resolve file_ref from markdown wrapper to actual binary path
    let binaryPath = filePath;
    if (filePath.endsWith('.md') && frontmatter.file_ref) {
      binaryPath = path.resolve(path.dirname(filePath), frontmatter.file_ref);
    }
    const moduleItem = await pushFile(
      courseId,
      {
        title,
        filePath: binaryPath,
        canvasId,
        position,
        indent,
        folderName,
      },
      dryRun,
    );
    if (moduleItem) item._canvasId = moduleItem.contentId;
    return moduleItem;
  }
  log.warn(`  [push] Skipping unknown type "${canvasType}": ${title}`);
  return null;
}

/**
 * Push a content item (page, assignment or discussion) to Canvas.
 *
 * Handles create-or-update and unresolved link tracking, and describes the
 * module item that should point at the result. Placing that item is the
 * caller's job — the module's whole list is reconciled at once, so this never
 * writes to the module itself.
 *
 * @returns {Promise<{pageUrl: string|null, moduleItem: object|null,
 *   resolvedId: string|number|null}>} `resolvedId` is the Canvas id the run
 *   settled on, for the caller to record in the sync state; null in a dry run,
 *   which resolves nothing.
 */
async function pushContentItem(
  courseId,
  { title, filePath, relativePath, canvasId, position, indent, frontmatter },
  dryRun,
  iconUrls,
  relativeToCanvas,
  unresolvedItems,
  syncData,
  strategy,
) {
  const raw = fs.readFileSync(filePath, 'utf8');

  let hasUnresolved = false;
  const linkResolver = (href) => {
    const { resolved, wasInternal } = resolveRelativeLink(
      href,
      relativePath,
      relativeToCanvas,
      courseId,
    );
    if (wasInternal) hasUnresolved = true;
    return resolved;
  };
  const fileResolver = buildFileResolver(relativePath, syncData);
  const html = markdownToHtml(raw, {
    iconUrls,
    alertTitles: loadCourseConfig().labels.alerts,
    linkResolver,
    fileResolver,
  });

  const opts = strategy.buildOpts(title, html, frontmatter);
  let itemId = canvasId;
  let slug = null;

  if (canvasId) {
    log.verbose(`Updating ${strategy.canvasType}: ${title} (id: ${canvasId})`);
    if (!dryRun) {
      try {
        const result = await strategy.update(courseId, canvasId, opts);
        itemId = strategy.extractId(result);
        slug = strategy.extractSlug ? strategy.extractSlug(result) : null;
      } catch (err) {
        if (err.message.includes('404')) {
          log.warn(
            `    [push] ${strategy.label} ${canvasId} not found on Canvas, creating new`,
          );
          canvasId = null;
        } else {
          throw err;
        }
      }
    }
  }

  if (!canvasId) {
    log.verbose(`Creating ${strategy.canvasType}: ${title}`);
    if (!dryRun) {
      const result = await strategy.create(courseId, opts);
      itemId = strategy.extractId(result);
      slug = strategy.extractSlug ? strategy.extractSlug(result) : null;
    }
  }

  // A dry run resolves no Canvas identity of its own, so the module item is
  // described from what the sync state already knows. An item with no id yet is
  // genuinely new, and a descriptor carrying no identity is exactly how the
  // reconcile reads a create — which is what it would be.
  const identifier = dryRun ? canvasId : slug || itemId;
  const moduleItem =
    dryRun || identifier
      ? strategy.buildModuleItem(title, identifier, position, indent)
      : null;
  if (moduleItem && strategy.canvasType === 'page') {
    // Canvas regenerates a page's slug from its title, so the numeric wiki page
    // id is the only identity of a Page item that survives a rename. It rides
    // along for the reconcile to match on and never reaches Canvas:
    // `createModuleItem` does not read it.
    const pageId = numericId(itemId);
    if (pageId != null) moduleItem.pageId = pageId;
    // A dry run has the numeric id and not the slug, so it has just put a
    // number where the slug goes. The slug the last sync recorded is the only
    // one available without a request, and it is what an instance that reports
    // no content_id on a Page item has to be matched on.
    if (numericId(moduleItem.pageUrl) != null) {
      const known = storedPageUrl(syncData, moduleItem.pageUrl);
      if (known) moduleItem.pageUrl = known;
      else delete moduleItem.pageUrl;
    }
  }

  if (hasUnresolved && !dryRun && itemId) {
    unresolvedItems.push({
      courseId,
      relativePath,
      filePath,
      canvasId: itemId,
      canvasType: strategy.canvasType,
      iconUrls,
    });
  }

  return {
    pageUrl: slug || null,
    moduleItem,
    resolvedId: dryRun ? null : itemId || null,
  };
}

/**
 * The page slug the last sync recorded for this page id, or null.
 *
 * A page item names its page by slug while the sync state holds the numeric id,
 * and the course's page list is normally what bridges the two — at the cost of
 * a request. The same state stores both halves of the pair, which is enough for
 * a dry run, whose whole job is to answer without asking Canvas anything it has
 * not already been told.
 */
function storedPageUrl(syncData, canvasId) {
  if (!syncData || canvasId == null) return null;
  const wanted = String(canvasId);
  for (const { entry } of allItems(syncData)) {
    if (entry.canvas_type !== 'page' || !entry.page_url) continue;
    if (String(entry.canvas_id) === wanted) return String(entry.page_url);
  }
  return null;
}

/** A value read as a Canvas numeric id, or null when it is not one. */
function numericId(value) {
  if (typeof value === 'number') return Number.isInteger(value) ? value : null;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  return null;
}

/** Strategy for pushing pages. */
const pageStrategy = {
  canvasType: 'page',
  label: 'Page',
  buildOpts: (title, html) => ({ title, body: html }),
  create: createPage,
  update: updatePage,
  extractId: (result) => result.page_id || result.url,
  extractSlug: (result) => result.url,
  buildModuleItem: (title, slug, position, indent) => ({
    title,
    type: 'Page',
    pageUrl: slug,
    position,
    indent,
  }),
};

/** Strategy for pushing assignments. */
const assignmentStrategy = {
  canvasType: 'assignment',
  label: 'Assignment',
  buildOpts: (title, html, frontmatter) => {
    const opts = { name: title, description: html };
    if (frontmatter.points_possible != null)
      opts.pointsPossible = frontmatter.points_possible;
    if (frontmatter.submission_types)
      opts.submissionTypes = frontmatter.submission_types;
    if (frontmatter.due_at) opts.dueAt = frontmatter.due_at;
    if (frontmatter.unlock_at) opts.unlockAt = frontmatter.unlock_at;
    if (frontmatter.lock_at) opts.lockAt = frontmatter.lock_at;
    if (frontmatter.published != null) opts.published = frontmatter.published;
    return opts;
  },
  create: createAssignment,
  update: updateAssignment,
  extractId: (result) => result.id,
  extractSlug: null,
  buildModuleItem: (title, contentId, position, indent) => ({
    title,
    type: 'Assignment',
    contentId,
    position,
    indent,
  }),
};

/**
 * Say so when Canvas reports the topic it just took as graded, and hand the
 * result straight back so this can wrap create and update.
 */
function warnIfGradedDiscussion(result) {
  const line = gradedDiscussionWarning(result);
  if (line) log.warn(`    [push] ${line}`);
  return result;
}

/** Strategy for pushing discussions. */
const discussionStrategy = {
  canvasType: 'discussion',
  label: 'Discussion',
  buildOpts: (title, html, frontmatter) => {
    const opts = { title, message: html };
    if (frontmatter.discussion_type)
      opts.discussionType = frontmatter.discussion_type;
    if (frontmatter.require_initial_post != null)
      opts.requireInitialPost = frontmatter.require_initial_post;
    if (frontmatter.delayed_post_at)
      opts.delayedPostAt = frontmatter.delayed_post_at;
    if (frontmatter.lock_at) opts.lockAt = frontmatter.lock_at;
    if (frontmatter.published != null) opts.published = frontmatter.published;
    return opts;
  },
  create: async (courseId, opts) =>
    warnIfGradedDiscussion(await createDiscussion(courseId, opts)),
  update: async (courseId, id, opts) =>
    warnIfGradedDiscussion(await updateDiscussion(courseId, id, opts)),
  extractId: (result) => result.id,
  extractSlug: null,
  buildModuleItem: (title, contentId, position, indent) => ({
    title,
    type: 'Discussion',
    contentId,
    position,
    indent,
  }),
};

/** A value as it should read inside a warning; an absent one says so. */
function describeValue(value) {
  if (value == null || value === '') return 'not set';
  if (Array.isArray(value)) return value.join(', ');
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/** Two dates are the same date when they name the same instant, however written. */
function asInstant(value) {
  if (value == null || value === '') return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? String(value) : time;
}

/** Submission types compare as a set: order and spacing are Canvas's business. */
function asTypeSet(value) {
  if (value == null) return '';
  const list = Array.isArray(value) ? value : String(value).split(',');
  return list
    .map((type) => String(type).trim())
    .filter(Boolean)
    .sort()
    .join(',');
}

/**
 * The three fields push sends that move grades on an assignment students have
 * already submitted to. Canvas applies each one silently: its web editor warns
 * about them, its API does not, so this is the only place the warning can come
 * from. `sent` reads what push is about to send, `live` what Canvas holds now.
 */
const GRADE_IMPACT_FIELDS = [
  {
    name: 'points_possible',
    sent: (opts) => opts.pointsPossible,
    live: (assignment) => assignment.points_possible,
    normalize: (value) =>
      value == null || value === '' ? null : Number(value),
    consequence:
      'Canvas does not rescale the grades already given: the raw scores stay ' +
      'as they are, so every percentage in that gradebook column moves.',
  },
  {
    name: 'due_at',
    sent: (opts) => opts.dueAt,
    live: (assignment) => assignment.due_at,
    normalize: asInstant,
    consequence:
      'Canvas recomputes late status against the new date, so an automatic ' +
      'late policy re-applies or drops its deductions on submissions that ' +
      'are already graded.',
  },
  {
    name: 'submission_types',
    sent: (opts) => opts.submissionTypes,
    live: (assignment) => assignment.submission_types,
    normalize: asTypeSet,
    consequence:
      'Canvas only accepts that change while an assignment has no ' +
      'submissions: it ignores this one, reports the push as a success, and ' +
      'keeps the value it already has, which the frontmatter no longer matches.',
  },
];

/**
 * The warning lines for one assignment about to be updated: one per field that
 * changes value and moves grades with it.
 *
 * An assignment with no submissions has no grades to move, so it stays silent.
 * A submission state that could not be read is never treated as that, though —
 * it gets the same warning, hedged.
 *
 * @param {string} label     - The assignment, named as it is in the warning.
 * @param {object} opts      - What push is about to send (from buildOpts).
 * @param {object} current   - The Canvas Assignment object as it stands.
 * @returns {string[]}
 */
function gradeImpactWarnings(label, opts, current) {
  const state = hasStudentSubmissions(current);
  if (state === false) return [];

  const lead =
    state === true
      ? `WARNING: ${label} has student submissions, and this push changes`
      : `WARNING: could not determine whether ${label} has student ` +
        'submissions, and this push changes';
  const hedge = state === true ? '' : 'Treat it as if it does. ';

  const lines = [];
  for (const field of GRADE_IMPACT_FIELDS) {
    const sent = field.sent(opts);
    // Not sent, not changed: buildOpts leaves a field out entirely when the
    // frontmatter has none, and Canvas keeps whatever it holds.
    if (sent === undefined) continue;
    const live = field.live(current);
    if (field.normalize(sent) === field.normalize(live)) continue;

    lines.push(
      `${lead} ${field.name} from ${describeValue(live)} to ` +
        `${describeValue(sent)}. ${hedge}${field.consequence}`,
    );
  }
  return lines;
}

/**
 * The assignments a run will update: the ones the sync state already knows.
 *
 * An assignment with no row is about to be created, so it cannot hold student
 * work yet and needs no check. Each entry carries the options push itself will
 * send, built by the same buildOpts, so the comparison can never drift from
 * what actually goes over the wire. The description is irrelevant to all three
 * fields, so an empty body is enough to build them.
 */
function collectUpdatedAssignments(syncData, localModules) {
  const updated = [];
  for (const mod of localModules) {
    for (const item of flattenItems(mod.items)) {
      if (item.type === 'subheader' || !item.frontmatter) continue;
      if (item.canvasType !== 'assignment') continue;
      const stored = getItem(syncData, item.relativePath);
      if (!stored || stored.entry.canvas_id == null) continue;
      updated.push({
        title: item.title,
        relativePath: item.relativePath,
        canvasId: stored.entry.canvas_id,
        opts: assignmentStrategy.buildOpts(item.title, '', item.frontmatter),
      });
    }
  }
  return updated;
}

/**
 * Warn about every field this push is about to change on an assignment that
 * students have already submitted to.
 *
 * Push sends the whole assignment on every update, and three of those fields
 * move grades that are already in the gradebook. What gets sent is unchanged
 * and nothing is blocked: a re-weighting can be deliberate, and only the author
 * knows. Naming the old and the new value is what separates the deliberate
 * change from the typo.
 *
 * One list request answers it for the entire run: the Assignment objects a list
 * returns carry has_submitted_submissions along with the current value of all
 * three fields, so nothing needs fetching per assignment. A run that updates no
 * existing assignment makes no request at all.
 *
 * A lookup that fails costs the warning, never the push.
 *
 * @param {string|number} courseId
 * @param {object} syncData             - Loaded sync state; the source of the ids.
 * @param {object[]} localModules       - The modules this run pushes.
 * @param {Function} [fetchAssignments] - Injection point for tests.
 * @returns {Promise<string[]>} The warning lines, already logged.
 */
async function warnGradeImpact(
  courseId,
  syncData,
  localModules,
  fetchAssignments = listAssignments,
) {
  const updated = collectUpdatedAssignments(syncData, localModules);
  if (updated.length === 0) return [];

  let current;
  try {
    current = await fetchAssignments(courseId);
  } catch (err) {
    log.warn(
      '\n[push] WARNING: could not check the assignments for student ' +
        `submissions, so this push may change grades without saying so: ${err.message}`,
    );
    return [];
  }

  const byId = new Map();
  for (const assignment of current || []) {
    byId.set(String(assignment.id), assignment);
  }

  const lines = [];
  for (const { title, relativePath, canvasId, opts } of updated) {
    const assignment = byId.get(String(canvasId));
    // An id Canvas does not list is gone: push recreates the assignment, and a
    // new one holds no student work.
    if (!assignment) continue;
    lines.push(
      ...gradeImpactWarnings(`"${title}" (${relativePath})`, opts, assignment),
    );
  }

  for (const line of lines) log.warn(`\n[push] ${line}`);
  return lines;
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

/**
 * Describe an external URL as a module item.
 *
 * There is no Canvas object to create or update: the module item is the whole
 * of it, so this resolves nothing, makes no request, and only says what the
 * item should be — which is why it needs no dry-run branch. Its Canvas id comes
 * back from the reconcile, and `recordModuleItemIds` is what writes it down.
 */
function pushExternalUrl({ title, position, indent, frontmatter }) {
  const url = frontmatter.external_url;
  if (!url) {
    log.warn(
      `  [push] WARNING: Skipping "${title}" — canvas_type is external_url but external_url field is missing in frontmatter`,
    );
    return null;
  }

  log.info(`  [push] External URL module item: ${title} -> ${url}`);

  // Nothing to resolve: the frontmatter is the whole of it, in a dry run as
  // much as in a real one.
  return {
    title,
    type: 'ExternalUrl',
    externalUrl: url,
    position,
    indent,
    newTab: frontmatter.new_tab !== false,
  };
}

/**
 * Say that no installed tool claims this launch URL, and what to do about it.
 *
 * The remedies are the two that outlive a single push. An account-level install
 * is inherited by every course in the account — a course resolves a tool by
 * searching itself and then its account chain — so it keeps working after a
 * rollover to next year's course, which a stored tool id never would. Course
 * Copy is the other one: Canvas carries the tool installation over itself.
 *
 * The tool list is fetched only here, on the failure path, and only to name
 * what is installed: it cannot decide the question, because for LTI 1.3 it
 * over-reports tools that Canvas then filters by context controls.
 */
async function warnNoMatchingTool(courseId, title, url) {
  log.warn(
    `  [push] WARNING: no external tool in this course matches the launch URL of "${title}" (${url}). ` +
      'Canvas creates the module item anyway and reports no error; the failure only shows when a ' +
      'student clicks it and gets "Couldn\'t find valid settings for this link".',
  );

  let installed;
  try {
    installed = describeInstalledTools(await listExternalTools(courseId));
  } catch (err) {
    installed = `the tools installed here could not be listed (${err.message})`;
  }
  log.warn(`    [push] Right now ${installed}.`);

  log.warn(
    '    [push] Two ways to fix it for good: ask your Canvas admin to install the tool at ACCOUNT ' +
      'level, because a course resolves a tool by searching itself and then its account chain — an ' +
      'account-level tool is therefore present in every future course and survives a rollover; or ' +
      "seed the new course with Canvas's own Course Copy, which carries the tool installation over " +
      'with it.',
  );
}

/**
 * Push an LTI link as a module item.
 *
 * Like an external URL, an external tool has no Canvas object of its own to
 * create or update — the module item is the whole of it, and Canvas resolves
 * which tool answers it from the launch URL every time. That is also what makes
 * the type survive a rollover: a launch URL still means something in next
 * year's course, a tool id from this year's does not.
 *
 * So this probes the launch URL and describes the item; placing it, and writing
 * down the id Canvas gives it, belongs to the reconcile.
 */
async function pushExternalTool(
  courseId,
  { title, position, indent, frontmatter },
  dryRun,
) {
  const url = frontmatter.external_url;
  if (!url) {
    log.warn(
      `  [push] WARNING: Skipping "${title}" — canvas_type is external_tool but external_url field is missing in frontmatter`,
    );
    return null;
  }

  log.info(`  [push] External tool module item: ${title} -> ${url}`);

  const moduleItem = {
    title,
    type: 'ExternalTool',
    externalUrl: url,
    position,
    indent,
    ...(frontmatter.new_tab != null ? { newTab: frontmatter.new_tab } : {}),
  };
  // The frontmatter describes the item on its own; the probe below is the only
  // part that costs a request, so a dry run stops here.
  if (dryRun) return moduleItem;

  // Canvas fails silently on an unmatched launch URL, so ask first. Whatever
  // the answer, the item is still created: a visible broken item the author can
  // see and fix beats dropping their content on the floor.
  const probe = await findToolForUrl(courseId, url);
  if (probe.status === 'no-match') {
    await warnNoMatchingTool(courseId, title, url);
  } else if (probe.status === 'unknown') {
    log.warn(
      `  [push] WARNING: could not check whether an external tool matches the launch URL of ` +
        `"${title}" (${url}): ${probe.reason}. The item is created without the check — this says ` +
        'nothing about whether it works, so open it in Canvas to be sure.',
    );
  }

  return moduleItem;
}

/**
 * Say that the quiz this item points at is not in the course, and how to put it
 * there.
 *
 * The steps are the ones `/quiz-build` prints beside the package it generated
 * (`.agents/skills/quiz-build/SKILL.md`), because a QTI package has no API
 * import: Canvas takes it only through the web interface. Naming the zip is the
 * point — it is the one thing that says which package this item is waiting for.
 */
function warnQuizNotImported(title, quizRef) {
  if (!quizRef) {
    log.warn(
      `  [push] WARNING: Skipping "${title}" — this course holds no quiz by that name, and this ` +
        'file names no quiz_ref, so there is no package to import either. Create the quiz in ' +
        `Canvas under the title "${title}", or point quiz_ref at its QTI .zip (path from the ` +
        'repository root), then push again.',
    );
    return;
  }
  log.warn(
    `  [push] WARNING: Skipping "${title}" — this course holds no quiz by that name yet. ` +
      `Import ${quizRef} by hand first; Canvas has no API for a QTI import:`,
  );
  log.warn(
    '    [push] 1. Canvas -> the course -> Settings -> Import Course Content.',
  );
  log.warn(`    [push] 2. Content Type "QTI .zip file"; choose ${quizRef}.`);
  log.warn(
    '    [push] 3. Leave the default question bank; tick "Import existing quizzes as New ' +
      'Quizzes" only if the course uses New Quizzes.',
  );
  log.warn(
    '    [push] 4. Import, and wait for "Completed" under Current Jobs.',
  );
  log.warn(
    '    [push] 5. The quiz arrives unpublished: check every question and point value, set ' +
      'the availability dates and the time limit (QTI carries none of those), then publish.',
  );
  log.warn(
    `    [push] Then push again. The quiz is found by its title, so leave it named "${title}" ` +
      'in Canvas, and its id is recorded in the sync state.',
  );
}

/**
 * Add a quiz to a module as an item, and never touch the quiz itself.
 *
 * A Classic Quiz has no markdown source: the QTI package named by `quiz_ref` is
 * what produced it, and it entered Canvas through a manual import. So this
 * creates the module item and stops there — no create, no update, no delete on
 * the quiz object, which holds questions and submissions that nothing here
 * could reconstruct.
 *
 * Which quiz an item names is resolved from the id the sync state holds for
 * this path while the course still lists it, and by title otherwise, handing
 * the id it found back for the caller to record. That is the stale-id recovery
 * `pushContentItem` already does for pages and assignments, with the one
 * difference that a quiz can only ever be found: when the title matches nothing
 * there is no falling back to creating it, and the item is skipped with the
 * import procedure printed.
 *
 * Two quizzes under one title are ambiguous and also skipped. A guess would
 * link students to the wrong quiz, and this is exactly the state a second
 * import of the same package leaves behind, so it is a case that happens.
 *
 * `quiz_ref` does not gate any of that. It names the package to import when the
 * quiz is missing, and it is what lets a rollover into a fresh course rebuild
 * one, so `validate` warns when it is absent. But a quiz pulled from Canvas
 * never has one, and refusing to place an item whose id resolves would drop
 * that quiz out of its module on the next push — the loss this type exists to
 * prevent.
 */
async function pushQuiz(
  courseId,
  { title, canvasId, position, indent, frontmatter },
  dryRun,
) {
  const quizRef = frontmatter.quiz_ref;

  log.info(`  [push] Adding quiz module item: ${title}`);
  if (dryRun) {
    // Which quiz an item names is resolved against the course's quiz list, and
    // a dry run does not fetch it. An id the sync state already holds is enough
    // to place the item in the plan; without one there is nothing to plan yet,
    // and guessing at a create would be wrong — a quiz is never created here.
    return canvasId != null
      ? { title, type: 'Quiz', contentId: canvasId, position, indent }
      : null;
  }

  const quizzes = (await listQuizzes(courseId)) || [];
  let quizId = null;

  if (
    canvasId != null &&
    quizzes.some((quiz) => String(quiz.id) === String(canvasId))
  ) {
    quizId = canvasId;
  } else {
    if (canvasId != null) {
      log.warn(
        `    [push] Quiz ${canvasId} is no longer in this course, matching "${title}" by title instead`,
      );
    }

    const wanted = String(title).trim();
    const matches = quizzes.filter(
      (quiz) => String(quiz.title || '').trim() === wanted,
    );

    if (matches.length > 1) {
      log.warn(
        `  [push] WARNING: Skipping "${title}" — ${matches.length} quizzes in this course carry ` +
          `that title (ids ${matches.map((quiz) => quiz.id).join(', ')}), and picking one would be ` +
          'a guess. Importing a QTI package a second time adds a quiz rather than replacing the ' +
          "first: delete the stale one in Canvas, or put the id you mean in this item's " +
          'canvas_id in .canvas-sync.json.',
      );
      return null;
    }

    if (matches.length === 0) {
      warnQuizNotImported(title, quizRef);
      return null;
    }

    quizId = matches[0].id;
    log.verbose(`Matched quiz "${title}" by title: id ${quizId}`);
  }

  return {
    title,
    type: 'Quiz',
    contentId: quizId,
    position,
    indent,
  };
}

/**
 * Upload a file's binary to Canvas and describe the module item that should
 * point at it. Placing that item, and recording the id it came back with, are
 * the caller's job.
 */
async function pushFile(
  courseId,
  { title, filePath, canvasId, position, indent, folderName },
  dryRun,
) {
  log.info(`  [push] Uploading file: ${title}`);
  if (dryRun) {
    // The Canvas file id comes back from the upload, which a dry run does not
    // make; the id from the last push is the best it can say.
    return canvasId != null
      ? { title, type: 'File', contentId: canvasId, position, indent }
      : null;
  }

  // The Canvas file from the previous sync, so a rename can be detected.
  // Canvas uploads with on_duplicate=overwrite key on the filename, so a
  // renamed binary lands as a NEW Canvas file, orphaning the old one. We
  // compare the old file's display_name (not its id) against the name we're
  // about to upload so we never delete a file that overwrite replaced in place.
  const prevId = canvasId;
  const newName = path.basename(filePath);
  let prevName = null;
  if (prevId) {
    try {
      const prevMeta = await get(`/api/v1/files/${prevId}`);
      prevName = prevMeta && prevMeta.display_name;
    } catch (err) {
      // Old file already gone (e.g. deleted manually) — nothing to clean up.
      log.verbose(`Could not fetch previous file ${prevId}: ${err.message}`);
    }
  }

  const result = await uploadFile(courseId, filePath, {
    parentFolderPath: folderName,
  });
  const fileId = result.id;
  log.info(`    [push] Uploaded file id=${fileId}`);

  // The binary was renamed since the last sync: the upload above created a
  // fresh Canvas file, so delete the now-orphaned previous one.
  if (prevId && prevName && prevName !== newName) {
    try {
      await deleteFile(prevId);
      log.verbose(`Deleted orphaned file ${prevId} ("${prevName}")`);
    } catch (err) {
      log.warn(
        `    [push] Could not delete orphaned file ${prevId} ("${prevName}"): ${err.message}`,
      );
    }
  }

  return { title, type: 'File', contentId: fileId, position, indent };
}

/**
 * The repo-relative paths the local tree still holds, across the modules given.
 *
 * This is the whole of "claimed" in v4. A sync row is keyed by the path of the
 * file that produced it, so the question prune has to answer — is this Canvas
 * object still authored here? — is answered by the path being in the tree, and
 * by nothing else. The identity matching this replaces existed only because the
 * key was a Canvas id and the path was a value that could drift away from it.
 */
function collectLocalPaths(localModules) {
  const paths = new Set();
  for (const mod of localModules) {
    for (const item of flattenItems(mod.items)) {
      if (item.type === 'subheader' || !item.relativePath) continue;
      paths.add(toPosixPath(item.relativePath));
    }
  }
  return paths;
}

/**
 * Collect sync-state modules that no local folder claims.
 *
 * The folder name is the key, so a module the author deleted is simply a key
 * with no folder under `course/` any more.
 */
function collectDeletedModules(syncData, localModules) {
  const localFolders = new Set(localModules.map((m) => m.folderName));

  const toDelete = [];
  for (const [folder, entry] of Object.entries(syncData.modules || {})) {
    if (localFolders.has(folder)) continue;
    toDelete.push({
      folder,
      canvasModuleId:
        entry.canvas_module_id != null ? Number(entry.canvas_module_id) : null,
    });
  }
  return toDelete;
}

/**
 * Collect the rows (within the given local modules) whose file is no longer in
 * the tree. Paths are gathered from allModules (default: the scoped ones) so an
 * item moved to a module outside the scope is never mistaken for a deletion.
 */
function collectDeletedItems(syncData, localModules, allModules) {
  const claimed = collectLocalPaths(allModules || localModules);
  const toDelete = [];

  for (const mod of localModules) {
    const moduleEntry = getModule(syncData, mod.folderName);
    if (!moduleEntry) continue;

    for (const [itemPath, entry] of Object.entries(moduleEntry.items || {})) {
      if (claimed.has(itemPath)) continue;
      toDelete.push({
        folder: mod.folderName,
        moduleId:
          moduleEntry.canvas_module_id != null
            ? Number(moduleEntry.canvas_module_id)
            : null,
        relativePath: itemPath,
        canvasId: entry.canvas_id,
        canvasType: entry.canvas_type,
        pageUrl: entry.page_url,
        externalUrl: entry.external_url,
      });
    }
  }

  return toDelete;
}

/**
 * Why prune must not delete this assignment, or null when it may.
 *
 * Canvas lists the gradebook half of a graded Classic Quiz among the course's
 * assignments, and a `DELETE` on it deletes the quiz, its questions and every
 * submission. A local file that claimed `canvas_type: assignment` for such an
 * id is a mismatch between what the file says and what Canvas holds, and only
 * the author can settle it — so prune stops, and stops equally when the check
 * itself could not be made. Nothing is destroyed on a guess.
 *
 * A 404 is not a refusal: the assignment is already gone, and the delete that
 * follows reports it as such.
 *
 * The check costs one request per doomed assignment, on a path that runs only
 * after the user has confirmed a deletion.
 *
 * @param {string|number} courseId
 * @param {object} item              - A doomed item of type `assignment`.
 * @param {Function} [fetchOne]      - Injection point for tests.
 * @returns {Promise<{lines: string[], error: string}|null>}
 */
async function refuseQuizBackedDelete(
  courseId,
  item,
  fetchOne = getAssignment,
) {
  let assignment;
  try {
    assignment = await fetchOne(courseId, item.canvasId);
  } catch (err) {
    if (err.message.includes('404')) return null;
    return {
      lines: [
        `could not check whether assignment ${item.canvasId} is really a quiz ` +
          `(${err.message}). Canvas lists the gradebook half of a graded quiz ` +
          'among the assignments, and deleting that deletes the quiz with it, ' +
          'so this one is left where it is.',
      ],
      error:
        `assignment ${item.canvasId} not deleted: could not check whether it ` +
        `belongs to a quiz (${err.message})`,
    };
  }

  if (!isQuizBackedAssignment(assignment)) return null;

  const quiz =
    assignment.quiz_id != null ? `quiz ${assignment.quiz_id}` : 'a quiz';
  return {
    lines: [
      `assignment ${item.canvasId} is the gradebook half of ${quiz}, and ` +
        'deleting it deletes the quiz, its questions and every submission on it.',
      'The local file claimed canvas_type: assignment for a Canvas object that ' +
        'is really a quiz. Settle that in Canvas: delete the quiz there if that ' +
        'is what you meant, or put the file back as canvas_type: quiz if it ' +
        'should stay. Nothing was deleted, so the next prune asks again.',
    ],
    error: `assignment ${item.canvasId} not deleted: it is the gradebook half of ${quiz}`,
  };
}

/**
 * Delete a single Canvas item by type.
 * Returns true on success (including 404 = already gone), false on error.
 */
async function deleteCanvasItemByType(courseId, item, errors) {
  try {
    if (item.canvasType === 'page') {
      await deletePage(courseId, item.pageUrl || item.canvasId);
    } else if (item.canvasType === 'assignment') {
      // An assignment id can name a quiz. Ask before deleting, and refuse
      // rather than take a quiz down with the assignment that fronts it.
      const refusal = await refuseQuizBackedDelete(courseId, item);
      if (refusal) {
        log.error(
          `    [push] Refusing to delete "${item.relativePath}": ${refusal.lines[0]}`,
        );
        for (const line of refusal.lines.slice(1)) {
          log.error(`    [push] ${line}`);
        }
        errors.push({ module: item.relativePath, error: refusal.error });
        return false;
      }
      await deleteAssignment(courseId, item.canvasId);
    } else if (item.canvasType === 'discussion') {
      // A discussion is authored content like a page, so prune deletes the
      // topic itself, not just its place in the module.
      await deleteDiscussion(courseId, item.canvasId);
    } else if (item.canvasType === 'file') {
      await deleteFile(item.canvasId);
    } else if (item.canvasType === 'external_url') {
      // External URLs are module items only — find and delete via module item list
      const moduleItems = await listModuleItems(courseId, item.moduleId);
      const match = moduleItems.find(
        (mi) =>
          mi.type === 'ExternalUrl' && mi.external_url === item.externalUrl,
      );
      if (match) {
        await deleteModuleItem(courseId, item.moduleId, match.id);
      } else {
        log.warn(
          `    [push] External URL item not found on Canvas, may already be deleted: ${item.relativePath}`,
        );
      }
    } else if (item.canvasType === 'external_tool') {
      // An LTI link is a module item pointing at a tool this project did not
      // install and does not own: other courses launch the same installation,
      // so prune removes the link and never the tool behind it.
      const moduleItems = await listModuleItems(courseId, item.moduleId);
      const match = moduleItems.find(
        (mi) =>
          mi.type === 'ExternalTool' && mi.external_url === item.externalUrl,
      );
      if (match) {
        await deleteModuleItem(courseId, item.moduleId, match.id);
        log.info(
          `    [push] Removed the LTI link only; the tool installation stays in Canvas for every other course using it.`,
        );
      } else {
        log.warn(
          `    [push] External tool item not found on Canvas, may already be deleted: ${item.relativePath}`,
        );
      }
    } else if (item.canvasType === 'quiz') {
      // The quiz is not this project's to delete: a QTI import created it,
      // push never writes to it, and deleting it would take every student
      // submission with it. Prune removes the module item that links it.
      const moduleItems = await listModuleItems(courseId, item.moduleId);
      const match = moduleItems.find(
        (mi) =>
          mi.type === 'Quiz' && String(mi.content_id) === String(item.canvasId),
      );
      if (match) {
        await deleteModuleItem(courseId, item.moduleId, match.id);
        log.info(
          `    [push] Removed the module item only; the quiz and its submissions stay in Canvas.`,
        );
      } else {
        log.warn(
          `    [push] Quiz item not found on Canvas, may already be deleted: ${item.relativePath}`,
        );
      }
    } else {
      log.warn(
        `    [push] Unknown canvas_type "${item.canvasType}" for ${item.relativePath}, skipping`,
      );
      return false;
    }
    return true;
  } catch (err) {
    if (err.message.includes('404')) {
      log.warn(
        `    [push] Item already deleted from Canvas: ${item.relativePath}`,
      );
      return true;
    }
    log.error(
      `    [push] Error deleting item "${item.relativePath}": ${err.message}`,
    );
    errors.push({ module: item.relativePath, error: err.message });
    return false;
  }
}

/**
 * Annotate the doomed assignments and discussions with whether Canvas already
 * holds student submissions for them, as `hasSubmissions`: true, false, or null
 * when the lookup failed.
 *
 * Prune works from sync state, so all it has is Canvas ids. One list call for
 * the whole course is cheaper than one fetch per doomed assignment, and the
 * Assignment objects a list returns carry the flag already. Items of other
 * types cost nothing: with no assignment and no discussion in the list, no call
 * is made.
 *
 * A discussion needs one more step. A graded discussion has an Assignment
 * behind it, and that is where its submissions and grades live, but the item's
 * own id is the DiscussionTopic id, which is keyed by nothing in the
 * assignments list. So each doomed topic — and only the doomed ones — is
 * fetched to find out whether it is graded and, if it is, which assignment id
 * to look up in the states already fetched. An ungraded topic has no gradebook
 * column and no submissions, which is a real "no".
 *
 * That fetch also answers a question no grade check covers: deleting a topic
 * deletes every reply in it, graded or not. The count rides along on the topic,
 * so it is kept as `replyCount` for the listing to name.
 *
 * A failed lookup leaves null behind, which the listing and the prompt report
 * as "could not determine" — never as "safe". That holds for a topic fetch that
 * fails too: an unreadable topic may well be a graded one.
 *
 * @param {string|number} courseId
 * @param {object[]} items          - Doomed items; annotated in place with
 *                                    `hasSubmissions` and, for a readable
 *                                    discussion, `replyCount`.
 * @param {Function} [fetchStates]  - Injection point for tests.
 * @param {Function} [fetchTopic]   - Injection point for tests.
 */
async function annotateSubmissions(
  courseId,
  items,
  fetchStates = getSubmissionStates,
  fetchTopic = getDiscussion,
) {
  const assignments = items.filter((item) => item.canvasType === 'assignment');
  const discussions = items.filter((item) => item.canvasType === 'discussion');
  if (assignments.length === 0 && discussions.length === 0) return items;

  // Resolve the doomed topics first, so a prune that only drops ungraded
  // discussions settles the question without listing the course's assignments.
  const gradedDiscussions = new Map();
  for (const item of discussions) {
    let topic;
    try {
      topic = await fetchTopic(courseId, item.canvasId);
    } catch (err) {
      log.warn(
        `[push] Could not check discussion ${item.canvasId} ` +
          `(${item.relativePath}) for grades: ${err.message}`,
      );
      item.hasSubmissions = null;
      continue;
    }
    // Deleting a topic deletes the replies in it whatever its grading, so the
    // count is worth keeping off every topic that was readable, not just the
    // graded ones. Canvas puts it on the topic, so it costs no extra call.
    if (typeof topic.discussion_subentry_count === 'number')
      item.replyCount = topic.discussion_subentry_count;
    if (!isGradedDiscussion(topic)) {
      // No gradebook column, so no submissions and no grades: a real "no".
      item.hasSubmissions = false;
      continue;
    }
    const assignmentId = discussionAssignmentId(topic);
    if (assignmentId == null) {
      // Graded, but Canvas named no assignment to look the grades up under.
      item.hasSubmissions = null;
      continue;
    }
    gradedDiscussions.set(item, String(assignmentId));
  }

  if (assignments.length === 0 && gradedDiscussions.size === 0) return items;

  let states;
  try {
    states = await fetchStates(courseId);
  } catch (err) {
    log.warn(
      `[push] Could not check the assignments for student submissions: ${err.message}`,
    );
    for (const item of assignments) item.hasSubmissions = null;
    for (const item of gradedDiscussions.keys()) item.hasSubmissions = null;
    return items;
  }

  // An id Canvas no longer lists is already gone, so there is no student work
  // left to lose: that is a real "no", not an unknown.
  for (const item of assignments) {
    const key = String(item.canvasId);
    item.hasSubmissions = states.has(key) ? states.get(key) : false;
  }
  // That reasoning does not carry over to a discussion. The item being deleted
  // is the topic, and the topic was just fetched, so it plainly exists and
  // plainly says it is graded; an assignment id that resolves to nothing is an
  // inconsistency in Canvas's own answer, not evidence that the topic is safe.
  // Unknown, therefore — the same as a graded topic that named no id at all.
  for (const [item, key] of gradedDiscussions) {
    item.hasSubmissions = states.has(key) ? states.get(key) : null;
  }
  return items;
}

/**
 * How many replies a doomed discussion takes with it, as "14 replies", or null
 * when Canvas gave no count or the topic is empty.
 *
 * @param {object} item
 * @returns {string|null}
 */
function replyCountPhrase(item) {
  const count = item.replyCount;
  if (typeof count !== 'number' || !Number.isFinite(count) || count <= 0)
    return null;
  return `${count} ${count === 1 ? 'reply' : 'replies'}`;
}

/**
 * The listing line for one doomed item. An assignment or discussion with grades
 * behind it must not scan like a stray page, so it carries the reason on the
 * same line.
 *
 * A discussion loses more than a gradebook column: the topic goes with it, and
 * every reply students wrote in it. That is true of an ungraded topic too —
 * there are no grades to lose, but a term of student writing still goes — so a
 * discussion with replies in it is never a bare line, graded or not.
 */
function describeDoomedItem(item) {
  const line = `  - ${item.relativePath} (${item.canvasType})`;
  if (item.canvasType === 'discussion') {
    const replies = replyCountPhrase(item);
    if (item.hasSubmissions === true)
      return (
        `${line}  <-- GRADED DISCUSSION WITH STUDENT WORK: deletes the topic ` +
        `and ${replies ? `its ${replies}` : 'every student reply in it'}, plus ` +
        'the gradebook column and every grade'
      );
    if (item.hasSubmissions === null)
      return (
        `${line}  <-- SUBMISSION STATUS UNKNOWN: could not be checked, assume ` +
        `it is graded and that ${replies ? `its ${replies} and the grades` : 'replies and grades'} ` +
        'will be lost'
      );
    if (replies)
      return (
        `${line}  <-- ${replies.toUpperCase()} FROM STUDENTS: no grades at ` +
        'stake, and deleting the topic still deletes every one of them'
      );
    return line;
  }
  if (item.canvasType !== 'assignment') return line;
  if (item.hasSubmissions === true)
    return `${line}  <-- HAS STUDENT SUBMISSIONS: deletes the gradebook column and every grade in it`;
  if (item.hasSubmissions === null)
    return `${line}  <-- SUBMISSION STATUS UNKNOWN: could not be checked, assume grades will be lost`;
  return line;
}

/**
 * What the submission count in a prune warning is counting, singular.
 *
 * Two types can hold grades, so the aggregate line can only call itself
 * "assignments" while assignments are all it holds. One doomed graded
 * discussion makes "1 assignment being deleted has student submissions" a false
 * sentence over a listing whose only flagged entry is a discussion, so the count
 * switches to the type both of them are.
 *
 * The type is what decides it, not the risk: a doomed discussion that turned out
 * ungraded is still a discussion in the count, and reading "items" over a
 * listing that holds one costs nothing.
 *
 * @param {object[]} items - The doomed items whose states were counted.
 * @returns {string}
 */
function submissionRiskNoun(items) {
  return (items || []).some((item) => item.canvasType === 'discussion')
    ? 'item'
    : 'assignment';
}

/**
 * Unified prune: detect and delete Canvas modules and items that no longer exist locally.
 */
async function pruneDeleted(
  courseId,
  syncData,
  allModules,
  filteredModules,
  moduleFilter,
  dryRun,
  errors,
) {
  // Collect modules to delete (skip when filtering by specific module)
  const modulesToDelete = !moduleFilter
    ? collectDeletedModules(syncData, allModules)
    : [];

  // Collect items to delete (within filtered modules, claims from all)
  const itemsToDelete = collectDeletedItems(
    syncData,
    filteredModules,
    allModules,
  );

  if (modulesToDelete.length === 0 && itemsToDelete.length === 0) {
    log.info('\n[push] Prune: nothing to remove from Canvas.');
    return;
  }

  // Display what will be deleted
  if (modulesToDelete.length > 0) {
    log.info(
      `\n[push] Prune: ${modulesToDelete.length} locally-deleted module(s) to remove from Canvas:`,
    );
    for (const { folder } of modulesToDelete) {
      log.info(`  - ${folder} (entire module)`);
    }
  }

  // Ask Canvas which of the doomed items carry student work before listing
  // them, so the listing can say so item by item. Both types that can hold
  // grades are counted: an assignment, and the discussion a graded topic hangs
  // its assignment off.
  await annotateSubmissions(courseId, itemsToDelete);
  const gradable = itemsToDelete.filter(
    (item) =>
      item.canvasType === 'assignment' || item.canvasType === 'discussion',
  );
  const risk = countSubmissionRisk(gradable.map((item) => item.hasSubmissions));
  const riskNoun = submissionRiskNoun(gradable);

  if (itemsToDelete.length > 0) {
    log.info(
      `\n[push] Prune: ${itemsToDelete.length} locally-deleted item(s) to remove from Canvas:`,
    );
    for (const item of itemsToDelete) {
      log.info(describeDoomedItem(item));
    }
  }

  for (const line of submissionWarningLines(risk, riskNoun)) {
    log.warn(`\n[push] ${line}`);
  }

  // Confirm with user (unless dry-run)
  if (!dryRun) {
    log.info(`\n[push] ${BACKUP_HINT}`);
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const answer = await new Promise((resolve) => {
      rl.question(
        `[push] Delete these from Canvas${submissionRiskSuffix(risk)}? (y/N) `,
        resolve,
      );
    });
    rl.close();

    if (answer.toLowerCase() !== 'y') {
      log.info('[push] Prune cancelled.');
      return;
    }
  }

  // Delete modules
  for (const { folder, canvasModuleId } of modulesToDelete) {
    log.info(
      `  [push] Pruning module: ${folder} (canvas_module_id: ${canvasModuleId})`,
    );
    if (!dryRun) {
      // A row naming no Canvas module addresses nothing on Canvas — a
      // hand-edited sync file is the only way to get one — so there is nothing
      // to delete there, only the row itself.
      if (canvasModuleId == null) {
        deleteModuleFromState(syncData, folder);
        log.info(
          '    [push] The sync state named no Canvas module for this folder, ' +
            'so only the row was dropped.',
        );
        continue;
      }
      try {
        await deleteCanvasModule(courseId, canvasModuleId);
        deleteModuleFromState(syncData, folder);
        log.info(`    [push] Deleted from Canvas.`);
      } catch (err) {
        log.error(
          `    [push] Error deleting module "${folder}": ${err.message}`,
        );
        errors.push({ module: folder, error: err.message });
      }
    }
  }

  // Delete individual items
  for (const item of itemsToDelete) {
    log.info(
      `  [push] Pruning item: ${item.relativePath} (${item.canvasType})`,
    );
    if (!dryRun) {
      const success = await deleteCanvasItemByType(courseId, item, errors);
      if (success) {
        deleteItem(syncData, item.relativePath);
        log.info(`    [push] Deleted from Canvas.`);
      }
    }
  }
}

module.exports = push;
// Exported for testing
push._pushModule = pushModule;
push._readModuleItems = readModuleItems;
push._createItemLedger = createItemLedger;
push._resolveLeftoverItems = resolveLeftoverItems;
push._collectDeletedModules = collectDeletedModules;
push._collectDeletedItems = collectDeletedItems;
push._collectLocalPaths = collectLocalPaths;
push._deleteCanvasItemByType = deleteCanvasItemByType;
push._refuseQuizBackedDelete = refuseQuizBackedDelete;
push._annotateSubmissions = annotateSubmissions;
push._describeDoomedItem = describeDoomedItem;
push._submissionRiskNoun = submissionRiskNoun;
push._warnGradeImpact = warnGradeImpact;
push._gradeImpactWarnings = gradeImpactWarnings;
push._collectUpdatedAssignments = collectUpdatedAssignments;
push._buildFileResolver = buildFileResolver;
push._recordItem = recordItem;
push._pageStrategy = pageStrategy;
push._assignmentStrategy = assignmentStrategy;
push._discussionStrategy = discussionStrategy;
push._pushContentItem = pushContentItem;
push._pushExternalTool = pushExternalTool;
push._pushQuiz = pushQuiz;
