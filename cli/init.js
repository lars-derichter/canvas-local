const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const { PROJECT_ROOT } = require('./project-root');
const { createRL, prompt } = require('./module-utils');
const { normaliseBaseUrl } = require('../lib/canvas/client');
const { RefusalError } = require('../lib/errors');
const {
  emptyState,
  loadState,
  saveState,
  SYNC_FILE,
} = require('../lib/sync/state');

const ENV_FILE = path.join(PROJECT_ROOT, '.env');

/**
 * Whether an existing sync state describes the course `init` is about to write.
 *
 * A file that claims no course — written while `CANVAS_COURSE_ID` was unset —
 * contradicts nothing, so its mappings are kept: they were built against
 * whatever course was configured at the time, which is the one being named now.
 *
 * @param {object} syncData
 * @param {{courseId: string|number, canvasBaseUrl: string}} target
 * @returns {boolean}
 */
function describesSameCourse(syncData, { courseId, canvasBaseUrl }) {
  const fileCourse =
    syncData.course_id != null && Number(syncData.course_id) !== 0
      ? String(syncData.course_id)
      : '';
  if (fileCourse && fileCourse !== String(courseId)) return false;

  const fileUrl = normaliseBaseUrl(syncData.canvas_base_url);
  const targetUrl = normaliseBaseUrl(canvasBaseUrl);
  if (fileUrl && targetUrl && fileUrl !== targetUrl) return false;

  return true;
}

/**
 * What an existing sync state says it describes, for the line that explains why
 * its ids are being dropped.
 *
 * @param {object} syncData
 * @returns {string}
 */
function describeSyncTarget(syncData) {
  const course =
    syncData.course_id != null && Number(syncData.course_id) !== 0
      ? `course ${syncData.course_id}`
      : 'another course';
  const url = normaliseBaseUrl(syncData.canvas_base_url);
  return url ? `${course} on ${url}` : course;
}

/**
 * The three values an existing `.env` already carries, to offer back as the
 * default answers. Empty strings for a file that is not there, and for a key
 * it does not mention.
 *
 * Through `dotenv` rather than a regex per key, because `dotenv` is what every
 * command reads this same file with (`cli/index.js`), and the two disagreeing
 * is what made this worth changing. `^CANVAS_API_URL=(.*)$` reads the value as
 * whatever sits after the `=`, quotes and inline comment included, and insists
 * the key start the line. So `export CANVAS_API_URL=...` and an indented key
 * matched nothing at all and a re-init offered a blank where a working value
 * sat; and an ordinary `CANVAS_COURSE_ID="45083"` offered `"45083"` back, which
 * accepted unchanged wrote `course_id: null` into the sync state, because
 * `Number('"45083"')` is NaN and JSON has no NaN. That is the very
 * `.env`-against-state mismatch this command exists to repair, manufactured by
 * the command itself. Every one of those shapes is one `dotenv` reads, so the
 * tool was already running on values this command could not see, and what the
 * tool reads out of this file is the only sensible thing to pre-fill these
 * questions with.
 *
 * @param {string} [file] - The `.env` to read; the project root's by default.
 * @returns {{url: string, token: string, courseId: string}}
 */
function readExistingEnv(file = ENV_FILE) {
  if (!fs.existsSync(file)) return { url: '', token: '', courseId: '' };
  const values = dotenv.parse(fs.readFileSync(file, 'utf8'));
  return {
    url: values.CANVAS_API_URL || '',
    token: values.CANVAS_API_TOKEN || '',
    courseId: values.CANVAS_COURSE_ID || '',
  };
}

/**
 * How many times `init` asks for the course id before it gives up.
 *
 * Finite because an input stream ending is not the only way a run can be unable
 * to answer: `yes | npx course init` answers every question for ever and parses
 * as nothing, and an uncapped loop takes that for a person who keeps mistyping.
 * Three is enough for a typo and a second look at the Canvas address bar, and
 * small enough that an unattended run stops in a moment rather than spinning.
 */
const COURSE_ID_ATTEMPTS = 3;

