const { toPosixPath } = require('./state');
const { CANVAS_FINGERPRINT_FIELDS } = require('./fingerprint');
const { detectRenames } = require('./rename-detect');

/**
 * The whole sync decision, as one pure function.
 *
 * Every hard question in this system is the same classification problem: given
 * what was true at the last sync, what is true in the working tree, and what is
 * true on Canvas, what should happen? Today that question is answered in
 * fragments scattered through `cli/push.js` and `cli/pull.js`, tangled with the
 * HTTP calls that fetched the answer — which is why push simply overwrites
 * Canvas and pull gates on file mtime. Neither is testable, so neither was ever
 * tested, so neither is right.
 *
 * Here the decision is one function of three plain-data inputs. No `fs`, no
 * `fetch`, no clock, no randomness: the caller gathers hashes, mtimes,
 * fingerprints and a per-file "does git hold uncommitted changes for this",
 * hands them in, and gets back a description of what should happen. It never
 * decides *how* — that is `lib/sync/apply.js` — and it never asks the author
 * anything.
 *
 * ## How `'ask'` stays pure
 *
 * The planner never prompts. When `policy.conflict === 'ask'` and an item
 * genuinely conflicts, the item lands in `pending.conflicts` and produces no
 * action. The command prompts the author and then **calls `plan()` again** with
 * the same three inputs and `policy.resolved.conflicts = { '01-intro/01-a.md':
 * 'local' }`. Same for ordering, keyed by module folder, and for a probable
 * rename, keyed by the path it came from.
 *
 * Re-planning is free — nothing has been fetched again — and it is what keeps
 * the whole thing a pure function of its inputs rather than a coroutine that
 * blocks on a terminal. It also means the second pass sees the *same* course it
 * decided about, so an answer cannot be applied to a state that has moved on.
 * A `resolved` answer wins over the policy for that item, whatever the policy
 * is.
 *
 * ## What comes back
 *
 * `actions` in execution order, plus one section per row of the report the
 * plan calls for, so the reporter at commit 7 is a renderer over this object
 * and nothing more. Every section is present and possibly empty.
 *
 * `status` is not a separate code path: it is `plan()` with
 * `write: {canvas: false, local: false}`, which leaves `actions` empty and
 * every report section fully populated. What the policy forbids is never
 * emitted as an action but is always recorded in `withheld`, so a push can say
 * "Canvas changed here and I left it alone" instead of losing the fact.
 */

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/**
 * Which side each action writes to, which is the only thing `policy.write`
 * needs to know to suppress it.
 *
 * `'base'` is the sync state itself: a re-key or a dropped row changes no
 * content on either side, so it is allowed whenever the run writes anything at
 * all, and suppressed under `status`, which writes nothing.
 */
const ACTION_SIDES = {
  'create-canvas-module': 'canvas',
  'update-canvas-module': 'canvas',
  'delete-canvas-module': 'canvas',
  'create-canvas-item': 'canvas',
  'update-canvas-item': 'canvas',
  'move-canvas-item': 'canvas',
  'delete-canvas-item': 'canvas',
  'reorder-canvas-module': 'canvas',
  'create-local-module': 'local',
  'update-local-module': 'local',
  'delete-local-module': 'local',
  'create-local-item': 'local',
  'update-local-item': 'local',
  'delete-local-item': 'local',
  'reorder-local-module': 'local',
  'rekey-base': 'base',
  'link-base-module': 'base',
  'drop-base-row': 'base',
  'drop-base-module': 'base',
};

/**
 * The execution order, as ranks. Actions are sorted by rank and nothing else,
 * and the sort is stable, so within a rank they run in the order the planner
 * found them — modules in local order, items in module order.
 *
 * The rule, and it is the reason the list is ordered at all:
 *
 * - **Re-keys first.** The state has to name the paths the rest of the run
 *   talks about before the run starts.
 * - **A module's link with the modules.** Everything below it addresses Canvas
 *   by a module id, and a link is where a module the run adopted gets one.
 * - **Creates before reorders.** A reorder that names an item Canvas does not
 *   hold yet is meaningless, and Canvas would silently drop it.
 * - **Modules before the items inside them.** An item cannot be created in a
 *   module that does not exist.
 * - **Deletes last, items before modules.** A failed delete then cannot strand
 *   a create that was going to replace it, and deleting a module first would
 *   make every item delete inside it fail with a 404.
 */
const ACTION_RANK = {
  'rekey-base': 0,
  'create-canvas-module': 1,
  'create-local-module': 1,
  'link-base-module': 1,
  'update-canvas-module': 2,
  'update-local-module': 2,
  'create-canvas-item': 3,
  'create-local-item': 3,
  'update-canvas-item': 4,
  'update-local-item': 4,
  'move-canvas-item': 5,
  'reorder-canvas-module': 6,
  'reorder-local-module': 6,
  'delete-canvas-item': 7,
  'delete-local-item': 7,
  'delete-canvas-module': 8,
  'delete-local-module': 8,
  'drop-base-row': 9,
  'drop-base-module': 9,
};

/**
 * The types with no object behind them: the module item *is* the thing, so its
 * identity is the module item id rather than a content id.
 *
 * Three of them point at something sync does not own — a quiz, a tool, a URL —
 * and sync never creates, updates or deletes the thing pointed at, only the
 * item that points there. `sub_header` is the odd one out: it points at nothing
 * at all. A text header is a title and an indent sitting in a module list, and
 * this project creates one for every subfolder inside a module folder. It
 * belongs here anyway, and for the same reason: Canvas gives it no
 * `content_id`, so `module_item_id` is the only thing a base row can find it by.
 */
const REFERENCE_TYPES = new Set([
  'quiz',
  'sub_header',
  'external_url',
  'external_tool',
]);

const CONFLICT_POLICIES = new Set(['newest', 'local', 'canvas', 'ask']);
const ORDER_POLICIES = new Set(['local', 'canvas', 'ask', 'skip']);
const ADOPT_POLICIES = new Set(['local', 'canvas']);
const RESOLUTIONS = new Set(['local', 'canvas', 'skip']);

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

/** The module folder an item path belongs to: everything before the first slash. */
function folderOf(itemPath) {
  const slash = itemPath.indexOf('/');
  return slash === -1 ? '' : itemPath.slice(0, slash);
}

/** A module name as a pairing compares it: trimmed and case-folded. */
function comparableName(name) {
  return name == null ? '' : String(name).trim().toLowerCase();
}

