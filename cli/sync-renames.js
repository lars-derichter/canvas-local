const path = require('path');
const log = require('./logger');
const { COURSE_DIR } = require('./module-utils');
const {
  allItems,
  deleteItem,
  deleteModule,
  getModule,
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

/**
 * How a row names the Canvas object behind it, or null when it names none.
 *
 * A row with no Canvas id was created locally and never pushed, so dropping it
 * strands nothing and there is nothing to tell the author about. A text header
 * has no content object at all — only the module item — which is why the
 * module item id is a fallback rather than an afterthought.
 */
function strandedBy(itemPath, row) {
  if (!row) return null;
  const id =
    row.canvas_id != null
      ? `Canvas id ${row.canvas_id}`
      : row.module_item_id != null
        ? `Canvas module item ${row.module_item_id}`
        : null;
  if (id == null) return null;
  const title = row.title ? ` "${row.title}"` : '';
  return `${itemPath} — ${row.canvas_type || 'item'}${title} (${id})`;
}

/**
 * Drop every row addressed at or under one path — in `state.modules` and in
 * `state.files` alike — and say what that puts out of reach.
 *
 * A module folder and an item are told apart by the state itself rather than by
 * the shape of the path: only a module has a key in `state.modules`, and an item
 * path always carries its module folder in front of it, so the two can never be
 * confused.
 *
 * The `state.files` sweep is not confined to the module branch, though it is
 * only a module that can have rows under it today: `_files/` sits at module
 * level, and a `_` prefix keeps it out of `getItems`, so no item path is ever a
 * prefix of one. Sweeping unconditionally costs a loop over a small map and
 * means a state that has lost a module row while keeping its file rows — hand
 * edited, half restored from a bad merge — is still cleared rather than left
 * with a row `renameFolder` would silently overwrite while rebuilding that map.
 *
 * This is the one place that takes `state.files` rows away from a live Canvas
 * file on purpose. `deleteModule` leaves them alone precisely so they outlive
 * the folder; here the folder name is about to belong to a different module,
 * whose own binary would otherwise overwrite the row without a word.
 *
 * @returns {{dropped: number, stranded: string[]}}
 */
function clearRowsAt(state, itemPath) {
  const stranded = [];
  const under = `${itemPath}/`;
  let dropped = 0;

  const module = getModule(state, itemPath);
  if (module) {
    const line = strandedByModule(itemPath, module);
    if (line) stranded.push(line);
    for (const [p, row] of Object.entries(module.items || {})) {
      const item = strandedBy(p, row);
      if (item) stranded.push(item);
    }
    deleteModule(state, itemPath);
    dropped += 1;
  } else {
    const doomed = allItems(state)
      .map((row) => row.itemPath)
      .filter((p) => p === itemPath || p.startsWith(under));
    for (const p of doomed) {
      const row = deleteItem(state, p);
      if (!row) continue;
      dropped += 1;
      const line = strandedBy(p, row);
      if (line) stranded.push(line);
    }
  }

  for (const [p, row] of Object.entries(state.files || {})) {
    if (!p.startsWith(under)) continue;
    if (row && row.canvas_file_id != null) {
      stranded.push(
        `${p} — embedded file (Canvas file id ${row.canvas_file_id})`,
      );
    }
    delete state.files[p];
    dropped += 1;
  }

  return { dropped, stranded };
}

/** The module's own line, mirroring `strandedBy` for an item. */
function strandedByModule(folder, entry) {
  if (entry.canvas_module_id == null) return null;
  const name = entry.name ? ` "${entry.name}"` : '';
  return `${folder} — module${name} (Canvas module id ${entry.canvas_module_id})`;
}

/**
 * Give up the sync row of a path a command has just deleted, when the renumber
 * that command ran is about to move another entry onto that exact path.
 *
 * Reachable only when two siblings share a slug at different prefixes:
 * `02-alerts.md` deleted with `03-alerts.md` behind it, or module `01-intro`
 * deleted with `02-intro` behind it. `renumberSequential` keeps the slug and
 * only rewrites the number, so the survivor lands on the dead one's name.
 *
 * **The state cannot hold both facts.** Its key *is* the local path, and one
 * path cannot be both "the row of the thing the author deleted, whose Canvas
 * object is now an orphan" and "the row of the thing that just moved here".
 * Left alone, the batch resolves that the wrong way round and in silence:
 * `renamePath` refuses to overwrite the row already sitting at the
 * destination, `renamePaths` rolls the mover back to the name it came from,
 * and the two swap identities. The file on disk would then push its content to
 * the deleted item's Canvas object, and `--prune-canvas` would offer to delete
 * the live one it actually is. `renameFolders` does the same thing one level
 * up, with a whole module's ids.
 *
 * So the deleted path's row is the one that gives way. That strands its Canvas
 * object — nothing in this repository points at it afterwards, which is the
 * harm everything else in this area exists to prevent — but it is strictly the
 * lesser harm: crossing two items' ids writes to the wrong Canvas object *and*
 * offers the right one for deletion, and says nothing either way. This says
 * something, and an author who reads it can finish the job in Canvas by hand —
 * on the error channel, so that `--quiet` cannot leave a scripted run with no
 * record of the object at all.
 *
 * **Why here.** The collision takes two facts, and only the command holds
 * both: which path it has just deleted, and the renames it has just applied to
 * disk. `renamePaths` and `renameFolders` see a state and nothing else, and
 * must stay that way — a state function that asked the filesystem whether a
 * path still has a file would give two different answers for one state, which
 * is exactly what makes the planner testable today. This module is where those
 * two facts already meet, and it already owns the load-edit-save discipline
 * that carrying a rename into the state needs.
 *
 * @param {Array<{fromDir: string, deleted: string,
 *   renames: Array<{from: string, to: string}>}>} batches - `fromDir` is the
 *   absolute directory the renumber ran in, `deleted` the entry name inside it
 *   that the command removed, `renames` what the renumber did.
 * @param {object} [options]
 * @param {string} [options.tag]       - Command name the printed lines carry.
 * @param {object} [options.state]     - A state already in hand, edited in
 *   place and left unsaved, for a command that holds one and writes once at the
 *   end (`cli/delete-module.js`). Without it this loads and saves the way
 *   `recordRenames` does.
 * @param {string} [options.courseDir] - Injection point for tests.
 * @param {string} [options.file]      - Injection point for tests.
 * @returns {string[]} One line per Canvas object now out of reach, in the order
 *   the state held them. Empty when nothing collided, and empty when what
 *   collided had never been pushed.
 */
function dropRowsRenumberedOver(
  batches,
  { tag = 'sync-state', state, courseDir = COURSE_DIR, file } = {},
) {
  const collisions = [];
  for (const batch of batches || []) {
    if (!batch || !batch.deleted) continue;
    const onto = (batch.renames || []).find((r) => r.to === batch.deleted);
    if (onto) collisions.push({ ...batch, movedFrom: onto.from });
  }
  if (collisions.length === 0) return [];

  // A course nobody has pushed has no rows to give up, and inventing a state
  // file here would claim it had — the same reason `recordRenames` allows null.
  const held = state || loadState({ allowNull: true, file });
  if (!held) return [];

  const stranded = [];
  let dropped = 0;
  for (const { fromDir, deleted, movedFrom } of collisions) {
    const itemPath = relativeTo(courseDir, fromDir, deleted);
    const result = clearRowsAt(held, itemPath);
    dropped += result.dropped;
    if (result.dropped === 0) continue;
    // Which sink, and why it is not always the same one. A run that strands a
    // live Canvas object has just made this listing the only record of it, so
    // the whole block — what happened, and the objects it left behind — goes
    // out on `log.error`, the one channel `--quiet` cannot close.
    // `quizNotImportedRefusal` in `lib/sync/canvas-write.js` gives the same
    // reasoning for throwing rather than warning: a warning `--quiet` drops is
    // not enough for something nothing here can reach again. Refusing is not
    // available here — the delete already happened on disk, and the row had to
    // give way — so the channel is what carries it. A collision whose row had
    // never been pushed strands nothing, and stays a warning: `--quiet` says it
    // shows only errors, and there is nothing out there to go and delete.
    const strands = result.stranded.length > 0;
    const say = strands ? log.error : log.warn;
    say(
      `[${tag}] Renumbering moved ${movedFrom} onto ${deleted}, the entry ` +
        'just deleted, and the sync state holds one row per path — so the ' +
        'deleted one gave way rather than let the two swap Canvas ids.',
    );
    if (strands) {
      say(
        `[${tag}] These Canvas objects are no longer tracked here and ` +
          '`--prune-canvas` will not offer them. Delete them in Canvas by hand:',
      );
      for (const line of result.stranded) say(`  - ${line}`);
    }
    stranded.push(...result.stranded);
  }

  // Only the loading branch owns the write; a caller that handed its own state
  // in is saving it itself, and a second save here would beat it to the file.
  if (dropped > 0 && !state) saveState(held, file);
  return stranded;
}

module.exports = { dropRowsRenumberedOver, recordRenames };
