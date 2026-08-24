const { plan } = require('../lib/sync/plan');
const { applyPlan } = require('../lib/sync/apply');
const {
  gatherCanvas,
  gatherLocal,
  gitDirtyPaths,
} = require('../lib/sync/gather');
const { loadState, saveState } = require('../lib/sync/state');
const { COURSE_DIR, createRL, prompt } = require('./module-utils');
const { BACKUP_HINT, submissionRiskSuffix } = require('./backup-warning');
const { warnGradeImpact } = require('./grade-impact');
const { describeCanvasPrune, describeLocalPrune } = require('./prune-warning');
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
  link: 'linked',
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
  // An embedded binary is in the course Files area and in no module at all, so
  // a module-item URL would point at nothing.
  if (orphan.kind === 'file' && orphan.canvasFileId != null) {
    return ` — ${baseUrl}/courses/${courseId}/files/${orphan.canvasFileId}`;
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
 * The actions that actually ran, as a set of `type|where` keys.
 *
 * The plan says what should happen; only the executor knows what did. Crossing
 * the two is what stops the report claiming a delete that 404'd or a write that
 * failed — and it is done here, from the applied list, rather than by threading
 * a second flag back through the planner, which is pure and has to stay a
 * function of its three inputs.
 */
function appliedIndex(applied) {
  const keys = new Set();
  for (const action of applied || []) {
    const where = action.itemPath || action.folder;
    if (where != null) keys.add(`${action.type}|${where}`);
  }
  return keys;
}

/**
 * Whether an orphan was really deleted, rather than merely planned for deletion.
 *
 * The planner sets `pruned` when it *emits* the delete, which is the only thing
 * a pure function can know. A delete that then failed leaves the item exactly
 * where it was, so reading that flag as truth drops it out of the report — and
 * the run's own summary becomes the thing that stops mentioning the item still
 * sitting in the course.
 */
function orphanDeleted(orphan, side, run) {
  if (orphan.pruned !== true) return false;
  if (!run.executed) return true;

  const where =
    orphan.kind === 'module' ? orphan.moduleFolder : orphan.itemPath;
  if (run.landed.has(`delete-${side}-${orphan.kind}|${where}`)) return true;
  // An item inside a module being deleted never gets a delete of its own: the
  // module's takes it along, so the module's is the one to look for.
  if (orphan.kind === 'item' && orphan.coveredByModule) {
    return run.landed.has(`delete-${side}-module|${orphan.moduleFolder}`);
  }
  return false;
}

/**
 * Why an orphan is still listed, when there is anything to say.
 *
 * Two different facts, and the planner can only know one of them. It sets
 * `reason` when it declined to emit a delete at all — a module still holding
 * remote changes, a folder with uncommitted work. A delete it *did* emit and
 * that then failed is invisible to it, because the failure happened after
 * planning. That one is read off the applied list, and it has to be said here:
 * the section closes with "each line says why", and this is the one case where
 * no line would carry a why.
 *
 * Called only for orphans that survived the filter, so `pruned` still true on
 * an executed run means exactly "attempted, and it did not land".
 */
function orphanNotes(orphan, run) {
  const notes = [];
  if (orphan.reason) notes.push(orphan.reason);
  if (run.executed && orphan.pruned === true) {
    notes.push('the delete was attempted and it failed; see the errors below');
  }
  return notes.length > 0 ? ` — ${notes.join('; ')}` : '';
}

/**
 * Whether the write that claims an existing Canvas object actually landed.
 *
 * An adoption emits an ordinary update, so a failed one is indistinguishable
 * from any other failed update in the summary — and calling it adopted anyway
 * would tell the author their file is tied to a Canvas object it is not tied
 * to, which is worse than saying nothing.
 */
function adoptionLanded(entry, run) {
  if (entry.applied !== true) return false;
  if (!run.executed) return true;
  const type =
    entry.direction === 'local' ? 'update-canvas-item' : 'update-local-item';
  return run.landed.has(`${type}|${entry.itemPath}`);
}

/** Whether the write that settles a conflict actually landed. */
function conflictLanded(conflict, run) {
  if (conflict.applied !== true) return false;
  if (!run.executed) return true;
  const where = conflict.itemPath || conflict.moduleFolder;
  const object = conflict.kind === 'module' ? 'module' : 'item';
  const type =
    conflict.winner === 'local'
      ? `update-canvas-${object}`
      : `update-local-${object}`;
  return run.landed.has(`${type}|${where}`);
}

/**
 * Whether the reorder that settles a module's order actually landed.
 *
 * The winner is the side that keeps its order, so the write goes to the other
 * one: a local winner is a `reorder-canvas-module`. One reorder covers a whole
 * module, so its line in the report is the only account the author gets of what
 * happened to that module's order — nothing in the summary above is per-item
 * enough to contradict it.
 */
function reorderLanded(entry, run) {
  if (entry.applied !== true) return false;
  if (!run.executed) return true;
  const type =
    entry.winner === 'local' ? 'reorder-canvas-module' : 'reorder-local-module';
  return run.landed.has(`${type}|${entry.folder}`);
}

/**
 * Render a plan as the run's closing report — the same sections in the same
 * order for every command that owns a plan, each omitted when it is empty.
 *
 * It is a function of its arguments alone, so it can be tested without running
 * anything, and so `status` is this over a plan that writes to neither side.
 *
 * **`applied` is what separates a report from a preview.** Given it, the report
 * describes what happened: the summary counts the actions that ran, an orphan
 * whose delete failed is still listed as sitting in the course, and a conflict
 * whose write failed is not called resolved. Without it the report describes
 * what *would* happen, which is what a dry run and `status` both want. There is
 * no separate dry-run flag, because two parameters that have to agree with each
 * other are one too many.
 *
 * @param {object} report - What `plan()` returned.
 * @param {object} [options]
 * @param {object[]} [options.applied]    - The actions `applyPlan` actually
 *   ran. Absent means "nothing was executed": report the plan as a preview.
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

  const run = {
    executed: Array.isArray(options.applied),
    landed: appliedIndex(options.applied),
  };

  // --- Applied -------------------------------------------------------------
  // An empty list renders no section at all, which is right for a run where
  // every action failed as much as for one that planned nothing. Those are not
  // the same thing to say, and this cannot tell them apart: a report is a
  // function of the plan and what ran, and the difference between the two is in
  // the errors, which are neither. So each command reads its own `errors`
  // before it decides what a bare report means. Every one of them used to
  // answer both cases with the sentence for the second, and a run that refused
  // its only action therefore reported the two sides as agreeing.
  section(
    run.executed ? 'Applied' : 'Would apply',
    summariseActions(run.executed ? options.applied : report.actions || []),
  );

  // Under `status`, and under a pinned-direction run, the plan records what the
  // policy forbade rather than losing it — so it can still be named.
  section(
    'Left alone (this command does not write to that side)',
    summariseActions(report.withheld || []),
  );

  // --- Adopted -------------------------------------------------------------
  // An adoption is an ordinary update in the summary above, so without this
  // section the author reads "1 item updated" and never learns that the item
  // in question was an object already sitting in Canvas, now claimed by a
  // local file. That is the whole fact worth telling them.
  section(
    'Adopted (matched to something already in Canvas)',
    (report.adopted || []).map((entry) => {
      const claimed = adoptionLanded(entry, run);
      const why = claimed
        ? ''
        : entry.applied === true
          ? ' — the write failed, so nothing was claimed; see the errors below'
          : ' — nothing was written, so the two are still unlinked';
      return (
        `  - ${entry.itemPath}: ${entry.canvasType} "${entry.title}"` +
        `${canvasItemUrl(options, entry)}${why}`
      );
    }),
  );

  // --- Orphaned on Canvas --------------------------------------------------
  const canvasOrphans = (report.orphans.canvas || []).filter(
    (orphan) => !orphanDeleted(orphan, 'canvas', run),
  );
  if (canvasOrphans.length > 0) {
    const body = canvasOrphans.map((orphan) => {
      // A `file` orphan is a binary in the course Files area that no page
      // embeds any more, not a module item, so it says which of the two it is.
      const what =
        orphan.kind === 'module'
          ? `module "${orphan.title}" (${plural(orphan.itemCount || 0, 'item')})`
          : orphan.kind === 'file'
            ? `embedded file "${orphan.title}", which nothing embeds any more`
            : `${orphan.canvasType} "${orphan.title || orphan.itemPath}"`;
      const why = orphanNotes(orphan, run);
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
  const localOrphans = (report.orphans.local || []).filter(
    (orphan) => !orphanDeleted(orphan, 'local', run),
  );
  if (localOrphans.length > 0) {
    const body = localOrphans.map((orphan) => {
      const what =
        orphan.kind === 'module'
          ? `folder "${orphan.moduleFolder}" (${plural(orphan.itemCount || 0, 'item')})`
          : `${orphan.canvasType} "${orphan.title || orphan.itemPath}"`;
      const why = orphanNotes(orphan, run);
      return `  - ${orphan.itemPath || orphan.moduleFolder}: ${what}${why}`;
    });
    body.push(
      options.pruneLocal
        ? '  Nothing above was deleted; each line says why.'
        : '  Nothing was deleted. `--prune-local` is what deletes these.',
    );
    if (!options.pruneLocal) body.push(`  ${BACKUP_HINT}`);
    // Deleting is one of two routes, and the only one a flag covers. The other
    // is the sync state: an entry taken out of it leaves a file nothing links
    // to Canvas any more, which is a new file, so the next push creates the
    // object again. Named here because nothing else in the report says it, and
    // an author who wants the item back rather than gone would otherwise read
    // the deleting flag as the whole answer.
    //
    // It sits below the backup hint rather than above it so that the sentence
    // naming the delete and the warning about the delete stay adjacent, and
    // carries a precondition: this section is built from what Canvas listed in
    // the modules, so an object dragged out of every module reads here exactly
    // like a deleted one, and pushing a row-less file at that state creates a
    // second copy of an object that was never gone.
    body.push(
      '  Or put one back on Canvas: check it is really gone rather than ' +
        'sitting outside every module, then take its entry out of the sync ' +
        'state and push, and it is created fresh; see docs/frontmatter.md, ' +
        'under "Adopting an Item You Made by Hand in Canvas".',
    );
    section('Orphaned locally (gone from Canvas, still here)', body);
  }

  // --- Conflicts resolved --------------------------------------------------
  const conflicts = report.conflicts || [];
  const resolved = conflicts.filter((conflict) =>
    conflictLanded(conflict, run),
  );
  const unsettled = conflicts.filter(
    (conflict) => !conflictLanded(conflict, run),
  );

  section(
    'Conflicts resolved',
    resolved.map((conflict) => {
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
  // A conflict whose write never landed belongs here rather than above: it was
  // decided, but both sides are still as they were, and calling that resolved
  // is the report telling the author their course is in a state it is not.
  section('Skipped', [
    ...(report.skipped || []).map(
      (skip) =>
        `  - ${skip.itemPath || skip.moduleFolder} (${skip.reason}): ${skip.remedy}`,
    ),
    ...unsettled.map((conflict) => {
      const where = conflict.itemPath || conflict.moduleFolder;
      const won = conflict.winner === 'local' ? 'local' : 'Canvas';
      // Three reasons a decided write is not on disk, and only one of them is
      // answered by running `sync`. The pinned direction is: sync writes to
      // both sides, so it settles what a one-directional command left. A guard
      // is not: sync meets the same guard and refuses again, and the author was
      // being sent to do the one thing that cannot help — while the guard's own
      // skip entry, printed a few lines above in this very section, carried the
      // remedy that works. `refusal` is which guard it was, and it is the same
      // word that line is tagged with.
      const remedy =
        conflict.applied === true
          ? 'the write failed, so both sides are as they were — see the ' +
            'errors below, then run again.'
          : conflict.refusal
            ? `the write was refused (${conflict.refusal}), so nothing ` +
              `changed. The ${conflict.refusal} line above says what to fix; ` +
              'running again settles this only once it is fixed.'
            : 'this command does not write to the side that lost, so nothing ' +
              'changed. Run `npx course sync` to settle it.';
      return `  - ${where} (conflict-unwritten): ${won} would have won, but ${remedy}`;
    }),
  ]);

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
      if (reorderLanded(entry, run)) {
        return `  - ${entry.folder}: took ${from} — ${entry.reason}.`;
      }
      // Decided but never carried out, which is not the same as undecided: the
      // two sides are still in different orders, and this line is the only
      // place that says so. The losing side is named rather than called "that
      // side", because the sentence has just named the winning one.
      const loser = entry.winner === 'local' ? 'Canvas' : 'the local files';
      const why =
        entry.applied === true
          ? 'the write failed, so both sides are as they were; see the ' +
            'errors below'
          : `this command does not write to ${loser}, so nothing moved`;
      return `  - ${entry.folder}: would have taken ${from} (${entry.reason}), but ${why}.`;
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

/**
 * List what a prune is about to delete on each side, name the student work
 * behind the Canvas half of it, and ask.
 *
 * Sync is the only command that prunes both ways, so it is the only one that
 * lists both. The Canvas listing is the same one `push --prune-canvas` prints,
 * from the same module: it is the same delete against the same course, and a
 * warning that differed between the two would be a warning the author could not
 * rely on. Only the Canvas side carries a submission risk — deleting a local
 * file costs whatever git has no copy of, which is a different sentence, and
 * the git guard has already kept anything uncommitted out of the plan.
 *
 * The listing runs before every early return, so a run that will not ask still
 * says what it found: a dry run, `--yes`, and a run with no terminal all print
 * it. A preview drops the orphans a plan means to prune out of the report,
 * which used to leave `--dry-run` with the count as its whole account.
 *
 * @returns {Promise<boolean>} Whether the deletes should stay in the plan.
 */
async function confirmPrune(courseId, report, { interactive, yes, dryRun }) {
  const actions = report.actions || [];
  const doomed = actions.filter((action) =>
    action.type.startsWith('delete-'),
  ).length;
  if (doomed === 0) return true;

  const { risk } = await describeCanvasPrune(courseId, actions, {
    tag: 'sync',
  });
  describeLocalPrune(actions, { tag: 'sync' });

  if (dryRun) return true;
  if (yes) return true;
  if (!interactive) {
    log.warn(
      `[sync] ${plural(doomed, 'thing')} would be deleted, and this run cannot ` +
        'ask. Nothing was pruned; run it in a terminal, or pass --yes.',
    );
    return false;
  }

  log.info(`\n[sync] ${BACKUP_HINT}`);
  const rl = createRL();
  const answer = await prompt(
    rl,
    `[sync] Delete them${submissionRiskSuffix(risk)}? (y/N)`,
  );
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

  // The union `pull` and `status` check against, rather than the local folders
  // `push` checks: sync writes both ways, so a name may belong to a module that
  // exists only in Canvas and is about to be written here for the first time.
  // Refusing that would refuse the very run that creates the folder. A typo, on
  // the other hand, matches nothing, scopes the run to nothing, and used to
  // report a course in perfect agreement.
  if (modules) {
    const known = new Set([
      ...local.modules.map((mod) => mod.folder),
      ...Object.keys(state.modules || {}),
      ...canvas.modules.map((mod) => mod.suggestedFolder).filter(Boolean),
    ]);
    const missing = modules.filter((name) => !known.has(name));
    if (missing.length > 0) {
      log.error(
        `[sync] Error: no module named ${missing.join(', ')} — nothing under ` +
          'course/ and nothing in the Canvas course answers to it.',
      );
      process.exitCode = 1;
      return;
    }
  }

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

  // Three of the fields an assignment update sends move grades that are already
  // in the gradebook, and the plan is what says which assignments this run
  // updates at all. Asked after the questions rather than before them, because
  // a conflict the author gave to Canvas is a local edit that never reaches the
  // assignment — warning about it off the first plan would name a change this
  // run has just decided not to make.
  await warnGradeImpact(courseId, report, { courseDir, tag: 'sync' });

  // Whether this run is still one that prunes, which a declined confirmation
  // makes it not. The report reads the answer rather than the flag: "nothing
  // above was deleted; each line says why" is a claim about the plan, and after
  // a decline there is no plan behind it to say why — the planner emitted no
  // delete, so no orphan carries a reason and every line would be silent.
  let pruningCanvas = wantsPruneCanvas;
  let pruningLocal = wantsPruneLocal;

  // A dry run deletes nothing, so it gets the listing and the warnings and no
  // question: hiding the deletes behind a prompt the run will never act on is
  // the opposite of what a preview is for. `confirmPrune` draws that line
  // itself, so the flags alone decide whether it runs.
  if (wantsPruneCanvas || wantsPruneLocal) {
    const ok = await confirmPrune(courseId, report, {
      interactive,
      yes,
      dryRun,
    });
    if (!ok) {
      pruningCanvas = false;
      pruningLocal = false;
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
      gitDirty,
      canvasContent: canvas.content,
      save: (next) => saveState(next, syncFile),
      log,
    });
    // A refusal the executor made belongs in the same section as the planner's,
    // and is read by the same two things below: the "Skipped" listing and the
    // exit code. Merged before the report is built, never after.
    report.skipped.push(...outcome.skipped);
  } else {
    state.last_sync = new Date().toISOString();
    saveState(state, syncFile);
  }

  const lines = buildReport(report, {
    // A dry run executed nothing, so it gets no applied list and the report
    // reads as the preview it is. Every other run — including one the collision
    // refused and one the icon upload aborted — hands over what actually ran,
    // which for those two is nothing.
    applied: dryRun ? undefined : outcome.applied,
    pruneCanvas: pruningCanvas,
    pruneLocal: pruningLocal,
    baseUrl: state.canvas_base_url,
    courseId,
  });
  if (lines.length > 0) {
    for (const line of lines) log.info(line);
  } else if (outcome.errors.length > 0) {
    // A bare report is not agreement: nothing got as far as being applied, and
    // the errors below are the whole account of this run.
    log.info('[sync] Nothing was applied. See the errors below.');
  } else {
    log.info('[sync] Everything is already in sync.');
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
// Exported for `cli/push.js`, `cli/pull.js`, `cli/status.js` and their tests:
// the four commands print one report, and this is the function that builds it.
sync._buildReport = buildReport;
