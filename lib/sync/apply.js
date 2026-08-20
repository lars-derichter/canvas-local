const fs = require('fs');
const path = require('path');

const {
  createModule,
  createModuleItem,
  deleteModule: deleteCanvasModule,
  deleteModuleItem,
  updateModule,
  updateModuleItem,
} = require('../canvas/modules');
const { deletePage, getPage } = require('../canvas/pages');
const { deleteAssignment, getAssignment } = require('../canvas/assignments');
const { deleteDiscussion, getDiscussion } = require('../canvas/discussions');
const { deleteFile, downloadFile, uploadFile } = require('../canvas/files');
const { ensureIcons, getIconUrls } = require('../canvas/icons');
const { loadCourseConfig } = require('../config/course-config');
const { markdownToHtml } = require('../convert/markdown-to-html');
const { canvasItemToMarkdown } = require('../convert/html-to-markdown');
const {
  parseFrontmatter,
  serializeFrontmatter,
} = require('../convert/frontmatter');
const {
  buildFileMap,
  buildLinkMap,
  extractFileReferences,
  resolveCanvasLink,
  resolveRelativeLink,
} = require('../convert/link-resolver');
const {
  canvasFingerprint,
  hashBinaryFile,
  hashText,
} = require('./fingerprint');
const { localFileHash, subHeaderHash } = require('./gather');
const {
  deleteItem,
  deleteModule: deleteModuleFromState,
  ensureModule,
  getItem,
  getModule,
  renamePaths,
  saveState,
  setItem,
  toPosixPath,
} = require('./state');
const { toFileSlug } = require('../../cli/naming');

/**
 * Reconcile the item list of one Canvas module instead of rebuilding it.
 *
 * Push used to clear a module and recreate every item in it on each run, and
 * that one line cost four things: every module item id changed, so a
 * `/courses/:id/modules/items/:id` link handed to students went stale on the
 * next push; anything in the module that push had not created was destroyed,
 * which is why a whole refusal apparatus existed to stop the push before it got
 * there; a run that changed nothing still issued a DELETE and a POST per item;
 * and `updateModuleItem` never had a caller.
 *
 * Reconciling replaces all of that with one decision, split in two so the
 * decision can be tested without a network anywhere near it:
 *
 * - `reconcileModuleItems` is pure. It takes what Canvas holds and what the
 *   module should hold, and answers what to create, what to update, what is
 *   already right, and what nothing local accounts for.
 * - `applyModuleItems` is the only half that talks to Canvas, and it issues
 *   exactly what the decision says and nothing else.
 *
 * The invariant the whole thing exists for: an item whose title, position and
 * indent already agree with the local tree gets no request at all.
 *
 * Nothing here deletes. A live item no desired item claimed comes back as
 * `leftover` for the caller to report by name; taking it out of the module is
 * an explicit act, never a side effect of pushing.
 */

/**
 * What identifies each module item type, on the Canvas side and on ours.
 *
 * Position is deliberately absent. Matching on position is what makes one
 * inserted item renumber every item after it into a fresh set of ids; matching
 * on the identity Canvas itself carries is what keeps those ids stable across
 * runs. The names differ per side because Canvas answers in snake_case and
 * `createModuleItem` takes camelCase, but they name the same thing.
 *
 * Each type lists its identities most reliable first, and a slot only ever
 * matches the same slot on the other side — an id is compared to an id and a
 * slug to a slug, never across. Only a page needs two: Canvas regenerates a
 * page's slug from its title, so a renamed page turns up under a slug neither
 * side agrees on any more, while the wiki page id behind it never moves. Recent
 * Canvas returns that id as `content_id` on a Page module item; the slug stays
 * as the fallback for instances that do not.
 *
 * A SubHeader is the one type with no Canvas object behind it — it is a label
 * and nothing more — so its title is the only thing left to match on. Two
 * subheaders under one title, or two external URLs on one launch URL, are
 * therefore indistinguishable, and are matched in order of appearance. That is
 * a tie-break, not an identity: it keeps the common case (nothing moved) free of
 * churn, and nothing in the data can tell a renamed subheader apart from a new
 * one, so a rename reads as a create plus a leftover.
 */
const ITEM_IDENTITY = {
  Page: {
    desired: (item) => [item.pageId, item.pageUrl],
    live: (item) => [item.content_id, item.page_url],
  },
  Assignment: {
    desired: (item) => [item.contentId],
    live: (item) => [item.content_id],
  },
  Discussion: {
    desired: (item) => [item.contentId],
    live: (item) => [item.content_id],
  },
  Quiz: {
    desired: (item) => [item.contentId],
    live: (item) => [item.content_id],
  },
  File: {
    desired: (item) => [item.contentId],
    live: (item) => [item.content_id],
  },
  ExternalUrl: {
    desired: (item) => [item.externalUrl],
    live: (item) => [item.external_url],
  },
  ExternalTool: {
    desired: (item) => [item.externalUrl],
    live: (item) => [item.external_url],
  },
  SubHeader: { desired: (item) => [item.title], live: (item) => [item.title] },
};

/**
 * The fields of a module item the local tree owns, and where each side keeps
 * them.
 *
 * Everything else about an item is either its identity (matched above, never
 * updated — changing it makes a different item, which is why an edited launch
 * URL reads as a new link plus a leftover rather than an edit in place) or
 * Canvas's own business.
 *
 * An undefined value on the desired side means the local tree has no opinion,
 * not "unset it": `createModuleItem` leaves such a field out of the payload
 * entirely, so an update has nothing to say about it either. `types` narrows a
 * field to the item types that carry it at all, and `absentMeansUnknown` says
 * that Canvas leaving the field out is not a value to compare against.
 */
const COMPARED_FIELDS = [
  {
    name: 'title',
    desired: (item) => item.title,
    live: (item) => item.title,
    normalise: (value) => (value == null ? '' : String(value)),
  },
  {
    name: 'position',
    desired: (item) => item.position,
    live: (item) => item.position,
    normalise: (value) => (value == null ? null : Number(value)),
  },
  {
    name: 'indent',
    desired: (item) => item.indent,
    live: (item) => item.indent,
    // Canvas omits indent on an item that has none, and means 0 by it.
    normalise: (value) => (value == null ? 0 : Number(value)),
  },
  {
    name: 'newTab',
    desired: (item) => item.newTab,
    live: (item) => item.new_tab,
    normalise: (value) => Boolean(value),
    types: ['ExternalUrl', 'ExternalTool'],
    // Unlike indent, an absent new_tab has no documented default to read it as.
    // The desired side is `frontmatter.new_tab !== false`, so it says `true`
    // whenever the author said nothing — and reading an unreported new_tab as
    // `false` would make those two disagree forever, issuing a PUT that changes
    // nothing on every single push. Declining to guess costs at worst one
    // missed flip, which the next real edit to the item carries anyway.
    absentMeansUnknown: true,
  },
];

