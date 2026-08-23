const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { SCHEMA_VERSION } = require('../../lib/sync/state');

const CLI = path.join(__dirname, '..', '..', 'cli', 'index.js');
const CANVAS_URL = 'https://canvas.example.com';
const STATE_COURSE = 45083;
const ENV_COURSE = '58155';

const made = [];

afterEach(() => {
  while (made.length) fs.rmSync(made.pop(), { recursive: true, force: true });
});

/**
 * A throwaway project holding two modules and a sync state that describes
 * course 45083.
 *
 * Out of the repository on purpose, and run as a child process: `COURSE_DIR`
 * and `SYNC_FILE` are module-level constants built from `PROJECT_ROOT`, which
 * is resolved from `process.cwd()` at require time. Calling `deleteModule()` in
 * this process would therefore delete a module out of the repository itself.
 * The child also never reads the repository's `.env` — dotenv is pointed at the
 * project root, which for the child is the fixture.
 */
function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'delete-module-'));
  made.push(dir);
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    '{ "name": "fixture", "private": true }\n',
    'utf8',
  );
  fs.mkdirSync(path.join(dir, 'course', '01-intro'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'course', '02-second'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'course', '01-intro', '01-welcome.md'),
    '---\ntitle: Welcome\n---\n\nBody\n',
    'utf8',
  );
  fs.writeFileSync(
    path.join(dir, '.canvas-sync.json'),
    JSON.stringify(
      {
        schema_version: SCHEMA_VERSION,
        canvas_base_url: CANVAS_URL,
        course_id: STATE_COURSE,
        last_sync: null,
        modules: {
          '01-intro': {
            canvas_module_id: 67890,
            name: 'Intro',
            position: 1,
            item_order: ['01-intro/01-welcome.md'],
            items: {
              '01-intro/01-welcome.md': { canvas_type: 'page', canvas_id: 1 },
            },
          },
        },
        icons: {},
        files: {},
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );
  return dir;
}

/** Run `npx course delete-module` in `dir`, against an environment that names another course. */
function deleteModule(dir, args, input = '') {
  return spawnSync(process.execPath, [CLI, 'delete-module', ...args], {
    cwd: dir,
    input,
    encoding: 'utf8',
    // The command asks questions when it is given no flags, and a test must not
    // be the thing that hangs the suite waiting for an answer.
    timeout: 30000,
    env: {
      ...process.env,
      CANVAS_API_URL: CANVAS_URL,
      CANVAS_COURSE_ID: ENV_COURSE,
    },
  });
}

describe('npx course delete-module against another course’s sync state', () => {
  it('refuses before it deletes the folder', () => {
    // The refusal in `loadState` protects the sync state from a command editing
    // rows that belong to a different Canvas course. Reached after `fs.rmSync`,
    // it protected nothing: the module was already gone, and the author was
    // told why only afterwards.
    const dir = project();
    const before = fs.readFileSync(path.join(dir, '.canvas-sync.json'), 'utf8');

    const run = deleteModule(dir, ['--module', '01-intro', '--yes']);

    assert.notEqual(run.status, 0, 'a refused run must not report success');
    assert.match(run.stderr, /describes course 45083/);
    assert.ok(
      fs.existsSync(path.join(dir, 'course', '01-intro')),
      'the module has to survive a run that refused to do anything',
    );
    assert.ok(
      fs.existsSync(path.join(dir, 'course', '01-intro', '01-welcome.md')),
    );
    assert.equal(
      fs.readFileSync(path.join(dir, '.canvas-sync.json'), 'utf8'),
      before,
      'the state file the refusal is about must not be rewritten either',
    );
  });

  it('refuses before it asks whether to delete anything', () => {
    // Asking "Delete 01-intro and all its contents? (y/N)", taking the answer,
    // and only then refusing is a sequence with no good ending: either the
    // author said no and the question was pointless, or they said yes and the
    // command breaks its word. The state load sits above the prompt so the
    // question is never put.
    const dir = project();

    const run = deleteModule(dir, [], '1\ny\n');

    assert.notEqual(run.status, 0);
    assert.doesNotMatch(
      run.stdout,
      /Delete 01-intro/,
      'a run that is going to refuse must not ask for a confirmation first',
    );
    assert.match(
      run.stderr,
      /describes course 45083/,
      'and it has to refuse for that reason, not merely stay quiet',
    );
    assert.ok(fs.existsSync(path.join(dir, 'course', '01-intro')));
  });
});
