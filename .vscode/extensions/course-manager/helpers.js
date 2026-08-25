// Shared helpers for the Course Manager extension. This module must never
// require('vscode'), so plain `node --test` can load it.

const path = require('path');

/**
 * Numeric filename prefix of an entry, or 0 when there is none.
 */
function extractPosition(name) {
  const match = name.match(/^(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * An entry name minus its numeric prefix — the one part of the name every CLI
 * renumbering pass preserves (`renumberSequential`, `renumberUp` and `reorder`
 * all rename via `name.replace(/^\d+/, newPrefix)`). Batch drops re-find
 * renumbered entries by this suffix; see `validateBatchDrop`.
 */
function nameSuffix(name) {
  return name.replace(/^\d+/, '');
}

/**
 * The numbered entries in `names` whose suffix matches `suffix`, in prefix
 * order. One match means the entry is re-findable after a renumber; two mean
 * the batch could no longer tell them apart.
 */
function matchBySuffix(names, suffix) {
  return cliSiblings(names).filter((name) => nameSuffix(name) === suffix);
}

/**
 * The entries the CLI's move commands operate on: names with a numeric
 * prefix, sorted by that prefix. Mirrors `getItems` (cli/item-utils.js) and
 * `getExistingModules` (cli/module-utils.js), so an index into this list is
 * an index into the CLI's list. Unnumbered entries, which the tree may still
 * display, are not CLI items and are dropped here.
 */
function cliSiblings(names) {
  return names
    .filter((name) => /^\d/.test(name))
    .map((name) => ({ name, prefix: extractPosition(name) }))
    .sort((a, b) => a.prefix - b.prefix)
    .map((entry) => entry.name);
}

/**
 * The `--position` for `move-module`/`move-item` that makes the dragged entry
 * take the drop target's visual slot. Those flags are 1-based ordinals into
 * the sorted sibling list, not filename prefixes: `reorder` (cli/renumber.js)
 * removes the dragged entry, splices it back at position - 1 of the remaining
 * list and renumbers everything 1..N, so the entry's final ordinal is exactly
 * the position passed. The target's pre-move ordinal therefore lands the
 * dragged entry in the target's slot for up- and down-moves alike — the
 * removal shift on a down-move is absorbed by the CLI's post-removal splice.
 *
 * Returns null when the target is not a CLI sibling (no numeric prefix).
 */
function reorderPosition(names, targetName) {
  const index = cliSiblings(names).indexOf(targetName);
  return index === -1 ? null : index + 1;
}

/**
 * The `--position` for `movetomodule-item` that makes the moved entry take
 * the drop target's slot in the destination. Unlike the reorder commands this
 * flag is a literal prefix, not an ordinal: `moveEntry`
 * (cli/movetomodule-item.js) shifts destination entries with prefix >=
 * position up by one and hands the moved entry that prefix, without ever
 * renumbering the destination sequentially. The target's own prefix is
 * therefore the right value even with gapped numbering.
 *
 * Returns null when the target has no numeric prefix. A return of 0 (a
 * 00-prefixed target) is a slot the CLI cannot fill: it refuses positions
 * below 1, and `renumberUp` only shifts prefixes >= the position, so the 00
 * entry can never be moved out of the way. Callers must refuse the drop
 * rather than pass 0 on.
 */
function crossContainerPosition(targetName) {
  const match = targetName.match(/^(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * The `movetomodule-item --position` prefix that appends to a container whose
 * entries are `names`: one past the highest existing prefix, matching the
 * CLI's own default. 1 for an empty container.
 */
function appendPosition(names) {
  const siblings = cliSiblings(names);
  return siblings.length === 0
    ? 1
    : extractPosition(siblings[siblings.length - 1]) + 1;
}

/**
 * The `--position` prefix for each entry of a batch landing at
 * `basePosition`, in dragged order: base, base+1, base+2, … Because
 * `renumberUp` shifts every destination prefix >= the position up by one,
 * each insertion pushes the previously landed tail one prefix higher, so
 * issuing the moves sequentially at these positions lands the batch in
 * exactly this order with the first entry on the target slot.
 *
 * Returns null when the batch would run past 99, the highest prefix the CLI
 * accepts — the caller must refuse the whole drop up front.
 */
function batchPositions(basePosition, count) {
  if (basePosition + count - 1 > 99) return null;
  return Array.from({ length: count }, (_, i) => basePosition + i);
}

/**
 * Dragged rows sorted into the order the tree displays them, which is the
 * order a batch drop must preserve at the landing point. VS Code hands the
 * drag selection over in click order, not visual order. Rows are the
 * serialised drag payload: { moduleFolderName, subfolderName, entryName }.
 */
function sortByVisualOrder(rows) {
  const key = (row) => [
    extractPosition(row.moduleFolderName || ''),
    row.subfolderName
      ? extractPosition(row.subfolderName)
      : extractPosition(row.entryName),
    // A subsection header sorts before its own children.
    row.subfolderName ? extractPosition(row.entryName) : -1,
  ];
  return rows.slice().sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    return ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2];
  });
}

/**
 * Refuse a multi-item drop the CLI cannot carry out as one unambiguous batch,
 * before the first call is made — a refused batch moves nothing. Returns the
 * refusal message, or null when the batch is safe.
 *
 * `rows` is the dragged payload (no module rows — the caller filters those),
 * `dest` is `{ dir, subfolderName }` with subfolderName null for a module
 * root, and `readDir` lists a directory as [{ name, isDirectory }].
 *
 * The suffix checks are load-bearing: after every CLI call the source
 * directory is renumbered to close the gap the move left, so the batch
 * re-finds each remaining entry (and each subsection directory on its path)
 * by its prefix-stripped suffix, the one name part no renumber rewrites. Two
 * siblings sharing a suffix would become indistinguishable the moment their
 * prefixes change, so such a batch is refused here rather than mis-resolved
 * later. Mid-batch nothing else can create a collision: source containers
 * only lose their dragged entries, and the one place the batch inserts is the
 * destination, guarded by the same-container and landing-clash checks below.
 */
function validateBatchDrop(rows, dest, readDir) {
  const destIsSubsection = dest.subfolderName != null;
  const destModuleRoot = destIsSubsection ? path.dirname(dest.dir) : dest.dir;
  const containerOf = (row) =>
    path.dirname(
      row.contextValue === 'subheader' ? row.folderPath : row.filePath,
    );

  // Every subsection on a row's path must be a numbered CLI sibling, or the
  // suffix lookup above cannot re-find it after the first move — which would
  // strand a partial batch that the single-item path handles fine.
  if (destIsSubsection && !/^\d/.test(dest.subfolderName)) {
    return `"${dest.subfolderName}" has no numeric prefix, so the batch cannot re-find it between moves.`;
  }

  for (const row of rows) {
    if (!/^\d/.test(row.entryName)) {
      return `"${row.entryName}" has no numeric prefix, so the CLI cannot move it.`;
    }
    if (row.subfolderName && !/^\d/.test(row.subfolderName)) {
      return `"${row.subfolderName}" has no numeric prefix, so the batch cannot re-find it between moves.`;
    }
    if (row.contextValue === 'subheader' && destIsSubsection) {
      return `"${row.entryName}" is a subsection, which can only land beside "${dest.subfolderName}" while dragged files land inside it — one batch cannot do both. Drop the subsections onto a module or a top-level item.`;
    }
  }

  const draggedSubDirs = new Map(
    rows
      .filter((r) => r.contextValue === 'subheader')
      .map((r) => [r.folderPath, r.entryName]),
  );
  for (const row of rows) {
    if (row.contextValue === 'subheader') continue;
    const parent = path.dirname(row.filePath);
    if (draggedSubDirs.has(parent)) {
      return `"${row.entryName}" sits inside "${draggedSubDirs.get(parent)}", which is in the same drop; moving the subsection already moves it.`;
    }
  }

  const containers = rows.map(containerOf);
  if (containers.every((dir) => dir === dest.dir)) {
    return 'A multi-item reorder cannot say which dragged item takes the target slot. Reorder one item at a time.';
  }
  const inside = containers.findIndex((dir) => dir === dest.dir);
  if (inside !== -1) {
    return `"${rows[inside].entryName}" is already in the destination, which would mix a reorder into the move. Leave it out of the drop.`;
  }

  const listings = new Map();
  const list = (dir) => {
    if (!listings.has(dir)) listings.set(dir, readDir(dir));
    return listings.get(dir);
  };
  const dirNamesIn = (dir) =>
    list(dir)
      .filter((entry) => entry.isDirectory)
      .map((entry) => entry.name);

  for (let i = 0; i < rows.length; i++) {
    const matches = matchBySuffix(
      list(containers[i]).map((entry) => entry.name),
      nameSuffix(rows[i].entryName),
    );
    if (matches.length > 1) {
      return `"${matches[0]}" and "${matches[1]}" differ only in their numeric prefix, and renumbering rewrites prefixes mid-batch, so the batch cannot keep them apart. Move them one at a time.`;
    }
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row.subfolderName) continue;
    const moduleRoot = path.dirname(containers[i]);
    const matches = matchBySuffix(
      dirNamesIn(moduleRoot),
      nameSuffix(row.subfolderName),
    );
    if (matches.length > 1) {
      return `Subsections "${matches[0]}" and "${matches[1]}" differ only in their numeric prefix, so the batch could not tell them apart mid-run. Move their items one at a time.`;
    }
    if (moduleRoot === destModuleRoot && !destIsSubsection) {
      const clash = rows.find(
        (r) =>
          r.contextValue === 'subheader' &&
          nameSuffix(r.entryName) === nameSuffix(row.subfolderName),
      );
      if (clash) {
        return `Landing "${clash.entryName}" next to subsection "${row.subfolderName}" would make the two indistinguishable mid-batch. Drop it separately.`;
      }
    }
  }

  if (destIsSubsection) {
    const matches = matchBySuffix(
      dirNamesIn(destModuleRoot),
      nameSuffix(dest.subfolderName),
    );
    if (matches.length > 1) {
      return `Subsections "${matches[0]}" and "${matches[1]}" differ only in their numeric prefix, so the batch could not re-find the destination mid-run. Move the items one at a time.`;
    }
  }

  return null;
}

/**
 * Where a file sits inside course/: `{ moduleFolder, segments }`, with
 * segments the path parts below the module folder, or null for a file the
 * module and item pickers have nothing to say about. Null covers a file
 * outside the workspace or outside course/, a file directly in the course/
 * root, and anything whose top-level folder is not a numbered module —
 * underscore folders included. A file deeper inside a numbered module always
 * resolves to that module, `_files/` assets and all: segments[0] may then name
 * an entry no picker lists, which promotes nothing, and the module itself is
 * still the answer.
 *
 * Comparison is `path.relative`, so a lookalike sibling (`course-notes/`, or
 * `01-mod` against `01-mod-extra`) never matches and trailing separators do
 * not matter. No case-folding is added here; comparisons inherit the
 * platform's path semantics (case-sensitive on POSIX, while
 * `path.win32.relative` compares case-insensitively).
 */
function courseLocation(workspaceRoot, filePath) {
  if (!workspaceRoot || !filePath) return null;
  const rel = path.relative(path.join(workspaceRoot, 'course'), filePath);
  if (
    rel === '' ||
    rel === '..' ||
    rel.startsWith(`..${path.sep}`) ||
    path.isAbsolute(rel)
  ) {
    return null;
  }
  const [moduleFolder, ...segments] = rel.split(path.sep);
  if (!/^\d/.test(moduleFolder) || segments.length === 0) return null;
  return { moduleFolder, segments };
}

/**
 * The quick-pick list with the first entry `isActive` matches moved to the
 * front, its description carrying `note` so the author can see why it leads.
 * Detection may only reorder, never skip a pick or drop a choice: every entry
 * stays in the list, and with no match the list comes back untouched. The
 * input array and the matched entry are not mutated.
 */
function promoteActive(items, isActive, note) {
  const index = items.findIndex(isActive);
  if (index === -1) return items;
  const active = items[index];
  const marked = {
    ...active,
    description: active.description ? `${active.description} · ${note}` : note,
  };
  return [marked, ...items.slice(0, index), ...items.slice(index + 1)];
}

/**
 * Whether a cross-module move's destination pick may seed the active file's
 * module. Seeding says "move the picked item into the module I am editing",
 * which only makes sense for an item known to lie outside that module: seeded
 * with the item's own module, Enter would run `movetomodule-item` onto the
 * module the item is already in, and that is no no-op — the CLI appends and
 * gap-closes, silently moving the file to the end of its module. A missing
 * location on either side never seeds: no active file gives nothing to offer,
 * and an item that cannot be placed cannot be shown to lie outside.
 *
 * Both arguments are `courseLocation` results (or null).
 */
function seedsDestination(itemLocation, activeLocation) {
  return (
    itemLocation != null &&
    activeLocation != null &&
    itemLocation.moduleFolder !== activeLocation.moduleFolder
  );
}

/**
 * The Canvas module id a sync state records for a local module folder, as a
 * string, or null when it holds none.
 *
 * A module's id lives on the module entry itself (`canvas_module_id`), not in
 * any item row, so the path lookup `getCanvasId` does cannot reach it. A folder
 * the state does not list, or lists without an id, has never been pushed.
 *
 * @param {object|null} state - Parsed `.canvas-sync.json`.
 * @param {string} folderName - Local module folder, e.g. '01-introduction'.
 */
function moduleCanvasId(state, folderName) {
  const entry = state && state.modules && state.modules[folderName];
  const id = entry && entry.canvas_module_id;
  return id == null ? null : String(id);
}

/**
 * Where "Open in Canvas" sends a module row.
 *
 * Canvas gives a module no page of its own: they all live on the course's
 * modules page, each one anchored by its id — the address `canvasItemUrl`
 * (cli/report.js) prints for an orphaned Canvas module too. So a module that
 * has been pushed deep-links to its own place in that list, and one that has
 * not, with no id to anchor on, opens the list itself: still where the author
 * was going.
 *
 * @param {string} baseUrl - Canvas base URL, without the /api/v1 suffix.
 * @param {string|number} courseId
 * @param {string|null} canvasModuleId
 */
function canvasModuleUrl(baseUrl, courseId, canvasModuleId) {
  const modulesPage = `${baseUrl}/courses/${courseId}/modules`;
  return canvasModuleId
    ? `${modulesPage}#module_${canvasModuleId}`
    : modulesPage;
}

/**
 * The pool number a terminal name carries: the bare base name is 1, and
 * "<base> 2" and up are their number. Any other name — another suffix like
 * ": Preview", a literal "<base> 1" (never issued: 1 is the bare name), a
 * user's own terminal — is null: not a pool terminal.
 */
function terminalNumber(name, baseName) {
  if (name === baseName) return 1;
  if (!name.startsWith(`${baseName} `)) return null;
  const suffix = name.slice(baseName.length + 1);
  if (!/^\d+$/.test(suffix)) return null;
  const number = parseInt(suffix, 10);
  return number >= 2 ? number : null;
}

/**
 * Which terminal a streaming command may use, given the pool as
 * [{ name, busy }] with the most recently used entry last. A busy terminal is
 * never picked while an alternative exists: sending into one would type the
 * command line into whatever interactive prompt is open there (a sync
 * conflict question, the setup wizard, init's questions) as its answer.
 * Returns { action: 'reuse', index } or { action: 'create', name }.
 *
 * Policy: the lowest-numbered idle terminal wins; with no idle terminal a
 * new one is created under the lowest free number, so a number a closed
 * terminal freed is filled before the count grows. At `cap` owned terminals
 * the most recently used one is reused even though it reads busy — a shell
 * without integration never reports idle, so past the cap every command
 * would otherwise open one more terminal forever. Typing into a busy
 * terminal is the bug this function exists to avoid, but unbounded terminal
 * spawn is the greater harm, and shell integration is on by default in
 * every VS Code new enough to run this extension, so the trade-off is
 * rarely reached.
 */
function pickTerminal(terminals, baseName, cap = 5) {
  let idle = -1;
  for (let i = 0; i < terminals.length; i++) {
    if (terminals[i].busy) continue;
    if (
      idle === -1 ||
      terminalNumber(terminals[i].name, baseName) <
        terminalNumber(terminals[idle].name, baseName)
    ) {
      idle = i;
    }
  }
  if (idle !== -1) return { action: 'reuse', index: idle };

  if (terminals.length >= cap) {
    return { action: 'reuse', index: terminals.length - 1 };
  }

  const used = new Set(
    terminals.map((entry) => terminalNumber(entry.name, baseName)),
  );
  let number = 1;
  while (used.has(number)) number += 1;
  return {
    action: 'create',
    name: number === 1 ? baseName : `${baseName} ${number}`,
  };
}

module.exports = {
  extractPosition,
  cliSiblings,
  reorderPosition,
  crossContainerPosition,
  nameSuffix,
  matchBySuffix,
  appendPosition,
  batchPositions,
  sortByVisualOrder,
  validateBatchDrop,
  courseLocation,
  promoteActive,
  seedsDestination,
  moduleCanvasId,
  canvasModuleUrl,
  terminalNumber,
  pickTerminal,
};
