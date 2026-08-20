const { plan } = require('../lib/sync/plan');
const { applyPlan } = require('../lib/sync/apply');
const {
  gatherCanvas,
  gatherLocal,
  gitDirtyPaths,
} = require('../lib/sync/gather');
const { loadState, saveState } = require('../lib/sync/state');
const { COURSE_DIR, createRL, prompt } = require('./module-utils');
const { BACKUP_HINT } = require('./backup-warning');
const log = require('./logger');

/**
 * Two-way sync: newest wins, nothing is deleted unless asked.
 *
 * The command is deliberately thin. Everything that decides anything lives in
 * `lib/sync/plan.js`, everything that reads the world lives in
 * `lib/sync/gather.js`, and everything that writes lives in
 * `lib/sync/apply.js`. What is left here is policy — the flags, the questions,
 * and the report — which is exactly the part that differs between `sync`,
 * `push`, `pull` and `status`.
 *
 * **Prompts re-plan; they never patch.** When the planner cannot decide
 * something on its own it says so in `pending` and emits no action for it. This
 * asks the author, then calls `plan()` a second time with the answers in
 * `policy.resolved`. Nothing is fetched again, so the second pass is free, and
 * it keeps the planner a pure function of its inputs rather than something that
 * blocks on a terminal halfway through. It also means an answer is applied to
 * the same course it was asked about.
 */

const CONFLICT_POLICIES = ['newest', 'local', 'canvas', 'ask'];
const ORDER_POLICIES = ['local', 'canvas', 'ask'];

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

