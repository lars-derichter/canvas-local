const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT } = require('../../cli/project-root');
const { RefusalError } = require('../errors');

const SYNC_FILE = path.join(PROJECT_ROOT, '.canvas-sync.json');
const SCHEMA_VERSION = 4;

/**
 * Schema v4: the item's path is the key and the Canvas ids are values — the
 * exact inverse of v3, which keyed every item by its Canvas identity
 * (`page:1234`, `external_url:https://…`) and kept the path as a value.
 *
 * The key is the path **under `course/`**, not from the repository root:
 * `01-introduction/01-welcome.md`, built by `path.relative(courseDir, …)` in
 * `gather.js`. Worth stating because a hand-repaired row is a documented
 * workflow, and a key written with the `course/` prefix matches nothing and
 * fails silently.
 *
 * v3 keyed on Canvas identity so that a local rename could not orphan a row:
 * the identity lived in each file's frontmatter and travelled with the file. v4
 * takes `canvas_id` out of frontmatter and commits this file to git instead,
 * which makes it the single source of truth — and a source of truth has to be
 * legible to the person who owns it. Keyed by path, an author can open the file,
 * recognise their own course in it, and repair a row by hand. Renames no longer
 * orphan anything because every command that renames calls `renamePath`.
 *
 * {
 *   "schema_version": 4,
 *   "canvas_base_url": "https://school.instructure.com",
 *   "course_id": 12345,
 *   "last_sync": "2026-08-19T10:00:00.000Z",
 *   "modules": {
 *     "01-introduction": {                          // local folder name
 *       "canvas_module_id": 67890,
 *       "name": "Introduction",
 *       "position": 1,
 *       "item_order": ["01-introduction/01-welcome.md"],
 *       "items": {
 *         "01-introduction/01-welcome.md": {        // under course/, POSIX
 *           "canvas_type": "page",
 *           "canvas_id": 1234,
 *           "page_url": "welcome",
 *           "module_item_id": 5678,
 *           "title": "Welcome",
 *           "indent": 0,
 *           "local_hash": "sha256…",
 *           "canvas_hash": "sha256…",
 *           "canvas_updated_at": "2026-08-19T09:59:00.000Z",
 *           "synced_at": "2026-08-19T10:00:00.000Z"
 *         }
 *       }
 *     }
 *   },
 *   "icons": { "note": { "canvas_file_id": 1, "preview_url": "…", "theme": "…" } },
 *   "files": {
 *     "01-introduction/_files/diagram.png": {
 *       "canvas_file_id": 222, "canvas_url": "…", "sha256": "9f2c…"
 *     }
 *   }
 * }
 *
 * `icons` and `files` are unchanged from v3 — same keys, same fields, written by
 * `lib/canvas/icons.js` and by push's embedded-file upload respectively.
 *
 * Two invariants the helpers below maintain, and callers may rely on:
 *
 * - An item path uses forward slashes on every platform, and always begins with
 *   the folder name of the module that holds it. A state written on Windows has
 *   to read the same everywhere, now that it is committed.
 * - `item_order` is the order the module's items were in at the last sync. It is
 *   the base leg of the three-way ordering comparison, so it has to survive a
 *   rename faithfully: a renamed item keeps its slot rather than moving to the
 *   end, which would read as "the author reordered this module".
 *
 * The fingerprint fields (`local_hash`, `canvas_hash`, `canvas_updated_at`,
 * `synced_at`) are written by the sync engine, and so are `title` and `indent`
 * beside them. Those two are baselines rather than fingerprints: neither is
 * inside `local_hash`, so the row is the only record of where they stood at the
 * last sync, and `hasTitleChanged` and `hasIndentChanged` in `plan.js` have
 * nothing else to compare against. An item pointing at a URL carries the
 * `external_url` Canvas echoed back beside them. This module never computes any
 * of them; it only carries them through a rename or a move untouched.
 */

