const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/**
 * The floor the glob has to clear. 71 files match as this is written, so 40 is
 * deliberately well under it: deleting a test file must never drag this number
 * along behind. It is still far above every broken-glob outcome there is —
 * quotes left on the pattern matches 0, and a `**` that collapsed to one level
 * matches 1 — so the gap between "the suite shrank" and "the glob broke" is
 * about thirty files wide.
 */
const MINIMUM = 40;

/** The quoted pattern out of an npm script, quote characters included. */
function quotedPattern(script) {
  const match = /(["'])([^"']*\*[^"']*)\1/.exec(script || '');
  return match ? match[0] : null;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const pattern = process.argv[2];
if (!pattern) {
  fail(
    'check-test-glob: no pattern given. Call this with the same quoted glob ' +
      'the `test` script passes to `node --test`.',
  );
}

const pkg = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'),
);
const inTest = quotedPattern(pkg.scripts.test);
const inPretest = quotedPattern(pkg.scripts.pretest);

// Both scripts have to spell the pattern identically, quote characters and
// all, or this guard stops describing the run it is meant to guard: it would
// glob one string while `node --test` globs another.
if (inTest !== inPretest) {
  fail(
    'check-test-glob: the `test` and `pretest` scripts disagree about the ' +
      `glob (${inTest} vs ${inPretest}). They have to match exactly, ` +
      'quote characters included, or this guard checks the wrong pattern.',
  );
}

const matched = fs.globSync(pattern, { cwd: ROOT });
if (matched.length < MINIMUM) {
  fail(
    `check-test-glob: the glob ${JSON.stringify(pattern)} matched ` +
      `${matched.length} file${matched.length === 1 ? '' : 's'}, and the ` +
      `suite holds at least ${MINIMUM}.\n` +
      '\n' +
      'If the pattern still carries its quote characters, this is the ' +
      'Windows quoting bug: npm runs scripts through cmd.exe there, and ' +
      'cmd does not strip single quotes the way sh does, so `node --test` ' +
      'is handed a literal that matches nothing. It does not complain — ' +
      "Node's own empty-run guard is skipped for any pattern containing " +
      'glob magic, and a `*` counts as magic even inside quotes that made ' +
      'the whole string literal. The run would report `tests 0` and exit 0.\n' +
      '\n' +
      'The fix is double quotes in package.json: cmd.exe and sh both strip ' +
      'those. See docs/tests.md.',
  );
}
