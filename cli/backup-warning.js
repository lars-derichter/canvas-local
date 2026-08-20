const { createRL, prompt } = require('./module-utils');
const log = require('./logger');

/** Where the three backup routes are written out. Referenced by every warning. */
const BACKUP_DOC = 'docs/backups.md';

/**
 * The one sentence every destructive path ends on. Canvas has no undo, and a
 * course export takes a minute, so the pointer is worth repeating verbatim.
 */
const BACKUP_HINT = `Canvas has no undo. Back the course up first — see ${BACKUP_DOC}.`;

/**
 * Ask a yes/no question, defaulting to no. Anything other than "y" cancels,
 * so a non-interactive stdin (a CI run, a piped command) cancels rather than
 * proceeding into a deletion.
 */
async function confirm(question) {
  const rl = createRL();
  const answer = await prompt(rl, question);
  rl.close();
  return answer.trim().toLowerCase() === 'y';
}

/**
 * Summarise what a Canvas course already holds, as "3 modules, 12 pages".
 * Zero counts are dropped so the line stays readable.
 */
function describeContents({ modules, pages, assignments, files }) {
  const parts = [];
  const add = (n, singular) => {
    if (n > 0) parts.push(`${n} ${singular}${n === 1 ? '' : 's'}`);
  };
  add(modules, 'module');
  add(pages, 'page');
  add(assignments, 'assignment');
  add(files, 'file');
  return parts.join(', ');
}

/**
 * Split a list of submission states — true, false, or null for "could not be
 * determined" — into the two counts every deletion warning needs.
 *
 * Unknown is never folded into the safe count: a lookup that failed gets its
 * own warning rather than passing for "no grades at stake".
 *
 * @param {Array<boolean|null>} states
 * @returns {{graded: number, unknown: number}}
 */
function countSubmissionRisk(states) {
  let graded = 0;
  let unknown = 0;
  for (const state of states) {
    if (state === true) graded++;
    else if (state !== false) unknown++;
  }
  return { graded, unknown };
}

/**
 * The warning lines that precede a confirmation when content holding grades is
 * about to be deleted. That deletion is the one irreversible step that takes
 * student work with it, so both commands say so in the same words.
 *
 * `noun` is what the count is counting. `reset-canvas` only ever deletes
 * assignments, so it keeps the default and stays specific. A prune counts two
 * types — an assignment, and the assignment behind a graded discussion — and
 * passes "item", because a line reading "1 assignment being deleted" over a
 * listing whose only flagged entry is a discussion is a wrong line, not a
 * loose one. Both readings take the article "an".
 *
 * Returns an empty array when nothing being deleted carries that risk; the
 * caller prefixes each line with its own command tag.
 *
 * @param {{graded: number, unknown: number}} risk
 * @param {string} [noun] - What is being counted, singular.
 * @returns {string[]}
 */
function submissionWarningLines(
  { graded = 0, unknown = 0 } = {},
  noun = 'assignment',
) {
  const lines = [];
  if (graded > 0) {
    lines.push(
      `WARNING: ${graded} ${noun}${graded === 1 ? '' : 's'} being deleted ` +
        `${graded === 1 ? 'has' : 'have'} student submissions. Deleting an ` +
        `${noun} deletes its gradebook column and every submission and ` +
        'grade in it.',
    );
  }
  if (unknown > 0) {
    lines.push(
      `WARNING: could not determine whether ${unknown} ${noun}` +
        `${unknown === 1 ? '' : 's'} being deleted ` +
        `${unknown === 1 ? 'has' : 'have'} student submissions. Treat ` +
        `${unknown === 1 ? 'it' : 'them'} as if ` +
        `${unknown === 1 ? 'it does' : 'they do'}: deleting an ${noun} ` +
        'takes its gradebook column, submissions and grades with it.',
    );
  }
  return lines;
}

/**
 * What a confirmation question adds when grades are at stake, so the last
 * thing read before typing "y" names the student work, not just the files.
 * Empty when no assignment being deleted carries any.
 *
 * @param {{graded: number, unknown: number}} risk
 * @returns {string}
 */
function submissionRiskSuffix({ graded = 0, unknown = 0 } = {}) {
  if (graded > 0) return ', including the student submissions and grades';
  if (unknown > 0) return ', including any student submissions and grades';
  return '';
}

