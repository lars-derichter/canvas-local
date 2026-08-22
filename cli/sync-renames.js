const path = require('path');
const { COURSE_DIR } = require('./module-utils');
const {
  loadState,
  renameFolders,
  renamePaths,
  saveState,
  toPosixPath,
} = require('../lib/sync/state');

/** An entry inside a directory, spelled the way the sync state keys it. */
function relativeTo(courseDir, dir, entryName) {
  return toPosixPath(path.relative(courseDir, path.join(dir, entryName)));
}

/**
 * Carry the renames a command has just applied to disk into the sync state.
 *
 * The state is keyed by the path under `course/`, so a file the tool renames without
 * re-keying leaves a row addressing nothing: the next push reads that as a
 * deletion at the old path and a create at the new one, and `--prune` offers to
 * delete a live Canvas object the author only renamed. Every command that
 * renames therefore ends here — including the ones that only renumber, since
 * `renumber` runs as a side effect of creating, deleting, splitting and moving
 * items, and an author who never types it still hits this.
 *
 * Batches rather than one list, because a single command can rename in more
 * than one directory: `movetomodule-item` makes room at the destination, moves
 * the file, then closes the gap at the source. They are applied in the order
 * given — the order they happened on disk — and the state is written once, at
 * the end, however many of them there are.
 *
 * @param {Array<{fromDir: string, toDir?: string,
 *   renames: Array<{from: string, to: string}>}>} batches - `fromDir` and
 *   `toDir` are absolute directories; `renames` name entries inside them.
 * @param {object} [options]
 * @param {string} [options.courseDir] - Injection point for tests.
 * @param {string} [options.file]      - Injection point for tests.
 * @returns {number} How many rows moved.
 */
function recordRenames(batches, { courseDir = COURSE_DIR, file } = {}) {
  const groups = (batches || []).filter(
    (batch) => batch && batch.renames && batch.renames.length > 0,
  );
  if (groups.length === 0) return 0;

  // A course that has never been synced has no rows to carry, and inventing a
  // state file here would claim it had.
  const state = loadState({ allowNull: true, file });
  if (!state) return 0;

  let moved = 0;
  for (const group of groups) {
    const { fromDir, toDir = fromDir, renames } = group;
    const moves = renames.map(({ from, to }) => ({
      from: relativeTo(courseDir, fromDir, from),
      to: relativeTo(courseDir, toDir, to),
    }));
    // A module folder sits directly under course/ and has a key of its own;
    // anything deeper is an item or a subsection, which are only paths.
    const atCourseRoot =
      path.resolve(fromDir) === path.resolve(courseDir) &&
      path.resolve(toDir) === path.resolve(courseDir);
    moved += atCourseRoot
      ? renameFolders(state, moves)
      : renamePaths(state, moves);
  }

  // One write per command, however many directories it renamed in.
  if (moved > 0) saveState(state, file);
  return moved;
}

module.exports = { recordRenames };