/**
 * A path under `course/` in the one shape this file stores it: forward slashes,
 * whatever the platform handed us. Callers that build a key with `path.relative`
 * should run it through here first.
 */
function toPosixPath(itemPath) {
  return String(itemPath).replace(/\\/g, '/');
}

/**
 * The module folder an item path belongs to: everything before the first slash.
 * Returns '' for a path with no folder segment, which no valid item key has.
 */
function moduleFolderOf(itemPath) {
  const posix = toPosixPath(itemPath);
  const slash = posix.indexOf('/');
  return slash === -1 ? '' : posix.slice(0, slash);
}

/**
 * Rename one key of a plain object without moving it to the end.
 *
 * JSON keeps insertion order, and this file is committed, so a rename that
 * re-keys in place produces a one-line diff instead of a block that vanishes
 * from one spot and reappears at the bottom.
 */
function rekey(map, from, to) {
  const rebuilt = {};
  for (const [key, value] of Object.entries(map || {})) {
    rebuilt[key === from ? to : key] = value;
  }
  return rebuilt;
}

/**
 * A Canvas base URL as both `.env` and the sync file should hold it: no trailing
 * slash, no `/api/v1` suffix. `init` writes it in this shape and the HTTP client
 * strips trailing slashes, so the two can differ by punctuation alone.
 */
function normaliseBaseUrl(url) {
  if (!url) return '';
  return String(url)
    .replace(/\/+$/, '')
    .replace(/\/api\/v1$/, '')
    .replace(/\/+$/, '');
}

/**
 * A fresh, empty v4 state, taking its identity from the environment so that it
 * agrees with it by construction.
 *
 * @param {object} [env] - Injection point for tests.
 * @returns {object} A state with all four containers present.
 */
function emptyState(env = process.env) {
  return {
    schema_version: SCHEMA_VERSION,
    canvas_base_url: normaliseBaseUrl(env.CANVAS_API_URL),
    course_id: Number(env.CANVAS_COURSE_ID) || 0,
    last_sync: null,
    modules: {},
    icons: {},
    files: {},
  };
}

/**
 * Refuse a sync state that describes a different Canvas course than `.env`
 * names, stamping the environment's identity on one that claims none.
 *
 * The ids in this file are only meaningful against the course they came from,
 * and one of them is not even scoped to a course: Canvas file ids are global, so
 * `DELETE /api/v1/files/:id` reaches a file in whichever course owns it. A sync
 * state left over from another course therefore lets `push --prune-canvas` — or
 * a renamed binary behind a file item, which deletes the Canvas file it
 * replaces — reach into a course this run was never pointed at. Every other
 * delete is scoped to `/courses/:id/`, so it would 404 and push would recreate
 * the content instead, duplicating the whole course rather than damaging
 * another one. Neither is something to do quietly. Now that the file is
 * committed the mismatch has a second way in besides a re-`init`: a clone, or a
 * branch, can arrive already pointing at someone else's course.
 *
 * A file that claims nothing is not a mismatch. Sync state written while
 * `CANVAS_COURSE_ID` was unset holds `course_id: 0`, and nothing later filled it
 * in, so the claim is taken from the environment here instead: the value is
 * written back the next time the caller saves, and from then on the file is
 * protected like any other. An environment that names nothing cannot contradict
 * anything either — the commands that need a course id have their own error for
 * that, and `export` needs neither.
 *
 * @param {object} state - Loaded sync state; annotated in place.
 * @param {object} [env] - Injection point for tests.
 * @throws {RefusalError} When the file and the environment name different courses.
 */
