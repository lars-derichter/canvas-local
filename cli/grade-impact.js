const fs = require('fs');
const path = require('path');

const { parseFrontmatter } = require('../lib/convert/frontmatter');
const {
  listAssignments,
  hasStudentSubmissions,
} = require('../lib/canvas/assignments');
const { assignmentStrategy } = require('../lib/sync/canvas-write');
const log = require('./logger');

/**
 * The grades an assignment update moves.
 *
 * Three of the fields this tool sends on an assignment update change marks that
 * are already in the gradebook, and Canvas applies every one of them silently:
 * its web editor warns about them, its API does not. So this is the only place
 * the warning can come from, and it has to reach every command that writes to
 * Canvas — `push` and `sync` both do.
 *
 * It lives here rather than in either of them for the same reason the report
 * lives in `cli/report.js`: a home inside one of them would make the other
 * require a command to warn about its own writes, and a command is an entry
 * point rather than a library. One module both can import is what keeps the two
 * commands warning in the same words about the same fields, which is the whole
 * point of a warning that must not drift.
 *
 * Everything here runs **between plan and apply, over the plan**, which is what
 * makes it answerable from one list request.
 */

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
 * The three fields a write sends that move grades on an assignment students
 * have already submitted to. `sent` reads what the run is about to send, `live`
 * what Canvas holds now.
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
      'submissions: it ignores this one, reports the write as a success, and ' +
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
 * @param {object} opts      - What the run is about to send (from buildOpts).
 * @param {object} current   - The Canvas Assignment object as it stands.
 * @returns {string[]}
 */
function gradeImpactWarnings(label, opts, current) {
  const state = hasStudentSubmissions(current);
  if (state === false) return [];

  const lead =
    state === true
      ? `WARNING: ${label} has student submissions, and this run changes`
      : `WARNING: could not determine whether ${label} has student ` +
        'submissions, and this run changes';
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
 * Each entry carries the options the run itself will send, built by the same
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
 * Warn about every field this run is about to change on an assignment that
 * students have already submitted to.
 *
 * The whole assignment goes on every update, and three of those fields move
 * grades that are already in the gradebook. What gets sent is unchanged and
 * nothing is blocked: a re-weighting can be deliberate, and only the author
 * knows. Naming the old and the new value is what separates the deliberate
 * change from the typo.
 *
 * One list request answers it for the entire run: the Assignment objects a list
 * returns carry has_submitted_submissions along with the current value of all
 * three fields, so nothing needs fetching per assignment. A run that updates no
 * existing assignment makes no request at all.
 *
 * A lookup that fails costs the warning, never the run.
 *
 * @param {string|number} courseId
 * @param {object} report                       - What `plan()` returned.
 * @param {object} options
 * @param {string} options.courseDir            - Absolute path of `course/`.
 * @param {string} options.tag                  - The calling command's log tag.
 * @param {Function} [options.fetchAssignments] - Injection point for tests.
 * @returns {Promise<string[]>} The warning lines, already logged.
 */
async function warnGradeImpact(
  courseId,
  report,
  { courseDir, tag, fetchAssignments = listAssignments } = {},
) {
  const updated = collectUpdatedAssignments(report, { courseDir });
  if (updated.length === 0) return [];

  let current;
  try {
    current = await fetchAssignments(courseId);
  } catch (err) {
    log.warn(
      `\n[${tag}] WARNING: could not check the assignments for student ` +
        `submissions, so this run may change grades without saying so: ${err.message}`,
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

  for (const line of lines) log.warn(`\n[${tag}] ${line}`);
  return lines;
}

module.exports = {
  collectUpdatedAssignments,
  gradeImpactWarnings,
  warnGradeImpact,
};
