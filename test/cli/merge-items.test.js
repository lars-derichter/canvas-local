const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const matter = require('gray-matter');

const { _mergeFiles } = require('../../cli/merge-items');

/**
 * Create a markdown file with frontmatter and body content.
 */
function createMdFile(dir, name, frontmatter, body) {
  const content = matter.stringify('\n' + body + '\n', frontmatter);
  fs.writeFileSync(path.join(dir, name), content, 'utf8');
}

describe('_mergeFiles', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-items-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('appends source body into target file', async () => {
    createMdFile(tmpDir, '01-first.md', { title: 'First' }, 'Content A');
    createMdFile(tmpDir, '02-second.md', { title: 'Second' }, 'Content B');

    const targetPath = path.join(tmpDir, '01-first.md');
    const sourcePath = path.join(tmpDir, '02-second.md');

    await _mergeFiles(targetPath, sourcePath, tmpDir);

    const result = fs.readFileSync(targetPath, 'utf8');
    assert.ok(result.includes('Content A'));
    assert.ok(result.includes('Content B'));
  });

  it('keeps target frontmatter', async () => {
    createMdFile(
      tmpDir,
      '01-first.md',
      { title: 'First', canvas_type: 'page', canvas_id: 'first-page' },
      'Content A',
    );
    createMdFile(
      tmpDir,
      '02-second.md',
      { title: 'Second', canvas_type: 'assignment', canvas_id: 42 },
      'Content B',
    );

    const targetPath = path.join(tmpDir, '01-first.md');
    const sourcePath = path.join(tmpDir, '02-second.md');

    await _mergeFiles(targetPath, sourcePath, tmpDir);

    const parsed = matter(fs.readFileSync(targetPath, 'utf8'));
    assert.equal(parsed.data.title, 'First');
    assert.equal(parsed.data.canvas_type, 'page');
    assert.equal(parsed.data.canvas_id, 'first-page');
  });

  it('discards source frontmatter', async () => {
    createMdFile(tmpDir, '01-first.md', { title: 'First' }, 'Content A');
    createMdFile(
      tmpDir,
      '02-second.md',
      { title: 'Second', canvas_id: 'second-page' },
      'Content B',
    );

    const targetPath = path.join(tmpDir, '01-first.md');
    const sourcePath = path.join(tmpDir, '02-second.md');

    await _mergeFiles(targetPath, sourcePath, tmpDir);

    const parsed = matter(fs.readFileSync(targetPath, 'utf8'));
    assert.equal(parsed.data.title, 'First');
    assert.ok(
      !parsed.data.canvas_id || parsed.data.canvas_id !== 'second-page',
    );
  });

  it('deletes the source file', async () => {
    createMdFile(tmpDir, '01-first.md', { title: 'First' }, 'Content A');
    createMdFile(tmpDir, '02-second.md', { title: 'Second' }, 'Content B');

    const targetPath = path.join(tmpDir, '01-first.md');
    const sourcePath = path.join(tmpDir, '02-second.md');

    await _mergeFiles(targetPath, sourcePath, tmpDir);

    assert.ok(!fs.existsSync(sourcePath));
  });

  it('renumbers remaining items sequentially', async () => {
    createMdFile(tmpDir, '01-first.md', { title: 'First' }, 'A');
    createMdFile(tmpDir, '02-second.md', { title: 'Second' }, 'B');
    createMdFile(tmpDir, '03-third.md', { title: 'Third' }, 'C');

    const targetPath = path.join(tmpDir, '01-first.md');
    const sourcePath = path.join(tmpDir, '02-second.md');

    await _mergeFiles(targetPath, sourcePath, tmpDir);

    const files = fs.readdirSync(tmpDir).sort();
    assert.deepStrictEqual(files, ['01-first.md', '02-third.md']);
  });

  it('combines multi-line content with a blank line separator', async () => {
    createMdFile(tmpDir, '01-first.md', { title: 'First' }, 'Line 1\nLine 2');
    createMdFile(tmpDir, '02-second.md', { title: 'Second' }, 'Line 3\nLine 4');

    const targetPath = path.join(tmpDir, '01-first.md');
    const sourcePath = path.join(tmpDir, '02-second.md');

    await _mergeFiles(targetPath, sourcePath, tmpDir);

    const parsed = matter(fs.readFileSync(targetPath, 'utf8'));
    const body = parsed.content.trim();
    assert.ok(body.includes('Line 1\nLine 2'));
    assert.ok(body.includes('Line 3\nLine 4'));
    // Should have a blank line between the two parts
    assert.ok(body.includes('Line 2\n\nLine 3'));
  });
});

