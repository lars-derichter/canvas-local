const fs = require('fs');
const path = require('path');
const readline = require('readline');
const log = require('./logger');
const { PROJECT_ROOT } = require('./project-root');
const { RefusalError } = require('../lib/errors');

const COURSE_DIR = path.join(PROJECT_ROOT, 'course');

/**
 * Resolved by `ask` in place of an answer when the input stream ends without
 * giving one: `< /dev/null`, a CI step, a VS Code task with no terminal, or a
 * pipe that ran out halfway through the questions.
 */
const EOF = Symbol('input stream ended');

/**
 * What each command tells a run that cannot answer it — the command's own name,
 * and the flags that supply the answers instead. Keyed by the interface so that
 * `prompt` can reach it without every question having to carry it.
 */
const hints = new WeakMap();

/**
 * Thrown by `prompt` when a question reaches the end of the input stream
 * instead of an answer. `cli/index.js` catches it, prints the message and sets
 * a non-zero exit code; nothing else should catch it, because reporting success
 * for a run that never got its answers is the defect it exists to stop.
 *
 * A `RefusalError` because that is what it is — a run this command cannot serve,
 * stopped on purpose, with one line saying what to do instead. The class is what
 * gets it printed as that line rather than under a stack trace, and it is shared
 * with every other deliberate stop; see `lib/errors.js`. It keeps a name of its
 * own only because its own tests catch it by type.
 */
class UnanswerableError extends RefusalError {
  constructor(message) {
    super(message);
    this.name = 'UnanswerableError';
  }
}

/**
 * Ask `question` and resolve the answer, or `EOF` when the input stream ends
 * without one.
 *
 * The `'close'` hook is the load-bearing half. `rl.question`'s callback never
 * fires once stdin reaches EOF, so waiting only for it leaves the promise
 * unsettled: the run stops mid-question with the event loop drained, every line
 * after the await goes unrun, and the process exits 0 as though it had done what
 * it was asked. `'close'` does fire on EOF, and on an answered run it fires
 * after the answer, so the first of the two to happen is the one that settles
 * this. The listener comes off again on an answer, so a command asking a dozen
 * questions on one interface does not accumulate a dozen listeners.
 *
 * An interface that closed *before* the question was asked cannot emit
 * `'close'` a second time — readline throws `ERR_USE_AFTER_CLOSE` from
 * `question` instead. That is the same ended stream by another route, so it
 * resolves the same way rather than escaping as a stack trace.
 *
 * It is deliberately not an `isTTY` check, and must not be tidied into one:
 * `printf '1\n' | npx course new-item` has no terminal either, and piping the
 * answers in is a legitimate way to script this. What separates EOF from a real
 * answer is what arrived, not what is attached.
 */
function ask(rl, question, defaultValue) {
  const suffix = defaultValue ? ` (${defaultValue})` : '';
  return new Promise((resolve) => {
    const onClose = () => resolve(EOF);
    rl.once('close', onClose);
    try {
      rl.question(`${question}${suffix}: `, (answer) => {
        rl.removeListener('close', onClose);
        resolve(answer.trim() || defaultValue || '');
      });
    } catch {
      rl.removeListener('close', onClose);
      resolve(EOF);
    }
  });
}

/**
 * The one line a run with no answers to give is left with. It names the command
 * rather than the question alone, because the run that hits this is a script or
 * a task whose output is read later, out of context.
 */
function unanswerableMessage(question, hint) {
  const { command, flags } = hint || {};
  const tag = command ? `[${command}] ` : '';
  const terminal = command
    ? `Run \`npx course ${command}\` in a terminal`
    : 'Run this in a terminal';
  const scripted = flags ? `, or pass ${flags} to answer from flags.` : '.';
  return (
    `${tag}Error: "${question}" got no answer — the input stream ended ` +
    `before one arrived. ${terminal}${scripted}`
  );
}