function assertStateMatchesEnv(state, env = process.env) {
  if (!state) return state;

  const envCourse = env.CANVAS_COURSE_ID ? String(env.CANVAS_COURSE_ID) : '';
  const envUrl = normaliseBaseUrl(env.CANVAS_API_URL);
  const fileCourse =
    state.course_id != null && Number(state.course_id) !== 0
      ? String(state.course_id)
      : '';
  const fileUrl = normaliseBaseUrl(state.canvas_base_url);

  const differences = [];
  if (envCourse && fileCourse && envCourse !== fileCourse) {
    differences.push(
      `course ${fileCourse} (\`.env\` names course ${envCourse})`,
    );
  }
  if (envUrl && fileUrl && envUrl !== fileUrl) {
    differences.push(`${fileUrl} (\`.env\` names ${envUrl})`);
  }

  if (differences.length > 0) {
    // A refusal, not a crash: three paragraphs of what happened and which of
    // the two ways out applies, which a stack trace would bury. See
    // `lib/errors.js`.
    throw new RefusalError(
      `${SYNC_FILE} describes ${differences.join(', and ')}.\n` +
        'The Canvas ids in that file mean nothing in another course, and one ' +
        'kind of id is not scoped to a course at all: a file id is global, so ' +
        'a prune, or a renamed binary behind a file item, would delete a ' +
        'file belonging to the course the sync state came from.\n' +
        'Either point `.env` back at the course this project has been pushing ' +
        'to, or, if you meant to switch, run `npx course reset-sync-state` ' +
        'first — after which push creates everything fresh on the new course, ' +
        'so make sure that course does not already hold a copy.',
    );
  }

  // Adopt what the file does not claim, so the next save records it.
  if (!fileCourse && envCourse) state.course_id = Number(envCourse);
  if (!fileUrl && envUrl) state.canvas_base_url = envUrl;

  return state;
}

/**
 * Refuse a sync state file that is on disk but says nothing this version can
 * read, rather than letting it pass for a course that was never synced.
 *
 * That fallthrough was the worst of both. The file is committed and every push
 * changes it, so the usual way in is a merge left half-finished — a file one
 * `git checkout` away from whole. Read as an empty state, it sent push off to
 * adopt by title and to create a second copy of everything whose title had
 * moved since: damage on Canvas, out of a repair nobody was told to make. So
 * the message names the file, names what is wrong with it, and says which
 * markers were found, rather than leaving the author to open the JSON and
 * guess.
 *
 * @param {string} file  - The state file, named in the message.
 * @param {string} raw   - Its bytes, checked for conflict markers.
 * @param {string} fault - What is wrong with it, as a clause after 'but'.
 * @throws {RefusalError} Always.
 */
function refuseUnreadableState(file, raw, fault) {
  const conflicted = /^<{7}/m.test(String(raw));
  throw new RefusalError(
    `${file} exists, but ${fault}.` +
      (conflicted
        ? ' It still holds git conflict markers (`<<<<<<<`): a merge was left ' +
          'half-finished, which is how this usually happens.'
        : ' Nothing in it looks like the conflict markers of an unfinished ' +
          'merge, which is the usual cause.') +
      '\n' +
      'That file is the only record of which Canvas object each of your files ' +
      'is. Taken for a course that had never been synced, it would have the ' +
      'next push claim items back by title and create a second copy of ' +
      'anything whose title has moved since.\n' +
      'If a merge is what left it like this, finish the merge and save the ' +
      'result. Otherwise take the last committed copy back with `git checkout ' +
      '-- .canvas-sync.json` from the project root. Delete the file only if ' +
      'you mean to start over: the next push rebuilds it, claiming back ' +
      'whatever it can still match by title.',
  );
}

