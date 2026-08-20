const { describe, it, mock, afterEach, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { mockCanvas, silence } = require('../helpers/canvas-mock');

process.env.CANVAS_API_URL = 'https://canvas.example.com';
process.env.CANVAS_API_TOKEN = 'test-token-123';
process.env.CANVAS_COURSE_ID = '4242';

const sync = require('../../cli/sync');
const { buildReport } = { buildReport: sync._buildReport };

const COURSE_ID = '4242';
const CLEAN = { available: true, paths: new Set(), reason: null };

// The command reports its verdict through `process.exitCode` rather than
// `process.exit`, so a test can read it — and has to put it back afterwards,
// or the first run that legitimately fails would fail the whole suite.
beforeEach(() => {
  process.exitCode = 0;
});
afterEach(() => {
  mock.restoreAll();
  process.exitCode = 0;
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function tempDir(tree = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-cli-test-'));
  for (const [relative, contents] of Object.entries(tree)) {
    const full = path.join(dir, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents, 'utf8');
  }
  return dir;
}

/** A sync state on disk, so the command's own load/save path is exercised. */
function stateFile(state) {
  const file = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'sync-state-')),
    '.canvas-sync.json',
  );
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        schema_version: 4,
        canvas_base_url: 'https://canvas.example.com',
        course_id: Number(COURSE_ID),
        last_sync: null,
        modules: {},
        icons: {},
        files: {},
        ...state,
      },
      null,
      2,
    ),
    'utf8',
  );
  return file;
}

const PAGE = {
  page_id: 501,
  url: 'welcome',
  title: 'Welcome',
  body: '<p>Hello there.</p>',
  updated_at: '2026-08-20T11:00:00.000Z',
};
const ITEM = {
  id: 91,
  type: 'Page',
  title: 'Welcome',
  page_url: 'welcome',
  content_id: 501,
  position: 1,
  indent: 0,
};

/** The four GETs a page-only course answers, in the order routes must be tried. */
function readRoutes({ items = [ITEM], page = PAGE } = {}) {
  return [
    { method: 'GET', path: '/modules/10/items', body: items },
    {
      method: 'GET',
      path: '/modules',
      body: [{ id: 10, name: 'Intro', position: 1 }],
    },
    { method: 'GET', path: `/pages/${page.url}`, body: page },
    {
      method: 'GET',
      path: '/pages',
      body: [
        {
          page_id: page.page_id,
          url: page.url,
          title: page.title,
          updated_at: page.updated_at,
        },
      ],
    },
  ];
}

/**
 * A synced course: the tree, the state and the Canvas side all agreeing, which
 * is the state every "does this write anything" test starts from.
 */
function syncedFixture({ localBody = 'Hello there.\n' } = {}) {
  const courseDir = tempDir({
    '01-intro/_category_.json': '{ "label": "Intro", "position": 1 }\n',
    '01-intro/01-welcome.md': `---\ntitle: Welcome\n---\n\n${localBody}`,
  });
  const {
    hashLocalFile,
    canvasFingerprint,
  } = require('../../lib/sync/fingerprint');
  const file = stateFile({
    modules: {
      '01-intro': {
        canvas_module_id: 10,
        name: 'Intro',
        position: 1,
        item_order: ['01-intro/01-welcome.md'],
        items: {
          '01-intro/01-welcome.md': {
            canvas_type: 'page',
            canvas_id: 501,
            page_url: 'welcome',
            module_item_id: 91,
            title: 'Welcome',
            local_hash: hashLocalFile(
              path.join(courseDir, '01-intro/01-welcome.md'),
            ),
            canvas_hash: canvasFingerprint(
              { item: ITEM, content: PAGE },
              'page',
            ),
            canvas_updated_at: PAGE.updated_at,
            synced_at: '2026-08-20T09:00:00.000Z',
          },
        },
      },
    },
  });
  return { courseDir, file };
}