// ---------------------------------------------------------------------------
// The source's base row, and what a sync makes of it
// ---------------------------------------------------------------------------

const { spawnSync } = require('child_process');

const { mockCanvas, silence } = require('../helpers/canvas-mock');
const {
  canvasFingerprint,
  hashLocalFile,
} = require('../../lib/sync/fingerprint');
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

const CLEAN = { available: true, paths: new Set(), reason: null };

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

const WELCOME = '01-intro/01-welcome.md';
const ALERTS = '01-intro/02-alerts.md';

function syncRow(courseDir, itemPath, item, content) {
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

/**
 * A throwaway synced project with two pages in one module, out of the
 * repository and merged by a child process: `COURSE_DIR` and `SYNC_FILE` are
 * module-level constants resolved from `process.cwd()` at require time, so
 * running the command in this process would merge inside the repository's own
 * course.
 */
function syncedProject({ twin = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-items-synced-'));
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
    '---\ntitle: Alerts\ncanvas_type: page\n---\n\nMind this.\n',
  );

  // A sibling sharing the source's slug at the next prefix. Merging closes the
  // gap, renumbering this one straight onto the source's own path.
  if (twin) {
    write(
      'course/01-intro/03-alerts.md',
      '---\ntitle: More alerts\ncanvas_type: page\n---\n\nMore.\n',
    );
  }

  const courseDir = path.join(dir, 'course');
  const items = {
    [WELCOME]: syncRow(courseDir, WELCOME, WELCOME_ITEM, WELCOME_PAGE),
    [ALERTS]: syncRow(courseDir, ALERTS, ALERTS_ITEM, ALERTS_PAGE),
  };
  if (twin) {
    items['01-intro/03-alerts.md'] = {
      canvas_type: 'page',
      canvas_id: 604,
      page_url: 'more-alerts',
      module_item_id: 96,
      title: 'More alerts',
      local_hash: hashLocalFile(path.join(courseDir, '01-intro/03-alerts.md')),
      canvas_hash: 'canvas-604',
      canvas_updated_at: '2026-08-20T08:00:00.000Z',
      synced_at: '2026-08-20T09:00:00.000Z',
    };
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
        files: {},
      },
      null,
      2,
    ) + '\n',
  );
  return dir;
}

/**
 * Run `npx course merge-items` in `dir`, with no terminal to ask questions of.
 */