/**
 * Every identity one item carries, in preference order, as strings scoped both
 * to the item type and to the slot they came from — so an id is only ever
 * compared to an id.
 *
 * Push needs these across modules as well as within one: an item that vanished
 * from module A is recognisable as the one module B just claimed only by
 * comparing exactly these keys.
 *
 * @param {object} item            - A live Canvas item or a desired one.
 * @param {'live'|'desired'} side  - Which vocabulary `item` speaks.
 * @returns {string[]} Possibly empty: an unknown type identifies nothing.
 */
function moduleItemKeys(item, side) {
  if (!item) return [];
  const identity = ITEM_IDENTITY[item.type];
  if (!identity) return [];
  const keys = [];
  identity[side](item).forEach((value, slot) => {
    if (value == null) return;
    keys.push(`${item.type} ${slot} ${value}`);
  });
  return keys;
}

/**
 * Take the first live item still going spare under any of these keys.
 *
 * Keys are tried in preference order, so a page matches on its id before its
 * slug; within one key the queue is in Canvas order, which is the tie-break for
 * the types whose key is not unique. An item already claimed through one of its
 * other keys is skipped, and dropped from this queue too — it is spoken for
 * either way.
 */
function claimLiveItem(queues, claimed, keys) {
  for (const key of keys) {
    const queue = queues.get(key);
    if (!queue) continue;
    while (queue.length > 0) {
      const candidate = queue.shift();
      if (claimed.has(candidate)) continue;
      claimed.add(candidate);
      return candidate;
    }
  }
  return null;
}

/**
 * The fields that have to change on a live item for it to match what the local
 * tree wants, as `updateModuleItem` takes them. An empty object means the item
 * is already right, and that is what buys the no-op push.
 */
function diffModuleItem(desired, live) {
  const changes = {};
  for (const field of COMPARED_FIELDS) {
    if (field.types && !field.types.includes(desired.type)) continue;
    const wanted = field.desired(desired);
    if (wanted === undefined) continue;
    const held = field.live(live);
    if (held == null && field.absentMeansUnknown) continue;
    if (field.normalise(wanted) === field.normalise(held)) continue;
    changes[field.name] = wanted;
  }
  return changes;
}

/**
 * Decide what has to happen to a module's item list. Pure: no I/O, no clock, no
 * mutation of either input.
 *
 * A live item is consumed the moment a desired item matches it, so two desired
 * items can never claim the same one — the second finds the queue empty and
 * counts as a create. A live item of a type this version does not know carries
 * no identity here, so it can never be matched, and lands in `leftover` with
 * everything else nothing claimed.
 *
 * Every result entry carries the `index` of its desired item, which is what
 * lets the executor issue its calls in the order the module should end up in.
 *
 * @param {object} input
 * @param {object[]} [input.live]    - What `listModuleItems` returned.
 * @param {object[]} [input.desired] - What the module should contain, in order,
 *                                     each shaped as `createModuleItem` opts.
 * @returns {{create: object[], update: object[], unchanged: object[], leftover: object[]}}
 */
function reconcileModuleItems({ live = [], desired = [] } = {}) {
  const queues = new Map();
  for (const item of live || []) {
    for (const key of moduleItemKeys(item, 'live')) {
      if (!queues.has(key)) queues.set(key, []);
      queues.get(key).push(item);
    }
  }

  const claimed = new Set();
  const create = [];
  const update = [];
  const unchanged = [];

  (desired || []).forEach((want, index) => {
    const match = claimLiveItem(
      queues,
      claimed,
      moduleItemKeys(want, 'desired'),
    );

    if (!match) {
      create.push({ index, desired: want });
      return;
    }

    const changes = diffModuleItem(want, match);
    if (Object.keys(changes).length === 0) {
      unchanged.push({ index, desired: want, live: match });
    } else {
      update.push({ index, desired: want, live: match, changes });
    }
  });

  const leftover = (live || []).filter((item) => !claimed.has(item));
  return { create, update, unchanged, leftover };
}

/**
 * Issue what the reconcile decided, and nothing more.
 *
 * Creates and updates go out in the order the module should end up in, which is
 * what makes the positions land: Canvas shifts the items at or after the
 * position it is given, so placing each item in ascending order never disturbs
 * one already placed. An `unchanged` item is skipped entirely — that is the
 * whole point — and a `leftover` one is passed straight through untouched.
 *
 * One failed item does not cost the rest of the module: the failure is recorded
 * and the walk carries on, the same resilience push has always had per item.
 *
 * @param {string|number} courseId
 * @param {string|number} moduleId
 * @param {object} plan            - What `reconcileModuleItems` returned.
 * @param {object} [deps]          - Injection points for tests.
 * @returns {Promise<{placed: object[], leftover: object[], errors: object[]}>}
 *          `placed` holds `{index, desired, id, action}` for every desired item
 *          that ended up in the module, in order, so the caller can record the
 *          Canvas ids; `errors` holds `{index, desired, action, error}`.
 */
async function applyModuleItems(
  courseId,
  moduleId,
  plan,
  { createItem = createModuleItem, updateItem = updateModuleItem } = {},
) {
  const actions = [
    ...plan.create.map((entry) => ({ ...entry, action: 'create' })),
    ...plan.update.map((entry) => ({ ...entry, action: 'update' })),
  ].sort((a, b) => a.index - b.index);

  const placed = plan.unchanged.map((entry) => ({
    index: entry.index,
    desired: entry.desired,
    id: entry.live.id,
    action: 'unchanged',
  }));
  const errors = [];

  for (const entry of actions) {
    try {
      if (entry.action === 'create') {
        const result = await createItem(courseId, moduleId, entry.desired);
        placed.push({
          index: entry.index,
          desired: entry.desired,
          id: result && result.id != null ? result.id : null,
          action: 'create',
        });
      } else {
        await updateItem(courseId, moduleId, entry.live.id, entry.changes);
        placed.push({
          index: entry.index,
          desired: entry.desired,
          id: entry.live.id,
          action: 'update',
        });
      }
    } catch (err) {
      errors.push({
        index: entry.index,
        desired: entry.desired,
        action: entry.action,
        error: err.message,
      });
    }
  }

  placed.sort((a, b) => a.index - b.index);
  return { placed, leftover: plan.leftover, errors };
}

/** One leftover item, named as someone has to find it back in Canvas. */
function describeLeftoverItem(item) {
  const title = item.title || '(untitled)';
  const where = item.position != null ? `, position ${item.position}` : '';
  const link = item.html_url ? ` — ${item.html_url}` : '';
  return `  - "${title}" (${item.type}${where})${link}`;
}

// ---------------------------------------------------------------------------
// Executing a plan
// ---------------------------------------------------------------------------