/**
 * The Canvas course id in `value`, or null when it is not one.
 *
 * A course id is the whole number in the address of a course in Canvas, and
 * every use this project makes of it is that: it goes into `/courses/:id/`
 * paths, and into `course_id` in the sync state, which `assertStateMatchesEnv`
 * compares against `.env` on every run (`lib/sync/state.js`).
 *
 * Refusing here rather than at the write is the point. `Number('SPRING-2026')`
 * is NaN, JSON has no NaN, and `JSON.stringify` writes NaN out as `null` — so
 * an unchecked `Number()` put `"course_id": null` into `.canvas-sync.json` and
 * exited 0, manufacturing the `.env`-against-state mismatch this command exists
 * to repair. Every shape that does that is refused: a term code, a value that
 * still carries its quotes, a decimal, exponent notation, anything with a
 * character after the digits. So is `0`, which is not a course id but the sync
 * state's own marker for "this file names no course", and so is an id longer
 * than `Number` holds exactly, which would be silently rounded to an id
 * belonging to some other course or to none.
 *
 * A padded or space-padded answer is taken and canonicalised rather than
 * refused, because it names a real course unambiguously — and canonicalising is
 * what keeps `.env` and the sync state agreeing: they are compared as strings,
 * so `045083` beside `45083` is a mismatch every later command stops on.
 *
 * @param {string|number|null} value
 * @returns {number|null}
 */
