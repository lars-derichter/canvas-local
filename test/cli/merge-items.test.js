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
function syncedProject() {
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
            item_order: [WELCOME, ALERTS],
            items: {
              [WELCOME]: syncRow(
                courseDir,
                WELCOME,
                WELCOME_ITEM,
                WELCOME_PAGE,
              ),
              [ALERTS]: syncRow(courseDir, ALERTS, ALERTS_ITEM, ALERTS_PAGE),
            },
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

    const run = spawnSync(
      process.execPath,
      [
        CLI,
        'merge-items',
        '--source',
        `course/${ALERTS}`,
        '--target',
        `course/${WELCOME}`,
      ],
      {
        cwd: dir,
        input: '',
        encoding: 'utf8',
        timeout: 30000,
        env: {
          ...process.env,
          CANVAS_API_URL: CANVAS_URL,
          CANVAS_COURSE_ID: COURSE_ID,
        },
      },
    );

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
