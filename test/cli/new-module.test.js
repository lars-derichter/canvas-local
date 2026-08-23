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
const COURSE_ID = '4242';

// Before `cli/status` is required, the way `test/cli/status.test.js` does it:
// the Canvas client reads the environment as it loads.
process.env.CANVAS_API_URL = CANVAS_URL;
process.env.CANVAS_API_TOKEN = 'test-token-123';
process.env.CANVAS_COURSE_ID = COURSE_ID;

const status = require('../../cli/status');

// The tree the child renumbers is in no git repository, and what git holds has
// no bearing on any of this: dirt gates writes into `course/`, and status makes
// none. Handed in so the answer does not depend on the checkout the suite runs
// in.
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

// ---------------------------------------------------------------------------
// The Canvas course the fixture is synced to
// ---------------------------------------------------------------------------

const WELCOME_PAGE = {
  page_id: 501,
  url: 'welcome',
  title: 'Welcome',
  body: '<p>Hello there.</p>',
  updated_at: '2026-08-20T08:00:00.000Z',
};
const LOOPS_PAGE = {
  page_id: 502,
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
const LOOPS_ITEM = {
  id: 92,
  type: 'Page',
  title: 'Loops',
  page_url: 'loops',
  content_id: 502,
  position: 1,
  indent: 0,
};

/** The reads a two-module, two-page course answers, longest path first. */
function readRoutes() {
  return [
    { method: 'GET', path: '/modules/10/items', body: [WELCOME_ITEM] },
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
      body: [WELCOME_PAGE, LOOPS_PAGE].map((page) => ({
        page_id: page.page_id,
        url: page.url,
        title: page.title,
        updated_at: page.updated_at,
      })),
    },
  ];
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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
const LOOPS = '02-basics/01-loops.md';
const DIAGRAM = '01-intro/_files/diagram.png';

/**
 * A throwaway project holding two synced modules, one of them with an embedded
 * binary, and a sync state that agrees with both `course/` and the Canvas
 * course above.
 *
 * Out of the repository and renumbered by a child process, for the reason
 * `test/cli/delete-module.test.js` gives: `COURSE_DIR` and `SYNC_FILE` are
 * module-level constants resolved from `process.cwd()` at require time, so
 * calling `newModule()` in this process would renumber the repository's own
 * course.
 *
 * `{ synced: false }` leaves the sync state out altogether — a course nobody
 * has pushed yet, which is where every course starts.
 */
function project({ synced = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'new-module-'));
  made.push(dir);
  const write = (relative, contents) => {
    const full = path.join(dir, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents, 'utf8');
  };

  write('package.json', '{ "name": "fixture", "private": true }\n');
  write(
    'course/01-intro/_category_.json',
    JSON.stringify({ label: 'Intro', position: 1 }, null, 2) + '\n',
  );
  write(
    `course/${WELCOME}`,
    '---\ntitle: Welcome\ncanvas_type: page\n---\n\nHello there.\n\n' +
      '![Diagram](_files/diagram.png)\n',
  );
  write(`course/${DIAGRAM}`, 'not really a png\n');
  write(
    'course/02-basics/_category_.json',
    JSON.stringify({ label: 'Basics', position: 2 }, null, 2) + '\n',
  );
  write(
    `course/${LOOPS}`,
    '---\ntitle: Loops\ncanvas_type: page\n---\n\nRound and round.\n',
  );

  if (!synced) return dir;

  const courseDir = path.join(dir, 'course');
  write(
    '.canvas-sync.json',
    JSON.stringify(
      {
        schema_version: SCHEMA_VERSION,
        canvas_base_url: CANVAS_URL,
        course_id: Number(COURSE_ID),
        last_sync: '2026-08-20T09:00:00.000Z',
        modules: {
          '01-intro': {
            canvas_module_id: 10,
            name: 'Intro',
            position: 1,
            item_order: [WELCOME],
            items: {
              [WELCOME]: pageRow(
                courseDir,
                WELCOME,
                WELCOME_ITEM,
                WELCOME_PAGE,
              ),
            },
          },
          '02-basics': {
            canvas_module_id: 20,
            name: 'Basics',
            position: 2,
            item_order: [LOOPS],
            items: {
              [LOOPS]: pageRow(courseDir, LOOPS, LOOPS_ITEM, LOOPS_PAGE),
            },
          },
        },
        icons: {},
        files: {
          [DIAGRAM]: {
            canvas_file_id: 555,
            canvas_url: `/courses/${COURSE_ID}/files/555/preview`,
            // The hash the last sync recorded for the binary, so the page it is
            // embedded in reads as unchanged rather than as an image to
            // re-upload.
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

/** Run `npx course new-module` in `dir`, with no terminal to ask questions of. */
function newModule(dir, args, { courseId = COURSE_ID } = {}) {
  return spawnSync(process.execPath, [CLI, 'new-module', ...args], {
    cwd: dir,
    input: '',
    encoding: 'utf8',
    // Every run below answers from flags. The timeout is what turns a
    // regression in that into a failure rather than a hung suite.
    timeout: 30000,
    env: {
      ...process.env,
      CANVAS_API_URL: CANVAS_URL,
      CANVAS_COURSE_ID: courseId,
    },
  });
}

function stateOf(dir) {
  return JSON.parse(
    fs.readFileSync(path.join(dir, '.canvas-sync.json'), 'utf8'),
  );
}

function printed(out) {
  return out.log.mock.calls.map((call) => call.arguments.join(' ')).join('\n');
}

// ---------------------------------------------------------------------------

describe('npx course new-module inserting at an occupied position', () => {
  it('carries the modules it renumbers into the sync state', () => {
    // The sync state keys every module and every item by its path under
    // `course/`, so a folder this command renumbers without re-keying leaves
    // rows addressing folders that are no longer there.
    const dir = project();

    const run = newModule(dir, ['--name', 'Kickoff', '--position', '1']);

    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(fs.readdirSync(path.join(dir, 'course')).sort(), [
      '01-kickoff',
      '02-intro',
      '03-basics',
    ]);

    const after = stateOf(dir);
    assert.deepEqual(Object.keys(after.modules).sort(), [
      '02-intro',
      '03-basics',
    ]);
    // The Canvas ids travel with the folder: the module the author shifted is
    // the same Canvas module it was before.
    assert.equal(after.modules['02-intro'].canvas_module_id, 10);
    assert.equal(after.modules['03-basics'].canvas_module_id, 20);
    assert.deepEqual(Object.keys(after.modules['02-intro'].items), [
      '02-intro/01-welcome.md',
    ]);
    assert.deepEqual(after.modules['02-intro'].item_order, [
      '02-intro/01-welcome.md',
    ]);
    assert.deepEqual(Object.keys(after.modules['03-basics'].items), [
      '03-basics/01-loops.md',
    ]);
    assert.equal(
      after.modules['02-intro'].items['02-intro/01-welcome.md'].canvas_id,
      501,
      'the row has to arrive whole, not just under a new key',
    );
    // An embedded binary is keyed by the same kind of path and moved with the
    // folder, or the next push uploads it again under its new address and
    // leaves a live Canvas file nothing reconciles.
    assert.deepEqual(Object.keys(after.files), ['02-intro/_files/diagram.png']);
    assert.equal(
      after.files['02-intro/_files/diagram.png'].canvas_file_id,
      555,
    );
  });

  it('leaves the sync state alone when it renumbers nothing', () => {
    // A module appended past the last one shifts no folder, so there is nothing
    // to record — and a command that rewrote the file anyway would leave the
    // author a diff to commit for a run that moved no row.
    const dir = project();
    const before = fs.readFileSync(path.join(dir, '.canvas-sync.json'), 'utf8');

    const run = newModule(dir, ['--name', 'Wrap Up', '--position', '3']);

    assert.equal(run.status, 0, run.stderr);
    assert.ok(fs.existsSync(path.join(dir, 'course', '03-wrap-up')));
    assert.equal(
      fs.readFileSync(path.join(dir, '.canvas-sync.json'), 'utf8'),
      before,
    );
  });

  it('renumbers a course that has never been synced', () => {
    // No `.canvas-sync.json` is not an error and must not become one: it is
    // where every course starts, and inventing the file here would claim the
    // course had been pushed.
    const dir = project({ synced: false });

    const run = newModule(dir, ['--name', 'Kickoff', '--position', '1']);

    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(fs.readdirSync(path.join(dir, 'course')).sort(), [
      '01-kickoff',
      '02-intro',
      '03-basics',
    ]);
    assert.equal(fs.existsSync(path.join(dir, '.canvas-sync.json')), false);
  });
});

describe('what a sync makes of the modules new-module shifted', () => {
  it('has only the new module to create and two positions to move', async () => {
    // The consequence, end to end. Unrecorded, the shifted folders read as two
    // brand-new modules: status planned three modules created, both pages moved
    // out of the Canvas modules they were in, and the two live Canvas modules
    // they came from reported as orphans for `--prune-canvas` to delete. What
    // the author actually did was insert one module.
    const out = silence();
    const dir = project();
    const run = newModule(dir, ['--name', 'Kickoff', '--position', '1']);
    assert.equal(run.status, 0, run.stderr);
    mockCanvas(readRoutes());

    await status({
      courseDir: path.join(dir, 'course'),
      syncFile: path.join(dir, '.canvas-sync.json'),
      gitDirty: CLEAN,
    });

    assert.match(printed(out), /Canvas: 1 module created, 2 modules updated/);
    assert.doesNotMatch(
      printed(out),
      /Orphaned on Canvas/,
      'nothing was orphaned: both modules are where the author left them',
    );
    assert.doesNotMatch(printed(out), /items moved/);
    assert.equal(process.exitCode, 0);
  });
});
