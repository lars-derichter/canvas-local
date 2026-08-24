const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CLI = path.resolve(__dirname, '../../cli/index.js');

const made = [];
afterEach(() => {
  for (const dir of made.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * A throwaway project holding the given module folders. Out of the repository
 * and moved by a child process, for the reason `test/cli/delete-module.test.js`
 * gives: `COURSE_DIR` is a module-level constant resolved from `process.cwd()`
 * at require time, so calling `moveModule()` in this process would reorder the
 * repository's own course.
 */
function project(moduleNames) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'move-module-'));
  made.push(dir);
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    '{ "name": "fixture", "private": true }\n',
    'utf8',
  );
  for (const name of moduleNames) {
    fs.mkdirSync(path.join(dir, 'course', name), { recursive: true });
  }
  return dir;
}

function moveModule(dir, args) {
  return spawnSync(process.execPath, [CLI, 'move-module', ...args], {
    cwd: dir,
    input: '',
    encoding: 'utf8',
    timeout: 30000,
  });
}

function modulesIn(dir) {
  return fs.readdirSync(path.join(dir, 'course')).sort();
}

// `--position` is a 1-based ordinal into the sorted module list, so the
// "already at that position" check has to compare ordinals too. It used to
// compare the source's filename prefix, which is only the same number when
// the numbering is 1-based and gapless.
describe('npx course move-module no-op guard', () => {
  it('moves a 00-based module whose prefix collides with the target ordinal', () => {
    // 02-gamma dropped onto 01-beta: ordinal 2. The old prefix comparison
    // (2 === 2) called this "already at that position" and did nothing.
    const dir = project(['00-alpha', '01-beta', '02-gamma']);

    const run = moveModule(dir, ['--module', '02-gamma', '--position', '2']);

    assert.equal(run.status, 0, run.stderr);
    assert.doesNotMatch(run.stdout, /already at that position/);
    assert.deepEqual(modulesIn(dir), ['01-alpha', '02-gamma', '03-beta']);
  });

  it('moves a gapped module whose prefix collides with the target ordinal', () => {
    // 03-beta dropped onto 07-charlie: ordinal 3, while beta's prefix is
    // also 3. The old guard no-opped exactly this move.
    const dir = project(['01-alpha', '03-beta', '07-charlie']);

    const run = moveModule(dir, ['--module', '03-beta', '--position', '3']);

    assert.equal(run.status, 0, run.stderr);
    assert.doesNotMatch(run.stdout, /already at that position/);
    assert.deepEqual(modulesIn(dir), ['01-alpha', '02-charlie', '03-beta']);
  });

  it('still no-ops a genuine same-slot move, with the friendly message', () => {
    const dir = project(['00-alpha', '01-beta', '02-gamma']);

    const run = moveModule(dir, ['--module', '01-beta', '--position', '2']);

    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /already at that position/);
    assert.deepEqual(modulesIn(dir), ['00-alpha', '01-beta', '02-gamma']);
  });
});
