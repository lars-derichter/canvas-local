/**
 * Simple logger that supports --verbose and --quiet modes.
 *
 * Usage:
 *   const log = require('./logger');
 *   log.configure({ verbose: true, quiet: false });
 *   log.info('...');     // Normal output (suppressed in quiet mode)
 *   log.verbose('...');  // Only shown in verbose mode
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

module.exports = {
  configure,
  info,
  verbose,
  error,
  warn,
};