/**
 * Run the action list `lib/sync/plan.js` produced, in the order it was given.
 *
 * The order is not a suggestion and this never re-sorts it: the planner's ranks
 * already encode every dependency there is — re-keys before anything names a
 * path, creates before the reorder that places them, item deletes before the
 * module delete that would 404 them, base rows dropped last. Reordering here
 * would silently undo all of that.
 *
 * **The invariant that governs the whole rework lives in this file**: after any
 * write, in either direction, the resulting fingerprint is recorded for *both*
 * sides — `canvas_hash` from the API response to the write, `local_hash` from
 * the bytes that were written, never from a re-read. Record one and not the
 * other and the two sides ping-pong forever, each reading the other's write as
 * a change it has to answer. Every write path below ends in `recordRow`, and
 * the test that matters is that a second `plan()` over the state this leaves
 * behind produces an empty action list.
 *
 * Failures are collected per action and the run carries on, the way
 * `applyModuleItems` already does. A sync that dies in the middle would leave
 * Canvas half written and the state describing neither side, so the state is
 * saved at the end and after a failure alike.
 */

/** Canvas's own name for each of this project's types. */
const CANVAS_ITEM_TYPES = {
  page: 'Page',
  assignment: 'Assignment',
  discussion: 'Discussion',
  quiz: 'Quiz',
  sub_header: 'SubHeader',
  external_url: 'ExternalUrl',
  external_tool: 'ExternalTool',
  file: 'File',
};

/** The types with no Canvas object behind the module item. */
const REFERENCE_TYPES = new Set([
  'quiz',
  'sub_header',
  'external_url',
  'external_tool',
]);

/** The three types whose body is authored markdown, and so can hold a callout. */
const CONTENT_TYPES = new Set(['page', 'assignment', 'discussion']);

/**
 * Whether this run will render markdown into Canvas HTML, which is the only
 * thing the alert icons are for.
 *
 * A pull-only or local-only run must issue no upload at all: the icons are
 * files in the Canvas course, and a run that writes nothing there has no
 * business putting anything in it. Only the three authored types go through
 * `markdownToHtml` — a link, a quiz, a text header and a file never do.
 */
function needsAlertIcons(plan) {
  return (plan.actions || []).some(
    (action) =>
      (action.type === 'create-canvas-item' ||
        action.type === 'update-canvas-item') &&
      CONTENT_TYPES.has(action.canvasType),
  );
}

/**
 * The three content strategies, and the file resolver, borrowed from push.
 *
 * Required lazily and on purpose: `cli/push.js` requires *this* module for
 * `reconcileModuleItems`, so requiring it back at load time would hand us a
 * half-initialised module whose exports are not attached yet. By the time an
 * action runs, both files are fully loaded, so the cycle never forms.
 *
 * They are borrowed rather than copied because they are the definition of what
 * this tool sends Canvas per type; a second copy would be a second answer, and
 * the two would drift the first time an assignment gained a field.
 */
function pushInternals() {
  return require('../../cli/push');
}

/** The local-write helpers pull already owns, borrowed for the same reason. */
function pullInternals() {
  return require('../../cli/pull');
}

function contentStrategy(canvasType) {
  const push = pushInternals();
  return {
    page: push._pageStrategy,
    assignment: push._assignmentStrategy,
    discussion: push._discussionStrategy,
  }[canvasType];
}

/** Everything one run of `applyPlan` carries around, assembled once. */
function createContext(plan, options) {
  const ctx = {
    plan,
    courseId: options.courseId,
    courseDir: options.courseDir,
    state: options.state,
    canvasContent: options.canvasContent || new Map(),
    save: options.save || ((state) => saveState(state)),
    now: options.now || (() => new Date().toISOString()),
    log: options.log || {
      info: () => {},
      warn: () => {},
      verbose: () => {},
      error: () => {},
    },
    applied: [],
    errors: [],
    // Items whose markdown referenced a page that did not exist yet when they
    // were written; revisited once the run has created everything.
    unresolved: new Map(),
    maps: null,
  };

  // The link map is derived from the state, and the state changes under every
  // create, so it is rebuilt on demand rather than held. Cheap: it walks rows
  // already in memory.
  ctx.invalidate = () => {
    ctx.maps = null;
  };
  ctx.linkMaps = () => {
    if (!ctx.maps) {
      ctx.maps = {
        ...buildLinkMap(ctx.state),
        ...buildFileMap(ctx.state),
      };
    }
    return ctx.maps;
  };
  ctx.iconUrls = getIconUrls(ctx.state);
  ctx.labels = loadCourseConfig().labels;
  return ctx;
}

/** The absolute path of a repo-relative item path. */
function absolutePath(ctx, itemPath) {
  return path.join(ctx.courseDir, itemPath);
}

/**
 * The Canvas module id an action should be issued against.
 *
 * The planner fills in what it knew when it planned, which for a module created
 * in this same run is nothing — the id did not exist yet. The state is what
 * learned it, a few actions ago, so it answers whatever the plan could not.
 */
function moduleIdFor(ctx, action) {
  if (action.canvasModuleId != null) return action.canvasModuleId;
  const entry = getModule(ctx.state, action.folder);
  return entry && entry.canvas_module_id != null
    ? entry.canvas_module_id
    : null;
}

/** The module item id recorded for a path, for an action planned before it existed. */
function moduleItemIdFor(ctx, action) {
  if (action.moduleItemId != null) return action.moduleItemId;
  const found = getItem(ctx.state, action.itemPath);
  return found && found.entry.module_item_id != null
    ? found.entry.module_item_id
    : null;
}

/**
 * Write one item's row, stamping both fingerprints and the moment.
 *
 * Every write in this file ends here. Fields the caller did not resolve keep
 * whatever the previous sync recorded — blanking a hash this run never computed
 * would make the next one call the item changed.
 */
function recordRow(ctx, folder, itemPath, fields) {
  ensureModule(ctx.state, folder, {});
  const previous = getItem(ctx.state, itemPath);
  const entry = previous ? { ...previous.entry } : {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) entry[key] = value;
  }
  entry.synced_at = ctx.now();
  const stored = setItem(ctx.state, folder, itemPath, entry);
  ctx.invalidate();
  return stored;
}

/** The local file's fingerprint, chosen by extension the way `gather` chooses it. */
function localHashOf(ctx, itemPath) {
  try {
    return localFileHash(absolutePath(ctx, itemPath), itemPath);
  } catch {
    return undefined;
  }
}

/** The frontmatter of a local markdown item, or an empty object. */
function frontmatterOf(ctx, itemPath) {
  try {
    return (
      parseFrontmatter(fs.readFileSync(absolutePath(ctx, itemPath), 'utf8'))
        .data || {}
    );
  } catch {
    return {};
  }
}