/**
 * Load the sync state. Returns the parsed object, or a fresh empty state when
 * the file is missing. Pass `{ allowNull: true }` to get null instead of that
 * default, which is how a command tells a first run from a synced course.
 *
 * Missing is the only absence there is. A file that is on disk and unreadable is
 * refused instead — see `refuseUnreadableState` — and so is one written by
 * another schema, rather than guessed at: there is deliberately no migration
 * from v3, since the two schemas key items differently and a wrong guess would
 * push duplicates to Canvas. `reset-sync-state` followed by a push is the
 * upgrade path. A state describing a different Canvas course is refused as well
 * — see `assertStateMatchesEnv` — except under
 * `{ skipEnvCheck: true }`. Two callers pass it, for opposite reasons: `init`
 * because it is the command that repairs exactly that mismatch, and `export`
 * because that refusal guards writes to Canvas and export makes none — it reads
 * the ids only to build a link map, so which course `.env` names is no business
 * of its own.
 *
 * @param {object}  [options]
 * @param {boolean} [options.allowNull]    - Return null rather than an empty state.
 * @param {boolean} [options.skipEnvCheck] - Skip the course-identity refusal.
 * @param {string}  [options.file]         - Injection point for tests.
 * @param {object}  [options.env]          - Injection point for tests.
 * @returns {object|null}
 */
function loadState(options = {}) {
  const {
    allowNull = false,
    skipEnvCheck = false,
    file = SYNC_FILE,
    env = process.env,
  } = options;

  if (fs.existsSync(file)) {
    // Read outside the try on purpose: a file this process cannot open at all
    // is an environment fault with a stack worth keeping, not a decision this
    // tool made about the sync state's contents.
    const raw = fs.readFileSync(file, 'utf8');
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      refuseUnreadableState(file, raw, 'it could not be parsed as JSON');
    }
    // A 0-byte file never gets this far: nothing is not JSON either, so the
    // parse above throws on it. `null` and the other falsy literals do parse,
    // and say the same thing — the file is there and states nothing — so they
    // stop in the same place rather than at the containers below.
    if (!data || typeof data !== 'object') {
      refuseUnreadableState(file, raw, 'it holds no sync state');
    }
    if (data.schema_version !== SCHEMA_VERSION) {
      // The next deliberate stop in this file, and the same kind: the author is
      // told which schema they have and the one command that upgrades it.
      throw new RefusalError(
        `${file} has schema_version ${JSON.stringify(data.schema_version)}, ` +
          `but this version only reads ${SCHEMA_VERSION}. ` +
          'Run `npx course reset-sync-state` and push again to rebuild it.',
      );
    }
    // The file is committed and hand-editable, so a container someone trimmed
    // comes back present rather than as an undefined every caller must guard.
    if (!data.modules) data.modules = {};
    if (!data.icons) data.icons = {};
    if (!data.files) data.files = {};
    if (skipEnvCheck) return data;
    return assertStateMatchesEnv(data, env);
  }

  if (allowNull) return null;

  return emptyState(env);
}

/**
 * Write the sync state atomically (write to .tmp, then rename), so an
 * interrupted run leaves the previous state intact rather than half a file.
 *
 * @param {object} state
 * @param {string} [file] - Injection point for tests.
 */
function saveState(state, file = SYNC_FILE) {
  const tmpFile = file + '.tmp';
  fs.writeFileSync(tmpFile, JSON.stringify(state, null, 2) + '\n', 'utf8');
  fs.renameSync(tmpFile, file);
}

/**
 * Get or create the module entry for a local folder, shallow-merging `fields`
 * (`canvas_module_id`, `name`, `position`) over what is already there.
 *
 * Keys whose value is `undefined` are skipped, so a caller assembling `fields`
 * from a partial Canvas response cannot blank out a name it simply did not ask
 * for. `items` and `item_order` are always present afterwards.
 *
 * @param {object} state
 * @param {string} folder - Local module folder name, e.g. '01-introduction'.
 * @param {object} [fields]
 * @returns {object} The module entry.
 */
function ensureModule(state, folder, fields = {}) {
  if (!state.modules) state.modules = {};

  let entry = state.modules[folder];
  if (!entry) {
    // Seeded in reading order: what the module is, then its order, then the bulk.
    entry = {};
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) entry[key] = value;
    }
    entry.item_order = [];
    entry.items = {};
    state.modules[folder] = entry;
    return entry;
  }

  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) entry[key] = value;
  }
  if (!Array.isArray(entry.item_order)) entry.item_order = [];
  if (!entry.items) entry.items = {};
  return entry;
}

