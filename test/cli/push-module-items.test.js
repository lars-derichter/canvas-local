const { describe, it, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { mockCanvas, silence } = require('../helpers/canvas-mock');

// Set required env vars before requiring anything that loads the client.
process.env.CANVAS_API_URL = 'https://canvas.example.com';
process.env.CANVAS_API_TOKEN = 'test-token-123';

const push = require('../../cli/push');

const {
  _pushModule: pushModule,
  _readModuleItems: readModuleItems,
  _createItemLedger: createItemLedger,
  _resolveLeftoverItems: resolveLeftoverItems,
} = push;

afterEach(() => mock.restoreAll());

const WELCOME_MD = '---\ntitle: Welcome\ncanvas_id: 4242\n---\n\nHello.\n';

/**
 * Keep the real filesystem for everything the push machinery legitimately
 * reads — the course config, the theme — and answer only for the one course
 * file these tests pretend exists. `_category_.json` is deliberately not
 * answered for: the real read raises ENOENT, which is how a module folder with
 * no Canvas id reads, and the sync state carries the id instead.
 */
function fakeCourseFile(contents = WELCOME_MD) {
  const realRead = fs.readFileSync;
  const written = [];
  mock.method(fs, 'readFileSync', (target, ...rest) => {
    if (String(target).endsWith('01-welcome.md')) return contents;
    if (String(target).endsWith('02-syllabus.md'))
      return '---\ntitle: Syllabus\ncanvas_type: external_url\nexternal_url: https://example.com/syllabus\n---\n';
    return realRead(target, ...rest);
  });
  mock.method(fs, 'writeFileSync', (target, body) => {
    written.push({ path: String(target), body: String(body) });
  });
  return written;
}

/** The local module: a text header and one page under it. */
function localModule(overrides = {}) {
  const { pageTitle = 'Welcome', extra = [] } = overrides;
  return {
    folderName: '01-mod',
    moduleName: 'Getting Started',
    position: 1,
    items: [
      { type: 'subheader', title: 'Part 1', position: 1, indent: 0, items: [] },
      {
        type: 'item',
        canvasType: 'page',
        title: pageTitle,
        relativePath: '01-mod/01-welcome.md',
        position: 2,
        indent: 0,
        frontmatter: { canvas_id: 4242, title: pageTitle },
      },
      ...extra,
    ],
  };
}

/** Sync state that already knows the module, keyed the way v3 keys it. */
function syncState() {
  return {
    schema_version: 3,
    modules: { 580457: { folder: '01-mod', items: {} } },
    files: {},
  };
}

/** What Canvas holds after a push of `localModule()` landed. */
function liveMatchingLocal() {
  return [
    { id: 5001, type: 'SubHeader', title: 'Part 1', position: 1, indent: 0 },
    {
      id: 5002,
      type: 'Page',
      title: 'Welcome',
      content_id: 4242,
      page_url: 'welcome',
      position: 2,
      indent: 0,
    },
  ];
}

/** The Canvas answers a push of `localModule()` needs, in order. */
function baseRoutes(liveItems) {
  return [
    { method: 'GET', path: '/modules/580457/items', body: liveItems },
    { method: 'PUT', path: '/modules/580457', body: { id: 580457 } },
    {
      method: 'PUT',
      path: '/pages/4242',
      body: { page_id: 4242, url: 'welcome' },
    },
  ];
}

/**
 * Push one or more modules against a single mocked Canvas and then settle the
 * run's leftovers, exactly as `push` does — the leftover verdict is a
 * whole-run decision, so a test that stopped at `pushModule` would be testing
 * half of it.
 */
async function run({
  mods,
  mod = localModule(),
  routes,
  sync = syncState(),
  dryRun = false,
} = {}) {
  const errors = [];
  const ledger = createItemLedger();
  const calls = mockCanvas(routes);
  for (const one of mods || [mod]) {
    await pushModule(
      45083,
      one,
      sync,
      dryRun,
      {},
      new Map(),
      [],
      errors,
      ledger,
    );
  }
  await resolveLeftoverItems(45083, ledger, dryRun, errors);
  return { calls, errors, sync, ledger };
}

describe('pushModule: a module Canvas already matches', () => {
  it('issues no DELETE and no POST at all', async () => {
    silence();
    fakeCourseFile();

    const { calls, errors } = await run({
      routes: baseRoutes(liveMatchingLocal()),
    });

    assert.deepEqual(errors, []);
    assert.deepEqual(
      calls.map((c) => c.method),
      ['GET', 'PUT', 'PUT'],
      'read the item list, update the module, update the page — and stop',
    );
    assert.equal(
      calls.filter((c) => c.method === 'DELETE').length,
      0,
      'a no-op push deletes nothing',
    );
    assert.equal(
      calls.filter((c) => c.method === 'POST').length,
      0,
      'a no-op push creates nothing',
    );
  });

  it('updates the one item whose title moved, and nothing else', async () => {
    silence();
    fakeCourseFile('---\ntitle: Welkom\ncanvas_id: 4242\n---\n\nHallo.\n');

    const { calls, errors } = await run({
      mod: localModule({ pageTitle: 'Welkom' }),
      routes: [
        ...baseRoutes(liveMatchingLocal()),
        {
          method: 'PUT',
          path: '/modules/580457/items/5002',
          body: { id: 5002 },
        },
      ],
    });

    assert.deepEqual(errors, []);
    assert.deepEqual(
      calls.map((c) => c.method),
      ['GET', 'PUT', 'PUT', 'PUT'],
    );
    const itemUpdate = calls.at(-1);
    assert.match(itemUpdate.url, /\/modules\/580457\/items\/5002$/);
    assert.deepEqual(itemUpdate.body.module_item, { title: 'Welkom' });
    assert.equal(calls.filter((c) => c.method === 'DELETE').length, 0);
    assert.equal(calls.filter((c) => c.method === 'POST').length, 0);
  });
});

describe('pushModule: module item ids survive a second push', () => {
  it('reuses the ids the first push created instead of making new ones', async () => {
    silence();
    fakeCourseFile();

    // First push: the module is empty on Canvas, so both items are created.
    const first = await run({
      routes: [
        ...baseRoutes([]),
        { method: 'POST', path: '/modules/580457/items', body: { id: 5001 } },
        { method: 'POST', path: '/modules/580457/items', body: { id: 5002 } },
      ],
    });
    mock.restoreAll();

    assert.deepEqual(first.errors, []);
    assert.deepEqual(
      first.calls.map((c) => c.method),
      ['GET', 'PUT', 'PUT', 'POST', 'POST'],
    );

    // Second push, with one title edited so there is something to write: the
    // items Canvas now holds are the ones the first push made.
    silence();
    fakeCourseFile('---\ntitle: Welkom\ncanvas_id: 4242\n---\n\nHallo.\n');
    const second = await run({
      mod: localModule({ pageTitle: 'Welkom' }),
      routes: [
        ...baseRoutes(liveMatchingLocal()),
        {
          method: 'PUT',
          path: '/modules/580457/items/5002',
          body: { id: 5002 },
        },
      ],
    });

    assert.deepEqual(second.errors, []);
    const itemWrites = second.calls.filter((c) =>
      /\/modules\/580457\/items\//.test(c.url),
    );
    assert.deepEqual(
      itemWrites.map((c) => `${c.method} ${c.url.split('/items/')[1]}`),
      ['PUT 5002'],
      'the second run writes to the id the first run created',
    );
    assert.equal(second.calls.filter((c) => c.method === 'POST').length, 0);
    assert.equal(second.calls.filter((c) => c.method === 'DELETE').length, 0);
  });
});

describe('pushModule: an item nothing local describes', () => {
  const handAdded = {
    id: 9001,
    type: 'Quiz',
    title: 'Kennischeck hoofdstuk 1',
    content_id: 777,
    position: 3,
    html_url: 'https://canvas.example.com/courses/45083/modules/items/9001',
  };

  it('leaves it alone, pushes the rest, and says it did', async () => {
    const logged = silence().log;
    fakeCourseFile();

    const { calls, errors } = await run({
      routes: baseRoutes([...liveMatchingLocal(), handAdded]),
    });

    assert.deepEqual(errors, [], 'a Canvas-only item is not a failure');
    assert.equal(
      calls.filter((c) => c.method === 'DELETE').length,
      0,
      'the item stays where it is',
    );
    const output = logged.mock.calls.map((c) => c.arguments[0]).join('\n');
    assert.match(output, /Kennischeck hoofdstuk 1/);
    assert.match(output, /\(Quiz, position 3\)/);
    assert.match(output, /no source file in course\/01-mod\//);
    assert.match(output, /left untouched/);
  });
});

describe('pushModule: an external URL gets its id from the reconcile', () => {
  const syllabus = {
    type: 'item',
    canvasType: 'external_url',
    title: 'Syllabus',
    relativePath: '01-mod/02-syllabus.md',
    position: 3,
    indent: 0,
    frontmatter: { external_url: 'https://example.com/syllabus' },
  };

  it('writes the new module item id to frontmatter and sync state', async () => {
    silence();
    const written = fakeCourseFile();

    const { calls, sync } = await run({
      mod: localModule({ extra: [syllabus] }),
      routes: [
        ...baseRoutes(liveMatchingLocal()),
        { method: 'POST', path: '/modules/580457/items', body: { id: 6001 } },
      ],
    });

    const created = calls.find((c) => c.method === 'POST');
    assert.deepEqual(created.body.module_item, {
      title: 'Syllabus',
      type: 'ExternalUrl',
      external_url: 'https://example.com/syllabus',
      position: 3,
      indent: 0,
      new_tab: true,
    });
    assert.equal(syllabus.frontmatter.canvas_id, 6001);
    const frontmatterWrite = written.find((w) =>
      w.path.endsWith('02-syllabus.md'),
    );
    assert.match(frontmatterWrite.body, /canvas_id: 6001/);
    assert.deepEqual(
      sync.modules['580457'].items['external_url:https://example.com/syllabus'],
      {
        path: '01-mod/02-syllabus.md',
        canvas_id: 6001,
        canvas_type: 'external_url',
        external_url: 'https://example.com/syllabus',
      },
    );
  });

  it('leaves an already-placed one untouched on the next push', async () => {
    silence();
    const written = fakeCourseFile();
    const placed = {
      ...syllabus,
      frontmatter: { ...syllabus.frontmatter, canvas_id: 6001 },
    };

    const { calls } = await run({
      mod: localModule({ extra: [placed] }),
      routes: baseRoutes([
        ...liveMatchingLocal(),
        {
          id: 6001,
          type: 'ExternalUrl',
          title: 'Syllabus',
          external_url: 'https://example.com/syllabus',
          position: 3,
          indent: 0,
          new_tab: true,
        },
      ]),
    });

    assert.deepEqual(
      calls.map((c) => c.method),
      ['GET', 'PUT', 'PUT'],
    );
    assert.ok(
      !written.some((w) => w.path.endsWith('02-syllabus.md')),
      'an id that did not change is not restated in the file',
    );
  });
});

describe('pushModule: an item that moved to another module', () => {
  /** The page left 01-mod, so only the text header is still local there. */
  const emptiedModule = {
    folderName: '01-mod',
    moduleName: 'Getting Started',
    position: 1,
    items: [
      { type: 'subheader', title: 'Part 1', position: 1, indent: 0, items: [] },
    ],
  };

  /** …and arrived in 02-mod, which has nothing else in it. */
  const receivingModule = {
    folderName: '02-mod',
    moduleName: 'Deep Dive',
    position: 2,
    items: [
      {
        type: 'item',
        canvasType: 'page',
        title: 'Welcome',
        relativePath: '02-mod/01-welcome.md',
        position: 1,
        indent: 0,
        frontmatter: { canvas_id: 4242, title: 'Welcome' },
      },
    ],
  };

  function twoModuleSync() {
    return {
      schema_version: 3,
      modules: {
        580457: { folder: '01-mod', items: {} },
        580458: { folder: '02-mod', items: {} },
      },
      files: {},
    };
  }

  const handAdded = {
    id: 9001,
    type: 'Quiz',
    title: 'Kennischeck hoofdstuk 1',
    content_id: 777,
    position: 3,
  };

  /**
   * What Canvas still holds in 01-mod: the text header, the page that left, and
   * a quiz someone placed there by hand.
   */
  function sourceModuleItems() {
    return [
      { id: 5001, type: 'SubHeader', title: 'Part 1', position: 1, indent: 0 },
      {
        id: 5002,
        type: 'Page',
        title: 'Welcome',
        content_id: 4242,
        page_url: 'welcome',
        position: 2,
        indent: 0,
      },
      handAdded,
    ];
  }

  function moveRoutes() {
    return [
      {
        method: 'GET',
        path: '/modules/580457/items',
        body: sourceModuleItems(),
      },
      { method: 'PUT', path: '/modules/580457', body: { id: 580457 } },
      { method: 'GET', path: '/modules/580458/items', body: [] },
      { method: 'PUT', path: '/modules/580458', body: { id: 580458 } },
      {
        method: 'PUT',
        path: '/pages/4242',
        body: { page_id: 4242, url: 'welcome' },
      },
      { method: 'POST', path: '/modules/580458/items', body: { id: 7001 } },
      { method: 'DELETE', path: '/modules/580457/items/5002', status: 204 },
    ];
  }

  it('removes the stale listing from the module it left and lists it in the new one', async () => {
    silence();
    fakeCourseFile();

    const { calls, errors } = await run({
      mods: [emptiedModule, receivingModule],
      routes: moveRoutes(),
      sync: twoModuleSync(),
    });

    assert.deepEqual(errors, []);
    const deletes = calls.filter((c) => c.method === 'DELETE');
    assert.equal(deletes.length, 1, 'exactly one listing goes');
    assert.match(deletes[0].url, /\/modules\/580457\/items\/5002$/);
    const posts = calls.filter((c) => c.method === 'POST');
    assert.equal(posts.length, 1, 'and exactly one arrives');
    assert.match(posts[0].url, /\/modules\/580458\/items$/);
    assert.ok(
      !calls.some((c) => c.method === 'DELETE' && /\/pages\//.test(c.url)),
      'the page itself is a separate Canvas object and is never touched',
    );
  });

  it('does not confuse the move with the quiz nobody added locally', async () => {
    const logged = silence().log;
    fakeCourseFile();

    const { calls } = await run({
      mods: [emptiedModule, receivingModule],
      routes: moveRoutes(),
      sync: twoModuleSync(),
    });

    assert.ok(
      !calls.some((c) => c.url.endsWith('/modules/580457/items/9001')),
      'a hand-added quiz is not a move, and nothing here removes it',
    );
    const output = logged.mock.calls.map((c) => c.arguments[0]).join('\n');
    assert.match(output, /1 item\(s\) moved to another module/);
    assert.match(output, /1 item\(s\) in the Canvas module "Getting Started"/);
    assert.match(output, /Kennischeck hoofdstuk 1/);
    assert.match(output, /left untouched/);
  });

  it('reports no Canvas-only item when the move is all there is', async () => {
    const logged = silence().log;
    fakeCourseFile();

    const { calls, errors } = await run({
      mods: [emptiedModule, receivingModule],
      routes: moveRoutes().map((route) =>
        route.path === '/modules/580457/items' && route.method === 'GET'
          ? { ...route, body: sourceModuleItems().slice(0, 2) }
          : route,
      ),
      sync: twoModuleSync(),
    });

    assert.deepEqual(errors, []);
    assert.equal(calls.filter((c) => c.method === 'DELETE').length, 1);
    const output = logged.mock.calls.map((c) => c.arguments[0]).join('\n');
    assert.match(output, /1 item\(s\) moved to another module/);
    assert.doesNotMatch(output, /no source file in course/);
  });
});

describe('pushModule: a dry run', () => {
  it('says what the item list would become and writes nothing', async () => {
    const logged = silence().log;
    fakeCourseFile('---\ntitle: Welkom\ncanvas_id: 4242\n---\n\nHallo.\n');

    const { calls, errors } = await run({
      mod: localModule({ pageTitle: 'Welkom' }),
      dryRun: true,
      routes: [
        {
          method: 'GET',
          path: '/modules/580457/items',
          body: [
            ...liveMatchingLocal(),
            {
              id: 9001,
              type: 'Quiz',
              title: 'Kennischeck',
              content_id: 777,
              position: 3,
            },
          ],
        },
      ],
    });

    assert.deepEqual(errors, []);
    assert.deepEqual(
      calls.map((c) => c.method),
      ['GET'],
      'reading the item list is the only thing a dry run does',
    );
    const output = logged.mock.calls.map((c) => c.arguments[0]).join('\n');
    assert.match(
      output,
      /DRY RUN: module items — 0 to create, 1 to update, 1 already correct, 1 with no local source\./,
    );
  });
});

describe('pushModule: a page whose slug Canvas regenerated', () => {
  it('falls back to the slug the last sync recorded, asking Canvas nothing', async () => {
    // An instance that reports no content_id on a Page item leaves the slug as
    // the only identity, and the frontmatter holds the numeric id — so without
    // the recorded pair a dry run would call every page a create.
    const logged = silence().log;
    fakeCourseFile();
    const sync = syncState();
    sync.modules['580457'].items['page:4242'] = {
      path: '01-mod/01-welcome.md',
      canvas_id: 4242,
      canvas_type: 'page',
      page_url: 'welcome',
    };

    const { calls } = await run({
      dryRun: true,
      sync,
      routes: [
        {
          method: 'GET',
          path: '/modules/580457/items',
          body: [
            {
              id: 5001,
              type: 'SubHeader',
              title: 'Part 1',
              position: 1,
              indent: 0,
            },
            {
              id: 5002,
              type: 'Page',
              title: 'Welcome',
              page_url: 'welcome',
              position: 2,
              indent: 0,
            },
          ],
        },
      ],
    });

    assert.deepEqual(
      calls.map((c) => c.method),
      ['GET'],
    );
    const output = logged.mock.calls.map((c) => c.arguments[0]).join('\n');
    assert.match(output, /0 to create, 0 to update, 2 already correct/);
  });

  it('matches it on content_id and updates the listing in place', async () => {
    silence();
    fakeCourseFile('---\ntitle: Welkom\ncanvas_id: 4242\n---\n\nHallo.\n');

    const { calls, errors } = await run({
      mod: localModule({ pageTitle: 'Welkom' }),
      routes: [
        {
          method: 'GET',
          path: '/modules/580457/items',
          body: [
            {
              id: 5001,
              type: 'SubHeader',
              title: 'Part 1',
              position: 1,
              indent: 0,
            },
            {
              id: 5002,
              type: 'Page',
              title: 'Welcome',
              content_id: 4242,
              // Canvas rebuilt the slug from the old title.
              page_url: 'welcome',
              position: 2,
              indent: 0,
            },
          ],
        },
        { method: 'PUT', path: '/modules/580457', body: { id: 580457 } },
        {
          method: 'PUT',
          path: '/pages/4242',
          body: { page_id: 4242, url: 'welkom' },
        },
        {
          method: 'PUT',
          path: '/modules/580457/items/5002',
          body: { id: 5002 },
        },
      ],
    });

    assert.deepEqual(errors, []);
    assert.equal(
      calls.filter((c) => c.method === 'POST').length,
      0,
      'a renamed page is the same page, not a second one',
    );
    assert.equal(calls.filter((c) => c.method === 'DELETE').length, 0);
    assert.deepEqual(calls.at(-1).body.module_item, { title: 'Welkom' });
  });

  it('still matches on the slug when Canvas reports no content_id', async () => {
    silence();
    fakeCourseFile();

    const { calls, errors } = await run({
      routes: baseRoutes([
        {
          id: 5001,
          type: 'SubHeader',
          title: 'Part 1',
          position: 1,
          indent: 0,
        },
        {
          id: 5002,
          type: 'Page',
          title: 'Welcome',
          page_url: 'welcome',
          position: 2,
          indent: 0,
        },
      ]),
    });

    assert.deepEqual(errors, []);
    assert.deepEqual(
      calls.map((c) => c.method),
      ['GET', 'PUT', 'PUT'],
      'an older Canvas still recognises its own page item',
    );
  });
});

describe('pushModule: new_tab', () => {
  it('issues one update when the author flipped it', async () => {
    silence();
    fakeCourseFile();
    const syllabus = {
      type: 'item',
      canvasType: 'external_url',
      title: 'Syllabus',
      relativePath: '01-mod/02-syllabus.md',
      position: 3,
      indent: 0,
      frontmatter: {
        external_url: 'https://example.com/syllabus',
        canvas_id: 6001,
        new_tab: false,
      },
    };

    const { calls, errors } = await run({
      mod: localModule({ extra: [syllabus] }),
      routes: [
        ...baseRoutes([
          ...liveMatchingLocal(),
          {
            id: 6001,
            type: 'ExternalUrl',
            title: 'Syllabus',
            external_url: 'https://example.com/syllabus',
            position: 3,
            indent: 0,
            new_tab: true,
          },
        ]),
        {
          method: 'PUT',
          path: '/modules/580457/items/6001',
          body: { id: 6001 },
        },
      ],
    });

    assert.deepEqual(errors, []);
    assert.deepEqual(
      calls.map((c) => c.method),
      ['GET', 'PUT', 'PUT', 'PUT'],
    );
    assert.deepEqual(calls.at(-1).body.module_item, { new_tab: false });
    assert.equal(calls.filter((c) => c.method === 'POST').length, 0);
  });
});

describe('readModuleItems', () => {
  it('makes no request for a module Canvas has never seen', async () => {
    const calls = mockCanvas([]);

    assert.deepEqual(await readModuleItems(45083, null), []);
    assert.equal(calls.length, 0);
  });

  it('returns what the module holds', async () => {
    mockCanvas([
      {
        method: 'GET',
        path: '/modules/580457/items',
        body: liveMatchingLocal(),
      },
    ]);

    assert.equal((await readModuleItems(45083, 580457)).length, 2);
  });

  it('reads a module that is gone as empty: push is about to make it again', async () => {
    mockCanvas([
      {
        method: 'GET',
        path: '/modules/580457/items',
        body: { message: 'not found' },
        status: 404,
      },
    ]);

    assert.deepEqual(await readModuleItems(45083, 580457), []);
  });

  it('refuses a module it could not read rather than double it', async () => {
    mockCanvas([
      {
        method: 'GET',
        path: '/modules/580457/items',
        body: { message: 'nope' },
        status: 403,
      },
    ]);

    await assert.rejects(
      readModuleItems(45083, 580457),
      /a second copy of everything/,
    );
  });
});
