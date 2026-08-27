/**
 * Simple logger that supports --verbose and --quiet modes.
 *
 * Usage:
 *   const log = require('./logger');
 *   log.configure({ verbose: true, quiet: false });
 *   log.info('...');     // Normal output (suppressed in quiet mode)
 *   log.verbose('...');  // Only shown in verbose mode
 *   log.warn('...');     // Something met on the way (suppressed in quiet mode)
 *   log.refusal('...');  // Why the run did less than it was asked (always shown)
 *   log.error('...');    // Always shown
 */

let verboseMode = false;
let quietMode = false;

function configure({ verbose = false, quiet = false } = {}) {
  verboseMode = verbose;
  quietMode = quiet;
}

function info(...args) {
  if (!quietMode) {
    console.log(...args);
  }
}

function verbose(...args) {
  if (verboseMode) {
    console.log('[debug]', ...args);
  }
}

function error(...args) {
  console.error(...args);
}

function warn(...args) {
  if (!quietMode) {
    console.warn(...args);
  }
}

/**
 * Why this run did less than it was asked to, or lost a guarantee it normally
 * gives — printed whatever `--quiet` says.
 *
 * `warn` is chatter about what a run met on the way: a `_category_.json` that
 * would not parse, a TOC entry that is not there, a Canvas list that could not
 * be read. Silencing that costs nothing, because the run still did the thing it
 * was asked to do, and silencing it is the whole of what `--quiet` is for.
 *
 * This level is for the other kind of line. The git guard in
 * `lib/sync/gather.js` refuses every local write when it cannot read git state,
 * so `pull --quiet` outside a checkout wrote nothing at all, exited 0, and —
 * through `warn` — said nothing whatsoever about why. A scheduled job or a VS
 * Code task reads that silence as a pull that found nothing to do, and goes on
 * reading it that way for as long as the condition lasts. `--quiet` means do
 * not chatter. It does not mean hide the reason nothing happened.
 *
 * Named for what `lib/errors.js` already calls this: a decision the tool made
 * on purpose and can explain. A `RefusalError` refuses the whole run and stops
 * it; this refuses part of one and carries on, so it is a line rather than a
 * throw. Both are the tool declining to do something, and in both cases the
 * sentence is the whole of what the person who typed the command is told.
 *
 * On stderr, like `warn` and `error`. Whatever is reading a `--quiet` run is
 * reading its stdout, and the reason it wrote nothing is not part of that.
 */
function refusal(...args) {
  console.warn(...args);
}

module.exports = {
  configure,
  info,
  verbose,
  error,
  warn,
  refusal,
};
