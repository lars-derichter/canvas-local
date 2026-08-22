const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { get } = require('../canvas/client');
const { downloadFile } = require('../canvas/files');
const { safeReadJSON } = require('../../cli/module-utils');
const log = require('../../cli/logger');

/**
 * How a Canvas object is written into the working tree.
 *
 * The counterpart of `lib/sync/canvas-write.js`, for the other direction: the
 * `_category_.json` a module folder needs before Docusaurus will label it, the
 * binaries an item's HTML references and where they land beside it, and the
 * resolver that turns a Canvas file URL back into a relative path from the file
 * being written.
 *
 * It lived in `cli/pull.js` until the engine took the writes over, and moved
 * here for the same reason `canvas-write.js` did: `lib/sync/apply.js` is what
 * calls it, and `lib/` must not reach back into a command to find it.
 */

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
 * Whether writing this destination would destroy the only copy of something.
 *
 * The executor's half of `guardDirty` in `lib/sync/plan.js`, and it follows the
 * same two rules. **Existence first:** a destination that is not there holds no
 * work to lose, so creating it is never guarded — exactly as `guardDirty`
 * declines to guard an action with no local item behind it. **Then git:** a
 * path git reports as modified or untracked is one whose current bytes exist
 * nowhere else, and where git cannot answer at all every file already on disk
 * reads that way, because refusing is the only safe reading of "I cannot tell".
 *
 * A tracked file with no uncommitted changes is not protected. It is one
 * `git checkout` away, which is the whole reason the rule is about git and not
 * about `_files/` being special.
 */
function wouldDestroyUnsavedWork(gitDirty, localRelPath, destPath) {
  if (!fs.existsSync(destPath)) return false;
  if (!gitDirty || gitDirty.available !== true) return true;
  return Boolean(gitDirty.paths && gitDirty.paths.has(localRelPath));
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
 * **This is a write into the working tree, so git guards it like every other
 * one.** The destination is the Canvas file's `display_name` joined to the
 * module's `_files/`, so an author's own `diagram.png` and a Canvas file of
 * that name are one path, and the Canvas one used to win by simply landing on
 * it. The planner cannot make this call — the destination is unknown until
 * Canvas has answered with a `display_name`, and the planner never touches the
 * network — so the run's single git answer is threaded down here instead of a
 * second `git status` being run.
 *
 * @param {string|number} courseId
 * @param {string} html - The Canvas HTML to scan for file references.
 * @param {string} folderName - The module folder the referencing item lives in.
 * @param {object} syncData - The sync state; `files` is written in place.
 * @param {Map<string, string>} canvasToLocal - Canvas preview URL to local path.
 * @param {string} courseDir - Absolute path of the `course/` tree being written.
 * @param {object} [guard]
 * @param {{available: boolean, paths: Set<string>}} [guard.gitDirty] - What
 *   `gitDirtyPaths` returned. Absent, or unavailable, protects every file
 *   already on disk.
 * @param {object[]} [guard.skipped] - Collector for refusals, in the shape
 *   `report.skipped` holds; the commands merge it into the report.
 */
async function downloadReferencedFiles(
  courseId,
  html,
  folderName,
  syncData,
  canvasToLocal,
  courseDir,
  { gitDirty = null, skipped = null } = {},
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

      if (wouldDestroyUnsavedWork(gitDirty, localRelPath, destPath)) {
        // No row, and no `canvasToLocal` entry either. A row would claim this
        // Canvas file id and a sha256 for bytes the run never wrote, which is
        // both a lie about the state and self-sealing: the already-downloaded
        // check above would then find the author's file sitting at the recorded
        // path and skip the download for good. Leaving the map alone also
        // decides what the page says — `createPullFileResolver` answers null,
        // and `htmlToMarkdown` falls back to the Canvas URL, so the page
        // renders Canvas's image rather than pointing at a local binary that is
        // not the one Canvas is showing.
        if (skipped) {
          skipped.push({
            kind: 'file',
            reason: 'git-dirty',
            moduleFolder: folderName,
            itemPath: localRelPath,
            action: 'download-embedded-file',
            remedy:
              `${localRelPath} holds uncommitted work and Canvas has a file ` +
              'of that name to write there; downloading it would be the only ' +
              'copy of those bytes gone. The page that embeds it keeps its ' +
              'Canvas link meanwhile, so it still renders. Commit or stash ' +
              'the file, then run again — or `npx course pull --force` to ' +
              'take the Canvas copy.',
          });
        }
        continue;
      }

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

module.exports = {
  writeCategoryFile,
  downloadReferencedFiles,
  createPullFileResolver,
};
