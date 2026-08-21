const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { get } = require('../lib/canvas/client');
const { downloadFile } = require('../lib/canvas/files');
const { plan } = require('../lib/sync/plan');
const { applyPlan } = require('../lib/sync/apply');
const {
  gatherCanvas,
  gatherLocal,
  gitDirtyPaths,
} = require('../lib/sync/gather');
const { loadState, saveState } = require('../lib/sync/state');
const {
  COURSE_DIR,
  createRL,
  prompt,
  safeReadJSON,
} = require('./module-utils');
const { BACKUP_DOC, confirmForcedPull } = require('./backup-warning');
const buildReport = require('./sync')._buildReport;
const log = require('./logger');

/**
 * Pull: `sync` with the direction pinned the other way from push.
 *
 * The same four steps `cli/sync.js` takes — gather, plan, apply, report — over
 * the same engine, with one policy nothing can change:
 *
 *     { write: { canvas: false, local: true }, conflict: 'canvas',
 *       adopt: 'canvas' }
 *
 * The working tree is written and Canvas is not. A file that changed on both
 * sides takes the Canvas version. A Canvas object already sitting there under
 * the same type and title is claimed by the local file that matches it rather
 * than written out a second time beside it. None of that is lost when the
 * policy forbids a write: the planner records it in `withheld`, and the report
 * names it.
 *
 * Everything that decides anything lives in `lib/sync/plan.js`, everything that
 * reads the world in `lib/sync/gather.js`, everything that writes in
 * `lib/sync/apply.js`. What is left here is the part that is genuinely pull's:
 * the `--force` confirmation and the `--prune-local` one, both of which run
 * **over the plan or over the working tree**, so neither needs a network.
 *
 * ## The mtime guard is gone, and `--force` means something else
 *
 * Old pull refused to write any file it could not prove was its own output,
 * judged by comparing the file's mtime against `last_sync` — a guess from the
 * shape of the file, which read "cannot tell" as "leave it alone" and so
 * skipped every file on a tree that had never synced. The planner asks the real
 * question instead: it compares each side against the fingerprint the last sync
 * recorded for it, so a file Canvas has not touched is not written, and one it
 * has is written without anybody having to guess.
 *
 * What is still load-bearing is git. `guardDirty` in the planner refuses to
 * write over — or delete — any file `git status` reports as modified or
 * untracked, because git is the only copy of whatever is in it. And
 * `gitDirtyPaths` answers `available: false` outside a git checkout or wherever
 * git cannot be run, at which point `gatherLocal` marks **every** file dirty and
 * a pull writes nothing at all. `--force` is the one lever that switches that
 * guard off, for overwrites and deletes alike. It is dangerous exactly in
 * proportion to how much work git has no copy of, so it asks first.
 *
 * ## A Canvas rename no longer renames the file
 *
 * Old pull derived the local filename from the Canvas title on every run, and
 * renamed the file when the title changed. The local path is the key of a sync
 * row now, so the title lands in the file's frontmatter and the filename stays
 * as the author left it. The numeric prefix still moves: that is the local
 * order, and a Canvas-side reorder is a `reorder-local-module`.
 *
 * ## What still lives here
 *
 * `writeCategoryFile`, `downloadReferencedFiles` and `createPullFileResolver`
 * are borrowed by `lib/sync/apply.js` through `pullInternals()`. They are the
 * definition of how this tool writes a Canvas object into the working tree, and
 * they live here until they get a home of their own.
 */