/**
 * The module entry for a local folder, or null.
 */
function getModule(state, folder) {
  const entry = state.modules && state.modules[folder];
  return entry || null;
}

/**
 * Remove a module and everything it holds.
 *
 * Deliberately asymmetric with `renameFolder`: the rows in `state.files` for
 * binaries that lived in this folder are left alone. Removal is not relocation
 * — the Canvas files behind those rows are still live, and dropping the rows
 * silently would strand them, unreachable to any later prune.
 *
 * **Call this only where the Canvas module is already gone or goes in the same
 * action**: `drop-base-module`, `delete-canvas-module` and
 * `delete-local-module` in `lib/sync/apply.js`. The module row is what tells a
 * later run "the author deleted this" from "this tool has never seen it" —
 * drop it while the Canvas module is still there and `planModuleMetadata`
 * emits `create-local-module`, writing the folder back to disk, while
 * `planModuleOrphan` returns before it can offer the module to
 * `--prune-canvas`. `cli/delete-module.js` used to call this unconditionally
 * and clear the matching `state.files` rows on the way past, and did exactly
 * that damage on every run.
 *
 * There is one caller that breaks the rule knowingly: `dropRowsRenumberedOver`
 * in `cli/sync-renames.js`, for the single case where the renumber that follows
 * a deletion is about to move another module onto this one's folder name. Two
 * modules cannot share a key, so one of the two Canvas identities has to go
 * unrecorded, and stranding the deleted module's is the lesser harm — the
 * alternative hands the surviving folder the dead module's ids. It is the only
 * place in this repository that strands a Canvas object on purpose, and the
 * only one that prints what it stranded.
 *
 * @returns {object|null} The removed entry, or null when the folder had none.
 */
function deleteModule(state, folder) {
  const entry = state.modules && state.modules[folder];
  if (!entry) return null;
  delete state.modules[folder];
  return entry;
}

/**
 * Rename a module folder, rewriting the paths of every item inside it.
 *
 * The module's own key changes and so does the leading segment of each item
 * path, because an item path always starts with the folder that holds it. Both
 * `item_order` and the `items` map keep their existing order, so the rename does
 * not read as a reorder in the next three-way comparison.
 *
 * Merging two modules is refused rather than done silently: the destination's
 * Canvas ids would survive and the source's would be lost, leaving live Canvas
 * objects that nothing in this file points at any more.
 *
 * `state.files` is keyed by the same kind of path too, and its rows for embedded
 * binaries under this folder are re-keyed along with everything else. Nothing
 * moved on Canvas — only the local address of those files changed — so a row
 * left behind would name an address that no longer exists, and the next push
 * would upload the binary again under its new path and leave a live Canvas file
 * that nothing reconciles or prunes.
 *
 * @returns {boolean} True when something moved; false when `from` is unknown.
 * @throws {Error} When `to` already names a module.
 */
function renameFolder(state, from, to) {
  if (!state.modules) state.modules = {};
  if (from === to) return false;

  const entry = state.modules[from];
  if (!entry) return false;

  if (state.modules[to]) {
    throw new Error(
      `Cannot rename module folder ${from} to ${to}: the sync state already ` +
        'holds a module there. Merging the two would drop one set of Canvas ' +
        'ids and leave the objects behind them unreachable.',
    );
  }

  const rewrite = (itemPath) => {
    const posix = toPosixPath(itemPath);
    return posix.startsWith(`${from}/`)
      ? `${to}/${posix.slice(from.length + 1)}`
      : posix;
  };

  if (entry.items) {
    const items = {};
    for (const [itemPath, row] of Object.entries(entry.items)) {
      items[rewrite(itemPath)] = row;
    }
    entry.items = items;
  }
  if (Array.isArray(entry.item_order)) {
    entry.item_order = entry.item_order.map(rewrite);
  }

  if (state.files) {
    const files = {};
    for (const [filePath, row] of Object.entries(state.files)) {
      files[rewrite(filePath)] = row;
    }
    state.files = files;
  }

  state.modules = rekey(state.modules, from, to);
  return true;
}

