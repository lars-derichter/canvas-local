const { toPosixPath } = require('./state');

/**
 * Rename detection, the way git does it: by content first, by name second, and
 * never by guess.
 *
 * The sync state keys every item by its path under `course/`, so a file that
 * moves has to be re-keyed or its Canvas ids are lost — and a lost id is not a
 * quiet failure. The base row would read as "deleted locally" and the new path
 * as "new locally", and the next run would offer to delete the Canvas object
 * and create a second copy of the same content beside it.
 *
 * Almost every rename in this project never reaches here at all: `renumber`,
 * `move-item`, `rename-item`, `movetomodule-item`, `move-module` and
 * `rename-module` each call `renamePath` and re-key the row as they go. This
 * module is for the rest — a file renamed by hand in Finder, a folder
 * reorganised in an editor, a branch merged with different numbering.
 *
 * Three steps, in order, and the order is the whole design:
 *
 * 1. **Exact.** A base path is missing locally and exactly one untracked local
 *    path holds a `localHash` equal to that row's stored `local_hash`. The
 *    content is identical, so there is nothing to decide: re-key silently.
 * 2. **Probable.** No hash match, but an untracked local path sits in the same
 *    directory and carries the same title. That is a file renamed *and* edited,
 *    which is a guess rather than a fact — so it is reported and confirmed,
 *    never applied on its own.
 * 3. **Neither.** A genuine delete and a genuine create, which the planner's
 *    truth table then handles and says out loud before anything destructive
 *    happens.
 *
 * **Ambiguity is refused rather than resolved.** Two untracked local files with
 * identical content genuinely are indistinguishable, and so are two base rows
 * with the same stored hash: nothing in the data says which moved where.
 * Guessing would hand one item another's Canvas ids, which is worse than the
 * delete-and-create the caller falls back to — that one at least announces
 * itself. So a hash, or a directory-plus-title, naming more than one candidate
 * on either side matches nothing at all.
 *
 * Pure: no filesystem, no network. The caller hands in the three sides already
 * gathered, and gets back a description of what moved.
 */

/**
 * The directory part of one of those POSIX paths; `''` for a bare filename.
 *
 * Read by step 2 only, which is deliberately confined to a single directory: a
 * title is a weak signal, and two modules may well hold a "Summary" each. Step
 * 1 has no such limit, because a content hash is strong enough to follow a file
 * into another module.
 */
function directoryOf(itemPath) {
  const slash = itemPath.lastIndexOf('/');
  return slash === -1 ? '' : itemPath.slice(0, slash);
}

/**
 * A title as a comparison sees it: trimmed, and blank read as unknown.
 *
 * A missing title is never equal to another missing title. Two files that both
 * failed to declare one have told us nothing about each other, and matching
 * them on that shared silence is exactly the wrong guess.
 */
function comparableTitle(title) {
  if (title == null) return null;
  const trimmed = String(title).trim();
  return trimmed === '' ? null : trimmed;
}

/** Group entries by a key, skipping the ones whose key is nullish or blank. */
function groupBy(entries, keyOf) {
  const groups = new Map();
  for (const entry of entries) {
    const key = keyOf(entry);
    if (key == null || key === '') continue;
    const bucket = groups.get(key);
    if (bucket) bucket.push(entry);
    else groups.set(key, [entry]);
  }
  return groups;
}

/**
 * The titles the Canvas side holds, indexed by the two identities a base row
 * can name it with: the module item, and the object behind it.
 *
 * Only step 2 reads this, and only as a fallback. A base row written before
 * this version stores no `title`, and refusing to look further would turn every
 * pre-existing row into an undetectable rename.
 */
function indexCanvasTitles(canvasItems) {
  const titles = new Map();
  for (const item of canvasItems) {
    if (!item) continue;
    const title = comparableTitle(item.title);
    if (title == null) continue;
    if (item.moduleItemId != null) {
      titles.set(`item:${item.moduleItemId}`, title);
    }
    if (item.canvasId != null && item.canvasType) {
      titles.set(`${item.canvasType}:${item.canvasId}`, title);
    }
  }
  return titles;
}

/**
 * The title a base row is known by: its own, or that of the Canvas item it
 * points at.
 *
 * @returns {string|null} null when neither side names one.
 */
function titleOfBaseRow(row, canvasTitles) {
  const own = comparableTitle(row && row.title);
  if (own != null) return own;
  if (!row) return null;
  if (row.module_item_id != null) {
    const byItem = canvasTitles.get(`item:${row.module_item_id}`);
    if (byItem != null) return byItem;
  }
  if (row.canvas_id != null && row.canvas_type) {
    const byContent = canvasTitles.get(`${row.canvas_type}:${row.canvas_id}`);
    if (byContent != null) return byContent;
  }
  return null;
}

