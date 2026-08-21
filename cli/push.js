const fs = require('fs');
const path = require('path');

const { parseFrontmatter } = require('../lib/convert/frontmatter');
const { listModules } = require('../lib/canvas/modules');
const { listPages } = require('../lib/canvas/pages');
const {
  listAssignments,
  getSubmissionStates,
  hasStudentSubmissions,
} = require('../lib/canvas/assignments');
const {
  getDiscussion,
  isGradedDiscussion,
  discussionAssignmentId,
} = require('../lib/canvas/discussions');
const { plan } = require('../lib/sync/plan');
const { applyPlan } = require('../lib/sync/apply');
const { assignmentStrategy } = require('../lib/sync/canvas-write');
const {
  gatherCanvas,
  gatherLocal,
  gitDirtyPaths,
} = require('../lib/sync/gather');
const { loadState, saveState } = require('../lib/sync/state');
const { COURSE_DIR, createRL, prompt } = require('./module-utils');
const {
  BACKUP_HINT,
  confirmFirstPush,
  countSubmissionRisk,
  submissionRiskSuffix,
  submissionWarningLines,
} = require('./backup-warning');
const buildReport = require('./sync')._buildReport;
const log = require('./logger');

/**
 * Push: `sync` with the direction pinned.
 *
 * The same four steps `cli/sync.js` takes — gather, plan, apply, report — over
 * the same engine, with one policy nothing can change:
 *
 *     { write: { canvas: true, local: false }, conflict: 'local',
 *       adopt: 'local' }
 *
 * Canvas is written and the working tree is not. A file that moved on both
 * sides is pushed rather than pulled. A Canvas object already sitting there
 * under the same type and title is claimed by the local file rather than
 * duplicated. None of that is lost when the policy forbids a write: the planner
 * records it in `withheld`, and the report names it.
 *
 * Everything that decides anything lives in `lib/sync/plan.js`, everything that
 * reads the world in `lib/sync/gather.js`, everything that writes in
 * `lib/sync/apply.js`. What is left here is the part that is genuinely push's:
 * the first-push confirmation, the warning that an assignment update moves
 * grades already in the gradebook, and the risk annotation on a
 * `--prune-canvas` confirmation. Each of those runs **between plan and apply,
 * over the plan**, which is what makes them answerable without a network.
 *
 * A Canvas-only reorder is deliberately left alone. `policy.order` bites only
 * when both sides moved; when only Canvas moved the planner gives it to Canvas,
 * which under push is a local write, so it is withheld and reported. Old push
 * imposed the local order on every run because it rebuilt every item list, and
 * that silently reverted anyone who reordered a module in the Canvas UI.
 * Settling a contested order is `sync`'s job, so push takes no `--order` flag.
 *
 * What this tool sends Canvas per type is no longer here: the three content
 * strategies, `buildFileResolver`, `pushQuiz`, `pushExternalTool` and
 * `refuseQuizBackedDelete` live in `lib/sync/canvas-write.js`, where the engine
 * that calls them can reach them without requiring a command. Push imports
 * `assignmentStrategy` from there like any other caller: the grade-impact
 * warning builds exactly what the push will send, so the comparison can never
 * drift from what goes over the wire.
 */

