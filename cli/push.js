const fs = require('fs');
const path = require('path');

const { parseFrontmatter } = require('../lib/convert/frontmatter');
const { listModules } = require('../lib/canvas/modules');
const { createPage, updatePage, listPages } = require('../lib/canvas/pages');
const {
  createAssignment,
  updateAssignment,
  getAssignment,
  listAssignments,
  getSubmissionStates,
  hasStudentSubmissions,
  isQuizBackedAssignment,
} = require('../lib/canvas/assignments');
const {
  createDiscussion,
  updateDiscussion,
  getDiscussion,
  isGradedDiscussion,
  discussionAssignmentId,
  gradedDiscussionWarning,
} = require('../lib/canvas/discussions');
const {
  listExternalTools,
  findToolForUrl,
  describeInstalledTools,
} = require('../lib/canvas/external-tools');
const { listQuizzes } = require('../lib/canvas/quizzes');
const { plan } = require('../lib/sync/plan');
const { applyPlan } = require('../lib/sync/apply');
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
 * The three content strategies below, plus `buildFileResolver`, `pushQuiz`,
 * `pushExternalTool` and `refuseQuizBackedDelete`, are still borrowed by
 * `lib/sync/apply.js` through `pushInternals()`. They are the definition of
 * what this tool sends Canvas per type, and they live here until they get a
 * home of their own.
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
  if (lines.length === 0) {
    log.info('[push] Canvas already holds everything in course/.');
  } else {
    for (const line of lines) log.info(line);
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

/**
 * Why a delete must not go ahead on this assignment, or null when it may.
 *
 * Canvas lists the gradebook half of a graded Classic Quiz among the course's
 * assignments, and a `DELETE` on it deletes the quiz, its questions and every
 * submission. A local file that claimed `canvas_type: assignment` for such an
 * id is a mismatch between what the file says and what Canvas holds, and only
 * the author can settle it — so the delete stops, and stops equally when the
 * check itself could not be made. Nothing is destroyed on a guess.
 *
 * A 404 is not a refusal: the assignment is already gone, and the delete that
 * follows reports it as such.
 *
 * The check costs one request per doomed assignment, on a path that runs only
 * after the user has confirmed a deletion. Called by `lib/sync/apply.js`, which
 * is where deletes are executed.
 *
 * @param {string|number} courseId
 * @param {object} item              - A doomed item of type `assignment`.
 * @param {Function} [fetchOne]      - Injection point for tests.
 * @returns {Promise<{lines: string[], error: string}|null>}
 */
async function refuseQuizBackedDelete(
  courseId,
  item,
  fetchOne = getAssignment,
) {
  let assignment;
  try {
    assignment = await fetchOne(courseId, item.canvasId);
  } catch (err) {
    if (err.message.includes('404')) return null;
    return {
      lines: [
        `could not check whether assignment ${item.canvasId} is really a quiz ` +
          `(${err.message}). Canvas lists the gradebook half of a graded quiz ` +
          'among the assignments, and deleting that deletes the quiz with it, ' +
          'so this one is left where it is.',
      ],
      error:
        `assignment ${item.canvasId} not deleted: could not check whether it ` +
        `belongs to a quiz (${err.message})`,
    };
  }

  if (!isQuizBackedAssignment(assignment)) return null;

  const quiz =
    assignment.quiz_id != null ? `quiz ${assignment.quiz_id}` : 'a quiz';
  return {
    lines: [
      `assignment ${item.canvasId} is the gradebook half of ${quiz}, and ` +
        'deleting it deletes the quiz, its questions and every submission on it.',
      'The local file claimed canvas_type: assignment for a Canvas object that ' +
        'is really a quiz. Settle that in Canvas: delete the quiz there if that ' +
        'is what you meant, or put the file back as canvas_type: quiz if it ' +
        'should stay. Nothing was deleted, so the next prune asks again.',
    ],
    error: `assignment ${item.canvasId} not deleted: it is the gradebook half of ${quiz}`,
  };
}

// ---------------------------------------------------------------------------
// What this tool sends Canvas, per type
// ---------------------------------------------------------------------------

/** Strategy for pushing pages. */
const pageStrategy = {
  canvasType: 'page',
  label: 'Page',
  buildOpts: (title, html) => ({ title, body: html }),
  create: createPage,
  update: updatePage,
  extractId: (result) => result.page_id || result.url,
  extractSlug: (result) => result.url,
  buildModuleItem: (title, slug, position, indent) => ({
    title,
    type: 'Page',
    pageUrl: slug,
    position,
    indent,
  }),
};

/** Strategy for pushing assignments. */
const assignmentStrategy = {
  canvasType: 'assignment',
  label: 'Assignment',
  buildOpts: (title, html, frontmatter) => {
    const opts = { name: title, description: html };
    if (frontmatter.points_possible != null)
      opts.pointsPossible = frontmatter.points_possible;
    if (frontmatter.submission_types)
      opts.submissionTypes = frontmatter.submission_types;
    if (frontmatter.due_at) opts.dueAt = frontmatter.due_at;
    if (frontmatter.unlock_at) opts.unlockAt = frontmatter.unlock_at;
    if (frontmatter.lock_at) opts.lockAt = frontmatter.lock_at;
    if (frontmatter.published != null) opts.published = frontmatter.published;
    return opts;
  },
  create: createAssignment,
  update: updateAssignment,
  extractId: (result) => result.id,
  extractSlug: null,
  buildModuleItem: (title, contentId, position, indent) => ({
    title,
    type: 'Assignment',
    contentId,
    position,
    indent,
  }),
};

/**
 * Say so when Canvas reports the topic it just took as graded, and hand the
 * result straight back so this can wrap create and update.
 */
function warnIfGradedDiscussion(result) {
  const line = gradedDiscussionWarning(result);
  if (line) log.warn(`    [push] ${line}`);
  return result;
}

/** Strategy for pushing discussions. */
const discussionStrategy = {
  canvasType: 'discussion',
  label: 'Discussion',
  buildOpts: (title, html, frontmatter) => {
    const opts = { title, message: html };
    if (frontmatter.discussion_type)
      opts.discussionType = frontmatter.discussion_type;
    if (frontmatter.require_initial_post != null)
      opts.requireInitialPost = frontmatter.require_initial_post;
    if (frontmatter.delayed_post_at)
      opts.delayedPostAt = frontmatter.delayed_post_at;
    if (frontmatter.lock_at) opts.lockAt = frontmatter.lock_at;
    if (frontmatter.published != null) opts.published = frontmatter.published;
    return opts;
  },
  create: async (courseId, opts) =>
    warnIfGradedDiscussion(await createDiscussion(courseId, opts)),
  update: async (courseId, id, opts) =>
    warnIfGradedDiscussion(await updateDiscussion(courseId, id, opts)),
  extractId: (result) => result.id,
  extractSlug: null,
  buildModuleItem: (title, contentId, position, indent) => ({
    title,
    type: 'Discussion',
    contentId,
    position,
    indent,
  }),
};

/**
 * Build a file resolver callback for a given markdown file.
 * Resolves relative file paths to Canvas file URLs using syncData.files.
 */
function buildFileResolver(currentFilePath, syncData) {
  return (href) => {
    if (!href || /^(https?:\/\/|\/\/|#|mailto:)/.test(href)) return null;
    if (href.endsWith('.md')) return null;

    const currentDir = path.posix.dirname(currentFilePath);
    const resolved = path.posix.normalize(path.posix.join(currentDir, href));
    const entry = syncData.files[resolved];
    if (!entry) return null;

    const baseUrl = syncData.canvas_base_url || '';
    return `${baseUrl}${entry.canvas_url}`;
  };
}

/**
 * Say that no installed tool claims this launch URL, and what to do about it.
 *
 * The remedies are the two that outlive a single push. An account-level install
 * is inherited by every course in the account — a course resolves a tool by
 * searching itself and then its account chain — so it keeps working after a
 * rollover to next year's course, which a stored tool id never would. Course
 * Copy is the other one: Canvas carries the tool installation over itself.
 *
 * The tool list is fetched only here, on the failure path, and only to name
 * what is installed: it cannot decide the question, because for LTI 1.3 it
 * over-reports tools that Canvas then filters by context controls.
 */
async function warnNoMatchingTool(courseId, title, url) {
  log.warn(
    `  [push] WARNING: no external tool in this course matches the launch URL of "${title}" (${url}). ` +
      'Canvas creates the module item anyway and reports no error; the failure only shows when a ' +
      'student clicks it and gets "Couldn\'t find valid settings for this link".',
  );

  let installed;
  try {
    installed = describeInstalledTools(await listExternalTools(courseId));
  } catch (err) {
    installed = `the tools installed here could not be listed (${err.message})`;
  }
  log.warn(`    [push] Right now ${installed}.`);

  log.warn(
    '    [push] Two ways to fix it for good: ask your Canvas admin to install the tool at ACCOUNT ' +
      'level, because a course resolves a tool by searching itself and then its account chain — an ' +
      'account-level tool is therefore present in every future course and survives a rollover; or ' +
      "seed the new course with Canvas's own Course Copy, which carries the tool installation over " +
      'with it.',
  );
}

/**
 * Push an LTI link as a module item.
 *
 * Like an external URL, an external tool has no Canvas object of its own to
 * create or update — the module item is the whole of it, and Canvas resolves
 * which tool answers it from the launch URL every time. That is also what makes
 * the type survive a rollover: a launch URL still means something in next
 * year's course, a tool id from this year's does not.
 *
 * So this probes the launch URL and describes the item; placing it, and writing
 * down the id Canvas gives it, belongs to `lib/sync/apply.js`.
 */
async function pushExternalTool(
  courseId,
  { title, position, indent, frontmatter },
  dryRun,
) {
  const url = frontmatter.external_url;
  if (!url) {
    log.warn(
      `  [push] WARNING: Skipping "${title}" — canvas_type is external_tool but external_url field is missing in frontmatter`,
    );
    return null;
  }

  log.info(`  [push] External tool module item: ${title} -> ${url}`);

  const moduleItem = {
    title,
    type: 'ExternalTool',
    externalUrl: url,
    position,
    indent,
    ...(frontmatter.new_tab != null ? { newTab: frontmatter.new_tab } : {}),
  };
  // The frontmatter describes the item on its own; the probe below is the only
  // part that costs a request, so a dry run stops here.
  if (dryRun) return moduleItem;

  // Canvas fails silently on an unmatched launch URL, so ask first. Whatever
  // the answer, the item is still created: a visible broken item the author can
  // see and fix beats dropping their content on the floor.
  const probe = await findToolForUrl(courseId, url);
  if (probe.status === 'no-match') {
    await warnNoMatchingTool(courseId, title, url);
  } else if (probe.status === 'unknown') {
    log.warn(
      `  [push] WARNING: could not check whether an external tool matches the launch URL of ` +
        `"${title}" (${url}): ${probe.reason}. The item is created without the check — this says ` +
        'nothing about whether it works, so open it in Canvas to be sure.',
    );
  }

  return moduleItem;
}

/**
 * Say that the quiz this item points at is not in the course, and how to put it
 * there.
 *
 * The steps are the ones `/quiz-build` prints beside the package it generated
 * (`.agents/skills/quiz-build/SKILL.md`), because a QTI package has no API
 * import: Canvas takes it only through the web interface. Naming the zip is the
 * point — it is the one thing that says which package this item is waiting for.
 */
function warnQuizNotImported(title, quizRef) {
  if (!quizRef) {
    log.warn(
      `  [push] WARNING: Skipping "${title}" — this course holds no quiz by that name, and this ` +
        'file names no quiz_ref, so there is no package to import either. Create the quiz in ' +
        `Canvas under the title "${title}", or point quiz_ref at its QTI .zip (path from the ` +
        'repository root), then push again.',
    );
    return;
  }
  log.warn(
    `  [push] WARNING: Skipping "${title}" — this course holds no quiz by that name yet. ` +
      `Import ${quizRef} by hand first; Canvas has no API for a QTI import:`,
  );
  log.warn(
    '    [push] 1. Canvas -> the course -> Settings -> Import Course Content.',
  );
  log.warn(`    [push] 2. Content Type "QTI .zip file"; choose ${quizRef}.`);
  log.warn(
    '    [push] 3. Leave the default question bank; tick "Import existing quizzes as New ' +
      'Quizzes" only if the course uses New Quizzes.',
  );
  log.warn(
    '    [push] 4. Import, and wait for "Completed" under Current Jobs.',
  );
  log.warn(
    '    [push] 5. The quiz arrives unpublished: check every question and point value, set ' +
      'the availability dates and the time limit (QTI carries none of those), then publish.',
  );
  log.warn(
    `    [push] Then push again. The quiz is found by its title, so leave it named "${title}" ` +
      'in Canvas, and its id is recorded in the sync state.',
  );
}

/**
 * Add a quiz to a module as an item, and never touch the quiz itself.
 *
 * A Classic Quiz has no markdown source: the QTI package named by `quiz_ref` is
 * what produced it, and it entered Canvas through a manual import. So this
 * describes the module item and stops there — no create, no update, no delete
 * on the quiz object, which holds questions and submissions that nothing here
 * could reconstruct.
 *
 * Which quiz an item names is resolved from the id the sync state holds for
 * this path while the course still lists it, and by title otherwise, handing
 * the id it found back for the caller to record. That is the stale-id recovery
 * the content types get for free, with the one difference that a quiz can only
 * ever be found: when the title matches nothing there is no falling back to
 * creating it, and the item is skipped with the import procedure printed.
 *
 * Two quizzes under one title are ambiguous and also skipped. A guess would
 * link students to the wrong quiz, and this is exactly the state a second
 * import of the same package leaves behind, so it is a case that happens.
 *
 * `quiz_ref` does not gate any of that. It names the package to import when the
 * quiz is missing, and it is what lets a rollover into a fresh course rebuild
 * one, so `validate` warns when it is absent. But a quiz pulled from Canvas
 * never has one, and refusing to place an item whose id resolves would drop
 * that quiz out of its module on the next push — the loss this type exists to
 * prevent.
 */
async function pushQuiz(
  courseId,
  { title, canvasId, position, indent, frontmatter },
  dryRun,
) {
  const quizRef = frontmatter.quiz_ref;

  log.info(`  [push] Adding quiz module item: ${title}`);
  if (dryRun) {
    // Which quiz an item names is resolved against the course's quiz list, and
    // a dry run does not fetch it. An id the sync state already holds is enough
    // to place the item in the plan; without one there is nothing to plan yet,
    // and guessing at a create would be wrong — a quiz is never created here.
    return canvasId != null
      ? { title, type: 'Quiz', contentId: canvasId, position, indent }
      : null;
  }

  const quizzes = (await listQuizzes(courseId)) || [];
  let quizId = null;

  if (
    canvasId != null &&
    quizzes.some((quiz) => String(quiz.id) === String(canvasId))
  ) {
    quizId = canvasId;
  } else {
    if (canvasId != null) {
      log.warn(
        `    [push] Quiz ${canvasId} is no longer in this course, matching "${title}" by title instead`,
      );
    }

    const wanted = String(title).trim();
    const matches = quizzes.filter(
      (quiz) => String(quiz.title || '').trim() === wanted,
    );

    if (matches.length > 1) {
      log.warn(
        `  [push] WARNING: Skipping "${title}" — ${matches.length} quizzes in this course carry ` +
          `that title (ids ${matches.map((quiz) => quiz.id).join(', ')}), and picking one would be ` +
          'a guess. Importing a QTI package a second time adds a quiz rather than replacing the ' +
          "first: delete the stale one in Canvas, or put the id you mean in this item's " +
          'canvas_id in .canvas-sync.json.',
      );
      return null;
    }

    if (matches.length === 0) {
      warnQuizNotImported(title, quizRef);
      return null;
    }

    quizId = matches[0].id;
    log.verbose(`Matched quiz "${title}" by title: id ${quizId}`);
  }

  return {
    title,
    type: 'Quiz',
    contentId: quizId,
    position,
    indent,
  };
}

module.exports = push;
// Borrowed by lib/sync/apply.js through pushInternals(); see the note there.
push._pageStrategy = pageStrategy;
push._assignmentStrategy = assignmentStrategy;
push._discussionStrategy = discussionStrategy;
push._buildFileResolver = buildFileResolver;
push._pushQuiz = pushQuiz;
push._pushExternalTool = pushExternalTool;
push._refuseQuizBackedDelete = refuseQuizBackedDelete;
// Exported for testing
push._annotateSubmissions = annotateSubmissions;
push._collectUpdatedAssignments = collectUpdatedAssignments;
push._describeDoomedItem = describeDoomedItem;
push._gradeImpactWarnings = gradeImpactWarnings;
push._submissionRiskNoun = submissionRiskNoun;
push._warnGradeImpact = warnGradeImpact;