function mergeItems(dir, args) {
  return spawnSync(process.execPath, [CLI, 'merge-items', ...args], {
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

/** The flag-mode arguments for merging 02-alerts.md into 01-welcome.md. */
const FLAGS = ['--source', `course/${ALERTS}`, '--target', `course/${WELCOME}`];

describe('npx course merge-items and the source row it leaves behind', () => {
  const dirs = [];
  afterEach(() => {
    mock.restoreAll();
    process.exitCode = 0;
    while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true });
  });

  it('keeps the row for the source it merged away', async () => {
    // A merge leaves the source's Canvas page live and untouched, and its base
    // row is the only record that it is the author's to delete. Dropped, the
    // page pairs with no local file and no base, and the planner reads that as
    // a page to write back into `course/` — the merge undone on the next sync,
    // and nothing for `--prune-canvas` to offer, because a prune candidate *is*
    // a base row.
    const dir = syncedProject();
    dirs.push(dir);
    const before = JSON.parse(
      fs.readFileSync(path.join(dir, '.canvas-sync.json'), 'utf8'),
    );

    const run = mergeItems(dir, [...FLAGS, '--yes']);

    assert.equal(run.status, 0, run.stderr);
    assert.equal(fs.existsSync(path.join(dir, 'course', ALERTS)), false);
    assert.match(
      fs.readFileSync(path.join(dir, 'course', WELCOME), 'utf8'),
      /Mind this\./,
      'the merge itself still has to happen',
    );

    const after = JSON.parse(
      fs.readFileSync(path.join(dir, '.canvas-sync.json'), 'utf8'),
    );
    assert.deepEqual(
      after.modules['01-intro'].items[ALERTS],
      before.modules['01-intro'].items[ALERTS],
      'the source keeps its row whole, Canvas ids and all',
    );

    const out = silence();
    // The single-page routes matter even though `GET /pages` already carries
    // every `updated_at`: that pre-filter can only spare the fetch for a page
    // whose base row records a `canvas_hash` to compare against. A run that
    // has lost the source's row re-fetches it one page at a time, and without
    // these the run would end in a Canvas error rather than in a wrong report
    // — which would make the assertions below pass for the wrong reason.
    mockCanvas([
      { method: 'GET', path: '/pages/welcome', body: WELCOME_PAGE },
      { method: 'GET', path: '/pages/alerts', body: ALERTS_PAGE },
      {
        method: 'GET',
        path: '/modules/10/items',
        body: [WELCOME_ITEM, ALERTS_ITEM],
      },
      {
        method: 'GET',
        path: '/modules',
        body: [{ id: 10, name: 'Intro', position: 1 }],
      },
      {
        method: 'GET',
        path: '/pages',
        body: [WELCOME_PAGE, ALERTS_PAGE].map((page) => ({
          page_id: page.page_id,
          url: page.url,
          title: page.title,
          updated_at: page.updated_at,
        })),
      },
    ]);
    await status({
      courseDir: path.join(dir, 'course'),
      syncFile: path.join(dir, '.canvas-sync.json'),
      gitDirty: CLEAN,
    });
    const report = out.log.mock.calls
      .map((call) => call.arguments.join(' '))
      .join('\n');

    assert.match(report, /Orphaned on Canvas/);
    assert.match(report, /01-intro\/02-alerts\.md: page "Alerts"/);
    assert.match(
      report,
      /Canvas: 1 item updated/,
      'the target still carries the merged body up to Canvas',
    );
    assert.doesNotMatch(
      report,
      /item created/,
      'the page merged away must not be written back to disk',
    );
  });
});

describe('npx course merge-items when the renumber lands on the source path', () => {
  const dirs = [];
  afterEach(() => {
    mock.restoreAll();
    process.exitCode = 0;
    while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true });
  });

  it('gives the source row up rather than let the two pages swap Canvas ids', () => {
    // A merge closes the gap the source left, so it collides exactly the way
    // `delete-item` does when two siblings share a slug: `03-alerts.md` lands
    // on `02-alerts.md`, and the state keys one row per path. Left alone,
    // `renamePaths` rolls the mover back and the two swap identities.
    const dir = syncedProject({ twin: true });
    dirs.push(dir);

    const run = mergeItems(dir, [...FLAGS, '--yes']);

    assert.equal(run.status, 0, run.stderr);
    const after = JSON.parse(
      fs.readFileSync(path.join(dir, '.canvas-sync.json'), 'utf8'),
    );
    const items = after.modules['01-intro'].items;
    assert.deepEqual(Object.keys(items), [WELCOME, ALERTS]);
    assert.equal(
      items[ALERTS].canvas_id,
      604,
      'the path belongs to the page that moved onto it, ids and all',
    );
    assert.match(
      run.stderr,
      /Renumbering moved 03-alerts\.md onto 02-alerts\.md/,
    );
    assert.match(
      run.stderr,
      /01-intro\/02-alerts\.md — page "Alerts" \(Canvas id 502\)/,
    );
  });
});

describe('npx course merge-items in flag mode, and the confirmation it needs', () => {
  const dirs = [];
  afterEach(() => {
    while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true });
  });

  it('refuses --source and --target without --yes, and merges nothing', () => {
    // Flag mode skips the y/N question, so `--yes` is the whole confirmation:
    // the same gate `delete-item --path` and `delete-module --module` stand
    // behind, and for the same reason — this deletes a file.
    const dir = syncedProject();
    dirs.push(dir);
    const target = path.join(dir, 'course', WELCOME);
    const before = fs.readFileSync(target, 'utf8');

    const run = mergeItems(dir, FLAGS);

    assert.equal(run.status, 1, 'a refused run must not report success');
    assert.match(run.stderr, /--source and --target require --yes/);
    assert.equal(
      fs.existsSync(path.join(dir, 'course', ALERTS)),
      true,
      'the source must still be there',
    );
    assert.equal(
      fs.readFileSync(target, 'utf8'),
      before,
      'and the target must not be holding the source body',
    );
  });

  it('merges and deletes the source once --yes is given', () => {
    const dir = syncedProject();
    dirs.push(dir);

    const run = mergeItems(dir, [...FLAGS, '--yes']);

    assert.equal(run.status, 0, run.stderr);
    assert.equal(fs.existsSync(path.join(dir, 'course', ALERTS)), false);
    assert.match(
      fs.readFileSync(path.join(dir, 'course', WELCOME), 'utf8'),
      /Mind this\./,
    );
  });
});