/**
 * Write `title:` into a markdown item's frontmatter when it has none.
 *
 * This is what makes "the filename is the address, `title:` is the display
 * name" true rather than aspirational. Without it the scanner falls back to the
 * de-prefixed filename, so renaming a file silently renames the Canvas item it
 * created — and `renumber` renames files by the dozen. Writing the title once,
 * at the moment sync creates or adopts the Canvas object, breaks that coupling
 * for good.
 *
 * A file that already declares one is left exactly as it is: the author's title
 * is the author's, and rewriting it would be sync deciding what their item is
 * called.
 *
 * It runs *after* the content write and before the row is recorded, so the
 * `local_hash` on that row describes the file including the line this just
 * added. The other order would leave every created item reading as changed
 * locally on the very next run. It is safe to run after the push because
 * `markdownToHtml` strips frontmatter, so the byte this adds never reaches the
 * HTML Canvas was handed.
 *
 * @returns {boolean} Whether a title was written.
 */
function writeTitleIfAbsent(ctx, itemPath, title) {
  if (!itemPath.endsWith('.md') || title == null) return false;
  const absolute = absolutePath(ctx, itemPath);
  try {
    const { data, content } = parseFrontmatter(
      fs.readFileSync(absolute, 'utf8'),
    );
    if (data.title != null) return false;
    // The key goes first in the block: it is the one an author reads.
    fs.writeFileSync(
      absolute,
      serializeFrontmatter({ title, ...data }, content),
      'utf8',
    );
    ctx.log.verbose(`Wrote title "${title}" to ${itemPath}`);
    return true;
  } catch (err) {
    ctx.log.warn(
      `  [sync] Could not write the title into ${itemPath}: ${err.message}`,
    );
    return false;
  }
}

// ---------------------------------------------------------------------------
// Canvas-side writes
// ---------------------------------------------------------------------------

/**
 * Upload every binary a markdown item embeds that Canvas does not already hold
 * the current version of.
 *
 * Keyed on the file's own hash rather than its mtime, so a clone — which
 * rewrites every mtime — does not re-upload the whole course, and an edited
 * image does.
 */
async function uploadEmbeddedFiles(ctx, itemPath, raw, folder) {
  if (!ctx.state.files) ctx.state.files = {};
  for (const ref of extractFileReferences(raw, itemPath)) {
    const localPath = absolutePath(ctx, ref);
    if (!fs.existsSync(localPath)) {
      ctx.log.warn(`  [sync] Referenced file not found: ${ref}`);
      continue;
    }
    const hash = hashBinaryFile(localPath);
    const tracked = ctx.state.files[ref];
    if (tracked && tracked.sha256 === hash) continue;

    const result = await uploadFile(ctx.courseId, localPath, {
      parentFolderPath: folder,
    });
    ctx.state.files[ref] = {
      canvas_file_id: result.id,
      canvas_url: `/courses/${ctx.courseId}/files/${result.id}/preview`,
      sha256: hash,
    };
    ctx.invalidate();
  }
}

/**
 * A markdown item as the HTML Canvas should hold, with its internal links
 * resolved against what the state knows so far.
 *
 * `unresolved` says the item linked to another item this run has not created
 * yet. The caller notes it and comes back at the end — the same second pass
 * push has always made, and it has to re-record the fingerprint when it does,
 * or the second write reads as a Canvas-side change forever after.
 */
function renderForCanvas(ctx, itemPath, raw) {
  const { relativeToCanvas } = ctx.linkMaps();
  let unresolved = false;
  const linkResolver = (href) => {
    const { resolved, wasInternal } = resolveRelativeLink(
      href,
      itemPath,
      relativeToCanvas,
      ctx.courseId,
    );
    if (wasInternal) unresolved = true;
    return resolved;
  };
  const fileResolver = pushInternals()._buildFileResolver(itemPath, ctx.state);
  const html = markdownToHtml(raw, {
    iconUrls: ctx.iconUrls,
    alertTitles: ctx.labels.alerts,
    linkResolver,
    fileResolver,
  });
  return { html, unresolved };
}

/**
 * Push a page, assignment or discussion's content and hand back what Canvas
 * stored, which is what the fingerprint is taken from.
 *
 * The response and not the request: Canvas rewrites markup it is handed, so
 * hashing what was sent would leave a baseline no later read ever matches, and
 * every sync after this one would report a remote change nobody made.
 */
async function writeContent(ctx, action, { canvasId, folder }) {
  const strategy = contentStrategy(action.canvasType);
  const itemPath = action.itemPath;
  const raw = fs.readFileSync(absolutePath(ctx, itemPath), 'utf8');
  const frontmatter = frontmatterOf(ctx, itemPath);

  await uploadEmbeddedFiles(ctx, itemPath, raw, folder);
  const { html, unresolved } = renderForCanvas(ctx, itemPath, raw);
  const opts = strategy.buildOpts(action.title, html, frontmatter);

  let result;
  if (canvasId != null) {
    try {
      result = await strategy.update(ctx.courseId, canvasId, opts);
    } catch (err) {
      if (!String(err.message).includes('404')) throw err;
      ctx.log.warn(
        `  [sync] ${strategy.label} ${canvasId} is gone from Canvas; creating it again.`,
      );
      result = await strategy.create(ctx.courseId, opts);
    }
  } else {
    result = await strategy.create(ctx.courseId, opts);
  }

  return {
    result,
    raw,
    frontmatter,
    unresolved,
    canvasId: strategy.extractId(result),
    pageUrl: strategy.extractSlug ? strategy.extractSlug(result) : null,
  };
}

/** What `createModuleItem` needs for this type, beyond the common fields. */
function moduleItemIdentity(canvasType, { canvasId, pageUrl, frontmatter }) {
  if (canvasType === 'page') return { pageUrl };
  if (canvasType === 'sub_header') return {};
  if (canvasType === 'external_url' || canvasType === 'external_tool') {
    return {
      externalUrl: frontmatter.external_url,
      ...newTabOf(canvasType, frontmatter),
    };
  }
  return { contentId: canvasId };
}

/**
 * What to say about `new_tab`, which the two link types answer differently —
 * push's distinction, kept rather than tidied away.
 *
 * An external URL is this project's own creation, so a frontmatter that says
 * nothing means "open in a new tab" and that is sent. An LTI link points at a
 * tool this project did not install, and Canvas does not report `new_tab`
 * reliably for one, so an author who said nothing gets nothing sent — guessing
 * would issue a PUT that changes nothing on every single run.
 */
function newTabOf(canvasType, frontmatter) {
  if (canvasType === 'external_url') {
    return { newTab: frontmatter.new_tab !== false };
  }
  return frontmatter.new_tab != null ? { newTab: frontmatter.new_tab } : {};
}

/** Upload the binary an item of type `file` stands for, and say which file it is. */
async function writeFileContent(ctx, action, folder) {
  const itemPath = action.itemPath;
  const absolute = absolutePath(ctx, itemPath);
  let binary = absolute;
  if (itemPath.endsWith('.md')) {
    const frontmatter = frontmatterOf(ctx, itemPath);
    if (!frontmatter.file_ref) {
      throw new Error(
        `${itemPath} is a file item but its frontmatter names no file_ref, so ` +
          'there is no binary to upload.',
      );
    }
    binary = path.resolve(path.dirname(absolute), frontmatter.file_ref);
  }
  const result = await uploadFile(ctx.courseId, binary, {
    parentFolderPath: folder,
  });
  return result;
}

