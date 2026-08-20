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

const WELCOME_MD = '---\ntitle: Welcome\n---\n\nHello.\n';

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
        // No canvas_id: the file says what it is called and nothing about
        // which Canvas page it is. That answer is in the sync state below.
        frontmatter: { title: pageTitle },
      },
      ...extra,
    ],
  };
}

/**
 * Sync state as a previous push left it: the module keyed by its folder name,
 * and the page keyed by its repo-relative path.
 */
function syncState(items = pageRow()) {
  return {
    schema_version: 4,
    modules: {
      '01-mod': {
        canvas_module_id: 580457,
        name: 'Getting Started',
        position: 1,
        item_order: Object.keys(items),
        items,
      },
    },
    icons: {},
    files: {},
  };
}

/** The row a previous push recorded for the welcome page. */
function pageRow() {
  return {
    '01-mod/01-welcome.md': {
      canvas_type: 'page',
      canvas_id: 4242,
      page_url: 'welcome',
    },
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
    fakeCourseFile('---\ntitle: Welkom\n---\n\nHallo.\n');

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
    fakeCourseFile('---\ntitle: Welkom\n---\n\nHallo.\n');
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

  it('records the new module item id in the sync state and not in the file', async () => {
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
    assert.deepEqual(sync.modules['01-mod'].items['01-mod/02-syllabus.md'], {
      canvas_type: 'external_url',
      // A link has no Canvas object behind it, so the module item is both.
      canvas_id: 6001,
      module_item_id: 6001,
      external_url: 'https://example.com/syllabus',
    });
    const frontmatterWrite = written.find((w) =>
      w.path.endsWith('02-syllabus.md'),
    );
    assert.ok(
      !frontmatterWrite || !/canvas_id/.test(frontmatterWrite.body),
      'the id Canvas issued never reaches the file',
    );
  });

  it('leaves an already-placed one untouched on the next push', async () => {
    silence();
    const written = fakeCourseFile();

    const { calls } = await run({
      mod: localModule({ extra: [syllabus] }),
      sync: syncState({
        ...pageRow(),
        '01-mod/02-syllabus.md': {
          canvas_type: 'external_url',
          canvas_id: 6001,
          external_url: 'https://example.com/syllabus',
        },
      }),
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
      'a file that already names itself is not rewritten',
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
        frontmatter: { title: 'Welcome' },
      },
    ],
  };

  function twoModuleSync() {
    return {
      schema_version: 4,
      modules: {
        '01-mod': {
          canvas_module_id: 580457,
          item_order: [],
          items: {},
        },
        '02-mod': {
          canvas_module_id: 580458,
          item_order: ['02-mod/01-welcome.md'],
          items: {
            '02-mod/01-welcome.md': {
              canvas_type: 'page',
              canvas_id: 4242,
              page_url: 'welcome',
            },
          },
        },
      },
      icons: {},
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
    fakeCourseFile('---\ntitle: Welkom\n---\n\nHallo.\n');

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

    const { calls } = await run({
      dryRun: true,
      sync: syncState(),
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
    fakeCourseFile('---\ntitle: Welkom\n---\n\nHallo.\n');

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

describe('pushModule: identity lives in the sync state', () => {
  /**
   * A module holding one page with no `title:` and no id anywhere in the file,
   * under the usual text header. Built fresh per call: push writes the title
   * back into the scanned item, so a shared fixture would only be untitled once.
   */
  function freshModule() {
    return {
      folderName: '01-mod',
      moduleName: 'Getting Started',
      position: 1,
      items: [
        {
          type: 'subheader',
          title: 'Part 1',
          position: 1,
          indent: 0,
          items: [],
        },
        {
          type: 'item',
          canvasType: 'page',
          title: 'Welcome',
          relativePath: '01-mod/01-welcome.md',
          position: 2,
          indent: 0,
          frontmatter: {},
        },
      ],
    };
  }

  /** Sync state that knows the module but nothing inside it. */
  function emptyModuleSync() {
    return syncState({});
  }

  it('records a created page in the sync state and writes no id to the file', async () => {
    silence();
    const written = fakeCourseFile('---\n---\n\nHello.\n');

    const { sync, errors } = await run({
      mod: freshModule(),
      sync: emptyModuleSync(),
      routes: [
        { method: 'GET', path: '/modules/580457/items', body: [] },
        { method: 'PUT', path: '/modules/580457', body: { id: 580457 } },
        {
          method: 'POST',
          path: '/pages',
          body: { page_id: 4242, url: 'welcome' },
        },
        { method: 'POST', path: '/modules/580457/items', body: { id: 5001 } },
        { method: 'POST', path: '/modules/580457/items', body: { id: 5002 } },
      ],
    });

    assert.deepEqual(errors, []);
    assert.deepEqual(sync.modules['01-mod'].items['01-mod/01-welcome.md'], {
      canvas_type: 'page',
      canvas_id: 4242,
      page_url: 'welcome',
      // The page and the module item listing it are two Canvas objects, and
      // the row addresses both.
      module_item_id: 5002,
    });
    assert.deepEqual(sync.modules['01-mod'].item_order, [
      '01-mod/01-welcome.md',
    ]);

    const fileWrite = written.find((w) => w.path.endsWith('01-welcome.md'));
    assert.ok(fileWrite, 'the file is written, to give it a title');
    assert.doesNotMatch(
      fileWrite.body,
      /canvas_id/,
      'the Canvas id it just learned stays out of the file',
    );
  });

  it('writes an explicit title so the filename stops being the display name', async () => {
    silence();
    const written = fakeCourseFile('---\n---\n\nHello.\n');

    await run({
      mod: freshModule(),
      sync: emptyModuleSync(),
      routes: [
        { method: 'GET', path: '/modules/580457/items', body: [] },
        { method: 'PUT', path: '/modules/580457', body: { id: 580457 } },
        {
          method: 'POST',
          path: '/pages',
          body: { page_id: 4242, url: 'welcome' },
        },
        { method: 'POST', path: '/modules/580457/items', body: { id: 5001 } },
        { method: 'POST', path: '/modules/580457/items', body: { id: 5002 } },
      ],
    });

    const fileWrite = written.find((w) => w.path.endsWith('01-welcome.md'));
    assert.match(fileWrite.body, /^---\ntitle: Welcome\n/);
  });

  it('leaves a file that already names itself alone', async () => {
    silence();
    const written = fakeCourseFile();

    await run({ routes: baseRoutes(liveMatchingLocal()) });

    assert.ok(
      !written.some((w) => w.path.endsWith('01-welcome.md')),
      'a title that is already there is not restated',
    );
  });

  it('finds the page by path on the next push and updates it in place', async () => {
    // The first run's state is handed to the second, which is the whole point:
    // nothing in the file said which page this was, and the second push still
    // updates 4242 rather than creating a second one.
    silence();
    fakeCourseFile('---\n---\n\nHello.\n');

    const first = await run({
      mod: freshModule(),
      sync: emptyModuleSync(),
      routes: [
        { method: 'GET', path: '/modules/580457/items', body: [] },
        { method: 'PUT', path: '/modules/580457', body: { id: 580457 } },
        {
          method: 'POST',
          path: '/pages',
          body: { page_id: 4242, url: 'welcome' },
        },
        { method: 'POST', path: '/modules/580457/items', body: { id: 5001 } },
        { method: 'POST', path: '/modules/580457/items', body: { id: 5002 } },
      ],
    });
    mock.restoreAll();

    silence();
    fakeCourseFile('---\ntitle: Welcome\n---\n\nHello.\n');
    const second = await run({
      mod: freshModule(),
      sync: first.sync,
      routes: baseRoutes(liveMatchingLocal()),
    });

    assert.deepEqual(second.errors, []);
    assert.deepEqual(
      second.calls.map((c) => `${c.method} ${c.url.split('/api/v1')[1]}`),
      [
        'GET /courses/45083/modules/580457/items',
        'PUT /courses/45083/modules/580457',
        'PUT /courses/45083/pages/4242',
      ],
      'the page is updated by the id the first run recorded, and nothing is created',
    );
  });

  it('takes the module id from the sync state, with no _category_.json anywhere', async () => {
    // `fakeCourseFile` deliberately lets the real read of _category_.json raise
    // ENOENT: the folder carries no Canvas id, and the module is still found.
    silence();
    const written = fakeCourseFile();

    const { calls, errors } = await run({
      routes: baseRoutes(liveMatchingLocal()),
    });

    assert.deepEqual(errors, []);
    assert.ok(
      calls.some(
        (c) => c.method === 'PUT' && c.url.endsWith('/modules/580457'),
      ),
      'the folder resolved to its Canvas module through the sync state alone',
    );
    assert.ok(
      !written.some((w) => w.path.endsWith('_category_.json')),
      'and push writes no id back into the folder',
    );
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