function parseCourseId(value) {
  const text = String(value == null ? '' : value).trim();
  if (!/^\d+$/.test(text)) return null;
  const id = Number(text);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * The ways of writing one value into a `.env`, in the order this command
 * prefers them.
 *
 * Which one is right is decided by `dotenv` in `envLine` below, not here: this
 * only says what is worth trying.
 *
 * 1. **Bare.** What a `.env` normally looks like, and what every value this
 *    command has ever written looked like. It carries most values and mangles
 *    the rest: `dotenv` trims the whitespace off an unquoted value and cuts it
 *    at the first `#`, and reads a value that both begins and ends with a quote
 *    character as a quoted one.
 * 2. **Single-quoted.** The literal form: `dotenv` takes the quotes off and
 *    expands nothing inside them, so a `#`, an `=`, a double quote, a backslash
 *    and the whitespace at either end all survive. It cannot carry a single
 *    quote, and it is skipped for a value holding a newline — it would carry
 *    one, but only by spreading the value across lines, and a `.env` with one
 *    line per key is the thing a person can still edit by hand.
 * 3. **Double-quoted, with the line breaks written as escapes.** The only form
 *    that keeps a value holding a newline on one line, because `dotenv` expands
 *    `\n` and `\r` back inside double quotes — which is also why it cannot
 *    carry a value that holds a literal backslash, and it cannot carry a double
 *    quote, `dotenv` leaving the backslash of a `\"` in place.
 *
 * Backticks are the fourth form `dotenv` reads and are deliberately not here.
 * They would carry a value holding both kinds of quote, which nothing else
 * does, but the extension parses this same file with a reader of its own
 * (`readEnvConfig` in `.vscode/extensions/course-manager/helpers.js`) that
 * reads backticks as part of the value — pinned as a known divergence in
 * `test/vscode/helpers.test.js`. Writing a shape only half the tool reads is
 * how `.env` came to disagree with itself in the first place.
 */
const bareForm = (key, value) => `${key}=${value}`;
const singleQuotedForm = (key, value) => `${key}='${value}'`;
const escapedForm = (key, value) =>
  `${key}="${value.replace(/\r/g, '\\r').replace(/\n/g, '\\n')}"`;

function envCandidates(key, value) {
  const forms = [bareForm(key, value)];
  if (!/[\r\n]/.test(value)) forms.push(singleQuotedForm(key, value));
  forms.push(escapedForm(key, value));
  return forms;
}

/**
 * The quoted forms, for the retry that gives up the per-value preference.
 *
 * Choosing each line on its own is not enough, because the thing that breaks a
 * `.env` is one line running into the next: two values that are each a bare
 * `'` are each read back perfectly alone, and written one under the other the
 * first one's quote opens at the end of its own line and closes at the end of
 * the second, swallowing the key in between. Neither line is wrong; the pair
 * is. So when the assembled file does not read back, every value is written
 * again in one of these instead — quoted forms close on their own line, so
 * there is nothing left to run on.
 *
 * Single quotes first: they expand nothing, so they are the closest thing to
 * storing the value as typed, and they leave the more readable file.
 */
const ESCAPING_FORMS = [singleQuotedForm, escapedForm];

/** Whether `dotenv` reads this one line back as exactly `value`. */
function lineRoundTrips(line, key, value) {
  return dotenv.parse(line)[key] === value;
}

/** Whether `dotenv` reads this whole file back as exactly what went in. */
function fileRoundTrips(content, entries) {
  const parsed = dotenv.parse(content);
  return entries.every(([key, value]) => parsed[key] === value);
}

/**
 * The parts of a value that no `.env` line carries by itself, named so a
 * refusal can say what actually stopped it rather than guessing.
 */
function awkwardParts(value) {
  const parts = [];
  if (/\n/.test(value)) parts.push('a line break');
  else if (/\r/.test(value)) parts.push('a carriage return');
  if (/\\[nr]/.test(value)) parts.push('a literal \\n or \\r');
  if (value.includes("'")) parts.push('a single quote');
  if (value.includes('"')) parts.push('a double quote');
  if (value.includes('#')) parts.push('a #');
  if (value !== value.trim()) parts.push('whitespace at one end');
  return parts;
}

/**
 * The characters in a value that can reach past the end of its own line, which
 * is what turns two individually writable values into an unwritable file.
 */
function runOnParts(value) {
  const parts = [];
  if (value.includes("'")) parts.push('a single quote');
  if (value.includes('"')) parts.push('a double quote');
  if (value.includes('`')) parts.push('a backtick');
  if (value.includes('\\')) parts.push('a backslash');
  return parts;
}

/** "a, b and c", for a message that lists what it found. */
function listOf(parts) {
  if (parts.length === 0) return 'nothing this command knows how to name';
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * The one line that carries `value`, or null when none of the forms does.
 *
 * `dotenv` decides, by being asked. It is the only authority worth asking: it
 * is what `cli/index.js` loads this file with, so a line it reads back as
 * something else is a line every command in this tool runs on the wrong value.
 * A rule derived by hand would be a second opinion about that, and a second
 * opinion is exactly what went wrong — `readExistingEnv` reading the file one
 * way while the rest of the tool read it another.
 */
function envLine(key, value) {
  for (const line of envCandidates(key, value)) {
    if (dotenv.parse(line)[key] === value) return line;
  }
  return null;
}

/**
 * The contents of `.env`, in the order the keys are given, checked against
 * `dotenv` before any of it reaches the disk.
 *
 * **A value that survives being read has to survive being written back.** This
 * command reads `.env` through `dotenv` and offers what it finds as the default
 * answers, so accepting those defaults unchanged is the commonest run there is
 * — and `.env` is gitignored, so a value it mangles on the way back is gone,
 * with no `git checkout` to undo it. Unquoted, `ab#cd` was written as a token
 * that stops at `ab`, and a token holding a newline turned a three-line file
 * into a four-line one, the value cut off at the break and its tail sitting on
 * a line of its own where the next key used to be.
 *
 * **The whole file is parsed, not just each line as it is chosen**, because a
 * line is only correct in the file it ends up in: a form that reads back
 * perfectly on its own can still open a quote that closes on the line after it,
 * taking the key in between with it. And a file that fails that check is not
 * refused on the spot — the per-value preference is what put an unbalanced
 * quote there, so it is given up and every value is written again in one of the
 * quoted forms, which close on their own line. Only when that fails too is
 * there nothing left to try.
 *
 * @param {Record<string, string>} values
 * @returns {string} The file, ending in a newline.
 * @throws {RefusalError} When no arrangement reads back — either a value with
 *   no form of its own, or a combination none of the retries settles. Refusing
 *   is the only answer that does not quietly store something else: this runs
 *   before the write, so a refused run leaves both files exactly as found.
 */
function buildEnvFile(values) {
  const entries = Object.entries(values);

  // What is left when a value has no form at all: no arrangement can save it,
  // so this is answered first and on its own terms.
  for (const [key, value] of entries) {
    if (envLine(key, value) != null) continue;
    const parts = awkwardParts(value);
    const trapped =
      /[\r\n]/.test(value) && /\\[nr]/.test(value)
        ? ' The line break is the part with no way out: the only form that ' +
          'keeps one on a single line writes it as `\\n`, which this value ' +
          'already contains, so reading it back cannot tell the two apart.'
        : '';
    throw new RefusalError(
      `[init] ${key} cannot be written to .env. Its value holds ` +
        `${listOf(parts)}, and none of the three ways this command writes a ` +
        'value — bare, single-quoted, or double-quoted with the line breaks ' +
        'escaped — is read back as the same value by `dotenv`, which is what ' +
        `every command in this tool reads that file with.${trapped} Nothing ` +
        'was written. Run `npx course init` again with a value that drops one ' +
        'of those, or write the line into .env by hand.',
    );
  }

  // Every value has at least one form, so the only question left is which
  // combination survives the file. The preferred arrangement first, then the
  // quoted forms across the board.
  const arrangements = [entries.map(([key, value]) => envLine(key, value))];
  for (const form of ESCAPING_FORMS) {
    const lines = entries.map(([key, value]) => {
      const line = form(key, value);
      return lineRoundTrips(line, key, value) ? line : null;
    });
    if (lines.every((line) => line != null)) arrangements.push(lines);
  }

  for (const lines of arrangements) {
    const candidate = `${lines.join('\n')}\n`;
    if (fileRoundTrips(candidate, entries)) return candidate;
  }

  // Each value is writable alone and no arrangement holds them together. What
  // does that is a character that reaches past the end of its own line: a
  // quote that finds its partner on the next line, or a backslash that eats
  // the quote meant to close its own. Naming the keys and what each one holds
  // is the whole of what makes this actionable — the author cannot see which
  // two values are fighting from a message that names one, and cannot see what
  // to change from one that names none.
  const culprits = entries
    .map(([key, value]) => [key, listOf(runOnParts(value))])
    .filter(([, parts]) => parts !== '')
    .map(([key, parts]) => `${key} holds ${parts}`);
  throw new RefusalError(
    `[init] .env cannot be written. ${listOf(entries.map(([key]) => key))} ` +
      'are each writable on their own, but not together: a quote character, ' +
      'or a backslash in front of one, reaches past the end of its own line ' +
      'and takes the next line with it, so `dotenv` reads the file as ' +
      'something other than what was entered. Every form this command writes ' +
      'was tried, on each value and then across all of them. ' +
      `${listOf(culprits)}. Nothing was written. Run \`npx course init\` ` +
      'again with one of those characters dropped.',
  );
}

async function init() {
  // `init` has no flags at all, so a run that cannot answer has nowhere to put
  // the three values and is told the only thing left to do: run it in a
  // terminal. The shared prompt is what says so — a private copy of it here is
  // what let this command keep hanging after the shared one was fixed.
  const rl = createRL({ command: 'init' });

  console.log('[init] Canvas LMS setup');
  console.log(
    '[init] This will create .env and .canvas-sync.json in the project root.\n',
  );

  const existingEnv = readExistingEnv();

  const canvasUrl = await prompt(
    rl,
    'Canvas URL (e.g. https://school.instructure.com)',
    existingEnv.url,
  );
  const apiToken = await prompt(rl, 'Canvas API token', existingEnv.token);

  // A default exists to be accepted with Enter, so one that is refused when it
  // is accepted is not a default — it is a loop with a keypress in it. What
  // `.env` holds is said once instead, because the author still has to know
  // what is in the file they are about to have rewritten.
  const offeredCourseId = parseCourseId(existingEnv.courseId);
  if (existingEnv.courseId && offeredCourseId == null) {
    console.log(
      `[init] .env holds CANVAS_COURSE_ID=${existingEnv.courseId}, which is ` +
        'not a Canvas course ID, so it is not offered below.',
    );
  }

  // Refused at the question and asked again, which is how every other command
  // in `cli/` handles an answer it cannot use — `new-module.js` asks for a
  // position the same way. Checking at the end instead would mean asking three
  // questions and only then saying the third was wrong, and making the author
  // retype the two answers that were fine.
  //
  // **Capped, which `new-module.js` is not.** An ended input stream is not the
  // only way a run can have no answer to give: `prompt` throws
  // `UnanswerableError` the moment the stream ends (`cli/module-utils.js`), so
  // a piped file and a Ctrl-D both stop the loop, but `yes | npx course init`
  // is a source that neither parses nor ever runs out. Uncapped, that is a hang
  // that burns a core and prints its own complaint thousands of times a minute,
  // in a command a script may well run unattended. So the asking is finite, and
  // what it ends in is what refusing once would have done: a non-zero exit
  // naming the value.
  let courseId = null;
  let lastAnswer = '';
  for (let attempt = 1; attempt <= COURSE_ID_ATTEMPTS; attempt += 1) {
    lastAnswer = await prompt(
      rl,
      'Canvas course ID',
      offeredCourseId == null ? '' : String(offeredCourseId),
    );
    courseId = parseCourseId(lastAnswer);
    if (courseId != null) break;
    // Not after the last attempt: "please try again" is a lie once there is no
    // try left, and the line below is what that run is told instead.
    if (attempt < COURSE_ID_ATTEMPTS) {
      console.log(
        `  "${lastAnswer}" is not a Canvas course ID. It is the whole number ` +
          'in the address of the course in Canvas, the 45083 in ' +
          '.../courses/45083. Please try again.',
      );
    }
  }

  rl.close();

  if (!canvasUrl || !apiToken) {
    console.error(
      '[init] Error: the Canvas URL and the API token are both required.',
    );
    process.exit(1);
  }

  if (courseId == null) {
    console.error(
      `[init] Error: "${lastAnswer}" is not a Canvas course ID, and ` +
        `${COURSE_ID_ATTEMPTS} tries is as many as this command asks. It is ` +
        'the whole number in the address of the course in Canvas, the 45083 ' +
        'in .../courses/45083. Nothing was written — find the number and run ' +
        '`npx course init` again.',
    );
    process.exit(1);
  }

  // Strip trailing slashes and any /api/v1 suffix: API paths already carry
  // /api/v1, so CANVAS_API_URL is the base URL alone. `normaliseBaseUrl` is the
  // definition of that shape, and this is the command that writes it, so the
  // two agreeing is not a nicety — every later comparison of `.env` against the
  // sync file assumes both went through it.
  const apiUrl = normaliseBaseUrl(canvasUrl);

  // Built before anything is written, and checked against `dotenv` while it is
  // built: a value that cannot be stored stops the run here, with both files
  // still exactly as they were found. `courseId` goes in as the number it
  // parsed to rather than as it was typed, so `.env` and the sync state below
  // spell the same course — they are compared as strings on every later run.
  const envContent = buildEnvFile({
    CANVAS_API_URL: apiUrl,
    CANVAS_API_TOKEN: apiToken,
    CANVAS_COURSE_ID: String(courseId),
  });

  fs.writeFileSync(ENV_FILE, envContent, 'utf8');
  console.log(`[init] Wrote ${ENV_FILE}`);

  // Create .canvas-sync.json. Starting from an empty v4 state rather than an
  // object literal is what guarantees every container is present: a state
  // missing `icons` or `files` reads as a hand-trimmed one, and the commands
  // that write them would have to guard for it.
  const syncData = emptyState();
  syncData.canvas_base_url = apiUrl;
  syncData.course_id = courseId;

  // Preserve existing module mappings if the file already exists. `init` is the
  // command that repairs a sync state disagreeing with `.env`, so it reads one
  // that the other commands refuse — and then must not carry its contents over.
  // Those ids belong to the course the old file describes; keeping them under a
  // new course id would rebuild exactly the mismatch, in a file that now looks
  // coherent. Only a re-init of the same course keeps them.
  const existing = loadState({ allowNull: true, skipEnvCheck: true });
  const sameCourse =
    existing != null &&
    describesSameCourse(existing, { courseId, canvasBaseUrl: apiUrl });

  if (existing && !sameCourse) {
    console.log(
      `[init] The existing ${SYNC_FILE} describes ` +
        `${describeSyncTarget(existing)}, so its module, file and icon ids are ` +
        'left behind: they mean nothing in course ' +
        `${courseId}. The next push creates everything fresh there.`,
    );
  } else if (existing) {
    if (existing.modules) syncData.modules = existing.modules;
    if (existing.files) syncData.files = existing.files;
    if (existing.icons) syncData.icons = existing.icons;
  }

  saveState(syncData);
  console.log(`[init] Wrote ${SYNC_FILE}`);

  console.log(
    '\n[init] ⚠ Security reminder: .env contains your Canvas API token.',
  );
  console.log(
    '[init]   Make sure .env is listed in .gitignore and never committed to version control.',
  );

  console.log('\n[init] Setup complete. You can now run:');
  console.log('  npx course push   - push local content to Canvas');
  console.log('  npx course pull   - pull Canvas content locally');
  console.log('  npx course status - compare local vs Canvas state');
}

module.exports = init;

// Exported for testing
init._describesSameCourse = describesSameCourse;
init._describeSyncTarget = describeSyncTarget;
init._readExistingEnv = readExistingEnv;
init._parseCourseId = parseCourseId;
init._buildEnvFile = buildEnvFile;