/** `1 item` / `3 items`, so a count never reads as a stutter. */
function plural(count, singular) {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

/**
 * @param {object} options - Commander's flags, plus four injection points for
 *   tests that commander never sets: `courseDir`, `syncFile`, `gitDirty` and
 *   `interactive`. A test needs its own tree, its own state file, a git answer
 *   that does not depend on the checkout it runs in, and a terminal it does
 *   not have.
 */
async function push(options = {}) {
  const courseId = process.env.CANVAS_COURSE_ID;
  if (!courseId) {
    log.error(
      '[push] Error: CANVAS_COURSE_ID is not set. Run "npx course init" first.',
    );
    process.exitCode = 1;
    return;
  }

  // Registered in `cli/index.js` only so the old spelling gets a pointer rather
  // than commander's bare "unknown option".
  if (options.prune === true) {
    log.error(
      '[push] Error: --prune is now --prune-canvas. Push writes to one side, ' +
        'so it prunes one side; `npx course sync --prune-local` is what ' +
        'deletes local files.',
    );
    process.exitCode = 1;
    return;
  }

  const dryRun = options.dryRun === true;
  const pruneCanvas = options.pruneCanvas === true;
  const modules = options.module
    ? [].concat(options.module).filter(Boolean)
    : null;
  const courseDir = options.courseDir || COURSE_DIR;
  const syncFile = options.syncFile || undefined;
  const interactive =
    options.interactive !== undefined
      ? options.interactive === true
      : Boolean(process.stdin.isTTY);

  const state = loadState(syncFile ? { file: syncFile } : {});

  // One `git status` for the run, the same answer every other command asks
  // for. The guard it feeds stops a Canvas copy overwriting uncommitted work,
  // and push writes to no local file it could destroy — the planner knows that
  // on its own and withholds those writes rather than reporting them as
  // skipped. It is asked anyway because the tree is not untouched: the engine
  // writes `title:` into a file it creates the Canvas object from, and a
  // command that told the planner the tree was clean would be asserting
  // something it has not checked.
  const gitDirty = options.gitDirty || gitDirtyPaths({ courseDir });
  if (!gitDirty.available) {
    log.warn(
      `[push] ${gitDirty.reason}. Git is the undo for everything this writes, ` +
        'so there is nothing to fall back on if a push goes wrong.',
    );
  }

  const local = gatherLocal({ courseDir, gitDirty });
  for (const warning of local.warnings) log.warn(`[push] ${warning}`);

  // Pushing from an empty tree is always a mistake rather than an instruction:
  // every item in the course would read as gone from here, and under
  // `--prune-canvas` that is the whole course. `reset-canvas` is the command
  // for emptying a Canvas course on purpose.
  if (local.modules.length === 0) {
    log.info('[push] No modules found in course/ directory.');
    return;
  }

  if (modules) {
    const known = new Set(local.modules.map((mod) => mod.folder));
    const missing = modules.filter((name) => !known.has(name));
    if (missing.length > 0) {
      log.error(
        `[push] Error: no module folder named ${missing.join(', ')} under ` +
          'course/.',
      );
      process.exitCode = 1;
      return;
    }
  }

  // The first push to a course that already holds content is the moment this
  // tool starts managing something it did not create. Asked before Canvas is
  // read in full, so a cancelled run costs three list requests and nothing else
  // — and on a course this project already tracks it costs none.
  const proceed = await confirmFirstPush({
    courseId,
    syncData: state,
    dryRun,
    fetchCounts: async () => {
      const [remoteModules, pages, assignments] = await Promise.all([
        listModules(courseId),
        listPages(courseId),
        listAssignments(courseId),
      ]);
      return {
        modules: remoteModules.length,
        pages: pages.length,
        assignments: assignments.length,
        files: 0,
      };
    },
  });
  if (!proceed) return;

  log.info(`[push] Reading Canvas course ${courseId}...`);
  const canvas = await gatherCanvas({ courseId, base: state });
  for (const warning of canvas.warnings) log.warn(`[push] ${warning}`);

  const policy = {
    write: { canvas: true, local: false },
    conflict: 'local',
    adopt: 'local',
    pruneCanvas,
    modules,
  };
  const inputs = { base: state, local, canvas };
  let report = plan({ ...inputs, policy });

  // Three of the fields an assignment update sends move grades that are already
  // in the gradebook, and the plan is what says which assignments this run
  // updates at all.
  await warnGradeImpact(courseId, report, { courseDir });

  // Whether this run is still one that prunes, which a declined confirmation
  // makes it not. The report reads the answer rather than the flag: "nothing
  // above was deleted; each line says why" is a claim about the plan, and after
  // a decline there is no plan behind it to say why.
  let pruning = pruneCanvas;
  if (pruneCanvas) {
    pruning = await confirmPrune(courseId, report, { interactive, dryRun });
    if (!pruning) {
      // Re-planned rather than filtered, so the report is built from a plan
      // that never held those deletes: the orphans go back to being listed as
      // orphans, with the flag's own line under them.
      report = plan({ ...inputs, policy: { ...policy, pruneCanvas: false } });
    }
  }

  let outcome = { applied: [], errors: [] };
  if (dryRun) {
    log.info('[push] DRY RUN — nothing was written.');
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
    // A dry run executed nothing, so it gets no applied list and the report
    // reads as the preview it is. Every other run hands over what actually ran,
    // which for one the icon upload aborted is nothing.
    applied: dryRun ? undefined : outcome.applied,
    pruneCanvas: pruning,
    baseUrl: state.canvas_base_url,
    courseId,
  });
  if (lines.length > 0) {
    for (const line of lines) log.info(line);
  } else if (outcome.errors.length > 0) {
    // A bare report is not agreement: nothing got as far as being applied, and
    // the errors below are the whole account of this run.
    log.info('[push] Nothing was applied. See the errors below.');
  } else {
    log.info('[push] Canvas already holds everything in course/.');
  }

  if (outcome.errors.length > 0) {
    log.error(`\n[push] ${plural(outcome.errors.length, 'error')}:`);
    for (const failure of outcome.errors) {
      log.error(
        // A run-wide failure — the icon upload — names no path and no folder,
        // so it falls back to its own name rather than printing "undefined".
        `  - ${failure.action.itemPath || failure.action.folder || failure.action.type}: ${failure.error}`,
      );
    }
  }

  // A skip is a refusal push could not carry out, which under this policy means
  // a file whose `canvas_type` no longer matches the Canvas object it names.
  // Orphans and the informational sections do not fail the run: a course
  // mid-edit is a normal state.
  if (outcome.errors.length > 0 || report.skipped.length > 0) {
    process.exitCode = 1;
  }
}

