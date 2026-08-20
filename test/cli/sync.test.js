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
        // Already uploaded, which is what a course looks like after its first
        // sync. `test/sync/apply-plan.test.js` is where the upload itself is
        // tested; here they only have to be out of the way.
        icons: recordedIcons(),
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

/** Alert icons recorded under the theme this repo is configured with. */
function recordedIcons() {
  const { ICON_FILES } = require('../../lib/convert/alert-icons');
  const { loadTheme, themeFingerprint } = require('../../lib/config/theme');
  const fingerprint = themeFingerprint(loadTheme());
  const icons = {};
  for (const type of Object.keys(ICON_FILES)) {
    icons[type] = {
      canvas_file_id: 900,
      preview_url: `https://canvas.example.com/recorded/${type}`,
      theme: fingerprint,
    };
  }
  return icons;
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

    it('still lists the orphan when its delete failed', async () => {
      // No DELETE route, so the delete 400s. The planner marked the orphan
      // pruned when it emitted that delete, and reading the flag as truth is
      // what used to drop the item out of the report — while it sat in the
      // Canvas course, unmentioned by the run that failed to remove it.
      const out = silence();
      const { courseDir, file, gone } = orphaned();
      mockCanvas([
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
        yes: true,
      });

      const printed = out.log.mock.calls
        .map((call) => call.arguments.join(' '))
        .join('\n');
      assert.match(printed, /Orphaned on Canvas/);
      assert.match(printed, /02-gone\.md/);
      assert.doesNotMatch(
        printed,
        /^Applied$/m,
        'nothing ran, so nothing applied',
      );
      assert.equal(process.exitCode, 1);
    });

    it('cancels the prune when it cannot ask', async () => {
      const out = silence();
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
      // The report follows the answer, not the flag. "Nothing above was
      // deleted; each line says why" is a claim about the plan, and a declined
      // prune leaves a plan with no deletes in it — so no orphan carries a
      // reason and every line would be silent.
      const printed = out.log.mock.calls
        .map((call) => call.arguments.join(' '))
        .join('\n');
      assert.match(printed, /`--prune-canvas` is what deletes these/);
      assert.doesNotMatch(printed, /each line says why/);
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
      adopted: [
        {
          moduleFolder: '01-intro',
          itemPath: '01-intro/11-claimed.md',
          title: 'Claimed',
          canvasType: 'page',
          canvasId: 4242,
          moduleItemId: 97,
          direction: 'local',
          applied: true,
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
          applied: true,
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
    // No `applied`, so this is the preview shape — what `--dry-run` and, at
    // commit 9, `status` both render.
    const lines = buildReport(fullPlan(), {
      baseUrl: 'https://canvas.example.com',
      courseId: COURSE_ID,
    });
    const text = lines.join('\n');

    const headings = lines.filter((line) => line && !line.startsWith(' '));
    assert.deepEqual(headings, [
      'Would apply',
      'Left alone (this command does not write to that side)',
      'Adopted (matched to something already in Canvas)',
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
    // An adoption names the object it claimed, and links to it.
    assert.match(text, /11-claimed\.md: page "Claimed"/);
    assert.match(text, /modules\/items\/97/);
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

  /** An otherwise empty plan carrying just these actions. */
  function planOf(actions, extra = {}) {
    return {
      actions,
      withheld: [],
      conflicts: [],
      skipped: [],
      orphans: { canvas: [], local: [] },
      decisions: [],
      unrecognised: [],
      ordering: [],
      pending: { conflicts: [], order: [], renames: [] },
      collision: null,
      ...extra,
    };
  }

  it('reads "Would apply" over the whole plan when nothing was executed', () => {
    const plan = planOf([
      { type: 'create-canvas-item', itemPath: 'a/b.md' },
      { type: 'create-canvas-item', itemPath: 'a/c.md' },
    ]);
    const lines = buildReport(plan);
    assert.equal(lines[1], 'Would apply');
    assert.match(lines[2], /2 items created/);
  });

  it('counts what ran, not what was planned', () => {
    // The plan is what was decided; only the executor knows what happened. A
    // run where one of two creates failed has to say one.
    const plan = planOf([
      { type: 'create-canvas-item', itemPath: 'a/b.md' },
      { type: 'create-canvas-item', itemPath: 'a/c.md' },
    ]);
    const lines = buildReport(plan, {
      applied: [{ type: 'create-canvas-item', itemPath: 'a/b.md' }],
    });
    assert.equal(lines[1], 'Applied');
    assert.match(lines[2], /Canvas: 1 item created/);
  });

  it('renders no Applied section when every action failed', () => {
    const plan = planOf([{ type: 'create-canvas-item', itemPath: 'a/b.md' }]);
    assert.deepEqual(buildReport(plan, { applied: [] }), []);
  });

  it('keeps an orphan listed when its delete failed', () => {
    // `pruned` is the planner saying it emitted the delete. A delete that then
    // failed leaves the item in the course, and dropping it from the report
    // would make the summary the thing that stops mentioning it.
    const plan = planOf(
      [
        {
          type: 'delete-canvas-item',
          itemPath: '01-intro/06-orphan.md',
          folder: '01-intro',
        },
      ],
      {
        orphans: {
          canvas: [
            {
              kind: 'item',
              moduleFolder: '01-intro',
              itemPath: '01-intro/06-orphan.md',
              title: 'Orphan',
              canvasType: 'page',
              pruned: true,
            },
          ],
          local: [],
        },
      },
    );

    const failed = buildReport(plan, { applied: [], pruneCanvas: true }).join(
      '\n',
    );
    assert.match(failed, /Orphaned on Canvas/);
    assert.match(failed, /06-orphan\.md/);

    const landed = buildReport(plan, {
      applied: [
        {
          type: 'delete-canvas-item',
          itemPath: '01-intro/06-orphan.md',
          folder: '01-intro',
        },
      ],
      pruneCanvas: true,
    }).join('\n');
    assert.doesNotMatch(landed, /Orphaned on Canvas/);
  });

  it('says so on the line when the delete was attempted and failed', () => {
    // The section closes with "each line says why", and a delete the planner
    // emitted carries no `reason` — the failure happened after planning. This
    // is the one case that would otherwise leave the footer promising a why no
    // line carries.
    const plan = planOf([{ type: 'delete-canvas-module', folder: '02-gone' }], {
      orphans: {
        canvas: [
          {
            kind: 'module',
            moduleFolder: '02-gone',
            title: 'Gone',
            canvasModuleId: 20,
            itemCount: 3,
            pruned: true,
          },
        ],
        local: [],
      },
    });

    const text = buildReport(plan, { applied: [], pruneCanvas: true }).join(
      '\n',
    );
    assert.match(text, /02-gone: module "Gone" \(3 items\)/);
    assert.match(
      text,
      /the delete was attempted and it failed; see the errors below/,
    );
  });

  it('leaves the planner\u2019s own reason for an orphan it declined to delete', () => {
    // A different fact, and the planner is the only one who knows it. It has to
    // survive untouched, and must not be joined by a failure that never
    // happened — nothing was attempted here.
    const plan = planOf([], {
      orphans: {
        canvas: [],
        local: [
          {
            kind: 'module',
            moduleFolder: '03-holding',
            title: 'Holding',
            itemCount: 2,
            pruned: false,
            reason:
              'left alone: this folder still holds local changes that need a decision first',
          },
        ],
      },
    });

    const text = buildReport(plan, { applied: [], pruneLocal: true }).join(
      '\n',
    );
    assert.match(text, /left alone: this folder still holds local changes/);
    assert.doesNotMatch(text, /attempted and it failed/);
  });

  it('counts an item as deleted when the module delete took it along', () => {
    const plan = planOf(
      [{ type: 'delete-canvas-module', folder: '01-intro' }],
      {
        orphans: {
          canvas: [
            {
              kind: 'item',
              moduleFolder: '01-intro',
              itemPath: '01-intro/06-orphan.md',
              title: 'Orphan',
              canvasType: 'page',
              pruned: true,
              coveredByModule: true,
            },
          ],
          local: [],
        },
      },
    );

    const lines = buildReport(plan, {
      applied: [{ type: 'delete-canvas-module', folder: '01-intro' }],
      pruneCanvas: true,
    });
    assert.doesNotMatch(lines.join('\n'), /Orphaned on Canvas/);
  });

  it('does not call a conflict resolved when its write failed', () => {
    const conflict = {
      kind: 'item',
      moduleFolder: '01-intro',
      itemPath: '01-intro/04-both.md',
      winner: 'canvas',
      reason: 'newest: Canvas',
      localMtimeMs: Date.parse('2026-08-19T08:00:00.000Z'),
      canvasUpdatedAt: '2026-08-19T09:00:00.000Z',
      applied: true,
    };
    const plan = planOf(
      [{ type: 'update-local-item', itemPath: '01-intro/04-both.md' }],
      { conflicts: [conflict] },
    );

    const failed = buildReport(plan, { applied: [] }).join('\n');
    assert.doesNotMatch(failed, /Conflicts resolved/);
    assert.match(failed, /04-both\.md \(conflict-unwritten\)/);
    assert.match(failed, /the write failed/);

    const landed = buildReport(plan, {
      applied: [{ type: 'update-local-item', itemPath: '01-intro/04-both.md' }],
    }).join('\n');
    assert.match(landed, /Conflicts resolved/);
    assert.doesNotMatch(landed, /conflict-unwritten/);
  });

  it('does not call a pair adopted when the write failed', () => {
    // An adoption is an ordinary update in the summary, so the only place the
    // author could learn the claim did not land is this section.
    const adopted = {
      moduleFolder: '01-intro',
      itemPath: '01-intro/11-claimed.md',
      title: 'Claimed',
      canvasType: 'page',
      canvasId: 4242,
      moduleItemId: 97,
      direction: 'local',
      applied: true,
    };
    const plan = planOf(
      [{ type: 'update-canvas-item', itemPath: '01-intro/11-claimed.md' }],
      { adopted: [adopted] },
    );

    const failed = buildReport(plan, { applied: [] }).join('\n');
    assert.match(failed, /Adopted \(matched to something already in Canvas\)/);
    assert.match(failed, /the write failed, so nothing was claimed/);

    const landed = buildReport(plan, {
      applied: [
        { type: 'update-canvas-item', itemPath: '01-intro/11-claimed.md' },
      ],
    }).join('\n');
    assert.match(landed, /11-claimed\.md: page "Claimed"/);
    assert.doesNotMatch(landed, /the write failed/);
  });

  it('names a pair whose write never happened at all', () => {
    // The git guard, and a write the policy forbade: the pair is matched and
    // both sides are still where they were, which is not an adoption.
    const plan = planOf([], {
      adopted: [
        {
          moduleFolder: '01-intro',
          itemPath: '01-intro/11-claimed.md',
          title: 'Claimed',
          canvasType: 'page',
          canvasId: 4242,
          moduleItemId: 97,
          direction: 'canvas',
          applied: false,
        },
      ],
    });

    const text = buildReport(plan, { applied: [] }).join('\n');
    assert.match(text, /11-claimed\.md: page "Claimed"/);
    assert.match(text, /nothing was written, so the two are still unlinked/);
  });

  it('does not call a module reordered when the reorder was withheld', () => {
    // A pinned run writes to one side only, so the reorder the losing side
    // needed is recorded in `withheld` and never runs. Printing "took the
    // Canvas order" over files that are exactly as they were describes a course
    // that does not exist.
    const plan = planOf([], {
      withheld: [{ type: 'reorder-local-module', folder: '01-intro' }],
      ordering: [
        {
          folder: '01-intro',
          winner: 'canvas',
          skipped: false,
          reason: 'only this side reordered',
          applied: false,
        },
      ],
    });

    const text = buildReport(plan, { applied: [] }).join('\n');
    assert.doesNotMatch(text, /took the Canvas order/);
    assert.match(text, /would have taken the Canvas order/);
    assert.match(text, /this command does not write to the local files/);
  });

  it('says the reorder failed when it was attempted and did not land', () => {
    // The planner sets `applied` when it *emits* the reorder, so a failed one
    // is indistinguishable from a withheld one without the applied list — and
    // the two want opposite things from the author.
    const plan = planOf(
      [{ type: 'reorder-canvas-module', folder: '01-intro' }],
      {
        ordering: [
          {
            folder: '01-intro',
            winner: 'local',
            skipped: false,
            reason: 'policy local',
            applied: true,
          },
        ],
      },
    );

    const failed = buildReport(plan, { applied: [] }).join('\n');
    assert.match(failed, /would have taken the local order \(policy local\)/);
    assert.match(failed, /the write failed, so both sides are as they were/);
    assert.doesNotMatch(failed, /does not write to/);

    const landed = buildReport(plan, {
      applied: [{ type: 'reorder-canvas-module', folder: '01-intro' }],
    });
    assert.deepEqual(landed.slice(-2), [
      'Ordering',
      '  - 01-intro: took the local order \u2014 policy local.',
    ]);
  });

  it('reads a reorder as taken in a preview, where nothing has run', () => {
    // No applied list means nothing was executed, so the planner's flag is all
    // there is to go on — which is what `--dry-run` and `status` both want.
    const plan = planOf(
      [{ type: 'reorder-canvas-module', folder: '01-intro' }],
      {
        ordering: [
          {
            folder: '01-intro',
            winner: 'local',
            skipped: false,
            reason: 'policy local',
            applied: true,
          },
        ],
      },
    );

    assert.deepEqual(buildReport(plan).slice(-2), [
      'Ordering',
      '  - 01-intro: took the local order \u2014 policy local.',
    ]);
  });

  it('leaves an ordering entry the planner skipped exactly as it was', () => {
    // A third thing again: nothing was decided, so there is no write that could
    // have landed, and the entry carries no `applied` for one.
    const plan = planOf([], {
      ordering: [
        {
          folder: '02-next',
          winner: null,
          skipped: true,
          reason: 'both sides reordered and neither was chosen',
          local: ['02-next/01-a.md', '02-next/02-b.md'],
          canvas: ['02-next/02-b.md', '02-next/01-a.md'],
        },
      ],
    });

    const text = buildReport(plan, { applied: [] }).join('\n');
    assert.match(text, /02-next: left as it is \u2014 both sides reordered/);
    assert.match(text, /here: {3}02-next\/01-a\.md \u2192 02-next\/02-b\.md/);
    assert.doesNotMatch(text, /would have taken/);
  });

  it('names a conflict the command was never allowed to write', () => {
    // `push` and `pull` pin a direction, so the losing side's write is withheld
    // rather than failed. Different cause, same duty not to call it resolved.
    const plan = planOf([], {
      conflicts: [
        {
          kind: 'item',
          moduleFolder: '01-intro',
          itemPath: '01-intro/04-both.md',
          winner: 'canvas',
          reason: 'policy canvas',
          applied: false,
        },
      ],
    });
    const text = buildReport(plan, { applied: [] }).join('\n');
    assert.match(text, /does not write to the side that lost/);
  });
});