/** Two path sequences, equal element for element. */
function sameSequence(left, right) {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

// ---------------------------------------------------------------------------
// Input normalisation
// ---------------------------------------------------------------------------

/**
 * The policy, with every default filled in and every unknown value refused.
 *
 * A misspelled policy has to be an error rather than a fallback: `--conflict
 * newst` silently becoming "skip everything" would look like a clean run that
 * reconciled nothing.
 *
 * `adopt` is a flag of its own rather than something read off `write`, and that
 * is deliberate. It looks derivable — adoption is safe exactly when one side is
 * pinned, which is what `push` and `pull` set `write` to — but `status`
 * previews `sync` with both write flags off, so `write.canvas && write.local`
 * would read as "pinned" there and quietly take the collision refusal out of
 * the one command whose whole job is to show it.
 *
 * `order` defaults to `'skip'` rather than `'ask'`, because asking has to be
 * opt-in. `'ask'` parks a contested order in `pending.order` for the caller to
 * put to the author, and a caller that never collects it leaves the author
 * reading "awaiting an answer" about a question nothing will ever pose. Only
 * `sync` asks, and it says so; `push`, `pull` and `status` take the default and
 * report the module as left alone.
 */
function normalisePolicy(policy = {}) {
  const write = policy.write || {};
  const resolved = policy.resolved || {};
  const conflict = policy.conflict || 'newest';
  const order = policy.order || 'skip';
  const adopt = policy.adopt ?? null;

  if (!CONFLICT_POLICIES.has(conflict)) {
    throw new Error(
      `Unknown conflict policy ${JSON.stringify(conflict)}; ` +
        `expected one of ${[...CONFLICT_POLICIES].join(', ')}.`,
    );
  }
  if (!ORDER_POLICIES.has(order)) {
    throw new Error(
      `Unknown order policy ${JSON.stringify(order)}; ` +
        `expected one of ${[...ORDER_POLICIES].join(', ')}.`,
    );
  }
  if (adopt !== null && !ADOPT_POLICIES.has(adopt)) {
    throw new Error(
      `Unknown adopt policy ${JSON.stringify(adopt)}; ` +
        `expected one of ${[...ADOPT_POLICIES].join(', ')}, or null to ` +
        'adopt nothing.',
    );
  }
  for (const [key, answer] of Object.entries(resolved.conflicts || {})) {
    if (!RESOLUTIONS.has(answer)) {
      throw new Error(
        `Unknown conflict answer ${JSON.stringify(answer)} for ${key}; ` +
          `expected one of ${[...RESOLUTIONS].join(', ')}.`,
      );
    }
  }
  for (const [key, answer] of Object.entries(resolved.order || {})) {
    if (!RESOLUTIONS.has(answer)) {
      throw new Error(
        `Unknown order answer ${JSON.stringify(answer)} for ${key}; ` +
          `expected one of ${[...RESOLUTIONS].join(', ')}.`,
      );
    }
  }

  return {
    write: { canvas: write.canvas !== false, local: write.local !== false },
    conflict,
    order,
    adopt,
    pruneCanvas: policy.pruneCanvas === true,
    pruneLocal: policy.pruneLocal === true,
    modules:
      Array.isArray(policy.modules) && policy.modules.length > 0
        ? new Set(policy.modules)
        : null,
    resolved: {
      conflicts: resolved.conflicts || {},
      order: resolved.order || {},
      renames: resolved.renames || {},
    },
  };
}

/** The base state, flattened into the two shapes the planner reads it in. */
function normaliseBase(base) {
  const modules = new Map();
  const rows = new Map();

  for (const [folder, entry] of Object.entries((base && base.modules) || {})) {
    if (!entry) continue;
    const order = (entry.item_order || []).map(toPosixPath);
    modules.set(folder, {
      folder,
      canvasModuleId: entry.canvas_module_id ?? null,
      name: entry.name ?? null,
      position: entry.position ?? null,
      order,
    });
    const items = entry.items || {};
    const seen = new Set();
    const push = (itemPath) => {
      const key = toPosixPath(itemPath);
      if (seen.has(key)) return;
      seen.add(key);
      rows.set(key, { itemPath: key, baseFolder: folder, row: items[key] });
    };
    // Ordered rows first, then any row the base order forgot, so the planner
    // reads a hand-edited state in a defined order too.
    for (const itemPath of order) {
      if (items[itemPath]) push(itemPath);
    }
    for (const itemPath of Object.keys(items)) push(itemPath);
  }

  return { modules, rows };
}

/** One item as the working tree holds it, with every field defaulted. */
function normaliseLocalItem(item, folder) {
  return {
    itemPath: toPosixPath(item.itemPath),
    folder,
    title: item.title ?? null,
    canvasType: item.canvasType ?? null,
    indent: item.indent ?? 0,
    position: item.position ?? 0,
    localHash: item.localHash ?? null,
    localMtimeMs: item.localMtimeMs ?? null,
    dirty: item.dirty === true,
  };
}

function normaliseLocal(local) {
  return ((local && local.modules) || []).map((module) => {
    const folder = module.folder;
    const items = (module.items || [])
      .map((item) => normaliseLocalItem(item, folder))
      .sort((a, b) => a.position - b.position);
    return {
      folder,
      name: module.name ?? null,
      position: module.position ?? 0,
      dirty: module.dirty === true,
      items,
      byPath: new Map(items.map((item) => [item.itemPath, item])),
    };
  });
}

/**
 * One Canvas module item, normalised into the planner's own record so that
 * nothing here ever mutates the caller's data.
 *
 * `recognised` defaults to "is this a type `lib/sync/fingerprint.js` knows",
 * rather than to `true`. A caller that forgets the flag then gets the cautious
 * answer instead of one that fabricates a local file for a module item type
 * this version has never heard of.
 *
 * A text header (`sub_header`) is a recognised type like any other, and arrives
 * with a path like any other: its `suggestedPath` and the `itemPath` of its
 * base row are the subfolder that produced it, `01-introduction/theory`. The
 * planner needs nothing else about it — the caller owns that mapping.
 */
function normaliseCanvasItem(item, module) {
  const canvasType = item.canvasType ?? null;
  const recognised =
    item.recognised === undefined
      ? canvasType != null &&
        Object.hasOwn(CANVAS_FINGERPRINT_FIELDS, canvasType)
      : item.recognised === true;

  return {
    moduleItemId: item.moduleItemId ?? null,
    canvasType,
    rawType: item.rawType ?? null,
    canvasId: item.canvasId ?? null,
    pageUrl: item.pageUrl ?? null,
    title: item.title ?? null,
    indent: item.indent ?? 0,
    position: item.position ?? 0,
    canvasHash: item.canvasHash ?? null,
    canvasUpdatedAt: item.canvasUpdatedAt ?? null,
    suggestedPath: item.suggestedPath ? toPosixPath(item.suggestedPath) : null,
    recognised,
    canvasModuleId: module.canvasModuleId ?? null,
  };
}

function normaliseCanvas(canvas) {
  return ((canvas && canvas.modules) || []).map((module) => {
    const record = {
      canvasModuleId: module.canvasModuleId ?? null,
      name: module.name ?? null,
      position: module.position ?? 0,
      suggestedFolder: module.suggestedFolder ?? null,
      items: [],
    };
    record.items = (module.items || [])
      .map((item) => normaliseCanvasItem(item, record))
      .sort((a, b) => a.position - b.position);
    return record;
  });
}

// ---------------------------------------------------------------------------
// Matching base rows to Canvas items
// ---------------------------------------------------------------------------

/**
 * The identities one Canvas item answers to.
 *
 * A content item is found by its own id; a reference has no object behind it,
 * so the module item id is its whole identity. A page also answers to its URL,
 * because that is the one content id a Canvas author can change from the web
 * interface, and losing the row over it would duplicate the page.
 */
function canvasItemKeys(item) {
  const keys = [];
  if (item.moduleItemId != null) keys.push(`item:${item.moduleItemId}`);
  if (item.canvasId != null && item.canvasType) {
    keys.push(`${item.canvasType}:${item.canvasId}`);
  }
  if (item.canvasType === 'page' && item.pageUrl) {
    keys.push(`page-url:${item.pageUrl}`);
  }
  return keys;
}

/** The identities a base row looks its Canvas item up by, best first. */
function baseRowKeys(row) {
  const keys = [];
  const type = row.canvas_type;
  if (REFERENCE_TYPES.has(type)) {
    if (row.module_item_id != null) keys.push(`item:${row.module_item_id}`);
    if (row.canvas_id != null && type) keys.push(`${type}:${row.canvas_id}`);
    return keys;
  }
  if (row.canvas_id != null && type) keys.push(`${type}:${row.canvas_id}`);
  if (type === 'page' && row.page_url) keys.push(`page-url:${row.page_url}`);
  if (row.module_item_id != null) keys.push(`item:${row.module_item_id}`);
  return keys;
}

/**
 * Match every base row to the Canvas item it names, across the whole course
 * rather than within its module.
 *
 * Course-wide on purpose: an item dragged into another module in Canvas is
 * still the same object, and matching per module would read it as deleted here
 * and created there — which under `--prune-canvas` deletes the author's work
 * and creates a duplicate of it in one run.
 */
function matchBaseToCanvas(baseRows, canvasItems) {
  const byKey = new Map();
  for (const item of canvasItems) {
    for (const key of canvasItemKeys(item)) {
      if (!byKey.has(key)) byKey.set(key, item);
    }
  }

  const canvasOf = new Map();
  const basePathOf = new Map();
  const claimed = new Set();

  for (const entry of baseRows.values()) {
    if (!entry.row) continue;
    for (const key of baseRowKeys(entry.row)) {
      const candidate = byKey.get(key);
      if (!candidate || claimed.has(candidate)) continue;
      claimed.add(candidate);
      canvasOf.set(entry.itemPath, candidate);
      basePathOf.set(candidate, entry.itemPath);
      break;
    }
  }

  return { canvasOf, basePathOf, claimed };
}

// ---------------------------------------------------------------------------
// Module contexts
// ---------------------------------------------------------------------------

/**
 * Pair the modules neither side has a base row for, by name.
 *
 * Without a base row nothing links a local folder to a Canvas module, and the
 * honest default is to treat each as new. But after `reset-sync-state` against
 * a course that already holds a copy, *every* module looks new on both sides,
 * and "create both" duplicates the course. The name is the one signal left, so
 * it is used — and only when it is unambiguous on both sides, because a name
 * shared by two modules says nothing about which is which.
 *
 * A pairing is not an adoption on its own. When both sides of a paired module
 * hold items, the run refuses (see `collision`); when one side is empty, the
 * pairing is what stops a second copy of the module being created beside the
 * one that is already there.
 */
function pairUnbasedModules(unbasedLocal, unclaimedCanvas) {
  const bucket = (entries, nameOf) => {
    const map = new Map();
    for (const entry of entries) {
      const key = comparableName(nameOf(entry));
      if (key === '') continue;
      const list = map.get(key);
      if (list) list.push(entry);
      else map.set(key, [entry]);
    }
    return map;
  };

  const localByName = bucket(unbasedLocal, (m) => m.name || m.folder);
  const canvasByName = bucket(unclaimedCanvas, (m) => m.name);

  const pairs = new Map();
  for (const [name, locals] of localByName) {
    if (locals.length !== 1) continue;
    const remotes = canvasByName.get(name);
    if (!remotes || remotes.length !== 1) continue;
    pairs.set(locals[0].folder, remotes[0]);
  }
  return pairs;
}

/**
 * One module seen from all three sides at once, which is the unit everything
 * below reasons about.
 */
function buildModuleContexts(base, localModules, canvasModules) {
  const canvasById = new Map();
  for (const module of canvasModules) {
    if (module.canvasModuleId != null) {
      canvasById.set(String(module.canvasModuleId), module);
    }
  }

  const claimedCanvas = new Set();
  const canvasForFolder = new Map();
  for (const [folder, entry] of base.modules) {
    if (entry.canvasModuleId == null) continue;
    const module = canvasById.get(String(entry.canvasModuleId));
    if (module && !claimedCanvas.has(module)) {
      claimedCanvas.add(module);
      canvasForFolder.set(folder, module);
    }
  }

  const localByFolder = new Map(localModules.map((m) => [m.folder, m]));
  const unbasedLocal = localModules.filter((m) => !base.modules.has(m.folder));
  const unclaimedCanvas = canvasModules.filter((m) => !claimedCanvas.has(m));
  for (const [folder, module] of pairUnbasedModules(
    unbasedLocal,
    unclaimedCanvas,
  )) {
    claimedCanvas.add(module);
    canvasForFolder.set(folder, module);
  }

  const contexts = [];
  const seen = new Set();
  const add = (folder, canvasModule) => {
    contexts.push({
      folder,
      baseModule: folder != null ? base.modules.get(folder) || null : null,
      localModule: folder != null ? localByFolder.get(folder) || null : null,
      canvasModule: canvasModule || null,
      canvasModuleId: canvasModule ? canvasModule.canvasModuleId : null,
      baseRows: [],
      baseOrder: [],
      collided: false,
      remoteChanges: false,
      localChanges: false,
      localDirty: false,
      coveredOrphans: [],
    });
    if (folder != null) seen.add(folder);
  };

  // Local order first: it is the author's own view of their course, and the
  // report reads better for following it.
  for (const module of localModules) {
    if (seen.has(module.folder)) continue;
    add(module.folder, canvasForFolder.get(module.folder));
  }
  for (const folder of base.modules.keys()) {
    if (seen.has(folder)) continue;
    add(folder, canvasForFolder.get(folder));
  }
  for (const module of canvasModules) {
    if (claimedCanvas.has(module)) continue;
    const suggested = module.suggestedFolder;
    add(suggested && !seen.has(suggested) ? suggested : null, module);
  }

  return contexts;
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

function emptyReport() {
  return {
    actions: [],
    conflicts: [],
    skipped: [],
    adopted: [],
    orphans: { canvas: [], local: [] },
    decisions: [],
    unrecognised: [],
    ordering: [],
    pending: { conflicts: [], order: [], renames: [] },
    collision: null,
    withheld: [],
  };
}

/**
 * Emit an action, unless the policy forbids writing to that side — in which
 * case the fact is recorded in `withheld` rather than lost.
 *
 * @returns {boolean} Whether the action was emitted, so the caller can mark its
 *   report entry as applied or not.
 */
function emit(ctx, action) {
  const side = ACTION_SIDES[action.type];
  const allowed =
    side === 'base'
      ? ctx.policy.write.canvas || ctx.policy.write.local
      : ctx.policy.write[side];

  if (!allowed) {
    ctx.report.withheld.push({ ...action, side, reason: 'write-policy' });
    return false;
  }
  ctx.report.actions.push(action);
  return true;
}

// ---------------------------------------------------------------------------
// Conflict resolution
// ---------------------------------------------------------------------------

/**
 * Who wins when both sides of one item changed.
 *
 * `'newest'` compares the file's mtime against Canvas's `updated_at`. A missing
 * or unparseable `updated_at` means **local wins**: Canvas has not proved it is
 * newer, and of the two possible mistakes, pushing over a remote edit is the
 * one git can undo. A tie goes to local for the same reason.
 *
 * @returns {{winner: 'local'|'canvas'|null, reason: string, pending: boolean, skipped: boolean}}
 */
function resolveConflict(ctx, key, localMtimeMs, canvasUpdatedAt) {
  const answer = ctx.policy.resolved.conflicts[key];
  if (answer === 'local' || answer === 'canvas') {
    return {
      winner: answer,
      reason: 'answered',
      pending: false,
      skipped: false,
    };
  }
  if (answer === 'skip') {
    return { winner: null, reason: 'answered', pending: false, skipped: true };
  }

  if (ctx.policy.conflict === 'local' || ctx.policy.conflict === 'canvas') {
    return {
      winner: ctx.policy.conflict,
      reason: `policy ${ctx.policy.conflict}`,
      pending: false,
      skipped: false,
    };
  }
  if (ctx.policy.conflict === 'ask') {
    return {
      winner: null,
      reason: 'awaiting an answer',
      pending: true,
      skipped: false,
    };
  }

  const canvasMs = canvasUpdatedAt == null ? NaN : Date.parse(canvasUpdatedAt);
  if (Number.isNaN(canvasMs)) {
    return {
      winner: 'local',
      reason:
        'newest: Canvas gave no usable timestamp, so it cannot prove it is newer',
      pending: false,
      skipped: false,
    };
  }
  if (localMtimeMs == null) {
    return {
      winner: 'canvas',
      reason: 'newest: the local file gave no usable mtime',
      pending: false,
      skipped: false,
    };
  }
  if (canvasMs > localMtimeMs) {
    return {
      winner: 'canvas',
      reason: 'newest: Canvas',
      pending: false,
      skipped: false,
    };
  }
  return {
    winner: 'local',
    reason: 'newest: local',
    pending: false,
    skipped: false,
  };
}

/**
 * Whether this run would really carry out an action of this type, which is the
 * question every refusal below has to ask before it records one.
 *
 * A skip means "this run wanted to do something and would not": it carries a
 * remedy, and it fails the run. Under a pinned direction `emit` suppresses
 * every write to the other side regardless, so a skip recorded for one of those
 * tells the author to repair a write the command was never going to make, and
 * fails the run over it. Those belong in `withheld`, which is where `emit` puts
 * them once the refusal declines to intervene.
 *
 * Named once rather than repeated, because repeating it is how it went missing:
 * the rule arrived with `guardDirty`, and the two other refusals that name a
 * concrete action — the type-changed one below and the module-level twin of
 * `guardDirty` in `planModuleOrphan` — each went without it. A refusal whose
 * `action` is null is a different thing and must not use this: nothing was
 * going to be emitted on either side, so there is nothing for `withheld` to
 * receive and the skip is the only place the fact can live.
 */
function writeLands(ctx, actionType) {
  const side = ACTION_SIDES[actionType];
  return !side || ctx.policy.write[side] === true;
}

/**
 * The refusal that protects a local file whose current contents exist nowhere
 * else.
 *
 * Git is the undo for this whole system, so a write onto a file with
 * uncommitted changes destroys the only copy of them. It applies to every write
 * into the working tree, including one the author's own conflict answer asked
 * for, and never to a write to Canvas — Canvas is not where the undo lives.
 *
 * **A write the policy already forbids is not guarded, it is withheld** — see
 * `writeLands`.
 */
function guardDirty(ctx, localItem, action, what) {
  if (!localItem || !localItem.dirty) return false;
  if (!writeLands(ctx, action.type)) return false;
  ctx.report.skipped.push({
    kind: 'item',
    reason: 'git-dirty',
    moduleFolder: localItem.folder,
    itemPath: localItem.itemPath,
    action: action.type,
    remedy:
      `${localItem.itemPath} has uncommitted changes; ${what} would be the ` +
      'only copy of them gone. Commit or stash the file, then run sync again.',
  });
  return true;
}

// ---------------------------------------------------------------------------
// Item planning
// ---------------------------------------------------------------------------

/**
 * Whether a side moved since the last sync, with every unknown resolved the
 * same way: **towards local being the truth.**
 *
 * A base row with no `local_hash` reads as changed locally, so the item is
 * pushed and the fingerprint recorded — which is what makes a row repaired by
 * hand, to adopt an existing Canvas object, do something. A base row with no
 * `canvas_hash`, or a Canvas item whose fingerprint could not be computed,
 * reads as *unchanged* remotely, because an unknown must never be grounds for
 * overwriting a local file. Both unknowns therefore point the same way: towards
 * the side git can undo.
 */
function hasLocalChanged(row, localItem) {
  if (!localItem || localItem.localHash == null) return false;
  if (row.local_hash == null) return true;
  return localItem.localHash !== row.local_hash;
}

function hasCanvasChanged(row, canvasItem) {
  if (!canvasItem || canvasItem.canvasHash == null) return false;
  if (row.canvas_hash == null) return false;
  return canvasItem.canvasHash !== row.canvas_hash;
}

/** The 1-based slot an item sits in within its module's local order. */
function localPositions(localModule) {
  const positions = new Map();
  if (!localModule) return positions;
  localModule.items.forEach((item, index) => {
    positions.set(item.itemPath, index + 1);
  });
  return positions;
}

/** Push the local file's content up to the Canvas object it is already tied to. */
function planCanvasUpdate(ctx, mc, itemPath, row, localItem, canvasItem) {
  const action = {
    type: 'update-canvas-item',
    folder: mc.folder,
    canvasModuleId: mc.canvasModuleId,
    itemPath,
    title: localItem.title,
    canvasType: row.canvas_type,
    canvasId: row.canvas_id ?? null,
    pageUrl: row.page_url ?? null,
    moduleItemId: canvasItem
      ? canvasItem.moduleItemId
      : (row.module_item_id ?? null),
    indent: localItem.indent,
    localHash: localItem.localHash,
  };

  // The author changed `canvas_type` in frontmatter. Pushing a page's body into
  // an assignment is not an update, it is a different object — so this stops
  // and says so rather than writing content into the wrong shape.
  //
  // Only where the update is a write this run makes: under `pull` it is
  // withheld whatever the frontmatter says, and the refusal would then be
  // telling the author to repair a Canvas write pull does not make. Same rule
  // as `guardDirty`, and `emit` below records the fact in `withheld` instead.
  if (
    localItem.canvasType &&
    localItem.canvasType !== row.canvas_type &&
    writeLands(ctx, action.type)
  ) {
    ctx.report.skipped.push({
      kind: 'item',
      reason: 'type-changed',
      moduleFolder: mc.folder,
      itemPath,
      action: action.type,
      remedy:
        `${itemPath} is a ${row.canvas_type} on Canvas but its frontmatter now ` +
        `says ${localItem.canvasType}. Changing the type means a new Canvas ` +
        'object: delete the item and add it again, or put the original type back.',
    });
    return false;
  }

  return emit(ctx, action);
}

/** Bring the local file in line with what Canvas holds. */
function planLocalUpdate(ctx, mc, itemPath, row, localItem, canvasItem) {
  const action = {
    type: 'update-local-item',
    folder: mc.folder,
    canvasModuleId: mc.canvasModuleId,
    itemPath,
    title: canvasItem.title,
    canvasType: canvasItem.canvasType,
    canvasId: canvasItem.canvasId,
    pageUrl: canvasItem.pageUrl,
    moduleItemId: canvasItem.moduleItemId,
    indent: canvasItem.indent,
    canvasHash: canvasItem.canvasHash,
    canvasUpdatedAt: canvasItem.canvasUpdatedAt,
  };
  if (
    guardDirty(ctx, localItem, action, 'writing the Canvas version over it')
  ) {
    return false;
  }
  return emit(ctx, action);
}

/**
 * The one item this whole module exists for: base row, local file and Canvas
 * item, and what should happen to them.
 */
function planKnownItem(ctx, mc, entry, localItem, canvasItem, positions) {
  const { itemPath, row } = entry;

  // yes / gone / gone — converged. Both sides did the same thing, so there is
  // nothing to do and nothing worth telling the author; only the row is stale.
  if (!localItem && !canvasItem) {
    emit(ctx, { type: 'drop-base-row', folder: mc.folder, itemPath });
    return;
  }

  const localChanged = hasLocalChanged(row, localItem);
  const canvasChanged = hasCanvasChanged(row, canvasItem);

  if (localItem && canvasItem) {
    if (canvasItem.canvasModuleId !== mc.canvasModuleId) {
      // The local path decides which module an item belongs to, because that
      // path is the key of its row. A Canvas-side move is therefore reported
      // and undone rather than followed; under `pull` the write is withheld and
      // named, so nothing reverts silently.
      emit(ctx, {
        type: 'move-canvas-item',
        itemPath,
        fromFolder: entry.baseFolder,
        toFolder: mc.folder,
        fromCanvasModuleId: canvasItem.canvasModuleId,
        toCanvasModuleId: mc.canvasModuleId,
        moduleItemId: canvasItem.moduleItemId,
        canvasType: row.canvas_type,
        canvasId: row.canvas_id ?? null,
        title: localItem.title,
        indent: localItem.indent,
        position: positions.get(itemPath) ?? null,
      });
    }

    if (!localChanged && !canvasChanged) return;
    if (localChanged && !canvasChanged) {
      planCanvasUpdate(ctx, mc, itemPath, row, localItem, canvasItem);
      mc.localChanges = true;
      return;
    }
    if (!localChanged && canvasChanged) {
      planLocalUpdate(ctx, mc, itemPath, row, localItem, canvasItem);
      mc.remoteChanges = true;
      return;
    }

    mc.localChanges = true;
    mc.remoteChanges = true;
    const outcome = resolveConflict(
      ctx,
      itemPath,
      localItem.localMtimeMs,
      canvasItem.canvasUpdatedAt,
    );
    if (outcome.pending) {
      ctx.report.pending.conflicts.push({
        kind: 'item',
        moduleFolder: mc.folder,
        itemPath,
        title: localItem.title ?? canvasItem.title,
        canvasType: row.canvas_type,
        localMtimeMs: localItem.localMtimeMs,
        canvasUpdatedAt: canvasItem.canvasUpdatedAt,
      });
      return;
    }
    if (outcome.skipped) {
      ctx.report.skipped.push({
        kind: 'item',
        reason: 'conflict-unresolved',
        moduleFolder: mc.folder,
        itemPath,
        action: null,
        remedy:
          `Both sides of ${itemPath} changed and no winner was chosen. Run ` +
          'again with --conflict local or --conflict canvas, or bring one side ' +
          'back in line by hand.',
      });
      return;
    }

    const applied =
      outcome.winner === 'local'
        ? planCanvasUpdate(ctx, mc, itemPath, row, localItem, canvasItem)
        : planLocalUpdate(ctx, mc, itemPath, row, localItem, canvasItem);
    ctx.report.conflicts.push({
      kind: 'item',
      moduleFolder: mc.folder,
      itemPath,
      title: localItem.title ?? canvasItem.title,
      canvasType: row.canvas_type,
      winner: outcome.winner,
      reason: outcome.reason,
      localMtimeMs: localItem.localMtimeMs,
      canvasUpdatedAt: canvasItem.canvasUpdatedAt,
      applied,
    });
    return;
  }

  if (!localItem && canvasItem) {
    if (canvasChanged) {
      // yes / gone / changed — either choice loses something, so neither is made.
      mc.remoteChanges = true;
      ctx.report.decisions.push({
        kind: 'local-deleted-canvas-changed',
        moduleFolder: mc.folder,
        itemPath,
        title: canvasItem.title,
        canvasType: canvasItem.canvasType,
        canvasId: canvasItem.canvasId,
        moduleItemId: canvasItem.moduleItemId,
        summary:
          `${itemPath} was deleted here, and the Canvas copy has changed since ` +
          'the last sync. Deleting it would discard that work; restoring the ' +
          'file would discard the deletion.',
      });
      return;
    }

    // yes / gone / unchanged — an orphan, and orphans are never deleted without
    // being asked for.
    const orphan = {
      kind: 'item',
      moduleFolder: mc.folder,
      itemPath,
      title: canvasItem.title ?? row.title ?? null,
      canvasType: canvasItem.canvasType,
      canvasId: canvasItem.canvasId,
      moduleItemId: canvasItem.moduleItemId,
      canvasModuleId: canvasItem.canvasModuleId,
      pruned: false,
      coveredByModule: mc.moduleOrphanedOnCanvas === true,
    };
    ctx.report.orphans.canvas.push(orphan);
    if (orphan.coveredByModule) mc.coveredOrphans.push(orphan);
    if (ctx.policy.pruneCanvas && !orphan.coveredByModule) {
      orphan.pruned = emit(ctx, {
        type: 'delete-canvas-item',
        folder: mc.folder,
        canvasModuleId: canvasItem.canvasModuleId,
        itemPath,
        moduleItemId: canvasItem.moduleItemId,
        canvasType: canvasItem.canvasType,
        canvasId: canvasItem.canvasId,
        title: canvasItem.title,
      });
    }
    return;
  }

  // localItem && !canvasItem
  if (localChanged) {
    // yes / changed / gone — the mirror image, and just as asymmetric.
    mc.localChanges = true;
    ctx.report.decisions.push({
      kind: 'local-changed-canvas-deleted',
      moduleFolder: mc.folder,
      itemPath,
      title: localItem.title,
      canvasType: row.canvas_type,
      summary:
        `${itemPath} changed here, and the Canvas copy is gone. Recreating it ` +
        'on Canvas or deleting the file are both losses; which one is yours.',
    });
    return;
  }

  const orphan = {
    kind: 'item',
    moduleFolder: mc.folder,
    itemPath,
    title: localItem.title ?? row.title ?? null,
    canvasType: row.canvas_type,
    pruned: false,
    coveredByModule: mc.moduleOrphanedLocally === true,
  };
  ctx.report.orphans.local.push(orphan);
  if (orphan.coveredByModule) mc.coveredOrphans.push(orphan);
  if (ctx.policy.pruneLocal && !orphan.coveredByModule) {
    const action = {
      type: 'delete-local-item',
      folder: mc.folder,
      itemPath,
      canvasType: row.canvas_type,
    };
    if (!guardDirty(ctx, localItem, action, 'deleting the file')) {
      orphan.pruned = emit(ctx, action);
    }
  }
}

// ---------------------------------------------------------------------------
// Adoption
// ---------------------------------------------------------------------------

/**
 * The key a pair is matched on: the type, and the title with case and padding
 * taken out of it. Null for anything that cannot identify an object — an
 * untitled item, or one whose type is unknown.
 *
 * Not `suggestedPath`, which is the obvious candidate and the wrong one: it is
 * built from the title *and* the Canvas position, so the same item sitting
 * third on Canvas and first here gives `03-welcome.md` against `01-welcome.md`
 * and never matches. The numeric prefix is ordering, and ordering is
 * reconciled by `planOrdering`, on its own evidence.
 *
 * **The separator is a NUL deliberately — do not tidy it to a colon.** The key
 * is only ever compared, never parsed back, so the single property it needs is
 * that two different pairs cannot build the same string. Any printable
 * separator puts that at the mercy of the type vocabulary, because a title may
 * hold any printable character: with a space, `page` + `a b` and `page a` + `b`
 * are one key. NUL is the one byte a Canvas title cannot carry. It is written
 * `\0` rather than as the byte itself because a literal NUL makes the whole
 * file read as binary to `grep` and `file`, which then go quiet instead of
 * failing — the file simply stops being searchable and nobody learns why.
 */
function adoptionKey(canvasType, title) {
  const name = comparableName(title);
  return name === '' || !canvasType ? null : `${canvasType}\0${name}`;
}

/**
 * Bind one local file to one Canvas object that is already there, instead of
 * creating a second copy of each.
 *
 * There is no base row, so nothing can prove the two agree and there is no
 * conflict to resolve: the pinned side is written unconditionally, which is
 * what `policy.adopt` names. The other side's identity is what the pair is
 * for — `canvasId`, `pageUrl` and `moduleItemId` come from Canvas whichever
 * direction is pinned, because they are the thing being claimed.
 */
function adoptPair(ctx, mc, localItem, canvasItem) {
  const action =
    ctx.policy.adopt === 'local'
      ? {
          type: 'update-canvas-item',
          folder: mc.folder,
          canvasModuleId: mc.canvasModuleId,
          itemPath: localItem.itemPath,
          title: localItem.title,
          canvasType: canvasItem.canvasType,
          canvasId: canvasItem.canvasId,
          pageUrl: canvasItem.pageUrl,
          moduleItemId: canvasItem.moduleItemId,
          indent: localItem.indent,
          localHash: localItem.localHash,
        }
      : {
          type: 'update-local-item',
          folder: mc.folder,
          canvasModuleId: mc.canvasModuleId,
          itemPath: localItem.itemPath,
          title: canvasItem.title,
          canvasType: canvasItem.canvasType,
          canvasId: canvasItem.canvasId,
          pageUrl: canvasItem.pageUrl,
          moduleItemId: canvasItem.moduleItemId,
          indent: canvasItem.indent,
          canvasHash: canvasItem.canvasHash,
          canvasUpdatedAt: canvasItem.canvasUpdatedAt,
        };

  // Registered before the write is even attempted, and whether or not it goes
  // ahead: these two sets are what `planNewItems` reads, and a pair left out of
  // them is created on both sides — the duplication adoption exists to stop.
  ctx.claimedCanvas.add(canvasItem);
  ctx.adoptedLocal.add(localItem.itemPath);

  // A pair is a link between a path and a Canvas item, which is exactly what a
  // matched base row is, and everything downstream reads links through these
  // two maps. `planOrdering` needs the Canvas sequence in local paths to
  // compare it with anything, and a reorder needs the module item id of every
  // slot it names.
  ctx.canvasOf.set(localItem.itemPath, canvasItem);
  ctx.basePathOf.set(canvasItem, localItem.itemPath);

  const entry = {
    moduleFolder: mc.folder,
    itemPath: localItem.itemPath,
    title: action.title,
    canvasType: canvasItem.canvasType,
    canvasId: canvasItem.canvasId,
    moduleItemId: canvasItem.moduleItemId,
    direction: ctx.policy.adopt,
    applied: false,
  };
  ctx.report.adopted.push(entry);

  if (
    action.type === 'update-local-item' &&
    guardDirty(ctx, localItem, action, 'writing the Canvas version over it')
  ) {
    return;
  }
  entry.applied = emit(ctx, action);
}

/**
 * Pair the items neither side has a base row for, by type and title, so that
 * an object already sitting in Canvas is claimed rather than duplicated.
 *
 * **Only when the direction is pinned.** With both sides writable nothing can
 * say which of the two copies is the newer, and there is no base row to ask;
 * `sync` therefore still refuses the whole module (see `detectCollisions`).
 * With `push` or `pull` there is an answer, and it is the pinned side.
 *
 * Types have to match exactly. A local page does not adopt a Canvas assignment
 * of the same name: that is not an adoption but a conversion, and this tool
 * cannot do one. Every type is eligible otherwise, `sub_header` and the three
 * reference types included — adopting a quiz by title is the general form of
 * the one-type trick `push` already does.
 *
 * **Ambiguity is never guessed at.** A title carried by two items on either
 * side says nothing about which claims which, so nothing is adopted for it and
 * the author is told; both sides fall through to the create path, exactly as
 * they did before this step existed.
 */
function planAdoptions(ctx, mc) {
  if (!ctx.policy.adopt) return;
  if (!mc.localModule || !mc.canvasModule) return;

  const bucket = (items) => {
    const map = new Map();
    for (const item of items) {
      const key = adoptionKey(item.canvasType, item.title);
      if (key === null) continue;
      const list = map.get(key);
      if (list) list.push(item);
      else map.set(key, [item]);
    }
    return map;
  };

  const here = bucket(
    mc.localModule.items.filter(
      (item) =>
        !ctx.baseRows.has(item.itemPath) &&
        // A path the author has not yet confirmed as a rename is held out of
        // the truth table entirely, and binding it to a Canvas object would be
        // deciding the very question that is being asked.
        !ctx.pendingRenameTargets.has(item.itemPath),
    ),
  );
  const there = bucket(
    mc.canvasModule.items.filter(
      (item) => item.recognised && !ctx.claimedCanvas.has(item),
    ),
  );

  for (const [key, locals] of here) {
    const remotes = there.get(key);
    if (!remotes) continue;
    if (locals.length === 1 && remotes.length === 1) {
      adoptPair(ctx, mc, locals[0], remotes[0]);
      continue;
    }
    ctx.report.decisions.push({
      kind: 'ambiguous-adoption',
      moduleFolder: mc.folder,
      title: locals[0].title,
      canvasType: locals[0].canvasType,
      localCandidates: locals.length,
      canvasCandidates: remotes.length,
      summary:
        `${mc.folder} holds ${locals.length} local and ${remotes.length} ` +
        `Canvas ${locals[0].canvasType} item(s) titled ` +
        `"${locals[0].title}", and nothing says which claims which. None of ` +
        'them was adopted. Give one of them a different title, or link them ' +
        'by hand in the sync state, then run again.',
    });
  }
}

// ---------------------------------------------------------------------------
// New items
// ---------------------------------------------------------------------------

/** Everything the sync state has never seen, on either side. */
function planNewItems(ctx, mc, positions) {
  if (mc.localModule) {
    for (const item of mc.localModule.items) {
      if (ctx.baseRows.has(item.itemPath)) continue;
      if (ctx.adoptedLocal.has(item.itemPath)) continue;
      if (ctx.pendingRenameTargets.has(item.itemPath)) continue;
      emit(ctx, {
        type: 'create-canvas-item',
        folder: mc.folder,
        canvasModuleId: mc.canvasModuleId,
        itemPath: item.itemPath,
        title: item.title,
        canvasType: item.canvasType,
        indent: item.indent,
        position: positions.get(item.itemPath) ?? null,
      });
    }
  }

  if (!mc.canvasModule) return;
  for (const item of mc.canvasModule.items) {
    if (!item.recognised) continue;
    if (ctx.claimedCanvas.has(item)) continue;
    emit(ctx, {
      type: 'create-local-item',
      folder: mc.folder,
      itemPath: item.suggestedPath,
      canvasModuleId: item.canvasModuleId,
      moduleItemId: item.moduleItemId,
      canvasType: item.canvasType,
      rawType: item.rawType,
      canvasId: item.canvasId,
      pageUrl: item.pageUrl,
      title: item.title,
      indent: item.indent,
      position: item.position,
      canvasHash: item.canvasHash,
      canvasUpdatedAt: item.canvasUpdatedAt,
    });
  }
}

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

/**
 * Make the losing side's order match the winner's.
 *
 * Shared by the two branches below, because "the local order wins" has to mean
 * the same thing whether a base row or an adoption is what linked the sides.
 */
function emitReorder(ctx, mc, winner, localSeq, canvasSeq) {
  if (winner === 'local') {
    // The full local sequence, not the restricted one: an item created this run
    // has a slot in the module too, and the executor needs to be told which.
    return emit(ctx, {
      type: 'reorder-canvas-module',
      folder: mc.folder,
      canvasModuleId: mc.canvasModuleId,
      order: mc.localModule.items.map((item, index) => ({
        itemPath: item.itemPath,
        moduleItemId: ctx.canvasOf.get(item.itemPath)?.moduleItemId ?? null,
        position: index + 1,
      })),
    });
  }

  // Canvas won: the desired local sequence is the Canvas one, with any path
  // Canvas does not hold kept at the end rather than dropped.
  const localSet = new Set(localSeq);
  const canvasSet = new Set(canvasSeq);
  const ordered = canvasSeq.filter((p) => localSet.has(p));
  const trailing = localSeq.filter((p) => !canvasSet.has(p));
  return emit(ctx, {
    type: 'reorder-local-module',
    folder: mc.folder,
    canvasModuleId: mc.canvasModuleId,
    order: [...ordered, ...trailing].map((itemPath, index) => ({
      itemPath,
      position: index + 1,
    })),
  });
}

/**
 * The order of a module whose two sides the base cannot compare.
 *
 * Called wherever the three-way comparison declines to decide, and it decides
 * only for a run that pinned a direction — the same rule, and the same reason,
 * as adoption itself: with no record of what the order was, nothing but the pin
 * can say which of two real orders is the right one.
 *
 * **Leaving it alone is not the neutral choice it looks like.** The run records
 * a base as it goes, and that base takes the order the rows were written in,
 * which is the local one. A Canvas still holding a different order then reads,
 * on the very next run, as though *Canvas* had been reordered and the local
 * files should be renumbered to match — a one-sided change, so nothing prompts
 * and nothing warns. Nobody reordered anything. Only an adoption can produce
 * that state, because before one, items reach Canvas in local order by
 * construction; so deciding here is this step's own mess to clean up.
 *
 * A no-op unless the two sides genuinely disagree, which is what keeps it from
 * emitting a reorder on every module of every pinned run.
 */
function planAdoptedOrdering(ctx, mc, localSeq, canvasSeq) {
  if (!ctx.policy.adopt) return;

  const localSet = new Set(localSeq);
  const canvasSet = new Set(canvasSeq);
  const restrictedLocal = localSeq.filter((p) => canvasSet.has(p));
  const restrictedCanvas = canvasSeq.filter((p) => localSet.has(p));

  // One linked item cannot sit in the wrong order relative to nothing, and two
  // that already agree need no write.
  if (restrictedCanvas.length < 2) return;
  if (sameSequence(restrictedLocal, restrictedCanvas)) return;

  const entry = {
    folder: mc.folder,
    winner: ctx.policy.adopt,
    skipped: false,
    reason:
      'adopted: no recorded order to compare against, so the side this run ' +
      'pins decided',
    base: null,
    local: restrictedLocal,
    canvas: restrictedCanvas,
    applied: false,
  };
  ctx.report.ordering.push(entry);
  entry.applied = emitReorder(ctx, mc, ctx.policy.adopt, localSeq, canvasSeq);
}

/**
 * Reconcile the order of a module's items, which is the one thing newest-wins
 * cannot decide: a position carries no timestamp on either side.
 *
 * Three sequences of paths — base, local, Canvas — **restricted to the paths
 * all three hold** before anything is compared. An item added or removed is a
 * membership change, and comparing unrestricted sequences would read every one
 * of them as a reorder of everything below it.
 *
 * Where that restriction leaves too little to compare, `planAdoptedOrdering`
 * takes over for a run that pinned a direction. It is reached from all three
 * of the points below that decide nothing, because an adopted pair is linked
 * without ever having been in the base, and so is invisible to every one of
 * these comparisons.
 */
function planOrdering(ctx, mc, unrecognised) {
  if (!mc.localModule || !mc.canvasModule) return;
  // A module with no base row at all still has two real orders once a pinned
  // run has adopted its way through it.
  if (!mc.baseModule && !ctx.policy.adopt) return;

  if (unrecognised.length > 0) {
    // An item this version cannot understand must not be shuffled. Its module
    // gets content and membership reconciled and nothing else.
    ctx.report.ordering.push({
      folder: mc.folder,
      winner: null,
      skipped: true,
      reason:
        `${mc.folder} holds ${unrecognised.length} module item(s) of a type ` +
        'this version does not understand, so its order was left exactly as ' +
        'it is on both sides.',
      unrecognised: unrecognised.map((item) => item.rawType ?? item.canvasType),
    });
    return;
  }

  const localSeq = mc.localModule.items.map((item) => item.itemPath);
  const canvasSeq = mc.canvasModule.items
    .map((item) => ctx.basePathOf.get(item))
    .filter((itemPath) => itemPath != null);
  const baseSeq = mc.baseOrder;

  const localSet = new Set(localSeq);
  const canvasSet = new Set(canvasSeq);
  const common = new Set(
    baseSeq.filter((p) => localSet.has(p) && canvasSet.has(p)),
  );
  if (common.size < 2) {
    planAdoptedOrdering(ctx, mc, localSeq, canvasSeq);
    return;
  }

  const restrictedBase = baseSeq.filter((p) => common.has(p));
  const restrictedLocal = localSeq.filter((p) => common.has(p));
  const restrictedCanvas = canvasSeq.filter((p) => common.has(p));

  const localMoved = !sameSequence(restrictedBase, restrictedLocal);
  const canvasMoved = !sameSequence(restrictedBase, restrictedCanvas);

  if (!localMoved && !canvasMoved) {
    planAdoptedOrdering(ctx, mc, localSeq, canvasSeq);
    return;
  }
  if (localMoved && canvasMoved) {
    if (sameSequence(restrictedLocal, restrictedCanvas)) {
      planAdoptedOrdering(ctx, mc, localSeq, canvasSeq);
      return;
    }
  }

  let winner = null;
  let reason = '';
  if (!canvasMoved) {
    winner = 'local';
    reason = 'only this side reordered';
  } else if (!localMoved) {
    winner = 'canvas';
    reason = 'only this side reordered';
  } else {
    const answer = ctx.policy.resolved.order[mc.folder];
    if (answer === 'local' || answer === 'canvas') {
      winner = answer;
      reason = 'answered';
    } else if (answer === 'skip') {
      ctx.report.ordering.push({
        folder: mc.folder,
        winner: null,
        skipped: true,
        reason: 'both sides reordered and neither was chosen',
        base: restrictedBase,
        local: restrictedLocal,
        canvas: restrictedCanvas,
      });
      return;
    } else if (ctx.policy.order === 'ask') {
      ctx.report.ordering.push({
        folder: mc.folder,
        winner: null,
        skipped: true,
        reason: 'both sides reordered; awaiting an answer',
        base: restrictedBase,
        local: restrictedLocal,
        canvas: restrictedCanvas,
      });
      ctx.report.pending.order.push({
        folder: mc.folder,
        base: restrictedBase,
        local: restrictedLocal,
        canvas: restrictedCanvas,
      });
      return;
    } else if (ctx.policy.order === 'skip') {
      // Nothing pending, because nothing will ask: a question filed under a
      // command that never collects it is a question the author never sees.
      // The line names the command that does ask instead, which is the only
      // thing they can act on.
      ctx.report.ordering.push({
        folder: mc.folder,
        winner: null,
        skipped: true,
        reason:
          'both sides reordered, and this command never asks which wins; ' +
          '`npx course sync` is the one that does',
        base: restrictedBase,
        local: restrictedLocal,
        canvas: restrictedCanvas,
      });
      return;
    } else {
      winner = ctx.policy.order;
      reason = `policy ${ctx.policy.order}`;
    }
  }

  const entry = {
    folder: mc.folder,
    winner,
    skipped: false,
    reason,
    base: restrictedBase,
    local: restrictedLocal,
    canvas: restrictedCanvas,
    applied: false,
  };
  ctx.report.ordering.push(entry);
  entry.applied = emitReorder(ctx, mc, winner, localSeq, canvasSeq);
}

// ---------------------------------------------------------------------------
// Module planning
// ---------------------------------------------------------------------------

/**
 * The module's own name and slot.
 *
 * Positions are reconciled in one direction only, and deliberately: a local
 * position is the folder's numeric prefix, a Canvas position is a 1-based index
 * within the course, and the two count in different spaces. Comparing them
 * would make every course whose folders are numbered 10, 20, 30 report a
 * permanent phantom change. So the Canvas side is watched for a name change,
 * and the local side for either.
 */
function planModuleMetadata(ctx, mc) {
  const { baseModule, localModule, canvasModule } = mc;

  if (!baseModule) {
    if (localModule && !canvasModule) {
      emit(ctx, {
        type: 'create-canvas-module',
        folder: mc.folder,
        name: localModule.name,
        position: localModule.position,
      });
      return;
    }
    if (!localModule && canvasModule) {
      emit(ctx, {
        type: 'create-local-module',
        folder: mc.folder,
        canvasModuleId: canvasModule.canvasModuleId,
        name: canvasModule.name,
        position: canvasModule.position,
      });
      return;
    }
    if (!localModule || !canvasModule) return;

    // Paired by name with nothing in the state to link them. Writing that link
    // down is a **state** operation, not a Canvas write, and no policy switches
    // it off: that this folder and this Canvas module are the same module is
    // true the moment the pair exists, whoever paired them and whichever side
    // the run writes to. Bookkeeping, not a decision.
    //
    // Nothing else records it. `recordRow` calls `ensureModule(state, folder,
    // {})` on its way past, so the module row does get created — with no
    // `canvas_module_id` in it. `buildModuleContexts` then pairs on that id and
    // falls back to matching by name only for a folder the base does not hold
    // at all, so on the next run the folder pairs with nothing: the module
    // reads as gone from Canvas, every item in it as a local orphan, a
    // `create-local-module` appears for a module that is already there, and
    // `--prune-local` would offer to delete the folder. That happens under
    // plain `sync` as readily as under an adopting run — a pair with items on
    // one side only never trips the collision guard — which is why this is not
    // gated on `policy.adopt`.
    //
    // Emitting it as an `update-canvas-module` would fix `push` and leave
    // `pull` broken in exactly the same way, because `emit` withholds a
    // Canvas-side action under a Canvas-pinned run.
    emit(ctx, {
      type: 'link-base-module',
      folder: mc.folder,
      canvasModuleId: canvasModule.canvasModuleId,
      // The local name and the local slot, because that is the frame the base
      // is compared in: a Canvas position counts within the course and a local
      // one is the folder's numeric prefix. A Canvas-pinned run that wants the
      // Canvas name gets it on the next pass, as an ordinary one-sided change.
      name: localModule.name,
      position: localModule.position,
    });

    // The module is adopted rather than duplicated, and the local name is what
    // it takes.
    //
    // **This cannot currently fire, and the branch is kept deliberately.**
    // `pairUnbasedModules` buckets both sides through `comparableName`, so a
    // pair only exists when the two names already compare equal — which is
    // exactly when this condition is false. The one way in is a local module
    // whose `name` is null, because that bucket falls back to the folder name,
    // and `gatherLocal` always sets one. Widen the pairing and this is what
    // stops a renamed module being silently adopted under its old Canvas name,
    // so it stays.
    if (
      comparableName(localModule.name) !== comparableName(canvasModule.name)
    ) {
      emit(ctx, {
        type: 'update-canvas-module',
        folder: mc.folder,
        canvasModuleId: canvasModule.canvasModuleId,
        name: localModule.name,
        position: localModule.position,
      });
    }
    return;
  }

  if (!localModule || !canvasModule) return;

  const localChanged =
    localModule.name !== baseModule.name ||
    localModule.position !== baseModule.position;
  const canvasChanged =
    comparableName(canvasModule.name) !== comparableName(baseModule.name);

  if (!localChanged && !canvasChanged) return;

  const toCanvas = () =>
    emit(ctx, {
      type: 'update-canvas-module',
      folder: mc.folder,
      canvasModuleId: canvasModule.canvasModuleId,
      name: localModule.name,
      position: localModule.position,
    });
  // Only the label in `_category_.json` moves: the folder name is the key of
  // every row in the state, so renaming it here would re-key the whole module
  // behind the author's back.
  const toLocal = () =>
    emit(ctx, {
      type: 'update-local-module',
      folder: mc.folder,
      canvasModuleId: canvasModule.canvasModuleId,
      name: canvasModule.name,
    });

  if (localChanged && !canvasChanged) {
    toCanvas();
    return;
  }
  if (!localChanged && canvasChanged) {
    toLocal();
    return;
  }

  const outcome = resolveConflict(ctx, mc.folder, null, null);
  if (outcome.pending) {
    ctx.report.pending.conflicts.push({
      kind: 'module',
      moduleFolder: mc.folder,
      localName: localModule.name,
      canvasName: canvasModule.name,
    });
    return;
  }
  if (outcome.skipped) {
    ctx.report.skipped.push({
      kind: 'module',
      reason: 'conflict-unresolved',
      moduleFolder: mc.folder,
      action: null,
      remedy:
        `${mc.folder} was renamed on both sides and no winner was chosen. Run ` +
        'again with --conflict local or --conflict canvas.',
    });
    return;
  }
  const applied = outcome.winner === 'local' ? toCanvas() : toLocal();
  ctx.report.conflicts.push({
    kind: 'module',
    moduleFolder: mc.folder,
    winner: outcome.winner,
    reason: outcome.reason,
    localName: localModule.name,
    canvasName: canvasModule.name,
    applied,
  });
}

/** A module that is in the state but gone from one side. */
function planModuleOrphan(ctx, mc) {
  const { baseModule, localModule, canvasModule } = mc;
  if (!baseModule) return;

  if (!localModule && !canvasModule) {
    emit(ctx, { type: 'drop-base-module', folder: mc.folder });
    return;
  }

  if (!localModule && canvasModule) {
    const orphan = {
      kind: 'module',
      moduleFolder: mc.folder,
      title: canvasModule.name,
      canvasModuleId: canvasModule.canvasModuleId,
      itemCount: canvasModule.items.length,
      pruned: false,
    };
    ctx.report.orphans.canvas.push(orphan);
    if (!ctx.policy.pruneCanvas) return;
    if (mc.remoteChanges) {
      // Deleting the module would take the changed items with it, and those are
      // exactly the ones the author still has to decide about.
      orphan.reason =
        'left alone: this module still holds Canvas-side changes that need a ' +
        'decision first';
      return;
    }
    orphan.pruned = emit(ctx, {
      type: 'delete-canvas-module',
      folder: mc.folder,
      canvasModuleId: canvasModule.canvasModuleId,
      name: canvasModule.name,
    });
    // Deleting the module takes its items with it, which is why they got no
    // delete of their own.
    for (const covered of mc.coveredOrphans) covered.pruned = orphan.pruned;
    return;
  }

  if (localModule && !canvasModule) {
    const orphan = {
      kind: 'module',
      moduleFolder: mc.folder,
      title: localModule.name,
      itemCount: localModule.items.length,
      pruned: false,
    };
    ctx.report.orphans.local.push(orphan);
    if (!ctx.policy.pruneLocal) return;
    if (mc.localChanges) {
      orphan.reason =
        'left alone: this folder still holds local changes that need a ' +
        'decision first';
      return;
    }
    // The module-level `guardDirty`: one folder standing in for every file
    // under it, and withheld rather than skipped on a run that does not write
    // locally, for the reason `writeLands` gives.
    if (mc.localDirty && writeLands(ctx, 'delete-local-module')) {
      ctx.report.skipped.push({
        kind: 'module',
        reason: 'git-dirty',
        moduleFolder: mc.folder,
        action: 'delete-local-module',
        remedy:
          `${mc.folder} holds files with uncommitted changes; deleting the ` +
          'folder would be the only copy of them gone. Commit or stash them, ' +
          'then run sync again.',
      });
      return;
    }
    orphan.pruned = emit(ctx, {
      type: 'delete-local-module',
      folder: mc.folder,
      canvasModuleId: baseModule.canvasModuleId,
    });
    for (const covered of mc.coveredOrphans) covered.pruned = orphan.pruned;
  }
}

function planModule(ctx, mc) {
  const unrecognised = mc.canvasModule
    ? mc.canvasModule.items.filter((item) => !item.recognised)
    : [];
  for (const item of unrecognised) {
    ctx.report.unrecognised.push({
      moduleFolder: mc.folder,
      canvasModuleId: mc.canvasModuleId,
      moduleItemId: item.moduleItemId,
      rawType: item.rawType,
      canvasType: item.canvasType,
      title: item.title,
    });
  }

  // A collided module is refused outright: nothing about it is decided until
  // the author picks a direction.
  if (mc.collided) return;

  mc.moduleOrphanedOnCanvas = Boolean(
    mc.baseModule && !mc.localModule && mc.canvasModule,
  );
  mc.moduleOrphanedLocally = Boolean(
    mc.baseModule && mc.localModule && !mc.canvasModule,
  );
  mc.localDirty = Boolean(
    mc.localModule && mc.localModule.items.some((item) => item.dirty),
  );

  planModuleMetadata(ctx, mc);

  const positions = localPositions(mc.localModule);
  for (const entry of mc.baseRows) {
    if (ctx.pendingRenameSources.has(entry.itemPath)) continue;
    planKnownItem(
      ctx,
      mc,
      entry,
      mc.localModule ? mc.localModule.byPath.get(entry.itemPath) || null : null,
      ctx.canvasOf.get(entry.itemPath) || null,
      positions,
    );
  }
  planAdoptions(ctx, mc);
  planNewItems(ctx, mc, positions);
  planModuleOrphan(ctx, mc);
  planOrdering(ctx, mc, unrecognised);
}

// ---------------------------------------------------------------------------
// Renames and the collision guard
// ---------------------------------------------------------------------------

/**
 * Fold the detected renames into the base index, so that everything downstream
 * classifies the item against the path it actually sits at now.
 *
 * An exact rename is applied here and reported as a `rekey-base` action; the
 * item is then classified normally, against its new path. A probable one is
 * held: both the old path and the new one are taken out of the truth table
 * until the author answers, because letting them through would report a delete
 * of the Canvas object and a create of a second copy of the same content — the
 * exact duplication rename detection exists to prevent.
 */
function applyRenames(ctx, base, localItems, canvasItems) {
  const inScope = (itemPath) => ctx.included(folderOf(itemPath));
  const { renames } = detectRenames({
    base: [...base.rows.values()].filter((entry) => inScope(entry.itemPath)),
    local: localItems.filter((item) => inScope(item.itemPath)),
    canvas: canvasItems,
  });

  const rekeys = new Map();
  for (const rename of renames) {
    const answer = ctx.policy.resolved.renames[rename.from];
    const confirmed = answer === rename.to || answer === true;
    const rejected = answer === false || answer === null;

    if (rename.confidence === 'exact' || confirmed) {
      rekeys.set(rename.from, rename.to);
      emit(ctx, {
        type: 'rekey-base',
        from: rename.from,
        to: rename.to,
        fromFolder: folderOf(rename.from),
        toFolder: folderOf(rename.to),
        confidence: rename.confidence,
      });
      continue;
    }
    if (rejected) continue;

    ctx.report.pending.renames.push({
      from: rename.from,
      to: rename.to,
      confidence: rename.confidence,
      fromFolder: folderOf(rename.from),
      toFolder: folderOf(rename.to),
    });
    ctx.pendingRenameSources.add(rename.from);
    ctx.pendingRenameTargets.add(rename.to);
  }

  if (rekeys.size === 0) return;

  const rows = new Map();
  for (const [itemPath, entry] of base.rows) {
    const to = rekeys.get(itemPath);
    rows.set(to || itemPath, to ? { ...entry, itemPath: to } : entry);
  }
  base.rows = rows;
  for (const module of base.modules.values()) {
    module.order = module.order.map(
      (itemPath) => rekeys.get(itemPath) || itemPath,
    );
  }

  // The Canvas match was made on ids, which a rename does not touch, so it
  // moves with the row rather than being redone.
  for (const [from, to] of rekeys) {
    const canvasItem = ctx.canvasOf.get(from);
    ctx.canvasOf.delete(from);
    if (!canvasItem) continue;
    ctx.canvasOf.set(to, canvasItem);
    ctx.basePathOf.set(canvasItem, to);
  }
}

/**
 * Refuse the one state that cannot be reconciled: the state links nothing in a
 * module to Canvas, and both sides hold content in it.
 *
 * That happens after `reset-sync-state` against a course that already holds a
 * copy, and on a first `sync` against a populated course. Every local item
 * reads as new here and every Canvas item as new there, so the honest plan is
 * to create both — which duplicates the entire course. This is the single most
 * destructive thing the old system did.
 *
 * The trigger is "no base row for this module", not "no base module row": a
 * module entry that names a Canvas module but holds no items — a run that
 * crashed between creating the module and recording what went in it — leads to
 * exactly the same duplication, and the same refusal is the right answer.
 *
 * Judged per module, never for the course: a genuinely new module on one side
 * is an ordinary thing and must not trip it.
 *
 * The refusal's own advice is to pick a direction, and a run that has picked
 * one needs no refusal: `planAdoptions` pairs the two sides by title and the
 * pinned side is written over what it claims. So a pinned run skips this
 * entirely — including the pairs adoption could not make, which fall through
 * to being created and are reported as such.
 */
function detectCollisions(ctx, contexts) {
  if (ctx.policy.adopt) return;

  const collided = [];
  for (const mc of contexts) {
    if (mc.baseRows.length > 0) continue;
    if (!mc.localModule || !mc.canvasModule) continue;
    const localCount = mc.localModule.items.length;
    const canvasCount = mc.canvasModule.items.filter(
      (item) => item.recognised,
    ).length;
    if (localCount === 0 || canvasCount === 0) continue;

    mc.collided = true;
    collided.push({
      folder: mc.folder,
      canvasModuleId: mc.canvasModule.canvasModuleId,
      name: mc.canvasModule.name ?? mc.localModule.name,
      localItems: localCount,
      canvasItems: canvasCount,
    });
  }

  if (collided.length === 0) return;
  const named = collided
    .map(
      (m) =>
        `${m.folder ?? m.name} (${m.localItems} local, ${m.canvasItems} on Canvas)`,
    )
    .join(', ');
  ctx.report.collision = {
    modules: collided,
    message:
      `The sync state links nothing in ${named} to Canvas, yet both sides hold ` +
      'items. Every one of them reads as new on the side it is on, so ' +
      'reconciling would create a second copy of each and duplicate the ' +
      'module. Pick a direction instead — `npx course push` pins the local ' +
      'copy as the winner and `npx course pull` pins Canvas — or clear the ' +
      'side you do not want first.',
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Decide what a sync run should do.
 *
 * @param {object} input
 * @param {object} input.base - Schema-v4 sync state, as `lib/sync/state.js`
 *   produces it: the truth as of the last sync, and the only thing that can
 *   tell "changed" from "new" from "deleted".
 * @param {object} input.local - `{ modules: [{folder, name, position, items:
 *   [{itemPath, title, canvasType, indent, position, localHash, localMtimeMs,
 *   dirty}]}] }`. `dirty` is whether git holds uncommitted changes for that
 *   file, and it is the caller's job to answer it.
 * @param {object} input.canvas - `{ modules: [{canvasModuleId, name, position,
 *   suggestedFolder, items: [{moduleItemId, canvasType, rawType, canvasId,
 *   pageUrl, title, indent, position, canvasHash, canvasUpdatedAt,
 *   suggestedPath, recognised}]}] }`.
 * @param {object} input.policy - `{ write: {canvas, local}, conflict, order,
 *   adopt, pruneCanvas, pruneLocal, modules, resolved }`. `push` is
 *   `write: {canvas: true, local: false}` with `conflict: 'local'` and
 *   `adopt: 'local'`, `pull` the mirror image, `status` writes to neither and
 *   adopts nothing. Only `sync` passes `order: 'ask'`, because only `sync`
 *   collects what that parks in `pending.order`.
 * @returns {object} `{ actions, conflicts, skipped, adopted, orphans,
 *   decisions, unrecognised, ordering, pending, collision, withheld }`.
 */
function plan({ base, local, canvas, policy } = {}) {
  const normalisedBase = normaliseBase(base);
  const localModules = normaliseLocal(local);
  const canvasModules = normaliseCanvas(canvas);

  const ctx = {
    policy: normalisePolicy(policy),
    report: emptyReport(),
    pendingRenameSources: new Set(),
    pendingRenameTargets: new Set(),
    adoptedLocal: new Set(),
  };
  ctx.included = (folder) =>
    ctx.policy.modules === null || ctx.policy.modules.has(folder);

  const localItems = localModules.flatMap((module) => module.items);
  const canvasItems = canvasModules.flatMap((module) => module.items);

  const matched = matchBaseToCanvas(normalisedBase.rows, canvasItems);
  ctx.canvasOf = matched.canvasOf;
  ctx.basePathOf = matched.basePathOf;
  ctx.claimedCanvas = matched.claimed;

  applyRenames(ctx, normalisedBase, localItems, canvasItems);
  ctx.baseRows = normalisedBase.rows;

  const contexts = buildModuleContexts(
    normalisedBase,
    localModules,
    canvasModules,
    // A Canvas module nothing links to a local folder has no folder to restrict
    // on, so `-m` excludes it rather than guessing that it was meant.
  ).filter((mc) =>
    mc.folder === null ? ctx.policy.modules === null : ctx.included(mc.folder),
  );

  // Base rows follow their current path, not the module the state files them
  // under: a rename that crossed a module folder has already moved them.
  const byFolder = new Map(
    contexts.filter((mc) => mc.folder !== null).map((mc) => [mc.folder, mc]),
  );
  for (const entry of normalisedBase.rows.values()) {
    const mc = byFolder.get(folderOf(entry.itemPath));
    if (mc) mc.baseRows.push(entry);
  }
  for (const mc of contexts) {
    if (!mc.baseModule) continue;
    const here = new Set(mc.baseRows.map((entry) => entry.itemPath));
    mc.baseOrder = mc.baseModule.order.filter((itemPath) => here.has(itemPath));
    for (const entry of mc.baseRows) {
      if (!mc.baseOrder.includes(entry.itemPath))
        mc.baseOrder.push(entry.itemPath);
    }
  }

  detectCollisions(ctx, contexts);
  for (const mc of contexts) planModule(ctx, mc);

  // Both lists in execution order, and `withheld` for the same reason as
  // `actions`: under `status` it *is* the action list, and a preview whose
  // order differs from the run it previews is not a preview.
  const byRank = (a, b) => ACTION_RANK[a.type] - ACTION_RANK[b.type];
  ctx.report.actions.sort(byRank);
  ctx.report.withheld.sort(byRank);
  return ctx.report;
}

module.exports = {
  ACTION_RANK,
  ACTION_SIDES,
  plan,
};
