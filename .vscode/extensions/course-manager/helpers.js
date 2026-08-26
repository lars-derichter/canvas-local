// Shared helpers for the Course Manager extension. This module must never
// require('vscode'), so plain `node --test` can load it.

const fs = require('fs');
const path = require('path');
const { AsyncLocalStorage } = require('async_hooks');

/**
 * The label a tree row carries for an entry name: numeric prefix off,
 * separators to spaces, sentence case.
 *
 * A copy of `displayTitle` in lib/convert/course-scanner.js, which derives the
 * Canvas item title from the same name. The two agreeing is what makes the
 * tree show the title Canvas will get, so helpers.test.js pins them together.
 */
function displayTitle(name) {
  const stripped = name.replace(/^\d+-/, '');
  const spaced = stripped.replace(/[-_]+/g, ' ').trim();
  // Sentence case, matching the library: only the first character is raised,
  // so the tree shows the same label Canvas gets.
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * The parsed JSON file, or `fallback` when it is missing or unreadable.
 *
 * The same read as `safeReadJSON` in cli/module-utils.js, minus its warning:
 * that one runs inside a sync and reports an unparseable file through the
 * logger, where this one has a tree row to draw and nowhere to report it.
 */
function safeReadJSON(filePath, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

/**
 * Read frontmatter fields from a markdown file without a YAML dependency.
 * Returns { canvasType, title, externalUrl }. The Canvas id is deliberately
 * not among them: identity lives in `.canvas-sync.json`, keyed by path, and a
 * `canvas_id` left behind in an older file is the stale copy that made the two
 * disagree. `getCanvasId` reads the state instead.
 */
function readFrontmatter(filePath) {
  const result = {
    canvasType: 'page',
    title: null,
    externalUrl: null,
  };
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    if (!content.startsWith('---')) return result;
    const endIndex = content.indexOf('\n---', 3);
    if (endIndex === -1) return result;
    const frontmatter = content.substring(3, endIndex);

    const typeMatch = frontmatter.match(/^canvas_type:\s*(.+)$/m);
    if (typeMatch) result.canvasType = typeMatch[1].trim();

    const titleMatch = frontmatter.match(/^title:\s*(.+)$/m);
    if (titleMatch) {
      // Strip surrounding quotes gray-matter may have added
      result.title = titleMatch[1].trim().replace(/^["'](.*)["']$/, '$1');
    }

    const urlMatch = frontmatter.match(/^external_url:\s*(.+)$/m);
    if (urlMatch)
      result.externalUrl = urlMatch[1].trim().replace(/^["'](.*)["']$/, '$1');
  } catch {
    // Defaults
  }
  return result;
}

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
 * The parsed `.canvas-sync.json`, or null when there is none to read.
 *
 * Read on every call rather than cached: a push or a pull rewrites that file
 * while the window stays open, and an id cached from before it would send the
 * author to the wrong object — or to none at all, for an item that has only
 * just been created. Unreadable and corrupt read as absent here; the two
 * lookups below have nothing to vouch for either way.
 *
 * @param {string} workspaceRoot
 */
function readSyncState(workspaceRoot) {
  if (!workspaceRoot) return null;
  try {
    return JSON.parse(
      fs.readFileSync(path.join(workspaceRoot, '.canvas-sync.json'), 'utf8'),
    );
  } catch {
    return null;
  }
}

/**
 * The Canvas id recorded for a course file, or null.
 *
 * @param {string} workspaceRoot
 * @param {string} filePath - Absolute path to the course file.
 */
function getCanvasId(workspaceRoot, filePath) {
  if (!workspaceRoot) return null;
  const relative = path.relative(path.join(workspaceRoot, 'course'), filePath);
  if (!relative || relative.startsWith('..')) return null;
  const key = relative.split(path.sep).join('/');
  const state = readSyncState(workspaceRoot);
  for (const module of Object.values((state && state.modules) || {})) {
    const row = (module.items || {})[key];
    if (row && row.canvas_id != null) return String(row.canvas_id);
  }
  return null;
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
 * The Canvas id recorded for a module folder, or null when that module has
 * never been pushed. Keyed by the folder name, the way `.canvas-sync.json` keys
 * modules: a module has no path row of its own for `getCanvasId` to find.
 *
 * @param {string} workspaceRoot
 * @param {string} moduleFolderName - e.g. '01-introduction'.
 */
function getModuleCanvasId(workspaceRoot, moduleFolderName) {
  if (!workspaceRoot || !moduleFolderName) return null;
  return moduleCanvasId(readSyncState(workspaceRoot), moduleFolderName);
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
 * A value with one matched pair of surrounding quotes taken off.
 *
 * Matched at both ends and the same character on both: a lone quote at one
 * end, or a double at one end and a single at the other, is part of the value
 * and stays. So is every quote inside it, `KEY="say "hi""` keeping its inner
 * pair. A bare `"` is one character, not an empty quoted value.
 */
function unquote(value) {
  const quote = value[0];
  if (quote !== '"' && quote !== "'") return value;
  return value.length >= 2 && value.endsWith(quote)
    ? value.slice(1, -1)
    : value;
}

/**
 * One line of a `.env`, as the shapes a hand-edited one takes: an optional
 * `export`, leading whitespace, a quoted or bare value, and a trailing `#`
 * comment that the quotes protect. Modelled on dotenv's own `LINE` pattern
 * (node_modules/dotenv/lib/main.js), narrowed to the shapes this project's
 * `.env` is written in — see `readEnvConfig` for what is left out and why.
 *
 * The `^` is load-bearing: it is the whole of what tells a commented-out
 * `# CANVAS_COURSE_ID=99999` from a live one. `[^#\r]` rather than `[^#]` for
 * the bare value keeps a lone-CR file matching nothing, as it always has,
 * instead of reading the file as one long line.
 */
const ENV_LINE =
  /^\s*(?:export\s+)?(\w+)\s*=\s*('(?:\\'|[^'])*'|"(?:\\"|[^"])*"|[^#\r]*)\s*(?:#.*)?$/;

/**
 * Every `KEY=value` pair in the workspace's `.env`, as a plain object, or an
 * empty one when there is no file to read.
 *
 * The parse is by shape, not by name, so the whole file comes back —
 * CANVAS_API_TOKEN included. `extension.js` reads two of them, CANVAS_API_URL
 * and CANVAS_COURSE_ID, to build the "Open in Canvas" address.
 *
 * Hand-rolled rather than `require('dotenv')` deliberately: the extension is
 * installed into ~/.vscode/extensions with no `node_modules` of its own, and
 * reaching into the opened workspace's copy would let any folder someone opens
 * run code in the extension host. So this file stays dependency-free and
 * tracks dotenv by test instead — helpers.test.js runs a corpus of hand-edited
 * shapes through both and pins where the two part company. Where it stops
 * short, for want of any evidence a `.env` here takes those shapes: keys with
 * dots or hyphens, `KEY: value`, backtick quotes, `\n` escapes inside double
 * quotes, values spanning lines, a key and its `=` split across lines (dotenv
 * matches one global `/m` pattern whose `\s*=` crosses the newline, where this
 * reads a line at a time), and lone-CR (classic Mac) line endings.
 *
 * Quoting a value is ordinary `.env` practice, and `dotenv` — which every CLI
 * command loads this same file with (`cli/index.js`) — takes the quotes off.
 * Reading them as part of the value made the two disagree about one file:
 * `CANVAS_API_URL="https://school.instructure.com/api/v1"` sent every CLI
 * command to the right host and every "Open in Canvas" click to a URL
 * beginning with a quote character. The quotes come off here too.
 */
function readEnvConfig(root) {
  const envPath = path.join(root, '.env');
  try {
    const content = fs.readFileSync(envPath, 'utf8');
    const vars = {};
    // Split on either ending, and on a file that mixes them. ENV_LINE's
    // trailing `\s*` would absorb a stray carriage return on a plain line, so
    // the split looks redundant until a line carries an inline comment: `#.*`
    // stops dead at the `\r`, the `$` has nothing left to reach, and the line
    // is dropped whole. Splitting here is what keeps every line of a CRLF
    // `.env` readable, commented or not.
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(ENV_LINE);
      if (match) vars[match[1]] = unquote(match[2].trim());
    }
    return vars;
  } catch {
    return {};
  }
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

// The shell names whose quoting rules this module knows, by flavour. A shell
// is only quoted for by name: guessing from the family a name looks like is
// what let csh and fish through the first version of this code, both of which
// break POSIX single-quoting in ways that corrupt a value silently.
const SHELL_NAMES = {
  cmd: ['cmd'],
  powershell: ['powershell', 'pwsh'],
  csh: ['csh', 'tcsh'],
  fish: ['fish'],
  posix: [
    'sh',
    'bash',
    'zsh',
    'dash',
    'ash',
    'ksh',
    'ksh93',
    'mksh',
    'pdksh',
    'busybox',
    'wsl',
  ],
};

/**
 * The bare executable name inside what VS Code reports as the shell, lowercased
 * and without its `.exe`. The reported value is usually a plain path, but it
 * can arrive quoted, with a trailing space, or with arguments appended
 * (`pwsh.exe -NoLogo`), and a name that fails to parse falls through to the
 * platform guess — on Windows, the unsafe direction. So: trim, unwrap a quoted
 * path, and end an unquoted Windows path at its `.exe` rather than at the first
 * space, because `C:\Program Files\...` has spaces inside the path itself.
 *
 * Shapes this deliberately does not chase, because every one of them is
 * pathological and none is a shell VS Code would report: a POSIX path that both
 * contains a space and carries arguments (`/opt/my shell/fish -l`), a directory
 * called something.exe (`C:\my.exe dir\cmd.exe`), and a doubled suffix
 * (`bash.exe.exe`). Each resolves to a name no list matches, which lands on the
 * platform guess.
 */
function shellExecutable(shellPath) {
  let text = String(shellPath || '').trim();
  if (!text) return '';
  if (text[0] === '"' || text[0] === "'") {
    const close = text.indexOf(text[0], 1);
    text = close === -1 ? text.slice(1) : text.slice(1, close);
  } else {
    const exe = text.match(/^(.*?\.exe)(?=\s|$)/i);
    text = exe ? exe[1] : text.split(/\s/)[0];
    // A stray trailing quote would otherwise defeat the .exe suffix strip and
    // send a cmd.exe to the platform guess, which is the unsafe direction.
    text = text.replace(/["']+$/, '');
  }
  return text
    .split(/[\\/]/)
    .pop()
    .toLowerCase()
    .replace(/\.exe$/, '');
}

/**
 * Which quoting rules a command line typed into the terminal needs.
 *
 * `shellPath` is what VS Code reports as the shell it will start
 * (`vscode.env.shell`), and a name this module knows always decides on its own:
 * a terminal opened without an explicit `shellPath` runs that shell, and on
 * Windows the answer is genuinely one of several (PowerShell, cmd, or a POSIX
 * shell on a win32 platform — Git Bash, WSL), so the platform must never
 * overrule a known name. Windows paths are compared case-insensitively, with
 * either separator.
 *
 * `platform` decides for a name no list matches, and for no name at all (in
 * practice never: `vscode.env.shell` is a non-optional string in the API).
 * win32 then means PowerShell, VS Code's default terminal profile there;
 * anywhere else, POSIX. This is a guess in both directions, and it is the
 * likeliest shell rather than the safest one — there is no safe fallback, since
 * every flavour's quoting is an injection somewhere else (cmd's caret form
 * leaves `$(…)` live inside the double quotes a POSIX shell would see).
 *
 * @param {string|undefined} shellPath
 * @param {string} platform - A `process.platform` value.
 * @returns {'posix'|'powershell'|'cmd'|'csh'|'fish'}
 */
function shellFlavour(shellPath, platform) {
  const name = shellExecutable(shellPath);
  for (const [flavour, names] of Object.entries(SHELL_NAMES)) {
    if (names.includes(name)) return flavour;
  }
  return platform === 'win32' ? 'powershell' : 'posix';
}

/**
 * A value no quoting rule for this shell can carry. Thrown rather than
 * returned, because the caller must not send anything at all: the whole point
 * is that there is no string that would mean this value there.
 */
class UnquotableValue extends Error {
  constructor(value, flavour, character) {
    const shown = value.length > 60 ? `${value.slice(0, 60)}…` : value;
    const problem =
      character === '\0'
        ? 'a null byte, which cannot be part of any command-line argument'
        : `a line break, which ${flavour} would run as a second command`;
    super(`${JSON.stringify(shown)} contains ${problem}`);
    this.name = 'UnquotableValue';
    this.value = value;
    this.flavour = flavour;
  }
}

// What each flavour cannot represent at all. A NUL is impossible everywhere: it
// terminates a C string, so no argument can contain one. A line break is
// carried only where that is verified, and refused everywhere else, because
// where it is not carried it is an injection and not a lost value: csh reports
// "Unmatched '" and then runs the second line as a fresh command (verified in
// csh and tcsh, `-c` and interactive), and cmd would do the same. PowerShell is
// unverifiable here and shares cmd's failure mode, so it is refused too; on
// Windows the case cannot arise anyway, because Win32 forbids control
// characters in filenames.
//
// The weak entry in this table is fish. POSIX carrying a newline was measured
// end to end — typed into a real interactive bash and zsh on a pty, argv read
// back from the child — but fish was only ever reachable non-interactively
// here (the one binary available segfaults under a pty), so "fish's reader
// continues an open quote across a newline" is reasoned from its documented
// grammar, not observed. If that reasoning is wrong, fish is an injection like
// csh rather than corruption like a folded CR. Anyone who gets an interactive
// fish should check that case first.
const UNREPRESENTABLE = {
  posix: /\0/,
  fish: /\0/,
  csh: /[\0\r\n]/,
  cmd: /[\0\r\n]/,
  powershell: /[\0\r\n]/,
};

/**
 * `value` as one argument of a command line for a `shellFlavour` shell.
 *
 * Throws `UnquotableValue` for a value the flavour cannot represent (see
 * `UNREPRESENTABLE`), and a plain Error for a flavour it does not know. Both
 * are refusals, not fallbacks: quoting for the wrong shell is the injection
 * this module exists to prevent, so there is nothing safe to return.
 *
 * What each flavour guarantees, and what it cannot:
 *
 * **posix** (sh, bash, zsh, dash, ksh, WSL, Git Bash) — single quotes, with the
 * `'\''` idiom for an embedded quote. Everything else is literal inside them:
 * `$`, a backtick, `!` (history expansion does not run inside quotes in these
 * shells), `\`, glob characters, whitespace and the control operators `;`,
 * `&&`, `|`. A newline survives too: the open quote continues onto the next
 * line, and the value arrives with the newline in it — measured by typing one
 * into a real interactive bash and zsh on a pty, which is what `sendText`
 * does, and checking the argv the child received. That is the shell grammar;
 * the delivery channel is narrower, because a pty is not a pipe — a TAB
 * triggers completion, ESC/DEL/VT/FF/NUL are swallowed and a CR arrives as LF,
 * none of which quoting can restore. Verified by round-tripping the hostile
 * corpus through real sh, bash, zsh, dash and ksh.
 *
 * **csh** (csh, tcsh) — the POSIX idiom plus `!` written as `\!` *inside* the
 * quotes, because csh runs history expansion before it parses quotes, so single
 * quotes do not protect a `!` there. `\!` is the form csh accepts inside single
 * quotes, and it drops that backslash, so the value arrives intact. Verified
 * against real csh and tcsh: over this module's 28-value hostile corpus the
 * plain POSIX rule fails 4 under `tcsh -c` — loudly on `wow!!`, `!important`
 * and `a!b` ("Event not found", the line never runs) and silently on `a\!b`,
 * which arrives as `a!b`. Typed into an interactive tcsh it fails more, and
 * worse: `!$` is silently replaced by the previous command's last argument
 * (measured — the value came back as `seeded-argument`). The csh rule passes
 * all 28 in both. Same pty caveat as POSIX, and measured there too: a TAB in
 * the value is eaten by completion before the shell ever parses the line. A
 * newline is refused, not quoted; see `UNREPRESENTABLE`.
 *
 * **fish** — single quotes, but fish's single quotes are not POSIX single
 * quotes: `\\` and `\'` are escapes inside them and nothing else is. So a
 * backslash has to be doubled and a quote written `\'`. fish has no history
 * expansion, so `!` needs nothing. Verified against real fish 4.8.1: all 28
 * hostile values round-trip, and the POSIX rule breaks 2 of them there — a
 * hard parse error on `C:\dir\`, whose trailing backslash escapes fish's
 * closing quote, and silent corruption of `a\\b` into `a\b`. A newline is
 * carried correctly (verified under `-c`; fish would not start interactively
 * in this sandbox, so that path is untested).
 *
 * **powershell** — single quotes, doubling an embedded quote. PowerShell does
 * no interpolation inside them. The token is then parsed a *second* time before
 * it reaches node, so that is the parse this rule is really chosen for. Under
 * PowerShell `npx` resolves to npm's `npx.ps1` shim, not to `npx.cmd` (the
 * everyday "npx.ps1 cannot be loaded because running scripts is disabled" error
 * is that shim), and the branch it takes for a command typed at a prompt
 * re-parses the original line with
 * `[Management.Automation.Language.Parser]::ParseInput`, takes each argument's
 * `Extent.Text` — the token's own source text, quotes included — joins them
 * with spaces and runs `Invoke-Expression "& \`"$NODE_EXE\`" \`"$NPX_CLI_JS\`"
 * $NPX_ARGS"`. A single-quoted token re-parses to itself; a double-quoted one
 * would survive PowerShell's first parse and then interpolate `$…` on the
 * second. Read from the `npx.ps1` npm ships, and modelled in the tests, but not
 * executed: there is no Windows in this repo's toolchain.
 *
 * **cmd** — two layers, because cmd hands the raw line to the program and the
 * program parses it again:
 *   1. The program's layer, the MSVC CRT rules — `node.exe` has a `wmain`, so
 *      its argv comes from the CRT's own parser, not from
 *      `CommandLineToArgvW`. The two agree everywhere except on the rule this
 *      depends on: for `""` inside a quoted region the CRT emits one quote and
 *      stays in the region, while `CommandLineToArgvW` needs three consecutive
 *      quotes for that. A program that took its argv from
 *      `CommandLineToArgvW` would therefore split several of these values.
 *      Wrap in `"`, write an embedded `"` as `""`, and double a backslash run
 *      that sits immediately before a quote. `""` rather than the more familiar
 *      `\"` because `npx.cmd` forwards `%*` on to `node` and cmd re-parses that
 *      line: cmd does not know about backslash escapes, so `\"` would close the
 *      quoted section early and leave a following `&` live, while a doubled
 *      quote keeps cmd's quote parity balanced and still reads as one literal
 *      quote to the CRT. A `"` in the value therefore survives both hops.
 *   2. cmd's own layer: prefix every one of `( ) % ! ^ " < > & |` with `^`,
 *      the quotes from step 1 included, so cmd never enters a quoted section at
 *      all. This is the only way to cover `%`: cmd expands `%VAR%` inside
 *      double quotes, but percent expansion runs before caret removal, so
 *      `^%VAR^%` looks up a variable named `VAR^`, misses, and survives as the
 *      literal text.
 * A newline is refused rather than quoted, for the reason given on
 * `UNREPRESENTABLE`. What remains uncovered is `!` under `cmd /v:on`, where
 * delayed expansion re-reads it inside quotes; that stays unreachable in
 * practice, since Win32 forbids control characters in filenames and nothing
 * here enables delayed expansion. The cmd rules are modelled against the
 * documented parsers, not executed: there is no Windows in this toolchain.
 *
 * @param {string} value
 * @param {'posix'|'powershell'|'cmd'|'csh'|'fish'} flavour
 * @throws {UnquotableValue} when the flavour cannot represent the value.
 */
function shellQuote(value, flavour) {
  const text = String(value);
  const unrepresentable = UNREPRESENTABLE[flavour];
  if (!unrepresentable) {
    throw new Error(
      `shellQuote: unknown shell flavour ${JSON.stringify(flavour)}`,
    );
  }
  const found = text.match(unrepresentable);
  if (found) throw new UnquotableValue(text, flavour, found[0]);

  if (flavour === 'powershell') return `'${text.replace(/'/g, "''")}'`;
  if (flavour === 'fish') return `'${text.replace(/[\\']/g, '\\$&')}'`;
  if (flavour === 'csh') {
    return `'${text.replace(/'/g, "'\\''").replace(/!/g, '\\!')}'`;
  }
  if (flavour === 'cmd') {
    const quoted = `"${text.replace(/(\\*)"/g, '$1$1""').replace(/(\\+)$/, '$1$1')}"`;
    return quoted.replace(/[()%!^"<>&|]/g, '^$&');
  }
  return `'${text.replace(/'/g, "'\\''")}'`;
}

/**
 * Where the CLI this extension drives lives inside `workspaceRoot`, or null
 * when the open folder carries none.
 *
 * The extension ships inside the template, beside the `cli/` it runs and the
 * `course/` tree it edits, so this is the only place worth looking. The runner
 * used to fall back on `npx`, which cost more than it bought: on Windows the
 * program is `npx.cmd`, libuv resolves no `.cmd` from PATH, and Node 24 refuses
 * to run one without a shell at all (the CVE-2024-27980 fix), so the fallback
 * could only ever fail there — with an ENOENT naming a program the author never
 * typed. A workspace with no `cli/index.js` is not a course project, and saying
 * that plainly is worth more than a second way to fail.
 */
function cliEntryPoint(workspaceRoot) {
  if (!workspaceRoot) return null;
  const entry = path.join(workspaceRoot, 'cli', 'index.js');
  return fs.existsSync(entry) ? entry : null;
}

/**
 * The environment the CLI child runs with: this process's, plus
 * `ELECTRON_RUN_AS_NODE`.
 *
 * The runner starts the CLI as `process.execPath <cli/index.js>`, and in a
 * desktop VS Code `process.execPath` is not node: it is the Electron helper
 * binary the extension host itself runs as. That binary behaves as node only
 * when `ELECTRON_RUN_AS_NODE` is set in its environment. Without it, it boots
 * as an Electron app instead and the CLI never runs.
 *
 * It works today without this line, and not for a reason worth leaning on. The
 * extension host's own OS-level environment does *not* carry the variable —
 * `ps eww` on a live host shows it absent, while every language server the host
 * spawns has it, because each of those sets it explicitly. What supplies it is
 * VS Code's own extension-host bootstrap, which assigns
 * `process.env.ELECTRON_RUN_AS_NODE = '1'` at runtime, so a child inheriting
 * `process.env` picks it up. That assignment is an implementation detail inside
 * a minified bundle, with no API promising it and nothing in the process
 * environment showing it, and it stops reaching the child the moment a caller
 * passes a filtered environment. Setting it here makes the child's behaviour a
 * property of this code instead.
 *
 * A remote or server extension host runs on plain node, where the variable
 * means nothing and setting it is inert.
 */
function cliChildEnv(env) {
  return { ...env, ELECTRON_RUN_AS_NODE: '1' };
}

/**
 * A queue that runs one task at a time, in the order they arrive.
 *
 * Two structural commands that overlap both renumber a directory and both
 * rewrite `.canvas-sync.json`, and the second reads a tree the first is halfway
 * through rewriting. Nothing stops an author from starting the second one: a
 * drop, a palette command and a context-menu command are three independent
 * events, and a batch drop already fires the CLI once per dragged row.
 *
 * It serialises commands, not batches. A batch drop is a loop of separate
 * commands, so two overlapping batches still interleave step by step; what
 * keeps that honest is `_resolveRowPath`, which re-resolves each row and
 * refuses an ambiguous one, so the outcome is a stopped batch rather than a
 * wrong move.
 *
 * The hazard in a plain promise chain is a deadlock. A task that queues another
 * task and waits for it waits forever, because its own turn is what has to end
 * first, and a wedged queue takes every later command with it — no error, and
 * nothing in the log. No call site does that today (each one is entered from a
 * VS Code command or a drop handler, never from inside a run), but "today" is
 * not a guarantee, so the queue does not rely on it: `AsyncLocalStorage` tells
 * it when a call comes from inside one of its own tasks, and such a call runs
 * straight through instead of queueing.
 *
 * The escape is scoped to the run, and the flag is what scopes it. A store is
 * inherited by every async resource seeded while the task ran, and those
 * outlive the task: a `.then` registered inside it and resolved later, a
 * `setTimeout` it started, a promise it created and something else settled.
 * Measured, not feared — before the flag, a call fired from a timer that a
 * previous run's completion callback had started sailed past the queue, with
 * two CLI children alive at once. The shape is one small feature away: a Retry
 * button on the error notification is registered inside the run and pressed
 * long after it. So the test is not "is there a store" but "is that run still
 * going", which also settles what a leaked context reaching a later drop
 * handler could do: nothing, because the flag it finds is already false.
 *
 * What the escape still costs, unchanged: a nested call is outside the queue,
 * so it is unserialised against whatever else runs while it lasts. That is
 * what every call had before this queue existed.
 *
 * One thing every task owes the queue: it must settle. The next turn waits for
 * this one, so a task that never resolves stops every later command for the
 * session. `execCli` is written so that each of its paths settles, the
 * completion callback included.
 */
function createSerialQueue() {
  const inTask = new AsyncLocalStorage();
  let tail = Promise.resolve();

  return function enqueue(task) {
    if (inTask.getStore()?.active) return Promise.resolve().then(task);

    const turn = { active: true };
    const result = tail.then(() => inTask.run(turn, task));
    // The next task waits for this one to settle, not to succeed: a task that
    // throws must not wedge the queue, and its failure belongs to the caller
    // holding `result` rather than to whoever is next in line. The same two
    // handlers close the turn, so a run that failed leaks no escape either.
    const close = () => {
      turn.active = false;
    };
    tail = result.then(close, close);
    return result;
  };
}

/**
 * Call `announce` when `work` has not settled inside the window `schedule`
 * opens, and never once it has.
 *
 * `schedule(fn)` opens the window and returns the function that closes it —
 * `setTimeout`/`clearTimeout` in the extension, something deterministic in the
 * tests. Both settle paths close it, so a run that fails fast stays as quiet as
 * one that succeeds fast; handling the rejection here is also what keeps a
 * failed run from reaching the host as an unhandled rejection.
 */
function announceIfSlow(work, announce, schedule) {
  const close = schedule(announce);
  const stop = () => close();
  work.then(stop, stop);
}

/**
 * One indicator for however many runs are outstanding.
 *
 * `track(work, title)` per run: the indicator opens when some run has been
 * outstanding longer than the window `schedule` defines, and closes when the
 * last outstanding run settles. `show(title)` opens it and returns the function
 * that closes it.
 *
 * The counting is the whole point, and a drop is what proves it. Ten rows
 * dropped on a module are ten separate runs, queued; a window armed per run
 * opens one indicator for every row still waiting when its own window expires.
 * Measured on the version before this: a ten-row drop stacked eight
 * simultaneous indicators and unwound them one at a time — the same
 * one-per-rename nuisance the delay was there to prevent, moved rather than
 * removed. So the window arms per run, because a run that waits its turn is
 * exactly the one nobody has been told about, but what it opens is shared.
 *
 * The title is the one belonging to the run that opened the indicator. For the
 * ordinary single command that is its name; for a batch it is the name of the
 * command that was slow first, which is what is running.
 *
 * Both settle paths count, so a run that fails or is rejected releases the
 * indicator like any other. A rejected run reaching the host is what would
 * otherwise leave a spinner turning with nothing behind it.
 */
function createProgressGate(schedule, show) {
  let outstanding = 0;
  let close = null;

  return function track(work, title) {
    outstanding += 1;
    const settled = () => {
      outstanding -= 1;
      if (outstanding === 0 && close) {
        const finish = close;
        close = null;
        finish();
      }
    };
    work.then(settled, settled);
    announceIfSlow(
      work,
      () => {
        if (close) return;
        close = show(title);
      },
      schedule,
    );
  };
}

/**
 * Which terminal the preview should type into, and what is known about its
 * shell: `{ terminal, flavour }`, or null when there is none to adopt and the
 * caller has to open one.
 *
 * The same rule the terminal pool follows, and it has to be the same rule for
 * the same reason: a stamp is a fact about one terminal object, not about a
 * name. A terminal already open under that name is either the one this
 * extension opened and stamped — `known`, whose stamp still holds — or somebody
 * else's, whose shell is not knowable and whose stamp is therefore null, so
 * `quoterFor` falls back to the current profile as a guess rather than quoting
 * for a shell it was never told about.
 *
 * Held apart from the command so it can be tested: the case that matters is one
 * where two terminals share a name, and driving that through a live editor is
 * not something a test can do.
 */
function previewTerminalEntry(terminals, name, known) {
  const found = (terminals || []).find((terminal) => terminal.name === name);
  if (!found) return null;
  if (known && known.terminal === found) return known;
  return { terminal: found, flavour: null };
}

/** Where the preview server runs when nothing says otherwise. */
const DEFAULT_PREVIEW_PORT = 3000;

/**
 * The port the preview command should use, as `{ port, rejected }`.
 *
 * `rejected` is the configured value when it could not be used, so the caller
 * can say so: silently falling back would leave an author who set 3001 looking
 * at a preview on 3000 with nothing to explain it.
 *
 * The port is not cosmetic here. It goes into the URL that decides whether a
 * server is already running, so a wrong one either polls whatever else answers
 * on 3000 and opens that, or waits two minutes for a Docusaurus that is
 * answering happily on another port.
 *
 * A number reaches this straight from the settings file, where nothing enforces
 * the manifest's schema: VS Code reports a type mismatch in the editor and
 * hands the value over anyway. A digits-only string is taken, because that is
 * the mistake a settings file invites (`"previewPort": "3001"`); anything else,
 * including a boolean, a float and 0 (which means "any free port" to a server
 * and nothing at all to a poller), is refused. A leading zero is refused with
 * them: `"007"` is a typo, and reading it as 7 would put the preview on a
 * privileged port without a word.
 */
function previewPort(configured) {
  if (configured === undefined || configured === null) {
    return { port: DEFAULT_PREVIEW_PORT, rejected: null };
  }
  const port =
    typeof configured === 'number'
      ? configured
      : typeof configured === 'string' &&
          /^(?:0|[1-9]\d*)$/.test(configured.trim())
        ? Number(configured.trim())
        : NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { port: DEFAULT_PREVIEW_PORT, rejected: configured };
  }
  return { port, rejected: null };
}

/**
 * What to tell the author about a directory listing that threw, or null when
 * there is nothing to tell.
 *
 * The tree lists a directory each time it draws a row, and every one of those
 * listings races the author: a folder can be renamed, moved or deleted between
 * the refresh being scheduled and the read happening, and the CLI's own
 * renumbering renames folders under the tree by design. A throw there takes out
 * whatever the caller was building, up to and including the whole view.
 *
 * Catching it is not enough on its own, because "gone" and "unreadable" are not
 * the same event and an empty tree is a plausible answer to only one of them:
 *
 *   - ENOENT and ENOTDIR mean the folder is not there any more, or is not a
 *     folder. The refresh that follows the change will draw the truth, so
 *     saying nothing is right.
 *   - Everything else — EACCES on a folder whose permissions changed, EMFILE
 *     when the host has run out of descriptors — means the content is there and
 *     this process cannot see it. Answering [] silently would draw an empty
 *     module and call it the truth.
 */
function directoryReadError(dir, error) {
  const code = error && error.code;
  if (code === 'ENOENT' || code === 'ENOTDIR') return null;
  const reason = code || (error && error.message) || 'unknown error';
  return `${dir} could not be read (${reason}), so the tree is showing it empty.`;
}

/**
 * What is wrong with a typed points-possible value, or null when nothing is.
 * The shape `showInputBox`'s `validateInput` wants.
 *
 * What counts as valid is the CLI's answer, not Canvas's: the value goes to
 * `--points`, and `cli/new-item.js` reads it with `parseInt(value, 10)`. So
 * anything parseInt would take a bite out of has to be stopped here, where the
 * author is still looking at what they typed:
 *
 *   - `abc` parses to NaN, and NaN is not null, so it lands in the frontmatter
 *     as `points_possible: .nan`.
 *   - `2.5` parses to 2 and `1e5` parses to 1. Canvas itself is happy with
 *     fractional points, and a `points_possible: 2.5` written into the file by
 *     hand pushes fine (lib/sync/canvas-write.js passes it through), so the
 *     refusal says where to put one rather than pretending the number is
 *     impossible.
 *   - Past 2^53 the digits stop being kept at all.
 *
 * Empty is valid and means 100, which is what the CLI's own interactive prompt
 * defaults to and what the box is pre-filled with. Zero is valid: an
 * assignment worth no points is an ordinary Canvas assignment.
 *
 * Some spellings are refused although parseInt would have read them back
 * whole: a sign (`-5`, `+5`, `-0`), a decimal point over a whole number
 * (`5.`, `5.0`), an exponent that resolves to one (`0e2`). What they have in
 * common is that none of them is a plain string of digits, and a plain string
 * of digits is never refused for the way it is written — only for being too
 * long to keep. The minus is the one that matters: commander hands
 * `--points -5` through as a value, and the CLI writes `points_possible: -5`
 * without a word, and nothing is worth minus five points. The rest are slips
 * rather than shorthands, and go the same way.
 */
function validatePoints(value) {
  const typed = String(value ?? '').trim();
  if (typed === '') return null;
  if (typed.includes('.')) {
    return 'Whole points only. For a fraction, set points_possible in the frontmatter afterwards.';
  }
  if (!/^\d+$/.test(typed)) {
    return 'Points must be a whole number, 0 or more';
  }
  if (!Number.isSafeInteger(Number(typed))) {
    return 'That is more points than a number can hold';
  }
  return null;
}

/**
 * The item types `new-item` can create where it is being run, as quick-pick
 * rows in the order they are offered.
 *
 * Only one of them depends on the place. A subsection is a folder of items,
 * and the CLI will not put one inside another: `--type subsection` together
 * with `--subsection` exits 1 (cli/new-item.js). Offering the row from a
 * subheader row and refusing it afterwards asked a question with a wrong
 * answer in it, and the wrong answer is the one a reader picks precisely when
 * they do not know the rule. The row keeps its "module root only" note where
 * it is offered, so its absence lower down reads as the rule rather than as
 * something missing.
 *
 * The `type` values are what goes to `--type`, so they have to be the CLI's
 * own spellings; helpers.test.js holds them against its VALID_TYPES.
 */
function newItemTypes({ inSubsection = false } = {}) {
  return [
    { label: 'Page', type: 'page' },
    { label: 'Assignment', type: 'assignment' },
    { label: 'External URL', type: 'url' },
    ...(inSubsection
      ? []
      : [
          {
            label: 'Subsection',
            type: 'subsection',
            description: 'module root only',
          },
        ]),
    { label: 'File', type: 'file' },
  ];
}

/**
 * Where `export-toc` writes the curated table of contents, or null when no
 * folder is open to write it in.
 *
 * One fact, three readers that have to agree on it: the command that generates
 * the file and opens it for editing, the activation check that restores the
 * context key gating "Course: Export via TOC...", and the watcher that clears
 * that key when the file goes away. The CLI's own `--output` can put the file
 * somewhere else; the extension never asks it to, so this is the path it means.
 */
function curatedTocPath(root) {
  if (!root) return null;
  return path.join(root, 'exports', 'toc.md');
}

module.exports = {
  displayTitle,
  safeReadJSON,
  readFrontmatter,
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
  getCanvasId,
  moduleCanvasId,
  getModuleCanvasId,
  canvasModuleUrl,
  readEnvConfig,
  DEFAULT_PREVIEW_PORT,
  previewPort,
  previewTerminalEntry,
  directoryReadError,
  newItemTypes,
  validatePoints,
  curatedTocPath,
  terminalNumber,
  pickTerminal,
  shellFlavour,
  shellQuote,
  UnquotableValue,
  cliEntryPoint,
  cliChildEnv,
  createSerialQueue,
  announceIfSlow,
  createProgressGate,
};
