const { getSubmissionStates } = require('../lib/canvas/assignments');
const {
  getDiscussion,
  isGradedDiscussion,
  discussionAssignmentId,
} = require('../lib/canvas/discussions');
const {
  countSubmissionRisk,
  submissionWarningLines,
} = require('./backup-warning');
const { plural } = require('./report');
const log = require('./logger');

/**
 * What a prune is about to take with it, said out loud before it asks.
 *
 * Deleting a Canvas assignment or a graded discussion takes its gradebook
 * column, every submission and every grade in it, and none of that comes back.
 * A count cannot carry that: the author has to read which items are going and
 * which of them hold student work, and the question they answer has to say so
 * too.
 *
 * Both `push --prune-canvas` and `sync --prune-canvas` run the same delete
 * against the same course, so both say the same words about it. This lives here
 * rather than in either command for the same reason the report lives in
 * `cli/report.js`: a home inside one of them would make the other require a
 * command to print its own warning, and a command is an entry point rather than
 * a library. One module both import is what keeps the warning from drifting
 * between them.
 *
 * Everything here reads the **plan's delete actions**, so what is listed is
 * exactly what would run — including nothing, when the planner declined to emit
 * a delete it had a reason not to.
 */

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
 * @param {object} [options]
 * @param {string} [options.tag]    - The calling command's log tag, for the two
 *   lines a failed lookup leaves behind. Absent outside a command, where there
 *   is no command to name.
 */
async function annotateSubmissions(
  courseId,
  actions,
  fetchStates = getSubmissionStates,
  fetchTopic = getDiscussion,
  { tag } = {},
) {
  const prefix = tag ? `[${tag}] ` : '';
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
        `${prefix}Could not check discussion ${action.canvasId} ` +
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
      `${prefix}Could not check the assignments for student submissions: ` +
        err.message,
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
 * List everything a prune would remove from Canvas, name the student work
 * behind each item, and hand back the risk for the question to carry.
 *
 * @param {string|number} courseId
 * @param {object[]} actions   - The whole plan; the three Canvas delete types
 *                               are picked out here.
 * @param {object} options
 * @param {string} options.tag - The calling command's log tag.
 * @returns {Promise<{count: number, risk: {graded: number, unknown: number}}>}
 */
async function describeCanvasPrune(courseId, actions, { tag }) {
  const doomedModules = actions.filter(
    (action) => action.type === 'delete-canvas-module',
  );
  const doomedItems = actions.filter(
    (action) => action.type === 'delete-canvas-item',
  );
  // An embedded binary is neither: it sits in the course Files area, in no
  // module at all. It still has to be listed and still has to be asked about —
  // a delete this function does not count is a delete that runs unannounced.
  const doomedFiles = actions.filter(
    (action) => action.type === 'delete-canvas-file',
  );
  const count = doomedModules.length + doomedItems.length + doomedFiles.length;
  if (count === 0) {
    log.info(`\n[${tag}] Prune: nothing to remove from Canvas.`);
    return { count, risk: { graded: 0, unknown: 0 } };
  }

  if (doomedModules.length > 0) {
    log.info(
      `\n[${tag}] Prune: ${plural(doomedModules.length, 'locally-deleted module')} ` +
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
  await annotateSubmissions(courseId, doomedItems, undefined, undefined, {
    tag,
  });
  const gradable = doomedItems.filter(
    (action) =>
      action.canvasType === 'assignment' || action.canvasType === 'discussion',
  );
  const risk = countSubmissionRisk(
    gradable.map((action) => action.hasSubmissions),
  );

  if (doomedItems.length > 0) {
    log.info(
      `\n[${tag}] Prune: ${plural(doomedItems.length, 'locally-deleted item')} ` +
        'to remove from Canvas:',
    );
    for (const action of doomedItems) log.info(describeDoomedItem(action));
  }

  if (doomedFiles.length > 0) {
    log.info(
      `\n[${tag}] Prune: ${plural(doomedFiles.length, 'embedded file')} ` +
        'nothing in course/ points at any more, to remove from Canvas:',
    );
    for (const action of doomedFiles) {
      log.info(`  - ${action.itemPath} ("${action.title}")`);
    }
  }

  for (const line of submissionWarningLines(
    risk,
    submissionRiskNoun(gradable),
  )) {
    log.warn(`\n[${tag}] ${line}`);
  }

  return { count, risk };
}

/**
 * List everything a prune would remove from the working tree.
 *
 * No submission check and no risk: deleting a local file costs whatever git has
 * no copy of, which is a different warning and the caller's to give. The git
 * guard keeps a file holding uncommitted work out of the plan in the first
 * place, so nothing here is the only copy unless `--force` said so.
 *
 * @param {object[]} actions   - The whole plan; the two local delete types are
 *                               picked out here.
 * @param {object} options
 * @param {string} options.tag - The calling command's log tag.
 * @returns {{count: number}}
 */
function describeLocalPrune(actions, { tag }) {
  const doomedModules = actions.filter(
    (action) => action.type === 'delete-local-module',
  );
  const doomedItems = actions.filter(
    (action) => action.type === 'delete-local-item',
  );
  const count = doomedModules.length + doomedItems.length;
  if (count === 0) {
    log.info(`\n[${tag}] Prune: nothing to remove from course/.`);
    return { count };
  }

  if (doomedModules.length > 0) {
    log.info(
      `\n[${tag}] Prune: ${plural(doomedModules.length, 'module folder')} gone ` +
        'from Canvas, to delete here:',
    );
    for (const action of doomedModules) {
      log.info(`  - ${action.folder}/ (the whole folder)`);
    }
  }

  if (doomedItems.length > 0) {
    log.info(
      `\n[${tag}] Prune: ${plural(doomedItems.length, 'file')} gone from ` +
        'Canvas, to delete here:',
    );
    for (const action of doomedItems) {
      log.info(`  - ${action.itemPath} (${action.canvasType})`);
    }
  }

  return { count };
}

module.exports = {
  annotateSubmissions,
  describeCanvasPrune,
  describeDoomedItem,
  describeLocalPrune,
  submissionRiskNoun,
};