/**
 * Find the row for an item path in whichever module holds it.
 *
 * Callers rarely know the module: they have a path from the working tree, or
 * from a Canvas item they just matched, and the module is what they are trying
 * to learn.
 *
 * @returns {{folder: string, entry: object}|null}
 */
function getItem(state, itemPath) {
  const wanted = toPosixPath(itemPath);
  for (const [folder, entry] of Object.entries(state.modules || {})) {
    if (entry && entry.items && entry.items[wanted]) {
      return { folder, entry: entry.items[wanted] };
    }
  }
  return null;
}

/**
 * Write the row for an item path into a module, and make sure it lives in
 * exactly one.
 *
 * A path is unique across the whole state, so writing it here removes any row
 * the same path had in another module — the v4 equivalent of v3's
 * `removeItemFromOtherModules`, and what makes "the author moved this item to
 * another module" a single call. The path joins the module's `item_order` when
 * it is not in it yet; an item already ordered keeps its slot.
 *
 * The module has to exist. Creating one here would give it no
 * `canvas_module_id`, and a module row that names no Canvas module is a row the
 * next push cannot reconcile.
 *
 * @returns {object} The stored entry.
 * @throws {Error} When `folder` names no module.
 */
function setItem(state, folder, itemPath, entry) {
  const target = state.modules && state.modules[folder];
  if (!target) {
    throw new Error(
      `Cannot record ${toPosixPath(itemPath)}: the sync state has no module ` +
        `${folder}. Call ensureModule first, with the Canvas module id.`,
    );
  }

  const key = toPosixPath(itemPath);
  for (const [otherFolder, other] of Object.entries(state.modules)) {
    if (otherFolder === folder) continue;
    if (other && other.items && other.items[key]) {
      delete other.items[key];
      if (Array.isArray(other.item_order)) {
        other.item_order = other.item_order.filter((p) => p !== key);
      }
    }
  }

  if (!target.items) target.items = {};
  if (!Array.isArray(target.item_order)) target.item_order = [];
  target.items[key] = entry;
  if (!target.item_order.includes(key)) target.item_order.push(key);
  return entry;
}

/**
 * Remove an item row, and its slot in the base order, from whichever module
 * holds it.
 *
 * @returns {object|null} The removed entry, or null when no module held it.
 */
function deleteItem(state, itemPath) {
  const key = toPosixPath(itemPath);
  for (const entry of Object.values(state.modules || {})) {
    if (entry && entry.items && entry.items[key]) {
      const removed = entry.items[key];
      delete entry.items[key];
      if (Array.isArray(entry.item_order)) {
        entry.item_order = entry.item_order.filter((p) => p !== key);
      }
      return removed;
    }
  }
  return null;
}

/**
 * Move an item's row from one path to another, keeping its Canvas ids and its
 * place in the base order.
 *
 * Every command that renames a file calls this — `renumber`, `move-item`,
 * `rename-item`, `movetomodule-item`, `move-module`, `rename-module` — so that
 * the common case never reaches the hash-based rename detection at all. Within a
 * module the row is re-keyed and `item_order` is edited in place at the same
 * index, because the base order has to describe the same sequence it did before
 * the rename. Across modules the row leaves the source order and joins the end
 * of the destination's, which is where an item arriving in a module goes.
 *
 * A path that was never synced is not an error: the tool renames untracked files
 * all the time, and there is simply nothing to move. Renaming onto a path the
 * state already knows is an error, though — the row underneath would be
 * overwritten, one item would inherit another's Canvas ids, and the next push
 * would duplicate content rather than update it.
 *
 * This helper only ever moves a single item. Directories are `renameFolder`'s
 * job, deliberately kept separate: guessing which of the two a caller meant is
 * how a folder rename ends up half-applied.
 *
 * @returns {boolean} True when a row moved; false when `from` is unknown.
 * @throws {Error} When `to` is already taken, or its module does not exist.
 */
