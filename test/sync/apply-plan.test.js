const { describe, it, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { mockCanvas, silence } = require('../helpers/canvas-mock');

process.env.CANVAS_API_URL = 'https://canvas.example.com';
process.env.CANVAS_API_TOKEN = 'test-token-123';

const { applyPlan } = require('../../lib/sync/apply');
const { plan } = require('../../lib/sync/plan');
const { gatherCanvas, gatherLocal } = require('../../lib/sync/gather');
const { hashLocalFile } = require('../../lib/sync/fingerprint');

const COURSE_ID = 4242;
const CLEAN = { available: true, paths: new Set(), reason: null };

afterEach(() => mock.restoreAll());

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function tempCourse(tree = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apply-plan-test-'));
  for (const [relative, contents] of Object.entries(tree)) {
    const full = path.join(dir, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents, 'utf8');
  }
  return dir;
}

function emptyState() {
  return {
    schema_version: 4,
    canvas_base_url: 'https://canvas.example.com',
    course_id: COURSE_ID,
    last_sync: null,
    modules: {},
    icons: {},
    files: {},
  };
}

/** Run a plan against the mock, never touching the real sync file. */
function run(planned, options) {
  return applyPlan(planned, {
    courseId: COURSE_ID,
    save: () => {},
    now: () => '2026-08-20T12:00:00.000Z',
    ...options,
  });
}

function calledWith(calls, method, fragment) {
  return calls.filter(
    (call) => call.method === method && call.url.includes(fragment),
  );
}

// ---------------------------------------------------------------------------
// The fingerprint invariant — the reason this file exists
// ---------------------------------------------------------------------------

describe('the fingerprint invariant, Canvas direction', () => {
  it('records both hashes after a Canvas write, so the next plan is empty', async () => {
    silence();
    const courseDir = tempCourse({
      '01-intro/_category_.json': '{ "label": "Intro", "position": 1 }\n',
      '01-intro/01-welcome.md': '---\ntitle: Welcome\n---\n\nHello there.\n',
    });
    const state = emptyState();

    // --- The course is on Canvas but nothing of it is ------------------------
    mockCanvas([{ method: 'GET', path: '/modules', body: [] }]);
    const local = gatherLocal({ courseDir, gitDirty: CLEAN });
    let canvas = await gatherCanvas({ courseId: COURSE_ID, base: state });
    const first = plan({ base: state, local, canvas });
    assert.deepEqual(
      first.actions.map((action) => action.type),
      ['create-canvas-module', 'create-canvas-item'],
    );

    // --- Execute -------------------------------------------------------------
    mock.restoreAll();
    const createdPage = {
      page_id: 501,
      url: 'welcome',
      title: 'Welcome',
      body: '<p>Hello there.</p>',
      updated_at: '2026-08-20T11:00:00.000Z',
    };
    const createdItem = {
      id: 91,
      type: 'Page',
      title: 'Welcome',
      page_url: 'welcome',
      content_id: 501,
      position: 1,
      indent: 0,
    };
    mockCanvas([
      { method: 'POST', path: '/modules/10/items', body: createdItem },
      {
        method: 'POST',
        path: '/modules',
        body: { id: 10, name: 'Intro', position: 1 },
      },
      { method: 'POST', path: '/pages', body: createdPage },
    ]);
    const outcome = await run(first, {
      courseDir,
      state,
      canvasContent: canvas.content,
    });
    assert.deepEqual(outcome.errors, []);

    const row = state.modules['01-intro'].items['01-intro/01-welcome.md'];
    assert.ok(row.local_hash, 'no local_hash was recorded');
    assert.ok(row.canvas_hash, 'no canvas_hash was recorded');
    assert.equal(row.canvas_updated_at, '2026-08-20T11:00:00.000Z');
    assert.equal(row.synced_at, '2026-08-20T12:00:00.000Z');
    assert.equal(row.module_item_id, 91);
    assert.equal(row.canvas_id, 501);
    assert.equal(row.page_url, 'welcome');

    // --- A sync straight after a sync ---------------------------------------
    // `base: null` deliberately defeats the page pre-filter, so the Canvas hash
    // is recomputed from a real fetch rather than read back out of the row this
    // run just wrote. That is what proves the two agree.
    mock.restoreAll();
    mockCanvas([
      { method: 'GET', path: '/modules/10/items', body: [createdItem] },
      {
        method: 'GET',
        path: '/modules',
        body: [{ id: 10, name: 'Intro', position: 1 }],
      },
      { method: 'GET', path: '/pages/welcome', body: createdPage },
      {
        method: 'GET',
        path: '/pages',
        body: [
          {
            page_id: 501,
            url: 'welcome',
            title: 'Welcome',
            updated_at: createdPage.updated_at,
          },
        ],
      },
    ]);
    canvas = await gatherCanvas({ courseId: COURSE_ID, base: null });
    const again = plan({
      base: state,
      local: gatherLocal({ courseDir, gitDirty: CLEAN }),
      canvas,
    });

    assert.deepEqual(again.actions, [], 'a sync after a sync must do nothing');
    assert.deepEqual(again.conflicts, []);
    assert.deepEqual(again.skipped, []);
  });
});

describe('the fingerprint invariant, local direction', () => {
  it('records both hashes after a local write, so the next plan is empty', async () => {
    silence();
    const courseDir = tempCourse();
    const state = emptyState();

    const page = {
      page_id: 501,
      url: 'welcome',
      title: 'Welcome',
      body: '<p>Hello there.</p>',
      updated_at: '2026-08-20T11:00:00.000Z',
    };
    const item = {
      id: 91,
      type: 'Page',
      title: 'Welcome',
      page_url: 'welcome',
      content_id: 501,
      position: 1,
      indent: 0,
    };
    const canvasRoutes = () => [
      { method: 'GET', path: '/modules/10/items', body: [item] },
      {
        method: 'GET',
        path: '/modules',
        body: [{ id: 10, name: 'Intro', position: 1 }],
      },
      { method: 'GET', path: '/pages/welcome', body: page },
      {
        method: 'GET',
        path: '/pages',
        body: [
          {
            page_id: 501,
            url: 'welcome',
            title: 'Welcome',
            updated_at: page.updated_at,
          },
        ],
      },
    ];

    mockCanvas(canvasRoutes());
    let canvas = await gatherCanvas({ courseId: COURSE_ID, base: state });
    const first = plan({
      base: state,
      local: gatherLocal({ courseDir, gitDirty: CLEAN }),
      canvas,
    });
    assert.deepEqual(
      first.actions.map((action) => action.type),
      ['create-local-module', 'create-local-item'],
    );

    // Nothing more is fetched: the content the gather already read is handed
    // to the executor rather than asked for a second time.
    const outcome = await run(first, {
      courseDir,
      state,
      canvasContent: canvas.content,
    });
    assert.deepEqual(outcome.errors, []);

    const written = path.join(courseDir, '01-intro/01-welcome.md');
    assert.ok(fs.existsSync(written), 'the item was not written');
    // A file sync created carries its title explicitly, so that renaming it
    // later cannot rename the Canvas item behind it.
    assert.match(fs.readFileSync(written, 'utf8'), /^---\ntitle: Welcome\n/);
    const row = state.modules['01-intro'].items['01-intro/01-welcome.md'];
    assert.ok(row.local_hash);
    assert.equal(row.canvas_hash, canvas.modules[0].items[0].canvasHash);
    assert.equal(row.canvas_updated_at, page.updated_at);
    assert.equal(row.synced_at, '2026-08-20T12:00:00.000Z');

    mock.restoreAll();
    mockCanvas(canvasRoutes());
    canvas = await gatherCanvas({ courseId: COURSE_ID, base: null });
    const again = plan({
      base: state,
      local: gatherLocal({ courseDir, gitDirty: CLEAN }),
      canvas,
    });

    assert.deepEqual(again.actions, [], 'a sync after a sync must do nothing');
    assert.deepEqual(again.skipped, []);
  });
});

// ---------------------------------------------------------------------------
// One test per action type
// ---------------------------------------------------------------------------

describe('applyPlan, per action type', () => {
  it('creates a module and records the id every later action needs', async () => {
    silence();
    const state = emptyState();
    const calls = mockCanvas([
      { method: 'POST', path: '/modules', body: { id: 77, name: 'Intro' } },
    ]);

    await run(
      {
        actions: [
          {
            type: 'create-canvas-module',
            folder: '01-intro',
            name: 'Intro',
            position: 1,
          },
        ],
      },
      { state, courseDir: tempCourse() },
    );

    assert.equal(calledWith(calls, 'POST', '/modules').length, 1);
    assert.equal(state.modules['01-intro'].canvas_module_id, 77);
  });

  it('updates a page and leaves the module item alone when it already agrees', async () => {
    silence();
    const courseDir = tempCourse({
      '01-intro/01-welcome.md': '---\ntitle: Welcome\n---\n\nEdited.\n',
    });
    const state = emptyState();
    state.modules['01-intro'] = {
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
        },
      },
    };
    const calls = mockCanvas([
      {
        // A page is addressed by its numeric id, which a rename does not move.
        method: 'PUT',
        path: '/pages/501',
        body: {
          page_id: 501,
          url: 'welcome',
          title: 'Welcome',
          body: '<p>Edited.</p>',
          updated_at: '2026-08-20T11:00:00.000Z',
        },
      },
    ]);

    const outcome = await run(
      {
        actions: [
          {
            type: 'update-canvas-item',
            folder: '01-intro',
            canvasModuleId: 10,
            itemPath: '01-intro/01-welcome.md',
            title: 'Welcome',
            canvasType: 'page',
            canvasId: 501,
            pageUrl: 'welcome',
            moduleItemId: 91,
            indent: 0,
          },
        ],
      },
      {
        courseDir,
        state,
        // The live module item already carries the same title and indent, so
        // there is nothing for a module-item PUT to change.
        canvasContent: new Map([
          [
            '91',
            { item: { id: 91, title: 'Welcome', indent: 0 }, content: null },
          ],
        ]),
      },
    );

    assert.deepEqual(outcome.errors, []);
    assert.equal(calledWith(calls, 'PUT', '/pages/501').length, 1);
    assert.equal(calledWith(calls, 'PUT', '/modules/10/items').length, 0);
  });

  it('creates an external URL as a module item and takes its id as the content id', async () => {
    silence();
    const courseDir = tempCourse({
      '01-intro/01-docs.md':
        '---\ntitle: Docs\ncanvas_type: external_url\nexternal_url: https://example.com\n---\n',
    });
    const state = emptyState();
    state.modules['01-intro'] = {
      canvas_module_id: 10,
      item_order: [],
      items: {},
    };
    const calls = mockCanvas([
      {
        method: 'POST',
        path: '/modules/10/items',
        body: {
          id: 95,
          type: 'ExternalUrl',
          title: 'Docs',
          external_url: 'https://example.com',
          new_tab: true,
          indent: 0,
        },
      },
    ]);

    await run(
      {
        actions: [
          {
            type: 'create-canvas-item',
            folder: '01-intro',
            canvasModuleId: 10,
            itemPath: '01-intro/01-docs.md',
            title: 'Docs',
            canvasType: 'external_url',
            indent: 0,
            position: 1,
          },
        ],
      },
      { courseDir, state },
    );

    const [post] = calledWith(calls, 'POST', '/modules/10/items');
    assert.equal(post.body.module_item.external_url, 'https://example.com');
    assert.equal(post.body.module_item.type, 'ExternalUrl');
    const row = state.modules['01-intro'].items['01-intro/01-docs.md'];
    assert.equal(row.canvas_id, 95);
    assert.equal(row.module_item_id, 95);
    assert.ok(row.canvas_hash);
  });

  it('writes title: into a file it creates the Canvas object from', async () => {
    silence();
    // The filename is the address and `title:` is the display name. Without
    // the title in the file, the scanner derives one from the filename, so
    // renaming the file would rename the Canvas item.
    const courseDir = tempCourse({
      '01-intro/01-welcome.md': 'Just a body, no frontmatter at all.\n',
    });
    const state = emptyState();
    state.modules['01-intro'] = {
      canvas_module_id: 10,
      item_order: [],
      items: {},
    };
    mockCanvas([
      {
        method: 'POST',
        path: '/modules/10/items',
        body: {
          id: 91,
          type: 'Page',
          title: 'Welcome',
          page_url: 'welcome',
          indent: 0,
        },
      },
      {
        method: 'POST',
        path: '/pages',
        body: {
          page_id: 501,
          url: 'welcome',
          title: 'Welcome',
          body: '<p>Just a body, no frontmatter at all.</p>',
          updated_at: '2026-08-20T11:00:00.000Z',
        },
      },
    ]);

    const outcome = await run(
      {
        actions: [
          {
            type: 'create-canvas-item',
            folder: '01-intro',
            canvasModuleId: 10,
            itemPath: '01-intro/01-welcome.md',
            title: 'Welcome',
            canvasType: 'page',
            indent: 0,
            position: 1,
          },
        ],
      },
      { courseDir, state },
    );

    assert.deepEqual(outcome.errors, []);
    const written = fs.readFileSync(
      path.join(courseDir, '01-intro/01-welcome.md'),
      'utf8',
    );
    assert.match(written, /^---\ntitle: Welcome\n/, 'no title: was written');

    // The row has to describe the file including that line, or the very next
    // run reads the item as changed locally and pushes it again.
    const row = state.modules['01-intro'].items['01-intro/01-welcome.md'];
    assert.equal(
      row.local_hash,
      hashLocalFile(path.join(courseDir, '01-intro/01-welcome.md')),
    );
  });

  it('leaves a title the author already wrote exactly as it is', async () => {
    silence();
    const original =
      '---\ntitle: The author\u2019s own title\ncanvas_type: page\n---\n\nBody.\n';
    const courseDir = tempCourse({ '01-intro/01-welcome.md': original });
    const state = emptyState();
    state.modules['01-intro'] = {
      canvas_module_id: 10,
      item_order: [],
      items: {},
    };
    mockCanvas([
      {
        method: 'POST',
        path: '/modules/10/items',
        body: {
          id: 91,
          type: 'Page',
          title: 'The author\u2019s own title',
          page_url: 'welcome',
          indent: 0,
        },
      },
      {
        method: 'POST',
        path: '/pages',
        body: {
          page_id: 501,
          url: 'welcome',
          title: 'The author\u2019s own title',
          body: '<p>Body.</p>',
          updated_at: '2026-08-20T11:00:00.000Z',
        },
      },
    ]);

    await run(
      {
        actions: [
          {
            type: 'create-canvas-item',
            folder: '01-intro',
            canvasModuleId: 10,
            itemPath: '01-intro/01-welcome.md',
            title: 'The author\u2019s own title',
            canvasType: 'page',
            indent: 0,
            position: 1,
          },
        ],
      },
      { courseDir, state },
    );

    assert.equal(
      fs.readFileSync(path.join(courseDir, '01-intro/01-welcome.md'), 'utf8'),
      original,
      'the file must not have been rewritten',
    );
  });

  it('refuses to write a link stub with no launch URL, and carries on', async () => {
    silence();
    // The action cannot describe a link, so the content cache is the supported
    // path. A caller that does not pass it gets an error for that one action —
    // never a file that looks like a link and points nowhere, which the next
    // run would read as done and never retry.
    const courseDir = tempCourse();
    const state = emptyState();
    state.modules['01-intro'] = {
      canvas_module_id: 10,
      item_order: [],
      items: {},
    };
    mockCanvas([]);

    const outcome = await run(
      {
        actions: [
          {
            type: 'create-local-item',
            folder: '01-intro',
            itemPath: '01-intro/01-docs.md',
            canvasModuleId: 10,
            moduleItemId: 95,
            canvasType: 'external_url',
            canvasId: 95,
            title: 'Docs',
            indent: 0,
            position: 1,
            canvasHash: 'whatever',
          },
        ],
      },
      { courseDir, state, canvasContent: new Map() },
    );

    assert.equal(outcome.errors.length, 1);
    assert.match(outcome.errors[0].error, /launch URL/);
    assert.equal(
      fs.existsSync(path.join(courseDir, '01-intro/01-docs.md')),
      false,
      'no stub may be left behind',
    );
    assert.equal(
      state.modules['01-intro'].items['01-intro/01-docs.md'],
      undefined,
    );
  });

  it('writes the link stub when the content cache supplies the URL', async () => {
    silence();
    const courseDir = tempCourse();
    const state = emptyState();
    state.modules['01-intro'] = {
      canvas_module_id: 10,
      item_order: [],
      items: {},
    };
    mockCanvas([]);

    const outcome = await run(
      {
        actions: [
          {
            type: 'create-local-item',
            folder: '01-intro',
            itemPath: '01-intro/01-docs.md',
            canvasModuleId: 10,
            moduleItemId: 95,
            canvasType: 'external_url',
            canvasId: 95,
            title: 'Docs',
            indent: 0,
            position: 1,
            canvasHash: 'whatever',
          },
        ],
      },
      {
        courseDir,
        state,
        canvasContent: new Map([
          [
            '95',
            {
              item: {
                id: 95,
                type: 'ExternalUrl',
                title: 'Docs',
                external_url: 'https://example.com',
                new_tab: true,
                indent: 0,
              },
              content: null,
            },
          ],
        ]),
      },
    );

    assert.deepEqual(outcome.errors, []);
    const written = fs.readFileSync(
      path.join(courseDir, '01-intro/01-docs.md'),
      'utf8',
    );
    // The YAML serializer quotes a URL; the assertion should not care.
    assert.match(written, /external_url: '?https:\/\/example\.com'?/);
    assert.match(written, /title: Docs/);
  });

  it('deletes a quiz item without touching the quiz behind it', async () => {
    silence();
    const state = emptyState();
    state.modules['01-intro'] = {
      canvas_module_id: 10,
      item_order: ['01-intro/01-test.md'],
      items: {
        '01-intro/01-test.md': {
          canvas_type: 'quiz',
          canvas_id: 700,
          module_item_id: 93,
        },
      },
    };
    const calls = mockCanvas([
      { method: 'DELETE', path: '/modules/10/items/93', body: {} },
    ]);

    await run(
      {
        actions: [
          {
            type: 'delete-canvas-item',
            folder: '01-intro',
            canvasModuleId: 10,
            itemPath: '01-intro/01-test.md',
            moduleItemId: 93,
            canvasType: 'quiz',
            canvasId: 700,
          },
        ],
      },
      { state, courseDir: tempCourse() },
    );

    assert.equal(calls.length, 1);
    assert.equal(calledWith(calls, 'DELETE', '/quizzes').length, 0);
    assert.equal(
      state.modules['01-intro'].items['01-intro/01-test.md'],
      undefined,
    );
  });

  it('moves an item to another module without changing its id', async () => {
    silence();
    const state = emptyState();
    state.modules['01-intro'] = {
      canvas_module_id: 10,
      item_order: [],
      items: {},
    };
    state.modules['02-next'] = {
      canvas_module_id: 20,
      item_order: ['02-next/01-a.md'],
      items: { '02-next/01-a.md': { canvas_type: 'page', module_item_id: 91 } },
    };
    const calls = mockCanvas([
      { method: 'PUT', path: '/modules/10/items/91', body: { id: 91 } },
    ]);

    await run(
      {
        actions: [
          {
            type: 'move-canvas-item',
            itemPath: '02-next/01-a.md',
            fromFolder: '01-intro',
            toFolder: '02-next',
            fromCanvasModuleId: 10,
            toCanvasModuleId: 20,
            moduleItemId: 91,
            canvasType: 'page',
            title: 'A',
            indent: 0,
            position: 1,
          },
        ],
      },
      { state, courseDir: tempCourse() },
    );

    const [put] = calledWith(calls, 'PUT', '/modules/10/items/91');
    assert.equal(put.body.module_item.module_id, 20);
    assert.equal(
      state.modules['02-next'].items['02-next/01-a.md'].module_item_id,
      91,
    );
  });

  it('reorders a module by position, in ascending order', async () => {
    silence();
    const state = emptyState();
    state.modules['01-intro'] = {
      canvas_module_id: 10,
      item_order: ['01-intro/01-a.md', '01-intro/02-b.md'],
      items: {
        '01-intro/01-a.md': { canvas_type: 'page', module_item_id: 91 },
        '01-intro/02-b.md': { canvas_type: 'page', module_item_id: 92 },
      },
    };
    const calls = mockCanvas([
      { method: 'PUT', path: '/modules/10/items/92', body: { id: 92 } },
      { method: 'PUT', path: '/modules/10/items/91', body: { id: 91 } },
    ]);

    await run(
      {
        actions: [
          {
            type: 'reorder-canvas-module',
            folder: '01-intro',
            canvasModuleId: 10,
            order: [
              { itemPath: '01-intro/02-b.md', moduleItemId: 92, position: 1 },
              { itemPath: '01-intro/01-a.md', moduleItemId: 91, position: 2 },
            ],
          },
        ],
      },
      { state, courseDir: tempCourse() },
    );

    assert.deepEqual(
      calls.map((call) => [
        call.url.split('/').pop(),
        call.body.module_item.position,
      ]),
      [
        ['92', 1],
        ['91', 2],
      ],
    );
    assert.deepEqual(state.modules['01-intro'].item_order, [
      '01-intro/02-b.md',
      '01-intro/01-a.md',
    ]);
  });

  it('deletes a local file and its row', async () => {
    silence();
    const courseDir = tempCourse({ '01-intro/01-gone.md': 'x\n' });
    const state = emptyState();
    state.modules['01-intro'] = {
      canvas_module_id: 10,
      item_order: ['01-intro/01-gone.md'],
      items: { '01-intro/01-gone.md': { canvas_type: 'page' } },
    };
    mockCanvas([]);

    await run(
      {
        actions: [
          {
            type: 'delete-local-item',
            folder: '01-intro',
            itemPath: '01-intro/01-gone.md',
            canvasType: 'page',
          },
        ],
      },
      { courseDir, state },
    );

    assert.equal(
      fs.existsSync(path.join(courseDir, '01-intro/01-gone.md')),
      false,
    );
    assert.deepEqual(state.modules['01-intro'].items, {});
  });

  it('renames files when Canvas wins the ordering', async () => {
    silence();
    const courseDir = tempCourse({
      '01-intro/01-a.md': 'a\n',
      '01-intro/02-b.md': 'b\n',
    });
    const state = emptyState();
    state.modules['01-intro'] = {
      canvas_module_id: 10,
      item_order: ['01-intro/01-a.md', '01-intro/02-b.md'],
      items: {
        '01-intro/01-a.md': { canvas_type: 'page', canvas_id: 1 },
        '01-intro/02-b.md': { canvas_type: 'page', canvas_id: 2 },
      },
    };
    mockCanvas([]);

    await run(
      {
        actions: [
          {
            type: 'reorder-local-module',
            folder: '01-intro',
            canvasModuleId: 10,
            order: [
              { itemPath: '01-intro/02-b.md', position: 1 },
              { itemPath: '01-intro/01-a.md', position: 2 },
            ],
          },
        ],
      },
      { courseDir, state },
    );

    // The prefix is the local order, so the two files swap slots — through a
    // temporary name, or the second would land on top of the first.
    assert.equal(
      fs.readFileSync(path.join(courseDir, '01-intro/01-b.md'), 'utf8'),
      'b\n',
    );
    assert.equal(
      fs.readFileSync(path.join(courseDir, '01-intro/02-a.md'), 'utf8'),
      'a\n',
    );
    assert.equal(
      state.modules['01-intro'].items['01-intro/01-b.md'].canvas_id,
      2,
    );
    assert.deepEqual(state.modules['01-intro'].item_order, [
      '01-intro/01-b.md',
      '01-intro/02-a.md',
    ]);
  });

  it('re-keys and drops base rows without touching either side', async () => {
    silence();
    const state = emptyState();
    state.modules['01-intro'] = {
      canvas_module_id: 10,
      item_order: ['01-intro/01-old.md', '01-intro/02-stale.md'],
      items: {
        '01-intro/01-old.md': { canvas_type: 'page', canvas_id: 1 },
        '01-intro/02-stale.md': { canvas_type: 'page', canvas_id: 2 },
      },
    };
    const calls = mockCanvas([]);

    await run(
      {
        actions: [
          {
            type: 'rekey-base',
            from: '01-intro/01-old.md',
            to: '01-intro/01-new.md',
          },
          {
            type: 'drop-base-row',
            folder: '01-intro',
            itemPath: '01-intro/02-stale.md',
          },
        ],
      },
      { state, courseDir: tempCourse() },
    );

    assert.equal(calls.length, 0);
    assert.equal(
      state.modules['01-intro'].items['01-intro/01-new.md'].canvas_id,
      1,
    );
    assert.equal(
      state.modules['01-intro'].items['01-intro/02-stale.md'],
      undefined,
    );
  });

  it('keeps going after one action fails, and reports it', async () => {
    silence();
    const state = emptyState();
    state.modules['01-intro'] = {
      canvas_module_id: 10,
      item_order: [],
      items: {},
    };
    mockCanvas([
      // No route for the first module, so it 400s; the second is routed.
      { method: 'POST', path: '/modules', body: { id: 20, name: 'Second' } },
    ]);

    const outcome = await run(
      {
        actions: [
          {
            type: 'create-canvas-item',
            folder: '01-intro',
            canvasModuleId: 10,
            itemPath: '01-intro/01-missing.md',
            title: 'Missing',
            canvasType: 'page',
            indent: 0,
            position: 1,
          },
          {
            type: 'create-canvas-module',
            folder: '02-second',
            name: 'Second',
            position: 2,
          },
        ],
      },
      { state, courseDir: tempCourse() },
    );

    assert.equal(outcome.errors.length, 1);
    assert.equal(outcome.errors[0].action.itemPath, '01-intro/01-missing.md');
    assert.equal(outcome.applied.length, 1);
    assert.equal(state.modules['02-second'].canvas_module_id, 20);
  });

  it('saves the state after a failure as well as at the end', async () => {
    silence();
    const state = emptyState();
    const saves = [];
    mockCanvas([]);

    await applyPlan(
      {
        actions: [
          {
            type: 'create-canvas-module',
            folder: '01-intro',
            name: 'Intro',
            position: 1,
          },
        ],
      },
      {
        courseId: COURSE_ID,
        courseDir: tempCourse(),
        state,
        save: () => saves.push(true),
        now: () => '2026-08-20T12:00:00.000Z',
      },
    );

    // One save for the failure, one at the end: work already done is never
    // lost to a later error.
    assert.equal(saves.length, 2);
  });
});
