const { describe, it, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { mockCanvas } = require('../helpers/canvas-mock');
const fs = require('fs');

// Set required env vars before requiring anything that loads the client.
process.env.CANVAS_API_URL = 'https://canvas.example.com';
process.env.CANVAS_API_TOKEN = 'test-token-123';

const push = require('../../cli/push');

const {
  _isLiveItemLocal: isLiveItemLocal,
  _inspectCanvasOnlyItems: inspectCanvasOnlyItems,
  _describeCanvasOnlyItem: describeCanvasOnlyItem,
  _reportCanvasOnlyRefusal: reportCanvasOnlyRefusal,
  _collectPushGuardClaims: collectPushGuardClaims,
  _makePageIdResolver: makePageIdResolver,
  _readLiveItems: readLiveItems,
  _pushModule: pushModule,
} = push;

afterEach(() => mock.restoreAll());

/**
 * The three items the playground course holds that no local file accounts for:
 * a quiz, a discussion and an LTI link, all added by hand in Canvas.
 */
const HAND_ADDED = [
  {
    id: 9001,
    type: 'Quiz',
    title: 'Kennischeck hoofdstuk 1',
    content_id: 777,
    position: 15,
    html_url: 'https://canvas.example.com/courses/45083/modules/items/9001',
  },
  {
    id: 9002,
    type: 'Discussion',
    title: '❓ Vragen en antwoorden',
    content_id: 888,
    position: 16,
  },
  {
    id: 9003,
    type: 'ExternalTool',
    title: 'Wooclap',
    content_id: 12,
    external_url: 'https://app.wooclap.com/events/ABCDEF',
    position: 17,
  },
];

describe('isLiveItemLocal', () => {
  it('recognises a page claimed by page id through its slug', () => {
    const item = { id: 1, type: 'Page', title: 'Welcome', page_url: 'welcome' };
    const pageIds = new Map([['welcome', 4242]]);

    assert.equal(
      isLiveItemLocal(item, new Set(['page:4242']), pageIds),
      true,
      'a slug claim and an id claim are the same page',
    );
  });

  it('recognises a page whose frontmatter holds the slug itself', () => {
    const item = { id: 1, type: 'Page', title: 'Welcome', page_url: 'welcome' };

    assert.equal(
      isLiveItemLocal(item, new Set(['page:welcome']), new Map()),
      true,
    );
  });

  it('flags a page no local file claims by either slug or id', () => {
    const item = {
      id: 1,
      type: 'Page',
      title: 'Written in Canvas',
      page_url: 'written-in-canvas',
    };
    const pageIds = new Map([['welcome', 4242]]);

    assert.equal(isLiveItemLocal(item, new Set(['page:4242']), pageIds), false);
  });

  it('flags a page whose slug cannot be resolved to an id', () => {
    const item = { id: 1, type: 'Page', title: 'Welcome', page_url: 'welcome' };

    assert.equal(isLiveItemLocal(item, new Set(['page:4242']), null), false);
  });

  it('recognises an external URL whose stored id went stale', () => {
    // Push wrote canvas_id 501 on the first push and never refreshed it; the
    // item Canvas holds now was recreated by a later push and carries id 940.
    const item = {
      id: 940,
      type: 'ExternalUrl',
      title: 'Syllabus',
      external_url: 'https://example.com/syllabus',
    };
    const claims = new Set([
      'external_url:501',
      'external_url:https://example.com/syllabus',
    ]);

    assert.equal(isLiveItemLocal(item, claims, new Map()), true);
  });

  it('recognises an external tool whose stored id went stale', () => {
    const item = {
      id: 941,
      type: 'ExternalTool',
      title: 'Wooclap',
      content_id: 12,
      external_url: 'https://app.wooclap.com/events/ABCDEF',
      // The tool id in content_id is shared by every link to that tool, so it
      // is never the identity of this item.
    };
    const claims = new Set([
      'external_tool:502',
      'external_tool:https://app.wooclap.com/events/ABCDEF',
    ]);

    assert.equal(isLiveItemLocal(item, claims, new Map()), true);
  });

  it('recognises an external URL by the id of the push that created it', () => {
    // First push: the id in frontmatter is the id Canvas still holds, even
    // though the URL was edited locally afterwards.
    const item = {
      id: 501,
      type: 'ExternalUrl',
      title: 'Syllabus',
      external_url: 'https://example.com/old-syllabus',
    };

    assert.equal(
      isLiveItemLocal(
        item,
        new Set(['external_url:501', 'external_url:https://example.com/new']),
        new Map(),
      ),
      true,
    );
  });

  it('never flags a SubHeader, whatever the claims hold', () => {
    const item = { id: 3, type: 'SubHeader', title: 'Part 1', position: 4 };

    assert.equal(isLiveItemLocal(item, new Set(), new Map()), true);
  });

  it('flags a quiz, a discussion and an LTI link added by hand', () => {
    const claims = new Set(['page:4242', 'assignment:99']);

    for (const item of HAND_ADDED) {
      assert.equal(
        isLiveItemLocal(item, claims, new Map([['welcome', 4242]])),
        false,
        `${item.type} "${item.title}" should count as Canvas-only`,
      );
    }
  });

  it('recognises the same three once local files claim them', () => {
    const claims = new Set([
      'quiz:777',
      'discussion:888',
      'external_tool:https://app.wooclap.com/events/ABCDEF',
    ]);

    for (const item of HAND_ADDED) {
      assert.equal(isLiveItemLocal(item, claims, new Map()), true);
    }
  });

  it('keeps claims type-scoped: an assignment claim never covers a quiz', () => {
    const quiz = { id: 9001, type: 'Quiz', title: 'Quiz', content_id: 12 };

    assert.equal(
      isLiveItemLocal(quiz, new Set(['assignment:12']), null),
      false,
    );
    assert.equal(isLiveItemLocal(quiz, new Set(['quiz:12']), null), true);
  });

  it('recognises a file item by its content id', () => {
    const item = { id: 5, type: 'File', title: 'Slides', content_id: 3030 };

    assert.equal(isLiveItemLocal(item, new Set(['file:3030']), null), true);
    assert.equal(isLiveItemLocal(item, new Set(['file:99']), null), false);
  });

  it('flags an item type push cannot produce', () => {
    const item = { id: 6, type: 'Something', title: 'Mystery', content_id: 1 };

    assert.equal(isLiveItemLocal(item, new Set(['page:1']), null), false);
  });
});

describe('inspectCanvasOnlyItems', () => {
  const claims = new Set(['page:4242']);
  const resolve = async () => new Map([['welcome', 4242]]);

  it('returns the items nothing local claims, in Canvas order', async () => {
    const live = [
      { id: 1, type: 'Page', title: 'Welcome', page_url: 'welcome' },
      { id: 2, type: 'SubHeader', title: 'Part 1' },
      ...HAND_ADDED,
    ];

    const { canvasOnly, error } = await inspectCanvasOnlyItems(
      live,
      claims,
      resolve,
    );

    assert.equal(error, null);
    assert.deepEqual(
      canvasOnly.map((item) => item.title),
      ['Kennischeck hoofdstuk 1', '❓ Vragen en antwoorden', 'Wooclap'],
    );
  });

  it('reports nothing for a module push itself built', async () => {
    const live = [
      { id: 1, type: 'Page', title: 'Welcome', page_url: 'welcome' },
      { id: 2, type: 'SubHeader', title: 'Part 1' },
    ];

    const { canvasOnly, error } = await inspectCanvasOnlyItems(
      live,
      claims,
      resolve,
    );

    assert.equal(error, null);
    assert.deepEqual(canvasOnly, []);
  });

  it('resolves the page list once, however many pages the module holds', async () => {
    let calls = 0;
    const counting = async () => {
      calls++;
      return new Map([['welcome', 4242]]);
    };
    const live = [
      { id: 1, type: 'Page', title: 'One', page_url: 'welcome' },
      { id: 2, type: 'Page', title: 'Two', page_url: 'welcome' },
    ];

    await inspectCanvasOnlyItems(live, claims, counting);

    assert.equal(calls, 1);
  });

  it('never asks for the page list when the module holds no page', async () => {
    let calls = 0;
    const counting = async () => {
      calls++;
      return new Map();
    };

    const { canvasOnly } = await inspectCanvasOnlyItems(
      [HAND_ADDED[1]],
      claims,
      counting,
    );

    assert.equal(calls, 0);
    assert.equal(canvasOnly.length, 1);
  });

  it('reports a failed page lookup instead of guessing', async () => {
    const live = [
      { id: 1, type: 'Page', title: 'Welcome', page_url: 'welcome' },
    ];

    const { canvasOnly, error } = await inspectCanvasOnlyItems(
      live,
      claims,
      async () => {
        throw new Error('503 Service Unavailable');
      },
    );

    assert.deepEqual(canvasOnly, []);
    assert.match(error, /could not list the pages/);
    assert.match(error, /503 Service Unavailable/);
  });

  it('handles a module Canvas reports as empty', async () => {
    const { canvasOnly, error } = await inspectCanvasOnlyItems(
      [],
      claims,
      resolve,
    );

    assert.equal(error, null);
    assert.deepEqual(canvasOnly, []);
  });
});

describe('collectPushGuardClaims', () => {
  const modules = [
    {
      folderName: '01-mod',
      items: [
        {
          type: 'item',
          canvasType: 'page',
          relativePath: '01-mod/01-welcome.md',
          frontmatter: { canvas_id: 4242 },
        },
      ],
    },
  ];

  it('keeps every claim the frontmatter makes', () => {
    mock.method(fs, 'existsSync', () => false);

    const claims = collectPushGuardClaims({ modules: {} }, modules);

    assert.equal(claims.has('page:4242'), true);
  });

  it('claims a tracked file whose local path is still there', () => {
    // A raw binary carries no frontmatter, so the sync entry push wrote is the
    // only thing tying the Canvas file to the local path.
    mock.method(fs, 'existsSync', () => true);
    const syncData = {
      modules: {
        580457: {
          folder: '01-mod',
          items: {
            'file:3030': {
              path: '01-mod/03-slides.pdf',
              canvas_id: 3030,
              canvas_type: 'file',
            },
          },
        },
      },
    };

    const claims = collectPushGuardClaims(syncData, modules);

    assert.equal(claims.has('file:3030'), true);
  });

  it('still claims a tracked file the author deleted locally', () => {
    // Deleting the source file is how you remove an item, and --prune is what
    // finishes the job on the Canvas object. If the guard stopped claiming it
    // the moment the file went, it would read the item back as hand-made and
    // refuse the module, blocking every other edit to it over one deletion.
    mock.method(fs, 'existsSync', () => false);
    const syncData = {
      modules: {
        580457: {
          items: {
            'file:3030': {
              path: '01-mod/03-slides.pdf',
              canvas_id: 3030,
              canvas_type: 'file',
            },
          },
        },
      },
    };

    const claims = collectPushGuardClaims(syncData, modules);

    assert.equal(claims.has('file:3030'), true);
  });

  it('claims sync entries of every type, not just files', () => {
    mock.method(fs, 'existsSync', () => false);
    const syncData = {
      modules: {
        580457: {
          items: {
            'page:99': {
              path: '01-mod/09-old.md',
              canvas_id: 99,
              canvas_type: 'page',
              page_url: 'old-page',
            },
            'quiz:366284': { canvas_id: 366284, canvas_type: 'quiz' },
            'external_tool:7': {
              canvas_id: 7,
              canvas_type: 'external_tool',
              external_url: 'https://app.wooclap.com/api/lti/launch',
            },
          },
        },
      },
    };

    const claims = collectPushGuardClaims(syncData, modules);

    assert.equal(claims.has('page:99'), true);
    assert.equal(
      claims.has('page:old-page'),
      true,
      'live items carry the slug',
    );
    assert.equal(claims.has('quiz:366284'), true);
    assert.equal(
      claims.has('external_tool:https://app.wooclap.com/api/lti/launch'),
      true,
      'an LTI item is matched on its launch URL, never on its module item id',
    );
  });

  it('claims nothing for an item added by hand in Canvas', () => {
    // The whole point of the guard: push never created it, so no sync entry
    // names it and no frontmatter claims it.
    mock.method(fs, 'existsSync', () => false);
    const syncData = { modules: { 580457: { items: {} } } };

    const claims = collectPushGuardClaims(syncData, modules);

    assert.equal(claims.has('quiz:366284'), false);
  });

  it('survives an empty sync file', () => {
    const claims = collectPushGuardClaims(null, modules);

    assert.equal(claims.has('page:4242'), true);
  });
});

describe('makePageIdResolver', () => {
  it('fetches the page list once per run', async () => {
    let calls = 0;
    const resolve = makePageIdResolver(45083, async () => {
      calls++;
      return [{ url: 'welcome', page_id: 4242 }];
    });

    const first = await resolve();
    const second = await resolve();

    assert.equal(calls, 1);
    assert.equal(first.get('welcome'), 4242);
    assert.equal(second, first);
  });

  it('hands the failure to the caller', async () => {
    const resolve = makePageIdResolver(45083, async () => {
      throw new Error('403 Forbidden');
    });

    await assert.rejects(resolve(), /403 Forbidden/);
  });
});

describe('readLiveItems', () => {
  it('makes no request for a module Canvas has never seen', async () => {
    const calls = mockCanvas([]);

    assert.equal(await readLiveItems(45083, null, false), null);
    assert.equal(calls.length, 0);
  });

  it('returns what the module holds', async () => {
    mockCanvas([
      { method: 'GET', path: '/modules/580457/items', body: HAND_ADDED },
    ]);

    const items = await readLiveItems(45083, 580457, false);

    assert.equal(items.length, 3);
  });

  it('treats a module that is gone as nothing to protect', async () => {
    mockCanvas([
      {
        method: 'GET',
        path: '/modules/580457/items',
        body: { message: 'not found' },
        status: 404,
      },
    ]);

    assert.equal(await readLiveItems(45083, 580457, false), null);
  });

  it('refuses a module it could not read', async () => {
    mockCanvas([
      {
        method: 'GET',
        path: '/modules/580457/items',
        body: { message: 'nope' },
        status: 403,
      },
    ]);

    await assert.rejects(
      readLiveItems(45083, 580457, false),
      /refuses to touch a module it could not read/,
    );
  });

  it('warns instead of failing when a dry run cannot read the module', async () => {
    const warned = mock.method(console, 'warn', () => {});
    mockCanvas([
      {
        method: 'GET',
        path: '/modules/580457/items',
        body: { message: 'nope' },
        status: 403,
      },
    ]);

    assert.equal(await readLiveItems(45083, 580457, true), null);
    assert.match(warned.mock.calls[0].arguments[0], /this dry run cannot say/);
  });
});

describe('describeCanvasOnlyItem', () => {
  it('names the item, its type, its position and where it lives', () => {
    assert.equal(
      describeCanvasOnlyItem(HAND_ADDED[0]),
      '  - "Kennischeck hoofdstuk 1" (Quiz, position 15) — ' +
        'https://canvas.example.com/courses/45083/modules/items/9001',
    );
  });

  it('drops what Canvas did not return', () => {
    assert.equal(
      describeCanvasOnlyItem({ type: 'Discussion' }),
      '  - "(untitled)" (Discussion)',
    );
  });
});

describe('reportCanvasOnlyRefusal', () => {
  const mod = {
    moduleName: 'Getting Started',
    folderName: '01-getting-started',
  };

  it('names every item at stake and what to do about it', () => {
    const errored = mock.method(console, 'error', () => {});

    const summary = reportCanvasOnlyRefusal(mod, HAND_ADDED, false);

    const output = errored.mock.calls.map((c) => c.arguments[0]).join('\n');
    assert.match(output, /Refusing to push module "Getting Started"/);
    assert.match(output, /Kennischeck hoofdstuk 1/);
    assert.match(output, /❓ Vragen en antwoorden/);
    assert.match(output, /Wooclap/);
    assert.match(output, /course\/01-getting-started\//);
    assert.match(output, /--drop-canvas-only/);
    assert.match(output, /docs\/frontmatter\.md/);
    assert.match(summary, /3 items/);
    assert.match(summary, /left untouched/);
    assert.match(summary, /"Wooclap"/);
  });

  it('says a dry run would refuse rather than that it did', () => {
    const errored = mock.method(console, 'error', () => {});

    reportCanvasOnlyRefusal(mod, [HAND_ADDED[0]], true);

    const output = errored.mock.calls.map((c) => c.arguments[0]).join('\n');
    assert.match(output, /DRY RUN: would refuse to push/);
    assert.match(output, /1 item in this Canvas module has/);
  });
});

describe('pushModule: the Canvas-only guard', () => {
  /** The module as scanCourse describes it: one text header, nothing else. */
  const mod = {
    folderName: '01-mod',
    moduleName: 'Getting Started',
    position: 1,
    items: [
      { type: 'subheader', title: 'Part 1', position: 1, indent: 0, items: [] },
    ],
  };

  const claimedPage = {
    id: 1,
    type: 'Page',
    title: 'Welcome',
    page_url: 'welcome',
    position: 1,
  };

  function syncState() {
    return {
      schema_version: 3,
      modules: { 580457: { folder: '01-mod', items: {} } },
      files: {},
    };
  }

  function guard(overrides = {}) {
    return {
      dropCanvasOnly: false,
      claims: new Set(['page:4242']),
      resolvePageIds: async () => new Map([['welcome', 4242]]),
      ...overrides,
    };
  }

  function run(options = {}) {
    const { dryRun = false, guardOverrides = {}, errors = [] } = options;
    return pushModule(
      45083,
      mod,
      syncState(),
      dryRun,
      {},
      new Map(),
      [],
      errors,
      guard(guardOverrides),
    ).then(() => errors);
  }

  it('pushes a module whose Canvas items all have a local source', async () => {
    mock.method(console, 'log', () => {});
    mock.method(fs, 'writeFileSync', () => {});
    const calls = mockCanvas([
      {
        method: 'GET',
        path: '/modules/580457/items',
        body: [claimedPage, { id: 2, type: 'SubHeader', title: 'Part 1' }],
      },
      { method: 'PUT', path: '/modules/580457', body: { id: 580457 } },
      { method: 'DELETE', path: '/modules/580457/items/1', status: 204 },
      { method: 'DELETE', path: '/modules/580457/items/2', status: 204 },
      { method: 'POST', path: '/modules/580457/items', body: { id: 77 } },
    ]);

    const errors = await run();

    assert.deepEqual(errors, []);
    assert.deepEqual(
      calls.map((c) => c.method),
      ['GET', 'PUT', 'DELETE', 'DELETE', 'POST'],
      'the module is rebuilt exactly as it was before the guard existed',
    );
  });

  it('leaves a module holding hand-added items completely alone', async () => {
    mock.method(console, 'log', () => {});
    const errored = mock.method(console, 'error', () => {});
    const written = mock.method(fs, 'writeFileSync', () => {});
    const calls = mockCanvas([
      {
        method: 'GET',
        path: '/modules/580457/items',
        body: [claimedPage, ...HAND_ADDED],
      },
    ]);

    const errors = await run();

    assert.deepEqual(
      calls.map((c) => c.method),
      ['GET'],
      'nothing is updated, deleted or created',
    );
    assert.equal(written.mock.callCount(), 0, '_category_.json is not touched');
    assert.equal(errors.length, 1);
    assert.equal(errors[0].module, '01-mod');
    assert.match(errors[0].error, /no local source file/);
    const output = errored.mock.calls.map((c) => c.arguments[0]).join('\n');
    for (const item of HAND_ADDED) assert.match(output, new RegExp(item.title));
  });

  it('refuses the module when the page list cannot be read', async () => {
    mock.method(console, 'log', () => {});
    const errored = mock.method(console, 'error', () => {});
    const calls = mockCanvas([
      {
        method: 'GET',
        path: '/modules/580457/items',
        body: [claimedPage],
      },
    ]);

    const errors = await run({
      guardOverrides: {
        resolvePageIds: async () => {
          throw new Error('503 Service Unavailable');
        },
      },
    });

    assert.deepEqual(
      calls.map((c) => c.method),
      ['GET'],
    );
    assert.equal(errors.length, 1);
    assert.match(errors[0].error, /could not list the pages/);
    const output = errored.mock.calls.map((c) => c.arguments[0]).join('\n');
    assert.match(output, /Refusing to push module "Getting Started"/);
  });

  it('rebuilds the module anyway under --drop-canvas-only, and says what goes', async () => {
    mock.method(console, 'log', () => {});
    const warned = mock.method(console, 'warn', () => {});
    mock.method(fs, 'writeFileSync', () => {});
    const calls = mockCanvas([
      {
        method: 'GET',
        path: '/modules/580457/items',
        body: [claimedPage, ...HAND_ADDED],
      },
      { method: 'PUT', path: '/modules/580457', body: { id: 580457 } },
      { method: 'DELETE', path: '/modules/580457/items/1', status: 204 },
      { method: 'DELETE', path: '/modules/580457/items/9001', status: 204 },
      { method: 'DELETE', path: '/modules/580457/items/9002', status: 204 },
      { method: 'DELETE', path: '/modules/580457/items/9003', status: 204 },
      { method: 'POST', path: '/modules/580457/items', body: { id: 77 } },
    ]);

    const errors = await run({ guardOverrides: { dropCanvasOnly: true } });

    assert.deepEqual(errors, []);
    assert.equal(
      calls.filter((c) => c.method === 'DELETE').length,
      4,
      'every item goes, including the three with no local source',
    );
    const output = warned.mock.calls.map((c) => c.arguments[0]).join('\n');
    assert.match(output, /--drop-canvas-only: removing 3 item\(s\)/);
    for (const item of HAND_ADDED) assert.match(output, new RegExp(item.title));
  });

  it('reports the refusal in a dry run without touching Canvas', async () => {
    mock.method(console, 'log', () => {});
    const errored = mock.method(console, 'error', () => {});
    const written = mock.method(fs, 'writeFileSync', () => {});
    const calls = mockCanvas([
      {
        method: 'GET',
        path: '/modules/580457/items',
        body: [claimedPage, ...HAND_ADDED],
      },
    ]);

    const errors = await run({ dryRun: true });

    assert.deepEqual(
      calls.map((c) => c.method),
      ['GET'],
    );
    assert.equal(written.mock.callCount(), 0);
    assert.equal(errors.length, 1);
    const output = errored.mock.calls.map((c) => c.arguments[0]).join('\n');
    assert.match(
      output,
      /DRY RUN: would refuse to push module "Getting Started"/,
    );
  });

  it('makes no Canvas write in a dry run of a clean module either', async () => {
    mock.method(console, 'log', () => {});
    const written = mock.method(fs, 'writeFileSync', () => {});
    const calls = mockCanvas([
      { method: 'GET', path: '/modules/580457/items', body: [claimedPage] },
    ]);

    const errors = await run({ dryRun: true });

    assert.deepEqual(errors, []);
    assert.deepEqual(
      calls.map((c) => c.method),
      ['GET'],
    );
    assert.equal(written.mock.callCount(), 0);
  });
});