/**
 * Record what a Canvas-side write settled, for both sides at once.
 *
 * `canvas_hash` is rebuilt from the module item Canvas handed back and the
 * content object it stored; `local_hash` from the file as it sits on disk,
 * which is the file that produced the write.
 */
function recordCanvasWrite(ctx, action, { item, content, canvasId, pageUrl }) {
  const canvasType = action.canvasType;
  let canvasHash;
  try {
    canvasHash = canvasFingerprint({ item, content }, canvasType);
  } catch (err) {
    ctx.log.verbose(`No fingerprint for ${action.itemPath}: ${err.message}`);
  }

  recordRow(ctx, action.folder, action.itemPath, {
    canvas_type: canvasType,
    canvas_id: canvasId ?? undefined,
    page_url: pageUrl ?? undefined,
    module_item_id: item && item.id != null ? item.id : undefined,
    title: item && item.title != null ? item.title : action.title,
    external_url:
      item && item.external_url != null ? item.external_url : undefined,
    local_hash:
      canvasType === 'sub_header'
        ? subHeaderHash({ title: action.title, indent: action.indent })
        : localHashOf(ctx, action.itemPath),
    canvas_hash: canvasHash,
    canvas_updated_at:
      content && content.updated_at ? content.updated_at : null,
  });
}

async function createCanvasItem(ctx, action) {
  const moduleId = moduleIdFor(ctx, action);
  if (moduleId == null) {
    throw new Error(
      `no Canvas module id for ${action.folder}; the module was not created.`,
    );
  }

  const canvasType = action.canvasType;
  const common = {
    title: action.title,
    type: CANVAS_ITEM_TYPES[canvasType],
    position: action.position ?? undefined,
    indent: action.indent ?? undefined,
  };

  if (!common.type) {
    throw new Error(
      `${action.itemPath} declares canvas_type "${canvasType}", which Canvas ` +
        'has no module item type for.',
    );
  }

  let content = null;
  let canvasId = null;
  let pageUrl = null;
  let frontmatter = frontmatterOf(ctx, action.itemPath);
  let unresolved = false;

  if (
    canvasType === 'page' ||
    canvasType === 'assignment' ||
    canvasType === 'discussion'
  ) {
    const written = await writeContent(ctx, action, {
      canvasId: null,
      folder: action.folder,
    });
    content = written.result;
    canvasId = written.canvasId;
    pageUrl = written.pageUrl;
    frontmatter = written.frontmatter;
    unresolved = written.unresolved;
  } else if (canvasType === 'file') {
    content = await writeFileContent(ctx, action, action.folder);
    canvasId = content.id;
  } else if (canvasType === 'quiz') {
    // Which quiz an item names is resolved against the course's quiz list, by
    // id and then by title — push's rule, kept whole because it is the one that
    // survives a QTI package being imported twice.
    const descriptor = await pushInternals()._pushQuiz(
      ctx.courseId,
      {
        title: action.title,
        canvasId: null,
        position: action.position,
        indent: action.indent,
        frontmatter,
      },
      false,
    );
    if (!descriptor) return;
    canvasId = descriptor.contentId;
  } else if (canvasType === 'external_tool') {
    const descriptor = await pushInternals()._pushExternalTool(
      ctx.courseId,
      {
        title: action.title,
        position: action.position,
        indent: action.indent,
        frontmatter,
      },
      false,
    );
    if (!descriptor) return;
  } else if (canvasType === 'external_url' && !frontmatter.external_url) {
    throw new Error(
      `${action.itemPath} declares canvas_type external_url but names no ` +
        'external_url in its frontmatter.',
    );
  }

  const item = await createModuleItem(ctx.courseId, moduleId, {
    ...common,
    ...moduleItemIdentity(canvasType, { canvasId, pageUrl, frontmatter }),
  });

  if (REFERENCE_TYPES.has(canvasType) && canvasType !== 'quiz') {
    // The module item is the whole of these, so it is also their content id.
    canvasId = canvasType === 'sub_header' ? null : item.id;
  }

  // Before the row is recorded, so `local_hash` describes the file as it now is.
  writeTitleIfAbsent(ctx, action.itemPath, action.title);
  recordCanvasWrite(ctx, action, { item, content, canvasId, pageUrl });
  if (unresolved) ctx.unresolved.set(action.itemPath, action);
}

/**
 * Bring the module item in line with the local file, and only when it is not
 * already: a PUT that changes nothing is a request the no-op sync must not make.
 */
async function alignModuleItem(ctx, moduleId, moduleItemId, wanted) {
  if (moduleItemId == null) return null;
  const cached = ctx.canvasContent.get(String(moduleItemId));
  const live = cached ? cached.item : null;
  const changes = {};
  if (live == null || String(live.title ?? '') !== String(wanted.title ?? '')) {
    changes.title = wanted.title;
  }
  if (live == null || Number(live.indent ?? 0) !== Number(wanted.indent ?? 0)) {
    changes.indent = wanted.indent ?? 0;
  }
  if (
    wanted.externalUrl !== undefined &&
    (live == null || live.external_url !== wanted.externalUrl)
  ) {
    changes.externalUrl = wanted.externalUrl;
  }
  if (
    wanted.newTab !== undefined &&
    live != null &&
    Boolean(live.new_tab) !== Boolean(wanted.newTab)
  ) {
    changes.newTab = wanted.newTab;
  }
  if (Object.keys(changes).length === 0) return live;
  return updateModuleItem(ctx.courseId, moduleId, moduleItemId, changes);
}