function renamePath(state, from, to) {
  const fromPath = toPosixPath(from);
  const toPath = toPosixPath(to);
  if (fromPath === toPath) return false;

  const found = getItem(state, fromPath);
  if (!found) return false;

  if (getItem(state, toPath)) {
    throw new Error(
      `Cannot rename ${fromPath} to ${toPath}: the sync state already holds a ` +
        'row for that path. Overwriting it would hand one item the Canvas ids ' +
        'of another, and the next push would duplicate content instead of ' +
        'updating it.',
    );
  }

  const source = state.modules[found.folder];

  if (moduleFolderOf(fromPath) === moduleFolderOf(toPath)) {
    source.items = rekey(source.items, fromPath, toPath);
    if (Array.isArray(source.item_order)) {
      // In place, at the same index: a rename is not a reorder. A row that had
      // no slot in the base order does not gain one here.
      const index = source.item_order.indexOf(fromPath);
      if (index !== -1) source.item_order[index] = toPath;
    }
    return true;
  }

  const destFolder = moduleFolderOf(toPath);
  const destination = state.modules[destFolder];
  if (!destination) {
    throw new Error(
      `Cannot move ${fromPath} to ${toPath}: the sync state has no module ` +
        `${destFolder}. Create it with ensureModule and its Canvas module id ` +
        'first, so the moved item lands in a module push can reconcile.',
    );
  }

  delete source.items[fromPath];
  if (Array.isArray(source.item_order)) {
    source.item_order = source.item_order.filter((p) => p !== fromPath);
  }

  if (!destination.items) destination.items = {};
  if (!Array.isArray(destination.item_order)) destination.item_order = [];
  destination.items[toPath] = found.entry;
  if (!destination.item_order.includes(toPath)) {
    destination.item_order.push(toPath);
  }
  return true;
}

/**
 * The key a row is parked under while a batch of renames is half applied.
 *
 * Underscore-prefixed because no synced path is: files and folders starting
 * with `_` are internal and never reach Canvas, so this can never collide with
 * a real one.
 */
const RENAME_TEMP_KEY = '__ccb_rename_';

/**
 * Carry a batch of local renames into the state: the item row at each path, and
 * everything under a path that is a directory, `state.files` rows included.
 *
 * The renaming commands hand this the list they have just applied to disk.
 * Applying them one at a time would not do — `renumber` routinely shifts
 * several files into each other's slots, and `renamePath` refuses to overwrite
 * a live row, rightly, since the destination's Canvas ids would be lost. So
 * every row goes to a temporary key inside its own module first and on to its
 * destination second: the same two passes the filesystem renames already use.
 *
 * A `from` the state never knew moves nothing and is not an error — the tool
 * renames untracked files all the time. A destination still held by a row this
 * batch did not move is a different matter: that is a rename onto a file that
 * was already there, and the row goes back where it came from rather than stay
 * parked under a temporary key in a file that is committed to git.
 *
 * Module folders are `renameFolders`' job. A module has a key of its own in
 * `state.modules`, and it has to move together with the paths inside it.
 *
 * @param {object} state
 * @param {Array<{from: string, to: string}>} moves - Repo-relative paths.
 * @returns {number} How many item rows moved.
 */