/** `1 file` / `3 files`, so a count never reads as a stutter. */
function plural(count, singular) {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

/**
 * @param {object} options - Commander's flags, plus four injection points for
 *   tests that commander never sets: `courseDir`, `syncFile`, `gitDirty` and
 *   `interactive`. A test needs its own tree, its own state file, a git answer
 *   that does not depend on the checkout it runs in, and a terminal it does
 *   not have.
 */
async function pull(options = {}) {
  const courseId = process.env.CANVAS_COURSE_ID;
  if (!courseId) {
    log.error(
      '[pull] Error: CANVAS_COURSE_ID is not set. Run "npx course init" first.',
    );
    process.exitCode = 1;
    return;
  }

  const dryRun = options.dryRun === true;
  const force = options.force === true;
  const pruneLocal = options.pruneLocal === true;
  const modules = options.module
    ? [].concat(options.module).filter(Boolean)
    : null;
  const courseDir = options.courseDir || COURSE_DIR;
  const syncFile = options.syncFile || undefined;
  const interactive =
    options.interactive !== undefined
      ? options.interactive === true
      : Boolean(process.stdin.isTTY);

  const state = loadState(syncFile ? { file: syncFile } : {});

  // One `git status` for the run. Pull writes to the working tree and nowhere
  // else, so this is the guard that decides how much of it may be written at
  // all: a file git holds uncommitted work for is the only copy of that work.
  const gitDirty = options.gitDirty || gitDirtyPaths({ courseDir });
  if (!gitDirty.available) {
    log.warn(
      `[pull] ${gitDirty.reason}. Every local file is treated as holding ` +
        'uncommitted work, so ' +
        (force
          ? '--force is the only reason this run writes anything at all.'
          : 'nothing here is overwritten or deleted; --force overrides that.'),
    );
  }

  const local = gatherLocal({ courseDir, gitDirty });
  for (const warning of local.warnings) log.warn(`[pull] ${warning}`);

  // Asked before Canvas is read, so a cancelled run costs no request at all:
  // what --force is about is the working tree, and the working tree is already
  // in hand. A course that turns out to hold no modules is the one case where
  // that means asking about a run with nothing to do, and a wasted question is
  // cheaper than a wasted course read.
  const guarded = local.modules
    .flatMap((module) => module.items)
    .filter((item) => item.dirty);
  const proceed = await confirmForcedPull({
    force,
    guarded: guarded.length,
    gitReason: gitDirty.available ? null : gitDirty.reason,
    pruneLocal,
    dryRun,
  });
  if (!proceed) return;

  // The whole of what --force does. The planner reads `dirty` per item and
  // nothing else, so clearing it here is the flag, stated once, rather than a
  // second condition threaded through every guard the engine has.
  if (force) {
    for (const module of local.modules) {
      for (const item of module.items) item.dirty = false;
    }
  }

  log.info(`[pull] Reading Canvas course ${courseId}...`);
  const canvas = await gatherCanvas({ courseId, base: state });
  for (const warning of canvas.warnings) log.warn(`[pull] ${warning}`);

  // Pulling from an empty course is always a mistake rather than an
  // instruction: every item in the tree would read as gone from Canvas, and
  // under `--prune-local` that is the whole course. The mirror of push refusing
  // to push from an empty tree.
  if (canvas.modules.length === 0) {
    log.info('[pull] No modules found in Canvas course.');
    return;
  }

  // Checked here rather than up front, because the folder a Canvas module will
  // be written into need not exist yet: `-m` may name one nothing but Canvas
  // has heard of. So the answer needs both sides and the state that links them.
  if (modules) {
    const known = new Set([
      ...local.modules.map((mod) => mod.folder),
      ...Object.keys(state.modules || {}),
      ...canvas.modules.map((mod) => mod.suggestedFolder).filter(Boolean),
    ]);
    const missing = modules.filter((name) => !known.has(name));
    if (missing.length > 0) {
      log.error(
        `[pull] Error: no module named ${missing.join(', ')} — nothing under ` +
          'course/ and nothing in the Canvas course answers to it.',
      );
      process.exitCode = 1;
      return;
    }
  }

  const policy = {
    write: { canvas: false, local: true },
    conflict: 'canvas',
    adopt: 'canvas',
    pruneLocal,
    modules,
  };
  const inputs = { base: state, local, canvas };
  let report = plan({ ...inputs, policy });

  // Whether this run is still one that prunes, which a declined confirmation
  // makes it not. The report reads the answer rather than the flag: "nothing
  // above was deleted; each line says why" is a claim about the plan, and after
  // a decline there is no plan behind it to say why.
  let pruning = pruneLocal;
  if (pruneLocal) {
    pruning = await confirmPrune(report, { interactive, dryRun, force });
    if (!pruning) {
      // Re-planned rather than filtered, so the report is built from a plan
      // that never held those deletes: the orphans go back to being listed as
      // orphans, with the flag's own line under them.
      report = plan({ ...inputs, policy: { ...policy, pruneLocal: false } });
    }
  }

  let outcome = { applied: [], errors: [] };
  if (dryRun) {
    log.info('[pull] DRY RUN — nothing was written.');
  } else if (report.actions.length > 0) {
    outcome = await applyPlan(report, {
      courseId,
      courseDir,
      state,
      canvasContent: canvas.content,
      save: (next) => saveState(next, syncFile),
      log,
    });
  } else {
    state.last_sync = new Date().toISOString();
    saveState(state, syncFile);
  }

  const lines = buildReport(report, {
    // A dry run executed nothing, so it gets no applied list and the report
    // reads as the preview it is. Every other run hands over what actually ran.
    applied: dryRun ? undefined : outcome.applied,
    pruneLocal: pruning,
    baseUrl: state.canvas_base_url,
    courseId,
  });
  if (lines.length === 0) {
    log.info('[pull] course/ already holds everything in Canvas.');
  } else {
    for (const line of lines) log.info(line);
  }

  if (outcome.errors.length > 0) {
    log.error(`\n[pull] ${plural(outcome.errors.length, 'error')}:`);
    for (const failure of outcome.errors) {
      log.error(
        // A run-wide failure — the icon upload — names no path and no folder,
        // so it falls back to its own name rather than printing "undefined".
        `  - ${failure.action.itemPath || failure.action.folder || failure.action.type}: ${failure.error}`,
      );
    }
  }

  // A skip is a refusal pull could not carry out, which under this policy means
  // a file holding uncommitted work that Canvas wanted to overwrite. Orphans
  // and the informational sections do not fail the run: a course mid-edit is a
  // normal state.
  if (outcome.errors.length > 0 || report.skipped.length > 0) {
    process.exitCode = 1;
  }
}

/**
 * List what `--prune-local` is about to delete, and ask.
 *
 * Read off the plan's delete actions rather than off the working tree, so what
 * is listed is exactly what would run — including nothing, when the planner
 * declined to emit a delete it had a reason not to. The commonest such reason
 * is the git guard: a file holding uncommitted work is reported under "Skipped"
 * with a remedy, and never reaches this listing.
 *
 * A dry run deletes nothing, so it gets the listing and no question: hiding the
 * deletes behind a prompt the run will never act on is the opposite of what a
 * preview is for.
 *
 * @returns {Promise<boolean>} Whether the deletes should stay in the plan.
 */
async function confirmPrune(report, { interactive, dryRun, force }) {
  const actions = report.actions || [];
  const doomedModules = actions.filter(
    (action) => action.type === 'delete-local-module',
  );
  const doomedItems = actions.filter(
    (action) => action.type === 'delete-local-item',
  );
  if (doomedModules.length === 0 && doomedItems.length === 0) {
    log.info('\n[pull] Prune: nothing to remove from course/.');
    return true;
  }

  if (doomedModules.length > 0) {
    log.info(
      `\n[pull] Prune: ${plural(doomedModules.length, 'module folder')} gone ` +
        'from Canvas, to delete here:',
    );
    for (const action of doomedModules) {
      log.info(`  - ${action.folder}/ (the whole folder)`);
    }
  }

  if (doomedItems.length > 0) {
    log.info(
      `\n[pull] Prune: ${plural(doomedItems.length, 'file')} gone from ` +
        'Canvas, to delete here:',
    );
    for (const action of doomedItems) {
      log.info(`  - ${action.itemPath} (${action.canvasType})`);
    }
  }

  if (dryRun) return true;

  if (!interactive) {
    log.warn(
      `[pull] ${plural(doomedModules.length + doomedItems.length, 'thing')} ` +
        'would be deleted, and this run cannot ask. Nothing was pruned; run ' +
        'it in a terminal.',
    );
    return false;
  }

  // What the undo is, and it is not the same sentence in both cases. Without
  // --force nothing dirty ever reaches this list, so everything on it is
  // committed and git has all of it; with --force the guard that guaranteed
  // that is off, whether or not it was holding anything back this run.
  log.info(
    force
      ? '\n[pull] --force is on, so the git guard is not standing between ' +
          'these files and their deletion. Anything among them git has no ' +
          `copy of is gone for good. See ${BACKUP_DOC}.`
      : '\n[pull] Nothing above holds uncommitted work — the git guard keeps ' +
          `those out of the list — so git brings all of it back. See ${BACKUP_DOC}.`,
  );
  const rl = createRL();
  const answer = await prompt(rl, '[pull] Delete these from course/? (y/N)');
  rl.close();
  const ok = answer.trim().toLowerCase() === 'y';
  if (!ok) log.info('[pull] Nothing was deleted.');
  return ok;
}

// ---------------------------------------------------------------------------
// How a Canvas object is written into the working tree
// ---------------------------------------------------------------------------

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

function sha256File(filePath) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(filePath))
    .digest('hex');
}