async function updateCanvasItem(ctx, action) {
  const moduleId = moduleIdFor(ctx, action);
  const moduleItemId = moduleItemIdFor(ctx, action);
  const canvasType = action.canvasType;
  let content = null;
  let canvasId = action.canvasId ?? null;
  let pageUrl = action.pageUrl ?? null;
  let frontmatter = frontmatterOf(ctx, action.itemPath);
  let unresolved = false;

  if (
    canvasType === 'page' ||
    canvasType === 'assignment' ||
    canvasType === 'discussion'
  ) {
    const written = await writeContent(ctx, action, {
      canvasId,
      folder: action.folder,
    });
    content = written.result;
    canvasId = written.canvasId;
    pageUrl = written.pageUrl;
    frontmatter = written.frontmatter;
    unresolved = written.unresolved;
  } else if (canvasType === 'file') {
    content = await writeFileContent(ctx, action, action.folder);
    if (canvasId != null && String(content.id) !== String(canvasId)) {
      // A renamed binary lands as a new Canvas file, so the item has to point
      // somewhere else — and a module item's content id cannot be changed.
      if (moduleItemId != null) {
        await deleteModuleItem(ctx.courseId, moduleId, moduleItemId);
      }
      const replacement = await createModuleItem(ctx.courseId, moduleId, {
        title: action.title,
        type: 'File',
        contentId: content.id,
        indent: action.indent ?? undefined,
      });
      recordCanvasWrite(ctx, action, {
        item: replacement,
        content,
        canvasId: content.id,
        pageUrl: null,
      });
      return;
    }
    canvasId = content.id;
  }

  const item = await alignModuleItem(ctx, moduleId, moduleItemId, {
    title: action.title,
    indent: action.indent,
    ...(canvasType === 'external_url' || canvasType === 'external_tool'
      ? {
          externalUrl: frontmatter.external_url,
          ...newTabOf(canvasType, frontmatter),
        }
      : {}),
  });

  recordCanvasWrite(ctx, action, {
    item: item || {
      id: moduleItemId,
      title: action.title,
      indent: action.indent,
    },
    content,
    canvasId,
    pageUrl,
  });
  if (unresolved) ctx.unresolved.set(action.itemPath, action);
}

/**
 * Move a module item into another module without touching what it points at.
 *
 * Canvas takes the target module on the item's own update endpoint, so the item
 * keeps its id — which is the whole point of this rework, and the reason this
 * is not a delete followed by a create.
 */
async function moveCanvasItem(ctx, action) {
  const moduleItemId = moduleItemIdFor(ctx, action);
  if (moduleItemId == null) return;
  const target =
    action.toCanvasModuleId ??
    (getModule(ctx.state, action.toFolder) || {}).canvas_module_id;
  if (target == null) {
    throw new Error(`no Canvas module id for ${action.toFolder}.`);
  }
  await updateModuleItem(
    ctx.courseId,
    action.fromCanvasModuleId,
    moduleItemId,
    {
      moduleId: target,
      position: action.position ?? undefined,
      indent: action.indent ?? undefined,
    },
  );
  recordRow(ctx, action.toFolder, action.itemPath, {
    module_item_id: moduleItemId,
  });
}

async function deleteCanvasItem(ctx, action) {
  const canvasType = action.canvasType;
  const moduleId = moduleIdFor(ctx, action);
  const moduleItemId = moduleItemIdFor(ctx, action);

  try {
    if (canvasType === 'page') {
      await deletePage(ctx.courseId, action.pageUrl || action.canvasId);
    } else if (canvasType === 'assignment') {
      // An assignment id can name a quiz. Deleting it would take the quiz and
      // every submission in it, so that one is refused rather than done.
      const refusal = await pushInternals()._refuseQuizBackedDelete(
        ctx.courseId,
        { canvasId: action.canvasId, relativePath: action.itemPath },
      );
      if (refusal) throw new Error(refusal.error);
      await deleteAssignment(ctx.courseId, action.canvasId);
    } else if (canvasType === 'discussion') {
      await deleteDiscussion(ctx.courseId, action.canvasId);
    } else if (canvasType === 'file') {
      await deleteFile(action.canvasId);
    } else if (moduleItemId != null) {
      // A quiz, a link or a text header: the module item is all this tool owns,
      // so removing it never reaches the quiz or the tool behind it.
      await deleteModuleItem(ctx.courseId, moduleId, moduleItemId);
    }
  } catch (err) {
    if (!String(err.message).includes('404')) throw err;
    ctx.log.verbose(`Already gone from Canvas: ${action.itemPath}`);
  }
  deleteItem(ctx.state, action.itemPath);
  ctx.invalidate();
}

async function reorderCanvasModule(ctx, action) {
  const moduleId = moduleIdFor(ctx, action);
  if (moduleId == null) return;
  // Ascending, because Canvas shifts everything at or after the position it is
  // given: placing each item in turn never disturbs one already placed.
  for (const entry of action.order) {
    const moduleItemId = moduleItemIdFor(ctx, entry);
    if (moduleItemId == null) continue;
    await updateModuleItem(ctx.courseId, moduleId, moduleItemId, {
      position: entry.position,
    });
  }
  const module = getModule(ctx.state, action.folder);
  if (module) {
    module.item_order = action.order.map((entry) =>
      toPosixPath(entry.itemPath),
    );
  }
}

// ---------------------------------------------------------------------------
// Local-side writes
// ---------------------------------------------------------------------------

/** The Canvas object behind an item, from the run's cache or, failing that, fetched. */
async function contentFor(ctx, action) {
  const cached = ctx.canvasContent.get(String(action.moduleItemId));
  if (cached && cached.content) return cached;
  const item = (cached && cached.item) || {
    id: action.moduleItemId,
    title: action.title,
    indent: action.indent,
  };
  if (action.canvasType === 'page') {
    return {
      item,
      content: await getPage(ctx.courseId, action.pageUrl ?? action.canvasId),
    };
  }
  if (action.canvasType === 'assignment') {
    return {
      item,
      content: await getAssignment(ctx.courseId, action.canvasId),
    };
  }
  if (action.canvasType === 'discussion') {
    return {
      item,
      content: await getDiscussion(ctx.courseId, action.canvasId),
    };
  }

  // A link has no object behind it: the launch URL on the module item is the
  // whole of it, and the planner's action does not carry one — `plan.js` keeps
  // only the fields it reasons about, and a URL is not one of them. The run's
  // content cache is the supported way to supply it: `gatherCanvas` puts the
  // raw module item there, URL and all, and the command always passes it.
  //
  // A caller that does not is refused rather than served. Writing the stub
  // anyway produces a file that looks like a link and points nowhere, which is
  // worse than a failed action: the next run sees a local file, reads it as
  // done, and never tries again — so the item is quietly broken for good.
  if (
    action.canvasType === 'external_url' ||
    action.canvasType === 'external_tool'
  ) {
    if (!item.external_url) {
      throw new Error(
        `cannot write ${action.itemPath}: nothing supplied the launch URL of ` +
          `this ${action.canvasType}. The Canvas module item carries it, so ` +
          "pass gatherCanvas's `content` map to applyPlan as `canvasContent`. " +
          'No file was written, because one without a URL would look like a ' +
          'link and go nowhere.',
      );
    }
  }

  return { item, content: null };
}

/** Write a text header's subfolder: the directory and the label Docusaurus reads. */
function writeLocalHeader(ctx, action) {
  const dir = absolutePath(ctx, action.itemPath);
  fs.mkdirSync(dir, { recursive: true });
  pullInternals()._writeCategoryFile(dir, action.title, action.position ?? 0);
}