/**
 * List what `--prune-canvas` is about to delete, name the student work behind
 * each item, and ask.
 *
 * Read off the plan's delete actions rather than off the sync state, so what is
 * listed is exactly what would run — including nothing, when the planner
 * declined to emit a delete it had a reason not to.
 *
 * A dry run deletes nothing, so it gets the listing and the warnings and no
 * question: hiding the deletes behind a prompt the run will never act on is the
 * opposite of what a preview is for.
 *
 * @returns {Promise<boolean>} Whether the deletes should stay in the plan.
 */
async function confirmPrune(courseId, report, { interactive, dryRun }) {
  const actions = report.actions || [];
  const doomedModules = actions.filter(
    (action) => action.type === 'delete-canvas-module',
  );
  const doomedItems = actions.filter(
    (action) => action.type === 'delete-canvas-item',
  );
  if (doomedModules.length === 0 && doomedItems.length === 0) {
    log.info('\n[push] Prune: nothing to remove from Canvas.');
    return true;
  }

  if (doomedModules.length > 0) {
    log.info(
      `\n[push] Prune: ${plural(doomedModules.length, 'locally-deleted module')} ` +
        'to remove from Canvas:',
    );
    for (const action of doomedModules) {
      log.info(`  - ${action.folder} (entire module)`);
    }
  }

  // Ask Canvas which of the doomed items carry student work before listing
  // them, so the listing can say so item by item. Both types that can hold
  // grades are counted: an assignment, and the discussion a graded topic hangs
  // its assignment off.
  await annotateSubmissions(courseId, doomedItems);
  const gradable = doomedItems.filter(
    (action) =>
      action.canvasType === 'assignment' || action.canvasType === 'discussion',
  );
  const risk = countSubmissionRisk(
    gradable.map((action) => action.hasSubmissions),
  );

  if (doomedItems.length > 0) {
    log.info(
      `\n[push] Prune: ${plural(doomedItems.length, 'locally-deleted item')} ` +
        'to remove from Canvas:',
    );
    for (const action of doomedItems) log.info(describeDoomedItem(action));
  }

  for (const line of submissionWarningLines(
    risk,
    submissionRiskNoun(gradable),
  )) {
    log.warn(`\n[push] ${line}`);
  }

  if (dryRun) return true;

  if (!interactive) {
    log.warn(
      `[push] ${plural(doomedModules.length + doomedItems.length, 'thing')} ` +
        'would be deleted, and this run cannot ask. Nothing was pruned; run ' +
        'it in a terminal.',
    );
    return false;
  }

  log.info(`\n[push] ${BACKUP_HINT}`);
  const rl = createRL();
  const answer = await prompt(
    rl,
    `[push] Delete these from Canvas${submissionRiskSuffix(risk)}? (y/N)`,
  );
  rl.close();
  const ok = answer.trim().toLowerCase() === 'y';
  if (!ok) log.info('[push] Nothing was deleted.');
  return ok;
}