/**
 * Scan HTML for Canvas file URLs and download any files not already tracked locally.
 * Updates syncData.files and canvasToLocal map as files are downloaded.
 *
 * `courseDir` is required and deliberately not defaulted to `COURSE_DIR`. It
 * used to be, and the default was the whole of the defect: the engine resolves
 * every other path against the `courseDir` its caller handed it, so a run
 * pointed at any other tree wrote the markdown wrapper there and downloaded the
 * binary it references into the working repo's `course/`. That left the wrapper
 * pointing at a `_files/` entry that was not beside it, and left the
 * already-downloaded check below looking in a tree the file was never in — so
 * every run downloaded it again. A missing argument now fails instead.
 *
 * @param {string|number} courseId
 * @param {string} html - The Canvas HTML to scan for file references.
 * @param {string} folderName - The module folder the referencing item lives in.
 * @param {object} syncData - The sync state; `files` is written in place.
 * @param {Map<string, string>} canvasToLocal - Canvas preview URL to local path.
 * @param {string} courseDir - Absolute path of the `course/` tree being written.
 */
async function downloadReferencedFiles(
  courseId,
  html,
  folderName,
  syncData,
  canvasToLocal,
  courseDir,
) {
  if (!courseDir) {
    throw new Error(
      'downloadReferencedFiles was given no course directory. Every path it ' +
        'writes is resolved against one, and guessing at the default would ' +
        "put a run's embedded files in a tree it was never pointed at.",
    );
  }
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
      if (fs.existsSync(path.resolve(courseDir, localPath))) continue;
    }

    try {
      const fileMeta = await get(`/api/v1/files/${fileId}`);
      const fileName = fileMeta.display_name || `file-${fileId}`;
      const localRelPath = path.posix.join(folderName, '_files', fileName);
      const destPath = path.resolve(courseDir, localRelPath);

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
// Borrowed by lib/sync/apply.js through pullInternals(); see the note there.
pull._writeCategoryFile = writeCategoryFile;
pull._downloadReferencedFiles = downloadReferencedFiles;
pull._createPullFileResolver = createPullFileResolver;
