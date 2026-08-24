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
const { subHeaderHash } = require('../../lib/sync/gather');
const { SCHEMA_VERSION } = require('../../lib/sync/state');

const CLI = path.join(__dirname, '..', '..', 'cli', 'index.js');
const CANVAS_URL = 'https://canvas.example.com';
const COURSE_ID = '4242';

// Before `cli/status` is required, the way `test/cli/new-module.test.js` does
// it: the Canvas client reads the environment as it loads.
process.env.CANVAS_API_URL = CANVAS_URL;
process.env.CANVAS_API_TOKEN = 'test-token-123';
process.env.CANVAS_COURSE_ID = COURSE_ID;

const status = require('../../cli/status');

// The fixture is in no git repository, and dirt only gates writes into
// `course/`, which status makes none of. Handed in so the answer does not
// depend on the checkout the suite runs in.
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
const ALERTS_PAGE = {
  page_id: 502,
  url: 'alerts',
  title: 'Alerts',
  body: '<p>Mind this.</p>',
  updated_at: '2026-08-20T08:00:00.000Z',
};
const ONE_PAGE = {
  page_id: 601,
  url: 'one',
  title: 'One',
  body: '<p>One.</p>',
  updated_at: '2026-08-20T08:00:00.000Z',
};
const TWO_PAGE = {
  page_id: 602,
  url: 'two',
  title: 'Two',
  body: '<p>Two.</p>',
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
const ONE_ITEM = {
  id: 94,
  type: 'Page',
  title: 'One',
  page_url: 'one',
  content_id: 601,
  position: 4,
  indent: 1,
};
const TWO_ITEM = {
  id: 95,
  type: 'Page',
  title: 'Two',
  page_url: 'two',
  content_id: 602,
  position: 5,
  indent: 1,
};
const DEEP_HEADER = {
  id: 93,
  type: 'SubHeader',
  title: 'Deep',
  position: 3,
  indent: 0,
};

/**
 * The reads the one-module course answers, longest path first.
 *
 * The single-page routes matter even though `GET /pages` already carries every
 * `updated_at`: that pre-filter can only spare the fetch for a page whose base
 * row records a `canvas_hash` to compare against. A run that has lost the rows
 * re-fetches each page one by one, and without these the run would end in a
 * Canvas error rather than in a wrong report — which would make every
 * assertion below pass for the wrong reason.
 */
function readRoutes({ subsection = false } = {}) {
  const items = subsection
    ? [WELCOME_ITEM, ALERTS_ITEM, DEEP_HEADER, ONE_ITEM, TWO_ITEM]
    : [WELCOME_ITEM, ALERTS_ITEM];
  const pages = subsection
    ? [WELCOME_PAGE, ALERTS_PAGE, ONE_PAGE, TWO_PAGE]
    : [WELCOME_PAGE, ALERTS_PAGE];
  return [
    ...pages.map((page) => ({
      method: 'GET',
      path: `/pages/${page.url}`,
      body: page,
    })),
    { method: 'GET', path: '/modules/10/items', body: items },
    {
      method: 'GET',
      path: '/modules',
      body: [{ id: 10, name: 'Intro', position: 1 }],
    },
    {
      method: 'GET',
      path: '/pages',
      body: pages.map((page) => ({
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
const ALERTS = '01-intro/02-alerts.md';
// A subsection is a Canvas item too — a text header keyed by the folder path —
// so the state holds a row for the folder itself as well as for its pages.
const TWIN = '01-intro/03-alerts.md';
const DEEP = '01-intro/03-deep';
const ONE = '01-intro/03-deep/01-one.md';
const TWO = '01-intro/03-deep/02-two.md';
const DIAGRAM = '01-intro/_files/diagram.png';

/**
 * A throwaway project holding one synced module, two pages, an embedded binary
 * and — with `{ subsection: true }` — a subsection of two more pages.
 *
 * Out of the repository and driven by a child process, for the reason
 * `test/cli/delete-module.test.js` gives: `COURSE_DIR` and `SYNC_FILE` are
 * module-level constants resolved from `process.cwd()` at require time, so
 * running the command in this process would delete out of the repository's own
 * course.
 */
function project({ subsection = false, twin = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'delete-item-'));
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
    '---\ntitle: Welcome\ncanvas_type: page\n---\n\nHello there.\n',
  );
  write(
    `course/${ALERTS}`,
    '---\ntitle: Alerts\ncanvas_type: page\n---\n\nMind this.\n\n' +
      '![Diagram](_files/diagram.png)\n',
  );
  write(`course/${DIAGRAM}`, 'not really a png\n');
  // A sibling sharing 02-alerts.md's slug at the next prefix. Deleting
  // 02-alerts.md renumbers this one straight onto the path just vacated.
  if (twin) {
    write(
      'course/01-intro/03-alerts.md',
      '---\ntitle: More alerts\ncanvas_type: page\n---\n\nMore.\n',
    );
  }
  if (subsection) {
    write(
      'course/01-intro/03-deep/_category_.json',
      JSON.stringify({ label: 'Deep', position: 3 }, null, 2) + '\n',
    );
    write(`course/${ONE}`, '---\ntitle: One\ncanvas_type: page\n---\n\nOne.\n');
    write(`course/${TWO}`, '---\ntitle: Two\ncanvas_type: page\n---\n\nTwo.\n');
  }

  const courseDir = path.join(dir, 'course');
  const items = {
    [WELCOME]: pageRow(courseDir, WELCOME, WELCOME_ITEM, WELCOME_PAGE),
    [ALERTS]: pageRow(courseDir, ALERTS, ALERTS_ITEM, ALERTS_PAGE),
  };
  if (twin) {
    items[TWIN] = {
      canvas_type: 'page',
      canvas_id: 604,
      page_url: 'more-alerts',
      module_item_id: 96,
      title: 'More alerts',
      local_hash: hashLocalFile(path.join(courseDir, TWIN)),
      canvas_hash: 'canvas-604',
      canvas_updated_at: '2026-08-20T08:00:00.000Z',
      synced_at: '2026-08-20T09:00:00.000Z',
    };
  }
  if (subsection) {
    items[DEEP] = {
      canvas_type: 'sub_header',
      module_item_id: DEEP_HEADER.id,
      title: DEEP_HEADER.title,
      local_hash: subHeaderHash({ title: DEEP_HEADER.title, indent: 0 }),
      canvas_hash: canvasFingerprint({ item: DEEP_HEADER }, 'sub_header'),
      synced_at: '2026-08-20T09:00:00.000Z',
    };
    items[ONE] = pageRow(courseDir, ONE, ONE_ITEM, ONE_PAGE);
    items[TWO] = pageRow(courseDir, TWO, TWO_ITEM, TWO_PAGE);
  }

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
            item_order: Object.keys(items),
            items,
          },
        },
        icons: {},
        files: {
          [DIAGRAM]: {
            canvas_file_id: 555,
            canvas_url: `/courses/${COURSE_ID}/files/555/preview`,
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

/**
 * Run `npx course delete-item` in `dir`, with no terminal to ask questions of.
 *
 * `global` carries the flags declared on the program rather than on the
 * command — `--quiet` is the one used here — placed in front of the
 * subcommand name the way a real invocation writes them.
 */
function deleteItem(dir, args, { global = [] } = {}) {
  return spawnSync(process.execPath, [CLI, ...global, 'delete-item', ...args], {
    cwd: dir,
    input: '',
    encoding: 'utf8',
    // Every run below answers from flags. The timeout is what turns a
    // regression in that into a failure rather than a hung suite.
    timeout: 30000,
    env: {
      ...process.env,
      CANVAS_API_URL: CANVAS_URL,
      CANVAS_COURSE_ID: COURSE_ID,
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

/** The real `cli/status` over the fixture, against a stubbed Canvas. */
async function statusOver(dir, options = {}) {
  const out = silence();
  mockCanvas(readRoutes(options));
  await status({
    courseDir: path.join(dir, 'course'),
    syncFile: path.join(dir, '.canvas-sync.json'),
    gitDirty: CLEAN,
  });
  return printed(out);
}

// ---------------------------------------------------------------------------

describe('npx course delete-item and the row it leaves behind', () => {
  it('keeps the row for the item it deleted', () => {
    // A base row is the only thing that separates "the author deleted this"
    // from "this tool has never seen it". Dropped, the live Canvas page pairs
    // with no local file and no base, and the planner reads that as a page to
    // write into `course/`.
    const dir = project();
    const before = stateOf(dir);

    const run = deleteItem(dir, ['--path', `course/${ALERTS}`, '--yes']);

    assert.equal(run.status, 0, run.stderr);
    assert.equal(fs.existsSync(path.join(dir, 'course', ALERTS)), false);

    const after = stateOf(dir);
    assert.deepEqual(
      after.modules['01-intro'].items[ALERTS],
      before.modules['01-intro'].items[ALERTS],
      'the row has to survive whole, Canvas ids and all',
    );
    assert.deepEqual(after.modules['01-intro'].item_order, [WELCOME, ALERTS]);
  });

  it('leaves a status that offers the page rather than restoring it', async () => {
    // The consequence, end to end. Without the row, status planned the page
    // created locally — the author's deletion undone on the next sync — and
    // `--prune-canvas` had nothing to offer, because a prune candidate *is* a
    // base row.
    const dir = project();
    const run = deleteItem(dir, ['--path', `course/${ALERTS}`, '--yes']);
    assert.equal(run.status, 0, run.stderr);

    const report = await statusOver(dir);

    assert.match(report, /Orphaned on Canvas/);
    assert.match(report, /01-intro\/02-alerts\.md: page "Alerts"/);
    assert.doesNotMatch(
      report,
      /item created/,
      'the page the author deleted must not be written back to disk',
    );
    assert.equal(process.exitCode, 0);
  });

  it('leaves one orphan per page under a subsection it deleted', async () => {
    // `removeFromSyncState` handled a directory by prefix: every row underneath
    // went at once. Each of those pages is a live Canvas object of its own, so
    // each stays and each is reported on its own line — the same listing any
    // other orphan gets, not a special case.
    const dir = project({ subsection: true });

    const run = deleteItem(dir, ['--path', 'course/01-intro/03-deep', '--yes']);

    assert.equal(run.status, 0, run.stderr);
    assert.equal(
      fs.existsSync(path.join(dir, 'course', '01-intro', '03-deep')),
      false,
    );
    const after = stateOf(dir);
    assert.deepEqual(
      Object.keys(after.modules['01-intro'].items),
      [WELCOME, ALERTS, DEEP, ONE, TWO],
      'every row under the folder stays, the text header row included',
    );
    assert.equal(
      after.modules['01-intro'].items[DEEP].canvas_type,
      'sub_header',
    );
    assert.equal(after.modules['01-intro'].items[ONE].canvas_id, 601);
    assert.equal(after.modules['01-intro'].items[TWO].canvas_id, 602);

    const report = await statusOver(dir, { subsection: true });
    assert.match(report, /01-intro\/03-deep: sub_header "Deep"/);
    assert.match(report, /01-intro\/03-deep\/01-one\.md: page "One"/);
    assert.match(report, /01-intro\/03-deep\/02-two\.md: page "Two"/);
    assert.doesNotMatch(
      report,
      /item created/,
      'three Canvas objects went, three orphans came back, and none of them ' +
        'is written back to disk',
    );
  });

  it('updates the Canvas page when the author writes the path again', async () => {
    // The row left behind is keyed by the path, so a new file at that path
    // pairs with it and is the same Canvas page, edited. Without the row the
    // new file was new on both sides: status planned a *second* Canvas page
    // beside the first, and the first written back to disk beside the new one.
    const dir = project();
    deleteItem(dir, ['--path', `course/${ALERTS}`, '--yes']);
    fs.writeFileSync(
      path.join(dir, 'course', ALERTS),
      '---\ntitle: Callouts\ncanvas_type: page\n---\n\nA different page.\n',
      'utf8',
    );

    const report = await statusOver(dir);

    assert.match(report, /Canvas: 1 item updated/);
    assert.doesNotMatch(
      report,
      /item created/,
      'writing the path again must edit page 502, not add a second page',
    );
  });
});

describe('npx course delete-item when the renumber lands on the deleted path', () => {
  it('gives the row up rather than let the two pages swap Canvas ids', () => {
    // Two siblings sharing a slug — `02-alerts.md` and `03-alerts.md` — is the
    // one shape where keeping the row backfires. Closing the gap moves
    // `03-alerts.md` onto `02-alerts.md`, and the state keys one row per path.
    // Left alone, `renamePath` refuses to overwrite the row it finds,
    // `renamePaths` rolls the mover back to `03-alerts.md`, and the two swap
    // identities in silence: the file on disk would push its content to page
    // 502, and `--prune-canvas` would offer to delete page 604, which is the
    // page it actually is.
    const dir = project({ twin: true });

    const run = deleteItem(dir, ['--path', `course/${ALERTS}`, '--yes']);

    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(
      fs.readdirSync(path.join(dir, 'course', '01-intro')).sort(),
      ['01-welcome.md', '02-alerts.md', '_category_.json', '_files'],
    );

    const items = stateOf(dir).modules['01-intro'].items;
    assert.deepEqual(Object.keys(items), [WELCOME, ALERTS]);
    assert.equal(
      items[ALERTS].canvas_id,
      604,
      'the path belongs to the page that moved onto it, ids and all',
    );
    assert.equal(items[ALERTS].title, 'More alerts');
  });

  it('names the Canvas page it can no longer reach', () => {
    // Dropping the row strands page 502: nothing in the repository points at
    // it afterwards and `--prune-canvas` will never offer it. That is the
    // lesser harm than crossing the ids, but only if the author is told, so
    // they can go and delete it in Canvas themselves.
    const dir = project({ twin: true });

    const run = deleteItem(dir, ['--path', `course/${ALERTS}`, '--yes']);

    assert.equal(run.status, 0);
    assert.match(
      run.stderr,
      /Renumbering moved 03-alerts\.md onto 02-alerts\.md/,
    );
    assert.match(run.stderr, /Delete them in Canvas by hand/);
    assert.match(
      run.stderr,
      /01-intro\/02-alerts\.md — page "Alerts" \(Canvas id 502\)/,
    );
  });

  it('names it under --quiet too, where a warning would be dropped', () => {
    // `--quiet` closes the warning channel, and this listing is the only record
    // of page 502 the run leaves anywhere: the row is gone from the sync state,
    // nothing under course/ points at the page, and `--prune-canvas` will never
    // offer it. So it goes out on the error channel, which `--quiet` keeps —
    // the same reasoning `lib/sync/canvas-write.js` gives for throwing rather
    // than warning on a quiz it could not place. A scripted delete is exactly
    // the run that would otherwise lose the page without a word.
    const dir = project({ twin: true });

    const run = deleteItem(dir, ['--path', `course/${ALERTS}`, '--yes'], {
      global: ['--quiet'],
    });

    // Still a completed delete with a caveat, not a failed run.
    assert.equal(run.status, 0, run.stderr);
    assert.match(
      run.stderr,
      /Renumbering moved 03-alerts\.md onto 02-alerts\.md/,
    );
    assert.match(run.stderr, /Delete them in Canvas by hand/);
    assert.match(
      run.stderr,
      /01-intro\/02-alerts\.md — page "Alerts" \(Canvas id 502\)/,
    );
  });

  it('says nothing when the renumber lands nowhere near it', () => {
    // The fence. Every other delete keeps its row, and a command that warned
    // about stranding on those would be crying wolf on the common path.
    const dir = project();

    const run = deleteItem(dir, ['--path', `course/${ALERTS}`, '--yes']);

    assert.equal(run.status, 0);
    assert.doesNotMatch(run.stderr, /Delete them in Canvas by hand/);
    assert.equal(stateOf(dir).modules['01-intro'].items[ALERTS].canvas_id, 502);
  });
});