// ---------------------------------------------------------------------------
// Grades an assignment update moves
// ---------------------------------------------------------------------------

/** A value as it should read inside a warning; an absent one says so. */
function describeValue(value) {
  if (value == null || value === '') return 'not set';
  if (Array.isArray(value)) return value.join(', ');
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/** Two dates are the same date when they name the same instant, however written. */
function asInstant(value) {
  if (value == null || value === '') return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? String(value) : time;
}

/** Submission types compare as a set: order and spacing are Canvas's business. */
function asTypeSet(value) {
  if (value == null) return '';
  const list = Array.isArray(value) ? value : String(value).split(',');
  return list
    .map((type) => String(type).trim())
    .filter(Boolean)
    .sort()
    .join(',');
}

/**
 * The three fields push sends that move grades on an assignment students have
 * already submitted to. Canvas applies each one silently: its web editor warns
 * about them, its API does not, so this is the only place the warning can come
 * from. `sent` reads what push is about to send, `live` what Canvas holds now.
 */
const GRADE_IMPACT_FIELDS = [
  {
    name: 'points_possible',
    sent: (opts) => opts.pointsPossible,
    live: (assignment) => assignment.points_possible,
    normalize: (value) =>
      value == null || value === '' ? null : Number(value),
    consequence:
      'Canvas does not rescale the grades already given: the raw scores stay ' +
      'as they are, so every percentage in that gradebook column moves.',
  },
  {
    name: 'due_at',
    sent: (opts) => opts.dueAt,
    live: (assignment) => assignment.due_at,
    normalize: asInstant,
    consequence:
      'Canvas recomputes late status against the new date, so an automatic ' +
      'late policy re-applies or drops its deductions on submissions that ' +
      'are already graded.',
  },
  {
    name: 'submission_types',
    sent: (opts) => opts.submissionTypes,
    live: (assignment) => assignment.submission_types,
    normalize: asTypeSet,
    consequence:
      'Canvas only accepts that change while an assignment has no ' +
      'submissions: it ignores this one, reports the push as a success, and ' +
      'keeps the value it already has, which the frontmatter no longer matches.',
  },
];

/**
 * The warning lines for one assignment about to be updated: one per field that
 * changes value and moves grades with it.
 *
 * An assignment with no submissions has no grades to move, so it stays silent.
 * A submission state that could not be read is never treated as that, though —
 * it gets the same warning, hedged.
 *
 * @param {string} label     - The assignment, named as it is in the warning.
 * @param {object} opts      - What push is about to send (from buildOpts).
 * @param {object} current   - The Canvas Assignment object as it stands.
 * @returns {string[]}
 */
function gradeImpactWarnings(label, opts, current) {
  const state = hasStudentSubmissions(current);
  if (state === false) return [];

  const lead =
    state === true
      ? `WARNING: ${label} has student submissions, and this push changes`
      : `WARNING: could not determine whether ${label} has student ` +
        'submissions, and this push changes';
  const hedge = state === true ? '' : 'Treat it as if it does. ';

  const lines = [];
  for (const field of GRADE_IMPACT_FIELDS) {
    const sent = field.sent(opts);
    // Not sent, not changed: buildOpts leaves a field out entirely when the
    // frontmatter has none, and Canvas keeps whatever it holds.
    if (sent === undefined) continue;
    const live = field.live(current);
    if (field.normalize(sent) === field.normalize(live)) continue;

    lines.push(
      `${lead} ${field.name} from ${describeValue(live)} to ` +
        `${describeValue(sent)}. ${hedge}${field.consequence}`,
    );
  }
  return lines;
}

/** The frontmatter of a local markdown item, or an empty object. */
function frontmatterOf(courseDir, itemPath) {
  try {
    const raw = fs.readFileSync(path.join(courseDir, itemPath), 'utf8');
    return parseFrontmatter(raw).data || {};
  } catch {
    return {};
  }
}

/**
 * The assignments a run will update, read off the plan.
 *
 * The plan is the only thing that knows which assignments this run touches, and
 * it distinguishes the two cases that matter on its own: an update names a
 * Canvas object that already exists and may hold student work, a create names
 * one that does not exist yet and cannot. An adoption is an ordinary update, so
 * an assignment claimed from an existing Canvas one is covered too.
 *
 * Each entry carries the options push itself will send, built by the same
 * `buildOpts` the executor calls, so the comparison can never drift from what
 * goes over the wire. The description is irrelevant to all three fields, so an
 * empty body is enough to build them.
 *
 * @param {object} report            - What `plan()` returned.
 * @param {object} options
 * @param {string} options.courseDir - Absolute path of `course/`.
 */
function collectUpdatedAssignments(report, { courseDir } = {}) {
  const updated = [];
  for (const action of (report && report.actions) || []) {
    if (action.type !== 'update-canvas-item') continue;
    if (action.canvasType !== 'assignment') continue;
    if (action.canvasId == null) continue;
    updated.push({
      title: action.title,
      relativePath: action.itemPath,
      canvasId: action.canvasId,
      opts: assignmentStrategy.buildOpts(
        action.title,
        '',
        frontmatterOf(courseDir, action.itemPath),
      ),
    });
  }
  return updated;
}

/**
 * Warn about every field this push is about to change on an assignment that
 * students have already submitted to.
 *
 * Push sends the whole assignment on every update, and three of those fields
 * move grades that are already in the gradebook. What gets sent is unchanged
 * and nothing is blocked: a re-weighting can be deliberate, and only the author
 * knows. Naming the old and the new value is what separates the deliberate
 * change from the typo.
 *
 * One list request answers it for the entire run: the Assignment objects a list
 * returns carry has_submitted_submissions along with the current value of all
 * three fields, so nothing needs fetching per assignment. A run that updates no
 * existing assignment makes no request at all.
 *
 * A lookup that fails costs the warning, never the push.
 *
 * @param {string|number} courseId
 * @param {object} report                       - What `plan()` returned.
 * @param {object} options
 * @param {string} options.courseDir            - Absolute path of `course/`.
 * @param {Function} [options.fetchAssignments] - Injection point for tests.
 * @returns {Promise<string[]>} The warning lines, already logged.
 */
async function warnGradeImpact(
  courseId,
  report,
  { courseDir, fetchAssignments = listAssignments } = {},
) {
  const updated = collectUpdatedAssignments(report, { courseDir });
  if (updated.length === 0) return [];

  let current;
  try {
    current = await fetchAssignments(courseId);
  } catch (err) {
    log.warn(
      '\n[push] WARNING: could not check the assignments for student ' +
        `submissions, so this push may change grades without saying so: ${err.message}`,
    );
    return [];
  }

  const byId = new Map();
  for (const assignment of current || []) {
    byId.set(String(assignment.id), assignment);
  }

  const lines = [];
  for (const { title, relativePath, canvasId, opts } of updated) {
    const assignment = byId.get(String(canvasId));
    // An id Canvas does not list is gone: the executor recreates the
    // assignment, and a new one holds no student work.
    if (!assignment) continue;
    lines.push(
      ...gradeImpactWarnings(`"${title}" (${relativePath})`, opts, assignment),
    );
  }

  for (const line of lines) log.warn(`\n[push] ${line}`);
  return lines;
}

// ---------------------------------------------------------------------------
// What a prune would take with it
// ---------------------------------------------------------------------------

/**
 * Annotate the doomed assignments and discussions with whether Canvas already
 * holds student submissions for them, as `hasSubmissions`: true, false, or null
 * when the lookup failed.
 *
 * The plan's delete actions carry Canvas ids and nothing about student work.
 * One list call for the whole course is cheaper than one fetch per doomed
 * assignment, and the Assignment objects a list returns carry the flag already.
 * Items of other types cost nothing: with no assignment and no discussion in
 * the list, no call is made.
 *
 * A discussion needs one more step. A graded discussion has an Assignment
 * behind it, and that is where its submissions and grades live, but the item's
 * own id is the DiscussionTopic id, which is keyed by nothing in the
 * assignments list. So each doomed topic — and only the doomed ones — is
 * fetched to find out whether it is graded and, if it is, which assignment id
 * to look up in the states already fetched. An ungraded topic has no gradebook
 * column and no submissions, which is a real "no".
 *
 * That fetch also answers a question no grade check covers: deleting a topic
 * deletes every reply in it, graded or not. The count rides along on the topic,
 * so it is kept as `replyCount` for the listing to name.
 *
 * A failed lookup leaves null behind, which the listing and the prompt report
 * as "could not determine" — never as "safe". That holds for a topic fetch that
 * fails too: an unreadable topic may well be a graded one.
 *
 * @param {string|number} courseId
 * @param {object[]} actions        - The plan's `delete-canvas-item` actions;
 *                                    annotated in place with `hasSubmissions`
 *                                    and, for a readable discussion,
 *                                    `replyCount`.
 * @param {Function} [fetchStates]  - Injection point for tests.
 * @param {Function} [fetchTopic]   - Injection point for tests.
 */
async function annotateSubmissions(
  courseId,
  actions,
  fetchStates = getSubmissionStates,
  fetchTopic = getDiscussion,
) {
  const assignments = actions.filter(
    (action) => action.canvasType === 'assignment',
  );
  const discussions = actions.filter(
    (action) => action.canvasType === 'discussion',
  );
  if (assignments.length === 0 && discussions.length === 0) return actions;

  // Resolve the doomed topics first, so a prune that only drops ungraded
  // discussions settles the question without listing the course's assignments.
  const gradedDiscussions = new Map();
  for (const action of discussions) {
    let topic;
    try {
      topic = await fetchTopic(courseId, action.canvasId);
    } catch (err) {
      log.warn(
        `[push] Could not check discussion ${action.canvasId} ` +
          `(${action.itemPath}) for grades: ${err.message}`,
      );
      action.hasSubmissions = null;
      continue;
    }
    // Deleting a topic deletes the replies in it whatever its grading, so the
    // count is worth keeping off every topic that was readable, not just the
    // graded ones. Canvas puts it on the topic, so it costs no extra call.
    if (typeof topic.discussion_subentry_count === 'number')
      action.replyCount = topic.discussion_subentry_count;
    if (!isGradedDiscussion(topic)) {
      // No gradebook column, so no submissions and no grades: a real "no".
      action.hasSubmissions = false;
      continue;
    }
    const assignmentId = discussionAssignmentId(topic);
    if (assignmentId == null) {
      // Graded, but Canvas named no assignment to look the grades up under.
      action.hasSubmissions = null;
      continue;
    }
    gradedDiscussions.set(action, String(assignmentId));
  }

  if (assignments.length === 0 && gradedDiscussions.size === 0) return actions;

  let states;
  try {
    states = await fetchStates(courseId);
  } catch (err) {
    log.warn(
      `[push] Could not check the assignments for student submissions: ${err.message}`,
    );
    for (const action of assignments) action.hasSubmissions = null;
    for (const action of gradedDiscussions.keys()) action.hasSubmissions = null;
    return actions;
  }

  // An id Canvas no longer lists is already gone, so there is no student work
  // left to lose: that is a real "no", not an unknown.
  for (const action of assignments) {
    const key = String(action.canvasId);
    action.hasSubmissions = states.has(key) ? states.get(key) : false;
  }
  // That reasoning does not carry over to a discussion. The item being deleted
  // is the topic, and the topic was just fetched, so it plainly exists and
  // plainly says it is graded; an assignment id that resolves to nothing is an
  // inconsistency in Canvas's own answer, not evidence that the topic is safe.
  // Unknown, therefore — the same as a graded topic that named no id at all.
  for (const [action, key] of gradedDiscussions) {
    action.hasSubmissions = states.has(key) ? states.get(key) : null;
  }
  return actions;
}

/**
 * How many replies a doomed discussion takes with it, as "14 replies", or null
 * when Canvas gave no count or the topic is empty.
 *
 * @param {object} action
 * @returns {string|null}
 */
function replyCountPhrase(action) {
  const count = action.replyCount;
  if (typeof count !== 'number' || !Number.isFinite(count) || count <= 0)
    return null;
  return `${count} ${count === 1 ? 'reply' : 'replies'}`;
}

/**
 * The listing line for one doomed item. An assignment or discussion with grades
 * behind it must not scan like a stray page, so it carries the reason on the
 * same line.
 *
 * A discussion loses more than a gradebook column: the topic goes with it, and
 * every reply students wrote in it. That is true of an ungraded topic too —
 * there are no grades to lose, but a term of student writing still goes — so a
 * discussion with replies in it is never a bare line, graded or not.
 */
function describeDoomedItem(action) {
  const line = `  - ${action.itemPath} (${action.canvasType})`;
  if (action.canvasType === 'discussion') {
    const replies = replyCountPhrase(action);
    if (action.hasSubmissions === true)
      return (
        `${line}  <-- GRADED DISCUSSION WITH STUDENT WORK: deletes the topic ` +
        `and ${replies ? `its ${replies}` : 'every student reply in it'}, plus ` +
        'the gradebook column and every grade'
      );
    if (action.hasSubmissions === null)
      return (
        `${line}  <-- SUBMISSION STATUS UNKNOWN: could not be checked, assume ` +
        `it is graded and that ${replies ? `its ${replies} and the grades` : 'replies and grades'} ` +
        'will be lost'
      );
    if (replies)
      return (
        `${line}  <-- ${replies.toUpperCase()} FROM STUDENTS: no grades at ` +
        'stake, and deleting the topic still deletes every one of them'
      );
    return line;
  }
  if (action.canvasType !== 'assignment') return line;
  if (action.hasSubmissions === true)
    return `${line}  <-- HAS STUDENT SUBMISSIONS: deletes the gradebook column and every grade in it`;
  if (action.hasSubmissions === null)
    return `${line}  <-- SUBMISSION STATUS UNKNOWN: could not be checked, assume grades will be lost`;
  return line;
}

/**
 * What the submission count in a prune warning is counting, singular.
 *
 * Two types can hold grades, so the aggregate line can only call itself
 * "assignments" while assignments are all it holds. One doomed graded
 * discussion makes "1 assignment being deleted has student submissions" a false
 * sentence over a listing whose only flagged entry is a discussion, so the count
 * switches to the type both of them are.
 *
 * The type is what decides it, not the risk: a doomed discussion that turned out
 * ungraded is still a discussion in the count, and reading "items" over a
 * listing that holds one costs nothing.
 *
 * @param {object[]} actions - The doomed items whose states were counted.
 * @returns {string}
 */
function submissionRiskNoun(actions) {
  return (actions || []).some((action) => action.canvasType === 'discussion')
    ? 'item'
    : 'assignment';
}

module.exports = push;
// Exported for testing
push._annotateSubmissions = annotateSubmissions;
push._collectUpdatedAssignments = collectUpdatedAssignments;
push._describeDoomedItem = describeDoomedItem;
push._gradeImpactWarnings = gradeImpactWarnings;
push._submissionRiskNoun = submissionRiskNoun;
push._warnGradeImpact = warnGradeImpact;
