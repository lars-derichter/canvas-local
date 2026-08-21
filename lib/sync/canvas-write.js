const path = require('path');

const {
  createAssignment,
  updateAssignment,
  getAssignment,
  isQuizBackedAssignment,
} = require('../canvas/assignments');
const {
  createDiscussion,
  updateDiscussion,
  gradedDiscussionWarning,
} = require('../canvas/discussions');
const {
  listExternalTools,
  findToolForUrl,
  describeInstalledTools,
} = require('../canvas/external-tools');
const { createPage, updatePage } = require('../canvas/pages');
const { listQuizzes } = require('../canvas/quizzes');
const log = require('../../cli/logger');

/**
 * What this tool sends Canvas, per type — and the one thing it refuses to send.
 *
 * `lib/sync/apply.js` knows the shape of an action and nothing about the shape
 * of an assignment. This is the other half of a Canvas write: given a title, a
 * body and the file's frontmatter, what exactly a page, an assignment or a
 * discussion looks like on the wire; what has to be resolved before a quiz or
 * an LTI link can be placed at all; and which delete must not go ahead.
 *
 * All of it lived in `cli/push.js` until the engine took the writes over, and
 * the engine borrowed it back through a lazy `require`, which is the only thing
 * that kept the cycle from forming. It is here now because the arrow points one
 * way: `cli/` depends on `lib/`, never the reverse. `cli/push.js` still uses
 * `assignmentStrategy` itself — the grade-impact warning compares what a push
 * is about to send against what Canvas holds — and imports it from here like
 * any other caller.
 *
 * There is one definition of each of these on purpose. A second copy would be a
 * second answer, and the two would drift the first time an assignment gained a
 * field.
 */

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
 *
 * A file that names no launch URL is refused, and refused by throwing, for the
 * reason `pushQuiz` is. It is also the same refusal `apply.js` already throws
 * for a `canvas_type: external_url` with no `external_url`, so one missing
 * field now gets one answer whichever of the two types names it.
 */
async function pushExternalTool(
  courseId,
  { title, position, indent, frontmatter },
  dryRun,
) {
  const url = frontmatter.external_url;
  if (!url) {
    throw new Error(
      `"${title}" declares canvas_type external_tool but names no ` +
        'external_url in its frontmatter. Canvas works out which tool answers ' +
        'a link from its launch URL, so there is nothing to place without ' +
        'one, and nothing was created.',
    );
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
 *
 * Handed back rather than logged, because the caller throws it and a thrown
 * message reaches the author under `--quiet`, where a `log.warn` does not. It
 * carries the procedure rather than a pointer to it for the same reason: this
 * is the whole of what a scripted run is told about an item it did not get.
 *
 * @returns {string} Why the item cannot be placed, and what to do about it.
 */
function quizNotImportedRefusal(title, quizRef) {
  if (!quizRef) {
    return (
      `"${title}" was not placed: this course holds no quiz by that name, ` +
      'and the file names no quiz_ref either, so there is no package to ' +
      `import. Create the quiz in Canvas under the title "${title}", or ` +
      'point quiz_ref at its QTI .zip (path from the repository root), then ' +
      'push again.'
    );
  }
  return (
    `"${title}" was not placed: this course holds no quiz by that name yet, ` +
    `and Canvas has no API for a QTI import, so ${quizRef} has to go in by ` +
    'hand.\n' +
    'In Canvas: the course, Settings, Import Course Content. Content type ' +
    `"QTI .zip file"; choose ${quizRef}. Leave the default question bank, and ` +
    'tick "Import existing quizzes as New Quizzes" only if the course uses ' +
    'New Quizzes. Import, and wait for "Completed" under Current Jobs.\n' +
    'The quiz arrives unpublished and QTI carries neither dates nor a time ' +
    'limit: check every question and point value, set the availability dates ' +
    'and the time limit, then publish. Push again after that. The quiz is ' +
    `found by its title, so leave it named "${title}" in Canvas, and its id ` +
    'is recorded in the sync state.'
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
 * creating it, and the item cannot be placed at all.
 *
 * Two quizzes under one title are ambiguous and cannot be placed either. A
 * guess would link students to the wrong quiz, and this is exactly the state a
 * second import of the same package leaves behind, so it is a case that
 * happens.
 *
 * Both throw. Neither used to: they warned and returned null, and a null is
 * something a caller has to remember to check. `createCanvasItem` read it as
 * "nothing left to do", returned, and `applyPlan` counted the action as
 * applied — so the run reported an item it had not created, wrote no row for
 * it, and exited 0, with the only trace a warning that `--quiet` drops. A
 * throw is the one answer a caller cannot spend by accident: it costs that
 * item and nothing else, lands in the run's error list with its reason
 * intact, and fails the run, which is what a refusal does everywhere else in
 * this tool.
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
      throw new Error(
        `"${title}" was not placed: ${matches.length} quizzes in this course ` +
          `carry that title (ids ${matches.map((quiz) => quiz.id).join(', ')}), ` +
          'and picking one would be a guess.\n' +
          'Importing a QTI package a second time adds a quiz rather than ' +
          'replacing the first, which is the ordinary way to arrive here. ' +
          'Delete the stale one in Canvas, or put the id you mean in this ' +
          "item's canvas_id in .canvas-sync.json, then push again.",
      );
    }

    if (matches.length === 0) {
      throw new Error(quizNotImportedRefusal(title, quizRef));
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

// ---------------------------------------------------------------------------
// What it refuses to send
// ---------------------------------------------------------------------------

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

module.exports = {
  pageStrategy,
  assignmentStrategy,
  discussionStrategy,
  buildFileResolver,
  pushExternalTool,
  pushQuiz,
  refuseQuizBackedDelete,
};