/** Download the binary a File item stands for and write the wrapper that names it. */
async function writeLocalFileItem(ctx, action, item, content) {
  const absolute = absolutePath(ctx, action.itemPath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });

  const displayName = (content && content.display_name) || action.title;
  const binaryName = toFileSlug(displayName);
  const filesDir = path.join(path.dirname(absolute), '_files');
  fs.mkdirSync(filesDir, { recursive: true });
  await downloadFile(action.canvasId, path.join(filesDir, binaryName));

  const wrapper = {
    title: action.title,
    canvas_type: 'file',
    file_ref: `_files/${binaryName}`,
  };
  for (const [key, value] of Object.entries(
    frontmatterOf(ctx, action.itemPath),
  )) {
    if (key in wrapper) continue;
    wrapper[key] = value;
  }
  const markdown = serializeFrontmatter(wrapper, '');
  fs.writeFileSync(absolute, markdown, 'utf8');
  return markdown;
}

/**
 * Write one item into the working tree, and record both fingerprints for it.
 *
 * `local_hash` is taken from the markdown this produced rather than from a
 * re-read of the file: re-reading opens a window for an editor's autosave to
 * land in between, which would leave a row describing a file this never wrote.
 * `canvas_hash` is the one the gather already computed for the item — the write
 * did not change Canvas, so nothing about it can have moved.
 */
async function writeLocalItem(ctx, action) {
  const canvasType = action.canvasType;
  let markdown = null;

  if (canvasType === 'sub_header') {
    writeLocalHeader(ctx, action);
  } else {
    const { item, content } = await contentFor(ctx, action);
    if (canvasType === 'file') {
      markdown = await writeLocalFileItem(ctx, action, item, content);
    } else {
      const absolute = absolutePath(ctx, action.itemPath);
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      const maps = ctx.linkMaps();
      const body =
        (content && (content.body || content.description || content.message)) ||
        '';
      if (body) {
        await pullInternals()._downloadReferencedFiles(
          ctx.courseId,
          body,
          action.folder,
          ctx.state,
          maps.canvasToLocal,
        );
        ctx.invalidate();
      }
      markdown = canvasItemToMarkdown(
        content || {
          title: action.title,
          external_url: item.external_url,
          content_id: item.content_id,
          id: item.id,
          new_tab: item.new_tab,
        },
        canvasType,
        {
          linkResolver: (href) =>
            resolveCanvasLink(href, action.itemPath, maps.canvasToRelative),
          fileResolver: pullInternals()._createPullFileResolver(
            ctx.courseId,
            action.itemPath,
            ctx.linkMaps().canvasToLocal,
          ),
          existingFrontmatter: frontmatterOf(ctx, action.itemPath),
        },
      );
      fs.writeFileSync(absolute, markdown, 'utf8');
    }
  }

  recordRow(ctx, action.folder, action.itemPath, {
    canvas_type: canvasType,
    canvas_id: action.canvasId ?? undefined,
    page_url: action.pageUrl ?? undefined,
    module_item_id: action.moduleItemId ?? undefined,
    title: action.title,
    local_hash:
      canvasType === 'sub_header'
        ? subHeaderHash({ title: action.title, indent: action.indent })
        : hashText(markdown),
    canvas_hash: action.canvasHash ?? undefined,
    canvas_updated_at: action.canvasUpdatedAt ?? null,
  });
}

function deleteLocalItem(ctx, action) {
  fs.rmSync(absolutePath(ctx, action.itemPath), {
    recursive: true,
    force: true,
  });
  deleteItem(ctx.state, action.itemPath);
  ctx.invalidate();
}

/** The same basename under a different two-digit prefix. */
function renumberPath(itemPath, position) {
  const slash = itemPath.lastIndexOf('/');
  const dir = slash === -1 ? '' : itemPath.slice(0, slash + 1);
  const base = itemPath.slice(slash + 1).replace(/^\d+-/, '');
  return `${dir}${String(position).padStart(2, '0')}-${base}`;
}

/** A path rewritten through the renames already decided for its parents. */
function throughRemap(itemPath, remap) {
  let best = itemPath;
  for (const [from, to] of remap) {
    if (itemPath === from) return to;
    if (itemPath.startsWith(`${from}/`)) {
      best = `${to}${itemPath.slice(from.length)}`;
    }
  }
  return best;
}

/**
 * Take the module's order from Canvas, which locally means renaming files.
 *
 * The numeric prefix *is* the local order, so there is nothing else to change.
 * Parents move first — renaming a subfolder moves every path inside it — and
 * every rename lands via a temporary name, because a reorder routinely moves
 * two files into each other's slots and the second would overwrite the first.
 */
function reorderLocalModule(ctx, action) {
  const byDepth = [...action.order].sort(
    (a, b) => a.itemPath.split('/').length - b.itemPath.split('/').length,
  );

  const remap = new Map();
  const moves = [];
  for (const entry of byDepth) {
    const current = throughRemap(entry.itemPath, remap);
    const target = renumberPath(current, entry.position);
    remap.set(entry.itemPath, target);
    if (current !== target) moves.push({ from: current, to: target });
  }
  if (moves.length === 0) return;

  const parked = [];
  moves.forEach(({ from, to }, index) => {
    const source = absolutePath(ctx, from);
    if (!fs.existsSync(source)) return;
    const temp = absolutePath(
      ctx,
      `${path.posix.dirname(from)}/__ccb_order_${index}`,
    );
    fs.renameSync(source, temp);
    parked.push({ temp, from, to });
  });
  const landed = [];
  for (const { temp, from, to } of parked) {
    const destination = absolutePath(ctx, to);
    if (fs.existsSync(destination)) {
      fs.renameSync(temp, absolutePath(ctx, from));
      ctx.log.warn(
        `  [sync] Could not reorder ${from} to ${to}: something is already there.`,
      );
      continue;
    }
    fs.renameSync(temp, destination);
    landed.push({ from, to });
  }

  renamePaths(ctx.state, landed);
  const module = getModule(ctx.state, action.folder);
  if (module) {
    module.item_order = action.order.map((entry) =>
      throughRemap(entry.itemPath, remap),
    );
  }
  ctx.invalidate();
}

// ---------------------------------------------------------------------------
// The dispatch table
// ---------------------------------------------------------------------------