function renamePaths(state, moves) {
  const itemMoves = [];
  const fileMoves = new Map();

  for (const move of moves || []) {
    const from = toPosixPath(move.from);
    const to = toPosixPath(move.to);
    if (from === to) continue;

    const under = `${from}/`;
    const rewrite = (p) => (p === from ? to : `${to}/${p.slice(under.length)}`);

    if (getItem(state, from)) itemMoves.push({ from, to });
    for (const { itemPath } of allItems(state)) {
      if (itemPath.startsWith(under)) {
        itemMoves.push({ from: itemPath, to: rewrite(itemPath) });
      }
    }
    for (const filePath of Object.keys(state.files || {})) {
      if (filePath === from || filePath.startsWith(under)) {
        fileMoves.set(filePath, rewrite(filePath));
      }
    }
  }

  // A flat map has no half-applied state to collide with, so one pass does it.
  if (fileMoves.size > 0) {
    const files = {};
    for (const [filePath, row] of Object.entries(state.files)) {
      files[fileMoves.get(filePath) || filePath] = row;
    }
    state.files = files;
  }

  // An item dragged into a module folder that has never been pushed needs
  // somewhere to land. The module is recorded without a Canvas id; the next
  // push creates it on Canvas and fills the id in.
  for (const { to } of itemMoves) {
    const folder = moduleFolderOf(to);
    if (folder && !(state.modules && state.modules[folder])) {
      ensureModule(state, folder);
    }
  }

  const parked = [];
  itemMoves.forEach(({ from, to }, index) => {
    const temp = `${moduleFolderOf(from)}/${RENAME_TEMP_KEY}${index}`;
    if (renamePath(state, from, temp)) parked.push({ temp, from, to });
  });

  let moved = 0;
  for (const { temp, from, to } of parked) {
    try {
      renamePath(state, temp, to);
      moved++;
    } catch {
      renamePath(state, temp, from);
    }
  }
  return moved;
}

/**
 * Carry a batch of module-folder renames into the state, in the same two passes
 * and for the same reason: renumbering the modules moves each of them into the
 * slot its neighbour is still occupying.
 *
 * @param {object} state
 * @param {Array<{from: string, to: string}>} moves - Module folder names.
 * @returns {number} How many modules moved.
 */
function renameFolders(state, moves) {
  const parked = [];
  (moves || []).forEach((move, index) => {
    const from = toPosixPath(move.from);
    const to = toPosixPath(move.to);
    if (from === to) return;
    const temp = `${RENAME_TEMP_KEY}${index}`;
    if (renameFolder(state, from, temp)) parked.push({ temp, from, to });
  });

  let moved = 0;
  for (const { temp, from, to } of parked) {
    try {
      renameFolder(state, temp, to);
      moved++;
    } catch {
      renameFolder(state, temp, from);
    }
  }
  return moved;
}

/**
 * Every item row in the state, flattened.
 *
 * Order carries no meaning to a caller, but it is deterministic anyway — modules
 * in the order the file lists them, items in `item_order`, then any row the
 * order does not mention — so that a report built from this reads the same twice
 * running.
 *
 * @returns {Array<{folder: string, itemPath: string, entry: object}>}
 */
function allItems(state) {
  const rows = [];
  for (const [folder, entry] of Object.entries(state.modules || {})) {
    if (!entry || !entry.items) continue;
    const seen = new Set();
    for (const itemPath of entry.item_order || []) {
      if (entry.items[itemPath] && !seen.has(itemPath)) {
        seen.add(itemPath);
        rows.push({ folder, itemPath, entry: entry.items[itemPath] });
      }
    }
    for (const [itemPath, row] of Object.entries(entry.items)) {
      if (!seen.has(itemPath)) rows.push({ folder, itemPath, entry: row });
    }
  }
  return rows;
}

module.exports = {
  SCHEMA_VERSION,
  SYNC_FILE,
  allItems,
  assertStateMatchesEnv,
  deleteItem,
  deleteModule,
  emptyState,
  ensureModule,
  getItem,
  getModule,
  loadState,
  normaliseBaseUrl,
  renameFolder,
  renameFolders,
  renamePath,
  renamePaths,
  saveState,
  setItem,
  toPosixPath,
};