/** `1 page` / `3 pages`, so a count never reads as a stutter. */
function plural(count, singular, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/**
 * An action type read as its three parts. Every type in the planner's
 * vocabulary is `<verb>-<side>-<object>`, bar the two that name only a side.
 */
function classifyAction(type) {
  const parts = String(type).split('-');
  if (parts.length < 3)
    return { verb: parts[0], side: parts[1], object: 'row' };
  return { verb: parts[0], side: parts[1], object: parts[2] };
}

const SIDE_LABELS = { canvas: 'Canvas', local: 'Locally', base: 'Sync state' };
const VERB_LABELS = {
  create: 'created',
  update: 'updated',
  move: 'moved',
  delete: 'deleted',
  reorder: 'reordered',
  rekey: 're-keyed',
  drop: 'dropped',
};

/** "Canvas: 2 items created, 1 module reordered", one line per side. */
function summariseActions(actions) {
  const counts = new Map();
  for (const action of actions) {
    const { verb, side, object } = classifyAction(action.type);
    const key = `${side}|${verb}|${object}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const lines = [];
  for (const side of ['canvas', 'local', 'base']) {
    const parts = [];
    for (const [key, count] of counts) {
      const [entrySide, verb, object] = key.split('|');
      if (entrySide !== side) continue;
      parts.push(`${plural(count, object)} ${VERB_LABELS[verb] || verb}`);
    }
    if (parts.length > 0) {
      lines.push(`  ${SIDE_LABELS[side]}: ${parts.join(', ')}`);
    }
  }
  return lines;
}

/** Where an orphaned Canvas item is, so it can be opened and looked at. */
function canvasItemUrl({ baseUrl, courseId }, orphan) {
  if (!baseUrl || !courseId) return '';
  if (orphan.kind === 'module' && orphan.canvasModuleId != null) {
    return ` — ${baseUrl}/courses/${courseId}/modules#module_${orphan.canvasModuleId}`;
  }
  if (orphan.moduleItemId != null) {
    return ` — ${baseUrl}/courses/${courseId}/modules/items/${orphan.moduleItemId}`;
  }
  return '';
}

/** A timestamp as a report reads it, with an unparseable one left verbatim. */
function stamp(value) {
  if (value == null) return 'unknown';
  const date = typeof value === 'number' ? new Date(value) : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

/**
 * Render a plan as the run's closing report — the same sections in the same
 * order for every command that owns a plan, each omitted when it is empty.
 *
 * It is a function of the plan alone, so it can be tested without running
 * anything, and so `status` is this over a plan that writes to neither side.
 *
 * @param {object} report - What `plan()` returned.
 * @param {object} [options]
 * @param {boolean} [options.dryRun]      - Head the applied section differently.
 * @param {boolean} [options.pruneCanvas] - Whether `--prune-canvas` was given.
 * @param {boolean} [options.pruneLocal]  - Whether `--prune-local` was given.
 * @param {string}  [options.baseUrl]     - For linking Canvas objects.
 * @param {string|number} [options.courseId]
 * @returns {string[]} Lines, ready to print one per call.
 */
function buildReport(report, options = {}) {
  const lines = [];
  const section = (title, body) => {
    if (body.length === 0) return;
    lines.push('');
    lines.push(title);
    lines.push(...body);
  };

  // --- Applied -------------------------------------------------------------
  section(
    options.dryRun ? 'Would apply' : 'Applied',
    summariseActions(report.actions || []),
  );

  // Under `status`, and under a pinned-direction run, the plan records what the
  // policy forbade rather than losing it — so it can still be named.
  section(
    'Left alone (this command does not write to that side)',
    summariseActions(report.withheld || []),
  );

  // --- Orphaned on Canvas --------------------------------------------------
  const canvasOrphans = (report.orphans.canvas || []).filter((o) => !o.pruned);
  if (canvasOrphans.length > 0) {
    const body = canvasOrphans.map((orphan) => {
      const what =
        orphan.kind === 'module'
          ? `module "${orphan.title}" (${plural(orphan.itemCount || 0, 'item')})`
          : `${orphan.canvasType} "${orphan.title || orphan.itemPath}"`;
      const why = orphan.reason ? ` — ${orphan.reason}` : '';
      return `  - ${orphan.itemPath || orphan.moduleFolder}: ${what}${canvasItemUrl(options, orphan)}${why}`;
    });
    body.push(
      options.pruneCanvas
        ? '  Nothing above was deleted; each line says why.'
        : '  Nothing was deleted. `--prune-canvas` is what deletes these.',
    );
    if (!options.pruneCanvas) body.push(`  ${BACKUP_HINT}`);
    section('Orphaned on Canvas (gone locally, still there)', body);
  }

  // --- Orphaned locally ----------------------------------------------------
  const localOrphans = (report.orphans.local || []).filter((o) => !o.pruned);
  if (localOrphans.length > 0) {
    const body = localOrphans.map((orphan) => {
      const what =
        orphan.kind === 'module'
          ? `folder "${orphan.moduleFolder}" (${plural(orphan.itemCount || 0, 'item')})`
          : `${orphan.canvasType} "${orphan.title || orphan.itemPath}"`;
      const why = orphan.reason ? ` — ${orphan.reason}` : '';
      return `  - ${orphan.itemPath || orphan.moduleFolder}: ${what}${why}`;
    });
    body.push(
      options.pruneLocal
        ? '  Nothing above was deleted; each line says why.'
        : '  Nothing was deleted. `--prune-local` is what deletes these.',
    );
    if (!options.pruneLocal) body.push(`  ${BACKUP_HINT}`);
    section('Orphaned locally (gone from Canvas, still here)', body);
  }

  // --- Conflicts resolved --------------------------------------------------
  section(
    'Conflicts resolved',
    (report.conflicts || []).map((conflict) => {
      const where = conflict.itemPath || conflict.moduleFolder;
      const won = conflict.winner === 'local' ? 'local' : 'Canvas';
      const tail =
        conflict.winner === 'canvas'
          ? ' The version that was here is in git.'
          : '';
      const when =
        conflict.kind === 'item'
          ? ` (local ${stamp(conflict.localMtimeMs)}, Canvas ${stamp(conflict.canvasUpdatedAt)})`
          : '';
      return `  - ${where}: ${won} won — ${conflict.reason}.${when}${tail}`;
    }),
  );

  // --- Conflicts skipped ---------------------------------------------------
  section(
    'Skipped',
    (report.skipped || []).map(
      (skip) =>
        `  - ${skip.itemPath || skip.moduleFolder} (${skip.reason}): ${skip.remedy}`,
    ),
  );

  // --- Ordering ------------------------------------------------------------
  section(
    'Ordering',
    (report.ordering || []).map((entry) => {
      if (entry.skipped) {
        const orders =
          entry.local && entry.canvas
            ? `\n      here:   ${entry.local.join(' → ')}\n      Canvas: ${entry.canvas.join(' → ')}`
            : '';
        return `  - ${entry.folder}: left as it is — ${entry.reason}.${orders}`;
      }
      const from =
        entry.winner === 'local' ? 'the local order' : 'the Canvas order';
      return `  - ${entry.folder}: took ${from} — ${entry.reason}.`;
    }),
  );

  // --- Unrecognised --------------------------------------------------------
  section(
    'Unrecognised Canvas items',
    (report.unrecognised || []).map(
      (item) =>
        `  - ${item.moduleFolder || '(unmatched module)'}: "${item.title}" is a ` +
        `${item.rawType}, which this version does not understand. It was left ` +
        'alone, and the order of its module was not touched either.',
    ),
  );

  // --- Needs a decision ----------------------------------------------------
  section(
    'Needs a decision',
    (report.decisions || []).map((decision) => `  ! ${decision.summary}`),
  );

  // --- Renames awaiting an answer -----------------------------------------
  section(
    'Possible renames awaiting an answer',
    (report.pending.renames || []).map(
      (rename) =>
        `  ! ${rename.from} may have been renamed to ${rename.to}. Neither ` +
        'was touched. Run sync interactively to confirm, or put the row back ' +
        'under the right path in the sync state by hand.',
    ),
  );

  // --- The refusal ---------------------------------------------------------
  if (report.collision) {
    lines.push('');
    lines.push('Refused');
    lines.push(`  ${report.collision.message}`);
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

/** Ask one multiple-choice question, defaulting to the safe answer. */
async function ask(rl, question, choices, fallback) {
  const answer = (await prompt(rl, `${question} [${choices.join('/')}]`))
    .trim()
    .toLowerCase();
  return choices.includes(answer) ? answer : fallback;
}

/**
 * Put every question the plan raised to the author, and hand the answers back
 * for a second planning pass.
 *
 * Non-interactively the answers are the ones that change nothing: a conflict is
 * skipped and reported, an ordering question is left alone and reported. Both
 * end up in the report with a remedy, which is the point — a silent skip would
 * be worse than either wrong answer.
 *
 * @returns {object|null} `policy.resolved`, or null when there was nothing to
 *   ask, in which case the caller keeps its first plan.
 */
async function askPending(report, { interactive }) {
  const pending = report.pending;
  const count =
    pending.conflicts.length + pending.order.length + pending.renames.length;
  if (count === 0) return null;

  const resolved = { conflicts: {}, order: {}, renames: {} };

  if (!interactive) {
    for (const conflict of pending.conflicts) {
      resolved.conflicts[conflict.itemPath || conflict.moduleFolder] = 'skip';
    }
    for (const entry of pending.order) resolved.order[entry.folder] = 'skip';
    // A rename left unanswered keeps both paths out of the truth table, which
    // is the only answer that neither deletes the Canvas object nor creates a
    // second copy of it. It is reported instead.
    return resolved;
  }

  const rl = createRL();
  try {
    for (const conflict of pending.conflicts) {
      const key = conflict.itemPath || conflict.moduleFolder;
      log.info(`\n[sync] Both sides of ${key} changed since the last sync.`);
      if (conflict.kind === 'item') {
        log.info(`[sync]   here:   ${stamp(conflict.localMtimeMs)}`);
        log.info(`[sync]   Canvas: ${stamp(conflict.canvasUpdatedAt)}`);
      } else {
        log.info(`[sync]   here:   "${conflict.localName}"`);
        log.info(`[sync]   Canvas: "${conflict.canvasName}"`);
      }
      resolved.conflicts[key] = await ask(
        rl,
        '[sync] Which one wins?',
        ['local', 'canvas', 'skip'],
        'skip',
      );
    }

    for (const entry of pending.order) {
      log.info(`\n[sync] ${entry.folder} was reordered on both sides.`);
      log.info(`[sync]   here:   ${entry.local.join(' → ')}`);
      log.info(`[sync]   Canvas: ${entry.canvas.join(' → ')}`);
      resolved.order[entry.folder] = await ask(
        rl,
        '[sync] Which order wins?',
        ['local', 'canvas', 'skip'],
        'skip',
      );
    }

    for (const rename of pending.renames) {
      log.info(
        `\n[sync] ${rename.from} is gone and ${rename.to} is new, with the ` +
          'same title in the same folder.',
      );
      const answer = await ask(
        rl,
        '[sync] Is that the same item, renamed?',
        ['y', 'n'],
        'n',
      );
      resolved.renames[rename.from] = answer === 'y' ? rename.to : false;
    }
  } finally {
    rl.close();
  }

  return resolved;
}

/** Whether the plan actually deletes anything, which is what needs confirming. */
function countPrunes(report) {
  return (report.actions || []).filter((action) =>
    action.type.startsWith('delete-'),
  ).length;
}

/** Stop before a delete, the way every other destructive path in this tool does. */
async function confirmPrune(report, { interactive, yes }) {
  const doomed = countPrunes(report);
  if (doomed === 0) return true;
  if (yes) return true;
  if (!interactive) {
    log.warn(
      `[sync] ${plural(doomed, 'thing')} would be deleted, and this run cannot ` +
        'ask. Nothing was pruned; run it in a terminal, or pass --yes.',
    );
    return false;
  }

  log.info(`\n[sync] ${plural(doomed, 'item')} will be deleted.`);
  log.info(`[sync] ${BACKUP_HINT}`);
  const rl = createRL();
  const answer = await prompt(rl, '[sync] Delete them? (y/N)');
  rl.close();
  const ok = answer.trim().toLowerCase() === 'y';
  if (!ok) log.info('[sync] Nothing was deleted.');
  return ok;
}

// ---------------------------------------------------------------------------
// The command
// ---------------------------------------------------------------------------

/** Refuse a misspelled policy rather than falling back to one nobody asked for. */
function checkPolicy(name, value, allowed) {
  if (allowed.includes(value)) return true;
  log.error(
    `[sync] Error: --${name} ${value} is not one of ${allowed.join(', ')}.`,
  );
  return false;
}

/**
 * @param {object} options - Commander's flags, plus four injection points for
 *   tests that commander never sets: `courseDir`, `syncFile`, `gitDirty` and
 *   `interactive`. A test needs its own tree, its own state file, a git answer
 *   that does not depend on the checkout it runs in, and a terminal it does not
 *   have.
 */
async function sync(options = {}) {
  const courseId = process.env.CANVAS_COURSE_ID;
  if (!courseId) {
    log.error(
      '[sync] Error: CANVAS_COURSE_ID is not set. Run "npx course init" first.',
    );
    process.exitCode = 1;
    return;
  }

  const conflict = options.conflict || 'newest';
  const order = options.order || 'ask';
  if (
    !checkPolicy('conflict', conflict, CONFLICT_POLICIES) ||
    !checkPolicy('order', order, ORDER_POLICIES)
  ) {
    process.exitCode = 1;
    return;
  }

  const dryRun = options.dryRun === true;
  const yes = options.yes === true;
  const interactive =
    options.interactive !== undefined
      ? options.interactive === true
      : Boolean(process.stdin.isTTY) && !yes;
  const wantsPruneCanvas =
    options.prune === true || options.pruneCanvas === true;
  const wantsPruneLocal = options.prune === true || options.pruneLocal === true;
  const modules = options.module
    ? [].concat(options.module).filter(Boolean)
    : null;
  const courseDir = options.courseDir || COURSE_DIR;
  const syncFile = options.syncFile || undefined;

  const state = loadState(syncFile ? { file: syncFile } : {});

  // One `git status` for the run. A file with uncommitted changes cannot be
  // overwritten by Canvas winning, because git is the undo for this whole
  // system — and outside a repository nothing can be proved safe, so nothing
  // local is written at all.
  const gitDirty = options.gitDirty || gitDirtyPaths({ courseDir });
  if (!gitDirty.available) {
    log.warn(
      `[sync] ${gitDirty.reason}. Every local file is treated as holding ` +
        'uncommitted work, so nothing here is overwritten or deleted this run.',
    );
  }

  const local = gatherLocal({ courseDir, gitDirty });
  for (const warning of local.warnings) log.warn(`[sync] ${warning}`);

  log.info(`[sync] Reading Canvas course ${courseId}...`);
  const canvas = await gatherCanvas({ courseId, base: state });
  for (const warning of canvas.warnings) log.warn(`[sync] ${warning}`);

  const policy = {
    write: { canvas: true, local: true },
    conflict,
    order,
    pruneCanvas: wantsPruneCanvas,
    pruneLocal: wantsPruneLocal,
    modules,
  };
  const inputs = { base: state, local, canvas };
  let report = plan({ ...inputs, policy });

  // Answers go back through the planner rather than being patched into the
  // plan: nothing was refetched, so the second pass costs nothing and stays a
  // pure function of the same three inputs.
  const resolved = await askPending(report, { interactive });
  if (resolved) report = plan({ ...inputs, policy: { ...policy, resolved } });

  // A dry run deletes nothing, so there is nothing to confirm — and hiding the
  // deletes behind a question the run will never act on is the opposite of
  // what a preview is for.
  if ((wantsPruneCanvas || wantsPruneLocal) && !dryRun) {
    const ok = await confirmPrune(report, { interactive, yes });
    if (!ok) {
      report = plan({
        ...inputs,
        policy: {
          ...policy,
          resolved: resolved || undefined,
          pruneCanvas: false,
          pruneLocal: false,
        },
      });
    }
  }

  let outcome = { applied: [], errors: [] };
  if (report.collision) {
    // Nothing is decided about a collided module until the author picks a
    // direction, so nothing is executed for the whole run either.
    log.error('[sync] Refusing to reconcile; no changes were made.');
  } else if (dryRun) {
    log.info('[sync] DRY RUN — nothing was written.');
  } else if (report.actions.length > 0) {
    outcome = await applyPlan(report, {
      courseId,
      courseDir,
      state,
      canvasContent: canvas.content,
      save: (next) => saveState(next, syncFile),
      log,
    });
  } else {
    state.last_sync = new Date().toISOString();
    saveState(state, syncFile);
  }

  const lines = buildReport(report, {
    dryRun,
    pruneCanvas: wantsPruneCanvas,
    pruneLocal: wantsPruneLocal,
    baseUrl: state.canvas_base_url,
    courseId,
  });
  if (lines.length === 0) {
    log.info('[sync] Everything is already in sync.');
  } else {
    for (const line of lines) log.info(line);
  }

  if (outcome.errors.length > 0) {
    log.error(`\n[sync] ${plural(outcome.errors.length, 'error')}:`);
    for (const failure of outcome.errors) {
      log.error(
        // A run-wide failure — the icon upload — names no path and no folder,
        // so it falls back to its own name rather than printing "undefined".
        `  - ${failure.action.itemPath || failure.action.folder || failure.action.type}: ${failure.error}`,
      );
    }
  }

  // A refusal fails the run, which is this tool's convention everywhere else.
  // Orphans and the informational sections do not: a course mid-edit is a
  // normal state, not a failure.
  if (
    outcome.errors.length > 0 ||
    report.skipped.length > 0 ||
    report.collision
  ) {
    process.exitCode = 1;
  }
}

module.exports = sync;
// Exported for testing
sync._buildReport = buildReport;
sync._summariseActions = summariseActions;