const HANDLERS = {
  'rekey-base': (ctx, action) => {
    renamePaths(ctx.state, [{ from: action.from, to: action.to }]);
    ctx.invalidate();
  },
  'drop-base-row': (ctx, action) => {
    deleteItem(ctx.state, action.itemPath);
    ctx.invalidate();
  },
  'drop-base-module': (ctx, action) => {
    deleteModuleFromState(ctx.state, action.folder);
    ctx.invalidate();
  },

  'create-canvas-module': async (ctx, action) => {
    const result = await createModule(ctx.courseId, {
      name: action.name,
      position: action.position,
    });
    ensureModule(ctx.state, action.folder, {
      canvas_module_id: result.id,
      name: action.name,
      position: action.position,
    });
  },
  'update-canvas-module': async (ctx, action) => {
    await updateModule(ctx.courseId, moduleIdFor(ctx, action), {
      name: action.name,
      position: action.position,
    });
    ensureModule(ctx.state, action.folder, {
      name: action.name,
      position: action.position,
    });
  },
  'delete-canvas-module': async (ctx, action) => {
    try {
      await deleteCanvasModule(ctx.courseId, moduleIdFor(ctx, action));
    } catch (err) {
      if (!String(err.message).includes('404')) throw err;
    }
    deleteModuleFromState(ctx.state, action.folder);
    ctx.invalidate();
  },

  'create-canvas-item': createCanvasItem,
  'update-canvas-item': updateCanvasItem,
  'move-canvas-item': moveCanvasItem,
  'delete-canvas-item': deleteCanvasItem,
  'reorder-canvas-module': reorderCanvasModule,

  'create-local-module': (ctx, action) => {
    const dir = absolutePath(ctx, action.folder);
    fs.mkdirSync(dir, { recursive: true });
    pullInternals()._writeCategoryFile(dir, action.name, action.position ?? 0);
    ensureModule(ctx.state, action.folder, {
      canvas_module_id: action.canvasModuleId,
      name: action.name,
      position: action.position,
    });
  },
  'update-local-module': (ctx, action) => {
    const dir = absolutePath(ctx, action.folder);
    const module = getModule(ctx.state, action.folder) || {};
    fs.mkdirSync(dir, { recursive: true });
    pullInternals()._writeCategoryFile(dir, action.name, module.position ?? 0);
    ensureModule(ctx.state, action.folder, { name: action.name });
  },
  'delete-local-module': (ctx, action) => {
    fs.rmSync(absolutePath(ctx, action.folder), {
      recursive: true,
      force: true,
    });
    deleteModuleFromState(ctx.state, action.folder);
    ctx.invalidate();
  },

  'create-local-item': writeLocalItem,
  'update-local-item': writeLocalItem,
  'delete-local-item': deleteLocalItem,
  'reorder-local-module': reorderLocalModule,
};

/** What an action is called in a report line. */
function describeAction(action) {
  return action.itemPath || action.folder || action.from || action.type;
}

/**
 * The second pass, for items whose markdown linked to something this run had
 * not created yet.
 *
 * Push has always made this pass; what is new is that it re-records the
 * fingerprint. Writing the resolved HTML and leaving the row describing the
 * unresolved version would make every later sync see a Canvas-side change that
 * nobody made — and pull it over the author's file.
 */
async function resolvePendingLinks(ctx) {
  if (ctx.unresolved.size === 0) return;
  ctx.invalidate();
  for (const action of ctx.unresolved.values()) {
    const found = getItem(ctx.state, action.itemPath);
    if (!found) continue;
    try {
      const written = await writeContent(ctx, action, {
        canvasId: found.entry.canvas_id,
        folder: action.folder,
      });
      const moduleItemId = found.entry.module_item_id ?? null;
      recordCanvasWrite(ctx, action, {
        item: {
          id: moduleItemId,
          title: action.title,
          indent: action.indent ?? 0,
        },
        content: written.result,
        canvasId: written.canvasId,
        pageUrl: written.pageUrl,
      });
    } catch (err) {
      ctx.errors.push({
        action: { type: 'resolve-links', itemPath: action.itemPath },
        error: err.message,
      });
    }
  }
}

/**
 * Execute a plan.
 *
 * @param {object} plan - What `plan()` returned; only `actions` is read.
 * @param {object} options
 * @param {string|number} options.courseId
 * @param {string} options.courseDir      - Absolute path of `course/`.
 * @param {object} options.state          - Loaded sync state, written in place.
 * @param {Map} [options.canvasContent]   - What `gatherCanvas` returned as
 *   `content`: the raw module item and the object behind it, keyed by module
 *   item id. Lets a local write happen without fetching anything twice.
 * @param {Function} [options.save]       - Injection point for tests.
 * @param {Function} [options.now]        - Injection point for tests.
 * @param {object} [options.log]
 * @returns {Promise<{applied: object[], errors: object[]}>}
 */
async function applyPlan(plan, options = {}) {
  const ctx = createContext(plan, options);

  // The engine renders the HTML that names the alert icons, so the engine is
  // what makes them exist. Leaving that to each command is how `sync` shipped
  // reading `getIconUrls` with nothing ever calling `ensureIcons`: every
  // callout went to Canvas with no `<img>` at all — `markdownToHtml` simply
  // omits it when the URL is missing, so it degraded quietly — and the page was
  // then fingerprinted as synced, so no later run ever put the icon back.
  if (needsAlertIcons(plan)) {
    let failure = null;
    try {
      await ensureIcons(ctx.courseId, ctx.state);
    } catch (err) {
      failure = err;
      ctx.errors.push({
        action: { type: 'ensure-icons' },
        error:
          `the alert icons could not be uploaded (${err.message}), so nothing ` +
          'was written on either side. Every page, assignment and discussion ' +
          'this run would have pushed names those icons by URL, and Canvas is ' +
          'handed no <img> at all when the URL is missing — the callouts would ' +
          'go up unmarked, be recorded as synced, and no later run would put ' +
          'them back, because the fingerprints would match. Fix the upload and ' +
          'run again.',
      });
    }

    // Saved either way, and this is the reason stopping is not the same as
    // losing the work: whatever uploaded before the failure is recorded, so the
    // next run resumes from there instead of putting a second copy of those
    // icons into the Canvas course. `ensureIcons` skips an icon whose stored
    // theme fingerprint still matches, and that record is the whole of its
    // idempotency.
    ctx.save(ctx.state);

    if (failure) {
      // Before any action, so nothing has been written and stopping costs
      // nothing. `last_sync` is deliberately not stamped: no sync happened, and
      // a run that claims one poisons the base the next run reasons from.
      return { applied: ctx.applied, errors: ctx.errors };
    }

    ctx.iconUrls = getIconUrls(ctx.state);
  }

  for (const action of plan.actions || []) {
    const handler = HANDLERS[action.type];
    if (!handler) {
      ctx.errors.push({
        action,
        error: `no executor for action type "${action.type}".`,
      });
      continue;
    }
    try {
      await handler(ctx, action);
      ctx.applied.push(action);
    } catch (err) {
      // One failed action costs that action and nothing else. Stopping here
      // would leave Canvas half written with a state describing neither side.
      ctx.errors.push({ action, error: err.message });
      ctx.log.error(
        `  [sync] ${action.type} failed for ${describeAction(action)}: ${err.message}`,
      );
      ctx.save(ctx.state);
    }
  }

  await resolvePendingLinks(ctx);

  ctx.state.last_sync = ctx.now();
  ctx.save(ctx.state);
  return { applied: ctx.applied, errors: ctx.errors };
}

module.exports = {
  reconcileModuleItems,
  applyModuleItems,
  applyPlan,
  moduleItemKeys,
  describeLeftoverItem,
};
// Exported for testing
module.exports._diffModuleItem = diffModuleItem;
module.exports._renumberPath = renumberPath;
