// Shared helpers for the Course Manager extension. This module must never
// require('vscode'), so plain `node --test` can load it.

/**
 * Numeric filename prefix of an entry, or 0 when there is none.
 */
function extractPosition(name) {
  const match = name.match(/^(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
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

module.exports = {
  extractPosition,
  cliSiblings,
  reorderPosition,
  crossContainerPosition,
};