/**
 * Work out which of the paths the base knows have merely moved.
 *
 * @param {object} sides
 * @param {Array<{itemPath: string, row: object}>} sides.base - Every item row
 *   the sync state holds, flattened across modules. Flat rather than per-module
 *   on purpose: a file dragged from one module folder to another is a rename
 *   like any other, and its hash follows it there.
 * @param {Array<{itemPath: string, title?: string, localHash?: string}>} sides.local -
 *   Every item in the working tree, likewise flattened.
 * @param {Array<{moduleItemId?: number, canvasType?: string, canvasId?: number, title?: string}>} [sides.canvas] -
 *   The Canvas items, read only to supply a title for a base row that stores
 *   none.
 * @returns {{renames: Array<{from: string, to: string, confidence: 'exact'|'probable'}>,
 *   unmatchedBase: string[], unmatchedLocal: string[]}}
 *   `renames` in detection order, every exact one before any probable one.
 *   `unmatchedBase` are paths the base knows that are gone from the tree and
 *   were not matched — genuine deletions. `unmatchedLocal` are paths in the
 *   tree the base has never seen and that were not matched — genuine additions.
 */
function detectRenames({ base = [], local = [], canvas = [] } = {}) {
  const baseEntries = base.map((entry) => ({
    itemPath: toPosixPath(entry.itemPath),
    row: entry.row || {},
  }));
  const localEntries = local.map((entry) => ({
    itemPath: toPosixPath(entry.itemPath),
    title: entry.title,
    localHash: entry.localHash,
  }));

  const localPaths = new Set(localEntries.map((entry) => entry.itemPath));
  const basePaths = new Set(baseEntries.map((entry) => entry.itemPath));

  // The only two sets a rename can be drawn from. A base path that still has a
  // file, or a local path the base already knows, is where it always was.
  const missingBase = baseEntries.filter(
    (entry) => !localPaths.has(entry.itemPath),
  );
  const untrackedLocal = localEntries.filter(
    (entry) => !basePaths.has(entry.itemPath),
  );

  const renames = [];
  const matchedBase = new Set();
  const matchedLocal = new Set();

  // Step 1 — identical content, wherever it landed.
  const baseByHash = groupBy(missingBase, (entry) => entry.row.local_hash);
  const localByHash = groupBy(untrackedLocal, (entry) => entry.localHash);
  for (const [hash, candidates] of localByHash) {
    if (candidates.length !== 1) continue;
    const owners = baseByHash.get(hash);
    if (!owners || owners.length !== 1) continue;
    renames.push({
      from: owners[0].itemPath,
      to: candidates[0].itemPath,
      confidence: 'exact',
    });
    matchedBase.add(owners[0].itemPath);
    matchedLocal.add(candidates[0].itemPath);
  }

  // Step 2 — same directory, same title: renamed and edited in one go.
  const canvasTitles = indexCanvasTitles(canvas);
  const stillMissing = missingBase.filter(
    (entry) => !matchedBase.has(entry.itemPath),
  );
  const stillUntracked = untrackedLocal.filter(
    (entry) => !matchedLocal.has(entry.itemPath),
  );
  // NUL joins the two halves, for the reason `adoptionKey` in `plan.js`
  // gives at length: a title may hold any printable character, and this key
  // only ever has to be unique. Written `\0`, never as the byte itself, or
  // the whole file reads as binary to `grep` and `file`.
  const placeKey = (itemPath, title) => `${directoryOf(itemPath)}\0${title}`;

  const baseByPlace = groupBy(stillMissing, (entry) => {
    const title = titleOfBaseRow(entry.row, canvasTitles);
    return title == null ? null : placeKey(entry.itemPath, title);
  });
  const localByPlace = groupBy(stillUntracked, (entry) => {
    const title = comparableTitle(entry.title);
    return title == null ? null : placeKey(entry.itemPath, title);
  });
  for (const [place, candidates] of localByPlace) {
    if (candidates.length !== 1) continue;
    const owners = baseByPlace.get(place);
    if (!owners || owners.length !== 1) continue;
    renames.push({
      from: owners[0].itemPath,
      to: candidates[0].itemPath,
      confidence: 'probable',
    });
    matchedBase.add(owners[0].itemPath);
    matchedLocal.add(candidates[0].itemPath);
  }

  return {
    renames,
    unmatchedBase: missingBase
      .filter((entry) => !matchedBase.has(entry.itemPath))
      .map((entry) => entry.itemPath),
    unmatchedLocal: untrackedLocal
      .filter((entry) => !matchedLocal.has(entry.itemPath))
      .map((entry) => entry.itemPath),
  };
}

module.exports = {
  detectRenames,
};
