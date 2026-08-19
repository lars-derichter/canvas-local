const { createModuleItem, updateModuleItem } = require('../canvas/modules');

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

module.exports = {
  reconcileModuleItems,
  applyModuleItems,
  moduleItemKeys,
  describeLeftoverItem,
};
// Exported for testing
module.exports._diffModuleItem = diffModuleItem;