/**
 * Prompt the user for input with an optional default value.
 *
 * Throws `UnanswerableError` rather than returning when the input stream ends
 * first, and throwing is the point twice over. A scripted run has to stop with
 * a non-zero exit instead of reporting a success it never had; and several
 * callers ask inside a `while (true)` that re-asks until the answer parses,
 * which an empty string would turn from one hang into an endless loop printing
 * its own complaint. An exception leaves the loop and the command together.
 *
 * A default value is no protection: it fires on an empty *line*, and EOF is the
 * absence of a line rather than an empty one.
 *
 * `confirm` in `backup-warning.js` deliberately does not use this — cancelling
 * is the safe answer to a destructive question, so it reads `ask` directly.
 */
async function prompt(rl, question, defaultValue) {
  const answer = await ask(rl, question, defaultValue);
  if (answer !== EOF) return answer;
  throw new UnanswerableError(unanswerableMessage(question, hints.get(rl)));
}

/**
 * Read existing module folders and return sorted array of { prefix, folderName }.
 */
function getExistingModules() {
  const entries = fs.readdirSync(COURSE_DIR, { withFileTypes: true });
  const modules = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const match = entry.name.match(/^(\d+)/);
    if (match) {
      modules.push({ prefix: parseInt(match[1], 10), folderName: entry.name });
    }
  }

  modules.sort((a, b) => a.prefix - b.prefix);
  return modules;
}

/**
 * Pad a number to two digits: 1 -> "01", 12 -> "12".
 */
function pad(n) {
  return String(n).padStart(2, '0');
}

/**
 * Rename a module folder to use a new numeric prefix and update its _category_.json.
 * Returns { from, to } describing the rename, or null if no change was needed.
 */
function renameModule(folderName, newPrefix) {
  const newFolderName = folderName.replace(/^\d+/, pad(newPrefix));
  if (newFolderName === folderName) return null;

  const oldFolder = path.join(COURSE_DIR, folderName);
  const newFolder = path.join(COURSE_DIR, newFolderName);

  fs.renameSync(oldFolder, newFolder);

  // Update _category_.json if it exists
  const categoryFile = path.join(newFolder, '_category_.json');
  if (fs.existsSync(categoryFile)) {
    const category = safeReadJSON(categoryFile);
    category.position = newPrefix;
    fs.writeFileSync(
      categoryFile,
      JSON.stringify(category, null, 2) + '\n',
      'utf8',
    );
  }

  return { from: folderName, to: newFolderName };
}

/**
 * Create a readline interface.
 *
 * `hint` names the command and the flags that skip its questions, for the error
 * a run that cannot answer them gets. It belongs here, once per command, rather
 * than at each question: a command that grows a thirteenth question should not
 * be able to grow one that fails less helpfully than the other twelve.
 *
 * @param {{command: string, flags?: string}} [hint]
 */
function createRL(hint) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  if (hint) hints.set(rl, hint);
  return rl;
}

/**
 * Convert a name to a folder slug: lowercase, hyphenated.
 * "My New Module" -> "my-new-module"
 */
function toSlug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Safely read and parse a JSON file. Returns the parsed object, or
 * a fallback value if the file is missing or contains invalid JSON.
 *
 * The unparseable-file warning goes through the logger rather than straight to
 * console: `lib/sync/local-write.js` reads `_category_.json` through here, so
 * this fires mid-pull and has to obey `--quiet` like the rest of a sync run.
 *
 * @param {string} filePath - Path to the JSON file.
 * @param {*} [fallback={}] - Value to return on failure.
 * @returns {*} Parsed JSON or the fallback value.
 */
function safeReadJSON(filePath, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') {
      log.warn(
        `[warn] Failed to parse ${path.basename(filePath)}: ${err.message}`,
      );
    }
    return fallback;
  }
}

/**
 * Print the list of existing modules.
 */
function printModules(modules) {
  if (modules.length === 0) return;
  console.log('Existing modules:');
  for (const m of modules) {
    console.log(`  ${pad(m.prefix)} - ${m.folderName}`);
  }
  console.log();
}

module.exports = {
  COURSE_DIR,
  EOF,
  UnanswerableError,
  ask,
  prompt,
  getExistingModules,
  pad,
  toSlug,
  renameModule,
  createRL,
  printModules,
  safeReadJSON,
};