function readState(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writes(calls) {
  return calls.filter((call) => call.method !== 'GET');
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

describe('npx course sync', () => {
  it('writes nothing when both sides already agree', async () => {
    silence();
    const { courseDir, file } = syncedFixture();
    const calls = mockCanvas(readRoutes());

    await sync({
      courseDir,
      syncFile: file,
      gitDirty: CLEAN,
      interactive: false,
    });

    assert.deepEqual(writes(calls), [], 'a no-op sync must issue no write');
    assert.equal(process.exitCode, 0);
  });

  it('pushes a local edit and pulls nothing', async () => {
    silence();
    const { courseDir, file } = syncedFixture();
    fs.writeFileSync(
      path.join(courseDir, '01-intro/01-welcome.md'),
      '---\ntitle: Welcome\n---\n\nEdited here.\n',
      'utf8',
    );
    const calls = mockCanvas([
      ...readRoutes(),
      {
        method: 'PUT',
        path: '/pages/501',
        body: { ...PAGE, body: '<p>Edited here.</p>' },
      },
    ]);

    await sync({
      courseDir,
      syncFile: file,
      gitDirty: CLEAN,
      interactive: false,
    });

    assert.deepEqual(
      writes(calls).map(
        (call) => `${call.method} ${call.url.split('/api/v1')[1]}`,
      ),
      [`PUT /courses/${COURSE_ID}/pages/501`],
    );
  });

  describe('when both sides changed', () => {
    /** A course where the local file and the Canvas page have both moved on. */
    function conflicted() {
      const fixture = syncedFixture();
      fs.writeFileSync(
        path.join(fixture.courseDir, '01-intro/01-welcome.md'),
        '---\ntitle: Welcome\n---\n\nEdited here.\n',
        'utf8',
      );
      const movedPage = {
        ...PAGE,
        body: '<p>Edited in Canvas.</p>',
        updated_at: '2026-08-20T13:00:00.000Z',
      };
      return { ...fixture, movedPage };
    }

    it('--conflict local pushes over the Canvas copy', async () => {
      silence();
      const { courseDir, file, movedPage } = conflicted();
      const calls = mockCanvas([
        ...readRoutes({ page: movedPage }),
        { method: 'PUT', path: '/pages/501', body: movedPage },
      ]);

      await sync({
        courseDir,
        syncFile: file,
        gitDirty: CLEAN,
        interactive: false,
        conflict: 'local',
      });

      assert.equal(writes(calls).length, 1);
      assert.equal(writes(calls)[0].method, 'PUT');
      assert.match(
        fs.readFileSync(path.join(courseDir, '01-intro/01-welcome.md'), 'utf8'),
        /Edited here/,
        'the local file must not have been overwritten',
      );
    });

    it('--conflict canvas writes the Canvas copy over the file', async () => {
      silence();
      const { courseDir, file, movedPage } = conflicted();
      const calls = mockCanvas(readRoutes({ page: movedPage }));

      await sync({
        courseDir,
        syncFile: file,
        gitDirty: CLEAN,
        interactive: false,
        conflict: 'canvas',
      });

      assert.deepEqual(writes(calls), []);
      assert.match(
        fs.readFileSync(path.join(courseDir, '01-intro/01-welcome.md'), 'utf8'),
        /Edited in Canvas/,
      );
    });

    it('--conflict ask with no terminal skips and fails the run', async () => {
      silence();
      const { courseDir, file, movedPage } = conflicted();
      const calls = mockCanvas(readRoutes({ page: movedPage }));

      await sync({
        courseDir,
        syncFile: file,
        gitDirty: CLEAN,
        interactive: false,
        conflict: 'ask',
      });

      assert.deepEqual(writes(calls), []);
      assert.match(
        fs.readFileSync(path.join(courseDir, '01-intro/01-welcome.md'), 'utf8'),
        /Edited here/,
      );
      assert.equal(
        process.exitCode,
        1,
        'a skipped conflict has to fail the run',
      );
    });

    it('refuses to overwrite a file git holds uncommitted work for', async () => {
      silence();
      const { courseDir, file, movedPage } = conflicted();
      const calls = mockCanvas(readRoutes({ page: movedPage }));

      await sync({
        courseDir,
        syncFile: file,
        interactive: false,
        conflict: 'canvas',
        gitDirty: {
          available: true,
          paths: new Set(['01-intro/01-welcome.md']),
          reason: null,
        },
      });

      assert.deepEqual(writes(calls), []);
      assert.match(
        fs.readFileSync(path.join(courseDir, '01-intro/01-welcome.md'), 'utf8'),
        /Edited here/,
        'git is the undo, so a dirty file is never overwritten',
      );
      assert.equal(process.exitCode, 1);
    });
  });

  it('--dry-run writes to neither side', async () => {
    silence();
    const { courseDir, file } = syncedFixture();
    fs.writeFileSync(
      path.join(courseDir, '01-intro/01-welcome.md'),
      '---\ntitle: Welcome\n---\n\nEdited here.\n',
      'utf8',
    );
    const calls = mockCanvas(readRoutes());

    await sync({
      courseDir,
      syncFile: file,
      gitDirty: CLEAN,
      interactive: false,
      dryRun: true,
    });

    assert.deepEqual(writes(calls), []);
    assert.equal(readState(file).last_sync, null, 'a dry run saves nothing');
  });

  describe('--prune-canvas', () => {
    /** A course whose second item was deleted locally but is still on Canvas. */
    function orphaned() {
      const fixture = syncedFixture();
      const state = readState(fixture.file);
      const module = state.modules['01-intro'];
      module.item_order.push('01-intro/02-gone.md');
      module.items['01-intro/02-gone.md'] = {
        canvas_type: 'page',
        canvas_id: 502,
        page_url: 'gone',
        module_item_id: 92,
        title: 'Gone',
        local_hash: 'whatever-it-was',
        canvas_hash: 'stored-gone-hash',
        canvas_updated_at: '2026-08-20T11:00:00.000Z',
        synced_at: '2026-08-20T09:00:00.000Z',
      };
      fs.writeFileSync(fixture.file, JSON.stringify(state, null, 2), 'utf8');

      const gone = {
        id: 92,
        type: 'Page',
        title: 'Gone',
        page_url: 'gone',
        content_id: 502,
        position: 2,
        indent: 0,
      };
      return { ...fixture, gone };
    }

    it('names the orphan and deletes nothing without the flag', async () => {
      silence();
      const { courseDir, file, gone } = orphaned();
      const calls = mockCanvas([
        { method: 'GET', path: '/modules/10/items', body: [ITEM, gone] },
        {
          method: 'GET',
          path: '/modules',
          body: [{ id: 10, name: 'Intro', position: 1 }],
        },
        {
          method: 'GET',
          path: '/pages',
          body: [
            {
              page_id: 501,
              url: 'welcome',
              title: 'Welcome',
              updated_at: PAGE.updated_at,
            },
            {
              page_id: 502,
              url: 'gone',
              title: 'Gone',
              updated_at: '2026-08-20T11:00:00.000Z',
            },
          ],
        },
      ]);

      await sync({
        courseDir,
        syncFile: file,
        gitDirty: CLEAN,
        interactive: false,
      });

      assert.deepEqual(writes(calls), []);
      // Orphans are informational: a course mid-edit is not a failure.
      assert.equal(process.exitCode, 0);
    });

    it('deletes only the orphan, under the flag', async () => {
      silence();
      const { courseDir, file, gone } = orphaned();
      const calls = mockCanvas([
        { method: 'GET', path: '/modules/10/items', body: [ITEM, gone] },
        {
          method: 'GET',
          path: '/modules',
          body: [{ id: 10, name: 'Intro', position: 1 }],
        },
        {
          method: 'GET',
          path: '/pages',
          body: [
            {
              page_id: 501,
              url: 'welcome',
              title: 'Welcome',
              updated_at: PAGE.updated_at,
            },
            {
              page_id: 502,
              url: 'gone',
              title: 'Gone',
              updated_at: '2026-08-20T11:00:00.000Z',
            },
          ],
        },
        { method: 'DELETE', path: '/pages/502', body: {} },
      ]);

      await sync({
        courseDir,
        syncFile: file,
        gitDirty: CLEAN,
        interactive: false,
        pruneCanvas: true,
        yes: true,
      });

      assert.deepEqual(
        writes(calls).map(
          (call) => `${call.method} ${call.url.split('/api/v1')[1]}`,
        ),
        [`DELETE /courses/${COURSE_ID}/pages/502`],
        'only the orphan may be deleted',
      );
      const state = readState(file);
      assert.equal(
        state.modules['01-intro'].items['01-intro/02-gone.md'],
        undefined,
      );
      assert.ok(state.modules['01-intro'].items['01-intro/01-welcome.md']);
    });

    it('cancels the prune when it cannot ask', async () => {
      silence();
      const { courseDir, file, gone } = orphaned();
      const calls = mockCanvas([
        { method: 'GET', path: '/modules/10/items', body: [ITEM, gone] },
        {
          method: 'GET',
          path: '/modules',
          body: [{ id: 10, name: 'Intro', position: 1 }],
        },
        {
          method: 'GET',
          path: '/pages',
          body: [
            {
              page_id: 501,
              url: 'welcome',
              title: 'Welcome',
              updated_at: PAGE.updated_at,
            },
            {
              page_id: 502,
              url: 'gone',
              title: 'Gone',
              updated_at: '2026-08-20T11:00:00.000Z',
            },
          ],
        },
      ]);

      await sync({
        courseDir,
        syncFile: file,
        gitDirty: CLEAN,
        interactive: false,
        pruneCanvas: true,
      });

      assert.deepEqual(writes(calls), [], 'nothing may be deleted unconfirmed');
      assert.ok(
        readState(file).modules['01-intro'].items['01-intro/02-gone.md'],
      );
    });
  });

  it('refuses a course whose state links nothing, and fails the run', async () => {
    silence();
    const courseDir = tempDir({
      '01-intro/_category_.json': '{ "label": "Intro", "position": 1 }\n',
      '01-intro/01-welcome.md': '---\ntitle: Welcome\n---\n\nLocal copy.\n',
    });
    const file = stateFile({});
    const calls = mockCanvas(readRoutes());

    await sync({
      courseDir,
      syncFile: file,
      gitDirty: CLEAN,
      interactive: false,
    });

    assert.deepEqual(writes(calls), [], 'a collision executes nothing at all');
    assert.equal(process.exitCode, 1);
  });

  it('refuses a policy it does not know rather than falling back', async () => {
    silence();
    await sync({ conflict: 'newst' });
    assert.equal(process.exitCode, 1);
  });
});

// ---------------------------------------------------------------------------
// The reporter
// ---------------------------------------------------------------------------

describe('the sync report', () => {
  /** A plan with every section populated, so the whole report can be read. */
  function fullPlan() {
    return {
      actions: [
        { type: 'create-canvas-item', itemPath: '01-intro/01-new.md' },
        { type: 'update-canvas-item', itemPath: '01-intro/02-edited.md' },
        { type: 'update-local-item', itemPath: '01-intro/03-remote.md' },
      ],
      withheld: [
        { type: 'update-local-item', itemPath: '01-intro/09-held.md' },
      ],
      conflicts: [
        {
          kind: 'item',
          moduleFolder: '01-intro',
          itemPath: '01-intro/04-both.md',
          winner: 'canvas',
          reason: 'newest: Canvas',
          localMtimeMs: Date.parse('2026-08-19T08:00:00.000Z'),
          canvasUpdatedAt: '2026-08-19T09:00:00.000Z',
          applied: true,
        },
      ],
      skipped: [
        {
          kind: 'item',
          reason: 'git-dirty',
          moduleFolder: '01-intro',
          itemPath: '01-intro/05-dirty.md',
          remedy: 'Commit or stash the file, then run sync again.',
        },
      ],
      orphans: {
        canvas: [
          {
            kind: 'item',
            moduleFolder: '01-intro',
            itemPath: '01-intro/06-orphan.md',
            title: 'Orphan',
            canvasType: 'page',
            moduleItemId: 96,
            pruned: false,
          },
        ],
        local: [
          {
            kind: 'item',
            moduleFolder: '01-intro',
            itemPath: '01-intro/07-local.md',
            title: 'Local orphan',
            canvasType: 'page',
            pruned: false,
          },
        ],
      },
      decisions: [
        {
          kind: 'local-deleted-canvas-changed',
          moduleFolder: '01-intro',
          itemPath: '01-intro/08-gone.md',
          summary: 'It was deleted here and changed on Canvas.',
        },
      ],
      unrecognised: [
        {
          moduleFolder: '01-intro',
          rawType: 'Sasquatch',
          title: 'Something new',
        },
      ],
      ordering: [
        {
          folder: '01-intro',
          winner: 'canvas',
          skipped: false,
          reason: 'only this side reordered',
        },
        {
          folder: '02-next',
          winner: null,
          skipped: true,
          reason: 'both sides reordered and neither was chosen',
          local: ['02-next/01-a.md', '02-next/02-b.md'],
          canvas: ['02-next/02-b.md', '02-next/01-a.md'],
        },
      ],
      pending: {
        conflicts: [],
        order: [],
        renames: [
          {
            from: '01-intro/10-was.md',
            to: '01-intro/10-now.md',
            confidence: 'probable',
          },
        ],
      },
      collision: { modules: [], message: 'Both sides hold items in 03-third.' },
    };
  }

  it('renders every section, in the order the plan document lists them', () => {
    const lines = buildReport(fullPlan(), {
      baseUrl: 'https://canvas.example.com',
      courseId: COURSE_ID,
    });
    const text = lines.join('\n');

    const headings = lines.filter((line) => line && !line.startsWith(' '));
    assert.deepEqual(headings, [
      'Applied',
      'Left alone (this command does not write to that side)',
      'Orphaned on Canvas (gone locally, still there)',
      'Orphaned locally (gone from Canvas, still here)',
      'Conflicts resolved',
      'Skipped',
      'Ordering',
      'Unrecognised Canvas items',
      'Needs a decision',
      'Possible renames awaiting an answer',
      'Refused',
    ]);

    assert.match(text, /Canvas: 1 item created, 1 item updated/);
    assert.match(text, /Locally: 1 item updated/);
    // The orphan sections name the flag that deletes them, and the backups doc.
    assert.match(text, /`--prune-canvas` is what deletes these/);
    assert.match(text, /`--prune-local` is what deletes these/);
    assert.match(text, /docs\/backups\.md/);
    // A conflict names the winner, both timestamps, and where the loser went.
    assert.match(text, /04-both\.md: Canvas won — newest: Canvas/);
    assert.match(text, /2026-08-19T08:00:00\.000Z.*2026-08-19T09:00:00\.000Z/);
    assert.match(text, /The version that was here is in git\./);
    // A skip carries its remedy.
    assert.match(text, /05-dirty\.md \(git-dirty\): Commit or stash/);
    // Ordering names the side per module, and prints both orders on a skip.
    assert.match(text, /01-intro: took the Canvas order/);
    assert.match(text, /02-next\/02-b\.md → 02-next\/01-a\.md/);
    // The Canvas link is there to click.
    assert.match(text, /modules\/items\/96/);
    assert.match(text, /Sasquatch/);
    assert.match(text, /Both sides hold items in 03-third\./);
  });

  it('renders nothing for a plan with nothing in it', () => {
    assert.deepEqual(
      buildReport({
        actions: [],
        withheld: [],
        conflicts: [],
        skipped: [],
        orphans: { canvas: [], local: [] },
        decisions: [],
        unrecognised: [],
        ordering: [],
        pending: { conflicts: [], order: [], renames: [] },
        collision: null,
      }),
      [],
    );
  });

  it('heads the applied section differently on a dry run', () => {
    const lines = buildReport(
      {
        actions: [{ type: 'create-canvas-item', itemPath: 'a/b.md' }],
        withheld: [],
        conflicts: [],
        skipped: [],
        orphans: { canvas: [], local: [] },
        decisions: [],
        unrecognised: [],
        ordering: [],
        pending: { conflicts: [], order: [], renames: [] },
        collision: null,
      },
      { dryRun: true },
    );
    assert.equal(lines[1], 'Would apply');
  });
});
