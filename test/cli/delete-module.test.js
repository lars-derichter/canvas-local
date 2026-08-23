const { describe, it, afterEach, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { mockCanvas, silence } = require('../helpers/canvas-mock');
const {
  canvasFingerprint,
  hashBinaryFile,
  hashLocalFile,
} = require('../../lib/sync/fingerprint');
const { SCHEMA_VERSION } = require('../../lib/sync/state');

const CLI = path.join(__dirname, '..', '..', 'cli', 'index.js');
const CANVAS_URL = 'https://canvas.example.com';
const STATE_COURSE = 45083;
const ENV_COURSE = '58155';

// The course the second half of this file uses, where state and environment
// agree. Set before `cli/status` is required, the way
// `test/cli/new-module.test.js` does it: the Canvas client reads the
// environment as it loads.
const SYNCED_COURSE = '4242';
process.env.CANVAS_API_URL = CANVAS_URL;
process.env.CANVAS_API_TOKEN = 'test-token-123';
process.env.CANVAS_COURSE_ID = SYNCED_COURSE;

const status = require('../../cli/status');

// The fixture is in no git repository, and what git holds has no bearing on a
// command that writes nothing to `course/`.
const CLEAN = { available: true, paths: new Set(), reason: null };

const made = [];

beforeEach(() => {
  process.exitCode = 0;
});
afterEach(() => {
  mock.restoreAll();
  process.exitCode = 0;
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
function deleteModule(dir, args, input = '', { courseId = ENV_COURSE } = {}) {
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
      CANVAS_COURSE_ID: courseId,
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

// ---------------------------------------------------------------------------
// The base rows the command leaves behind
// ---------------------------------------------------------------------------

const WELCOME_PAGE = {
  page_id: 501,
  url: 'welcome',
  title: 'Welcome',
  body: '<p>Hello there.</p>',
  updated_at: '2026-08-20T08:00:00.000Z',
};
const ALERTS_PAGE = {
  page_id: 502,
  url: 'alerts',
  title: 'Alerts',
  body: '<p>Mind this.</p>',
  updated_at: '2026-08-20T08:00:00.000Z',
};
const LOOPS_PAGE = {
  page_id: 503,
  url: 'loops',
  title: 'Loops',
  body: '<p>Round and round.</p>',
  updated_at: '2026-08-20T08:00:00.000Z',
};
const WELCOME_ITEM = {
  id: 91,
  type: 'Page',
  title: 'Welcome',
  page_url: 'welcome',
  content_id: 501,
  position: 1,
  indent: 0,
};
const ALERTS_ITEM = {
  id: 92,
  type: 'Page',
  title: 'Alerts',
  page_url: 'alerts',
  content_id: 502,
  position: 2,
  indent: 0,
};
const LOOPS_ITEM = {
  id: 93,
  type: 'Page',
  title: 'Loops',
  page_url: 'loops',
  content_id: 503,
  position: 1,
  indent: 0,
};

/**
 * The reads a two-module course answers, longest path first.
 *
 * The single-page routes matter even though `GET /pages` already carries every
 * `updated_at`: that pre-filter can only spare the fetch for a page whose base
 * row records a `canvas_hash` to compare against. A run that has lost the rows
 * re-fetches each page one by one, and without these the run would end in a
 * Canvas error rather than in a wrong report — which would make every
 * assertion below pass for the wrong reason.
 */
function readRoutes() {
  return [
    { method: 'GET', path: '/pages/welcome', body: WELCOME_PAGE },
    { method: 'GET', path: '/pages/alerts', body: ALERTS_PAGE },
    { method: 'GET', path: '/pages/loops', body: LOOPS_PAGE },
    {
      method: 'GET',
      path: '/modules/10/items',
      body: [WELCOME_ITEM, ALERTS_ITEM],
    },
    { method: 'GET', path: '/modules/20/items', body: [LOOPS_ITEM] },
    {
      method: 'GET',
      path: '/modules',
      body: [
        { id: 10, name: 'Intro', position: 1 },
        { id: 20, name: 'Basics', position: 2 },
      ],
    },
    {
      method: 'GET',
      path: '/pages',
      body: [WELCOME_PAGE, ALERTS_PAGE, LOOPS_PAGE].map((page) => ({
        page_id: page.page_id,
        url: page.url,
        title: page.title,
        updated_at: page.updated_at,
      })),
    },
  ];
}

/** The sync row a synced page has, with both fingerprints as they stand. */
function pageRow(courseDir, itemPath, item, content) {
  return {
    canvas_type: 'page',
    canvas_id: content.page_id,
    page_url: content.url,
    module_item_id: item.id,
    title: content.title,
    local_hash: hashLocalFile(path.join(courseDir, itemPath)),
    canvas_hash: canvasFingerprint({ item, content }, 'page'),
    canvas_updated_at: content.updated_at,
    synced_at: '2026-08-20T09:00:00.000Z',
  };
}

const WELCOME = '01-intro/01-welcome.md';
const ALERTS = '01-intro/02-alerts.md';
const DIAGRAM = '01-intro/_files/diagram.png';

/**
 * A throwaway project holding two synced modules, the first with two pages and
 * an embedded binary, and a sync state that agrees with `course/` and with the
 * Canvas course `readRoutes` answers for.
 */
function syncedProject({ twinSlug = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'delete-module-synced-'));
  made.push(dir);
  const write = (relative, contents) => {
    const full = path.join(dir, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents, 'utf8');
  };

  // With `twinSlug`, the module behind 01-intro shares its slug, so closing the
  // gap renumbers it straight onto the deleted module's folder name.
  const second = twinSlug ? '02-intro' : '02-basics';
  const loops = `${second}/01-loops.md`;

  write('package.json', '{ "name": "fixture", "private": true }\n');
  write(
    'course/01-intro/_category_.json',
    JSON.stringify({ label: 'Intro', position: 1 }, null, 2) + '\n',
  );
  write(
    `course/${WELCOME}`,
    '---\ntitle: Welcome\ncanvas_type: page\n---\n\nHello there.\n',
  );
  write(
    `course/${ALERTS}`,
    '---\ntitle: Alerts\ncanvas_type: page\n---\n\nMind this.\n\n' +
      '![Diagram](_files/diagram.png)\n',
  );
  write(`course/${DIAGRAM}`, 'not really a png\n');
  write(
    `course/${second}/_category_.json`,
    JSON.stringify({ label: 'Basics', position: 2 }, null, 2) + '\n',
  );
  write(
    `course/${loops}`,
    '---\ntitle: Loops\ncanvas_type: page\n---\n\nRound and round.\n',
  );

  const courseDir = path.join(dir, 'course');
  write(
    '.canvas-sync.json',
    JSON.stringify(
      {
        schema_version: SCHEMA_VERSION,
        canvas_base_url: CANVAS_URL,
        course_id: Number(SYNCED_COURSE),
        last_sync: '2026-08-20T09:00:00.000Z',
        modules: {
          '01-intro': {
            canvas_module_id: 10,
            name: 'Intro',
            position: 1,
            item_order: [WELCOME, ALERTS],
            items: {
              [WELCOME]: pageRow(
                courseDir,
                WELCOME,
                WELCOME_ITEM,
                WELCOME_PAGE,
              ),
              [ALERTS]: pageRow(courseDir, ALERTS, ALERTS_ITEM, ALERTS_PAGE),
            },
          },
          [second]: {
            canvas_module_id: 20,
            name: 'Basics',
            position: 2,
            item_order: [loops],
            items: {
              [loops]: pageRow(courseDir, loops, LOOPS_ITEM, LOOPS_PAGE),
            },
          },
        },
        icons: {},
        files: {
          [DIAGRAM]: {
            canvas_file_id: 555,
            canvas_url: `/courses/${SYNCED_COURSE}/files/555/preview`,
            sha256: hashBinaryFile(path.join(courseDir, DIAGRAM)),
          },
        },
      },
      null,
      2,
    ) + '\n',
  );
  return dir;
}

function stateOf(dir) {
  return JSON.parse(
    fs.readFileSync(path.join(dir, '.canvas-sync.json'), 'utf8'),
  );
}

function printed(out) {
  return out.log.mock.calls.map((call) => call.arguments.join(' ')).join('\n');
}

describe('npx course delete-module and the rows it leaves behind', () => {
  it('keeps the module row and its embedded-file rows', () => {
    // A base row is the only thing that separates "the author deleted this"
    // from "this tool has never seen it". Dropped, the live Canvas module pairs
    // with no folder and no base, which the planner reads as a module to write
    // back into `course/`. The `state.files` row is worse: a Canvas file id is
    // global rather than course-scoped, and this row is the last thing in the
    // repository that holds the one behind the binary.
    const dir = syncedProject();
    const before = stateOf(dir);

    const run = deleteModule(dir, ['--module', '01-intro', '--yes'], '', {
      courseId: SYNCED_COURSE,
    });

    assert.equal(run.status, 0, run.stderr);
    assert.equal(fs.existsSync(path.join(dir, 'course', '01-intro')), false);

    const after = stateOf(dir);
    assert.deepEqual(
      after.modules['01-intro'],
      before.modules['01-intro'],
      'the deleted module keeps its row whole, or the next sync writes the ' +
        'folder back',
    );
    assert.equal(after.modules['01-intro'].canvas_module_id, 10);
    assert.deepEqual(Object.keys(after.modules['01-intro'].items), [
      WELCOME,
      ALERTS,
    ]);
    assert.deepEqual(
      after.files,
      before.files,
      'and so does the embedded binary, whose Canvas file id nothing else holds',
    );
    assert.equal(after.files[DIAGRAM].canvas_file_id, 555);

    // The renumber still has to land, which is why the command still saves.
    assert.deepEqual(fs.readdirSync(path.join(dir, 'course')).sort(), [
      '01-basics',
    ]);
    assert.equal(after.modules['01-basics'].canvas_module_id, 20);
    assert.deepEqual(Object.keys(after.modules['01-basics'].items), [
      '01-basics/01-loops.md',
    ]);
  });

  it('leaves a status that offers the module rather than restoring it', async () => {
    // The consequence, end to end. Without the rows, status planned the whole
    // module created locally — folder, both pages and `_category_.json`, the
    // author's deletion undone — and `push --prune-canvas` reported nothing to
    // remove, because a prune candidate *is* a base row.
    const out = silence();
    const dir = syncedProject();
    const run = deleteModule(dir, ['--module', '01-intro', '--yes'], '', {
      courseId: SYNCED_COURSE,
    });
    assert.equal(run.status, 0, run.stderr);
    mockCanvas(readRoutes());

    await status({
      courseDir: path.join(dir, 'course'),
      syncFile: path.join(dir, '.canvas-sync.json'),
      gitDirty: CLEAN,
    });

    const report = printed(out);
    assert.match(report, /Orphaned on Canvas/);
    assert.match(report, /01-intro: module "Intro" \(2 items\)/);
    assert.match(report, /01-intro\/_files\/diagram\.png: embedded file/);
    assert.match(
      report,
      /files\/555/,
      'the stranded Canvas file id, reachable',
    );
    assert.doesNotMatch(
      report,
      /module created/,
      'the module the author deleted must not be written back to disk',
    );
    assert.equal(process.exitCode, 0);
  });
});

describe('npx course delete-module when the renumber lands on the deleted folder', () => {
  it('gives the row up rather than let the two modules swap Canvas ids', () => {
    // Two modules sharing a slug — `01-intro` and `02-intro` — is the one shape
    // where keeping the row backfires. Closing the gap renumbers `02-intro`
    // onto `01-intro`, and `state.modules` keys one entry per folder. Left
    // alone, `renameFolder` refuses to overwrite the entry it finds,
    // `renameFolders` rolls the mover back to `02-intro`, and the surviving
    // folder inherits the deleted module's Canvas id while live module 20
    // becomes a prune candidate.
    const dir = syncedProject({ twinSlug: true });

    const run = deleteModule(dir, ['--module', '01-intro', '--yes'], '', {
      courseId: SYNCED_COURSE,
    });

    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(fs.readdirSync(path.join(dir, 'course')).sort(), [
      '01-intro',
    ]);

    const after = stateOf(dir);
    assert.deepEqual(Object.keys(after.modules), ['01-intro']);
    assert.equal(
      after.modules['01-intro'].canvas_module_id,
      20,
      'the folder belongs to the module that moved onto it, ids and all',
    );
    assert.deepEqual(Object.keys(after.modules['01-intro'].items), [
      '01-intro/01-loops.md',
    ]);
    assert.equal(
      after.modules['01-intro'].items['01-intro/01-loops.md'].canvas_id,
      503,
    );
    // The deleted module's binary goes with its module row, or `renameFolder`
    // would overwrite it without a word while rebuilding `state.files`.
    assert.deepEqual(Object.keys(after.files), []);
  });

  it('names every Canvas object it can no longer reach', () => {
    const dir = syncedProject({ twinSlug: true });

    const run = deleteModule(dir, ['--module', '01-intro', '--yes'], '', {
      courseId: SYNCED_COURSE,
    });

    assert.equal(run.status, 0);
    assert.match(run.stderr, /Renumbering moved 02-intro onto 01-intro/);
    assert.match(
      run.stderr,
      /01-intro — module "Intro" \(Canvas module id 10\)/,
    );
    assert.match(
      run.stderr,
      /01-welcome\.md — page "Welcome" \(Canvas id 501\)/,
    );
    assert.match(run.stderr, /02-alerts\.md — page "Alerts" \(Canvas id 502\)/);
    assert.match(
      run.stderr,
      /diagram\.png — embedded file \(Canvas file id 555\)/,
    );
  });

  it('says nothing when the renumber lands nowhere near it', () => {
    const dir = syncedProject();

    const run = deleteModule(dir, ['--module', '01-intro', '--yes'], '', {
      courseId: SYNCED_COURSE,
    });

    assert.equal(run.status, 0);
    assert.doesNotMatch(run.stderr, /Delete them in Canvas by hand/);
    assert.equal(stateOf(dir).modules['01-intro'].canvas_module_id, 10);
  });
});
