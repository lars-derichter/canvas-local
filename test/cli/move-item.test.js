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
 * A throwaway project holding one module with the given item files. Out of the
 * repository and moved by a child process, for the reason
 * `test/cli/delete-module.test.js` gives: `COURSE_DIR` is a module-level
 * constant resolved from `process.cwd()` at require time.
 */
function project(itemNames) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'move-item-'));
  made.push(dir);
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    '{ "name": "fixture", "private": true }\n',
    'utf8',
  );
  const moduleDir = path.join(dir, 'course', '01-mod');
  fs.mkdirSync(moduleDir, { recursive: true });
  for (const name of itemNames) {
    fs.writeFileSync(path.join(moduleDir, name), `# ${name}\n`, 'utf8');
  }
  return dir;
}

function moveItem(dir, args) {
  return spawnSync(process.execPath, [CLI, 'move-item', ...args], {
    cwd: dir,
    input: '',
    encoding: 'utf8',
    timeout: 30000,
  });
}

function itemsIn(dir) {
  return fs.readdirSync(path.join(dir, 'course', '01-mod')).sort();
}

// The non-interactive path has no "already at that position" pre-guard, and
// must not grow one that compares the prefix to the ordinal: these are the
// prefix/ordinal collisions such a guard would wrongly no-op.
describe('npx course move-item with colliding prefix and ordinal', () => {
  it('moves a 00-based item onto its immediate predecessor', () => {
    // 02-c dropped onto 01-b: ordinal 2, the same number as c's prefix.
    const dir = project(['00-a.md', '01-b.md', '02-c.md']);

    const run = moveItem(dir, [
      '--path',
      'course/01-mod/02-c.md',
      '--position',
      '2',
    ]);

    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /Reordered items/);
    assert.deepEqual(itemsIn(dir), ['01-a.md', '02-c.md', '03-b.md']);
  });

  it('moves a gapped item whose prefix equals the target ordinal', () => {
    // 03-b dropped onto 07-c: ordinal 3, the same number as b's prefix.
    const dir = project(['01-a.md', '03-b.md', '07-c.md']);

    const run = moveItem(dir, [
      '--path',
      'course/01-mod/03-b.md',
      '--position',
      '3',
    ]);

    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /Reordered items/);
    assert.deepEqual(itemsIn(dir), ['01-a.md', '02-c.md', '03-b.md']);
  });
});