/**
 * Warn before the first push to a Canvas course that already holds content.
 *
 * A first push is the moment the tool starts managing a course it did not
 * create. It matches each local file to what is already there by type and
 * title and writes the local version over the match, which is how a live course
 * is taken over rather than duplicated; from then on `--prune-canvas` can
 * delete real content. Someone pointing the tool at a live course for the first
 * time deserves to hear that before it happens, not after.
 *
 * Returns true when the push should continue.
 *
 * @param {object} opts
 * @param {string|number} opts.courseId
 * @param {object} opts.syncData      - Loaded sync state.
 * @param {boolean} opts.dryRun       - A dry run changes nothing; never warn.
 * @param {Function} opts.fetchCounts - Async, returns the content counts.
 */
async function confirmFirstPush({ courseId, syncData, dryRun, fetchCounts }) {
  if (dryRun) return true;

  // Anything already tracked means this course is ours and has been pushed to
  // before. Only the very first push to an unknown course asks.
  const tracked = Object.keys((syncData && syncData.modules) || {}).length;
  if (tracked > 0) return true;

  let counts;
  try {
    counts = await fetchCounts();
  } catch (err) {
    // A failed pre-flight check must not block a legitimate push; the push
    // itself will surface the same connection problem with a better message.
    log.verbose(`Could not check existing Canvas content: ${err.message}`);
    return true;
  }

  const summary = describeContents(counts);
  if (!summary) return true;

  log.info(
    `\n[push] Canvas course ${courseId} already contains ${summary}, and this ` +
      'project has never pushed to it.',
  );
  log.info(
    '[push] Push matches your files to what is already in there by type and ' +
      'title, and writes your version over each match. Anything it cannot ' +
      'match is left exactly as it is, and listed at the end of the run.',
  );
  log.info(`[push] ${BACKUP_HINT}`);

  const ok = await confirm('[push] Continue? (y/N)');
  if (!ok) log.info('[push] Cancelled.');
  return ok;
}

/**
 * Warn before a pull rewrites the working tree, and stop for an answer when
 * `--force` is about to write over work git has no copy of.
 *
 * A pull overwrites — it is not a merge — and what makes that survivable is
 * git: the planner refuses to write over, or delete, any file `git status`
 * reports as modified or untracked, so the only copy of hand-written work is
 * never the one that goes. An ordinary pull therefore needs the pointer to the
 * backup routes and nothing else, and stays scriptable.
 *
 * `--force` switches that refusal off, and it is one lever rather than two: the
 * same flag that lets a pull overwrite an uncommitted file lets `--prune-local`
 * delete one. It is also the only way a pull writes anything at all outside a
 * git checkout, or anywhere git cannot be run — with no answer to work from
 * every file counts as dirty, and the guard covers the whole tree.
 *
 * So the question is asked exactly when the flag would change something: it
 * names how many files the guard is holding, and says why git could not answer
 * when that is the reason there are so many.
 *
 * A dry run writes nothing, so it is never asked: a preview that stops for
 * permission it will not use is not a preview, and a scripted `--dry-run
 * --force` with no terminal behind it would cancel instead of printing a plan.
 *
 * Returns true when the pull should continue.
 *
 * @param {object} opts
 * @param {boolean} opts.force       - The --force flag.
 * @param {number} opts.guarded      - How many local files the git guard holds.
 * @param {string} [opts.gitReason]  - Why git could not answer, when it could not.
 * @param {boolean} [opts.pruneLocal] - Whether this run also deletes.
 * @param {boolean} [opts.dryRun]    - A dry run changes nothing; never ask.
 */
async function confirmForcedPull({
  force,
  guarded = 0,
  gitReason = null,
  pruneLocal = false,
  dryRun = false,
}) {
  log.info(
    `[pull] A pull overwrites; git is what gives a file back. See ${BACKUP_DOC}.`,
  );

  if (!force || guarded < 1 || dryRun) return true;

  const files = `${guarded} local file${guarded === 1 ? '' : 's'}`;
  const fate = pruneLocal
    ? 'overwritten with the Canvas version, or deleted where Canvas no longer ' +
      'holds them'
    : 'overwritten with the Canvas version';
  log.info(
    gitReason
      ? `[pull] --force: ${gitReason}, so all ${files} under course/ count as ` +
          `holding work that exists nowhere else. Every one of them is ${fate}.`
      : `[pull] --force: ${files} hold uncommitted or untracked changes, and ` +
          `each is ${fate}. Git has no copy of what is in them.`,
  );

  const ok = await confirm('[pull] Overwrite local course files? (y/N)');
  if (!ok) log.info('[pull] Cancelled.');
  return ok;
}

module.exports = {
  BACKUP_DOC,
  BACKUP_HINT,
  confirm,
  confirmFirstPush,
  confirmForcedPull,
  countSubmissionRisk,
  describeContents,
  submissionRiskSuffix,
  submissionWarningLines,
};
