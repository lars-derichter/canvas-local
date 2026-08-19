const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  reconcileModuleItems,
  applyModuleItems,
  describeLeftoverItem,
} = require('../../lib/sync/apply');

/** A live module item as `listModuleItems` returns one. */
function live(overrides) {
  return { id: 1, position: 1, indent: 0, ...overrides };
}

describe('reconcileModuleItems: matching by identity', () => {
  it('matches a page on its slug, never on its title or position', () => {
    const result = reconcileModuleItems({
      live: [
        live({ id: 10, type: 'Page', title: 'Old name', page_url: 'welcome' }),
      ],
      desired: [
        { type: 'Page', title: 'New name', pageUrl: 'welcome', position: 1 },
      ],
    });

    assert.equal(result.create.length, 0);
    assert.equal(result.leftover.length, 0);
    assert.equal(result.update.length, 1);
    assert.equal(result.update[0].live.id, 10);
    assert.deepEqual(result.update[0].changes, { title: 'New name' });
  });

  it('matches an assignment, a discussion, a quiz and a file on content_id', () => {
    for (const type of ['Assignment', 'Discussion', 'Quiz', 'File']) {
      const result = reconcileModuleItems({
        live: [live({ id: 20, type, title: 'Thing', content_id: 500 })],
        desired: [{ type, title: 'Thing', contentId: 500, position: 1 }],
      });

      assert.equal(result.unchanged.length, 1, `${type} should match`);
      assert.equal(result.unchanged[0].live.id, 20);
    }
  });

  it('keeps the match type-scoped: a quiz never claims an assignment item', () => {
    const result = reconcileModuleItems({
      live: [
        live({ id: 30, type: 'Assignment', title: 'Test', content_id: 7 }),
      ],
      desired: [{ type: 'Quiz', title: 'Test', contentId: 7, position: 1 }],
    });

    assert.equal(result.create.length, 1);
    assert.equal(result.leftover.length, 1);
    assert.equal(result.leftover[0].id, 30);
  });

  it('matches an external URL and an LTI link on the launch URL', () => {
    const url = 'https://app.wooclap.com/events/ABCDEF';
    for (const [type, liveType] of [
      ['ExternalUrl', 'ExternalUrl'],
      ['ExternalTool', 'ExternalTool'],
    ]) {
      const result = reconcileModuleItems({
        // The stored module item id from the first push went stale long ago;
        // the URL is the only thing that survives a recreate.
        live: [
          live({
            id: 940,
            type: liveType,
            title: 'Wooclap',
            external_url: url,
          }),
        ],
        desired: [{ type, title: 'Wooclap', externalUrl: url, position: 1 }],
      });

      assert.equal(
        result.unchanged.length,
        1,
        `${type} should match on its URL`,
      );
      assert.equal(result.unchanged[0].live.id, 940);
    }
  });

  it('matches a subheader on its title, among subheaders only', () => {
    const result = reconcileModuleItems({
      live: [
        live({ id: 40, type: 'Page', title: 'Part 1', page_url: 'part-1' }),
        live({ id: 41, type: 'SubHeader', title: 'Part 1', position: 2 }),
      ],
      desired: [{ type: 'SubHeader', title: 'Part 1', position: 2, indent: 0 }],
    });

    assert.equal(result.unchanged.length, 1);
    assert.equal(result.unchanged[0].live.id, 41);
    assert.deepEqual(
      result.leftover.map((item) => item.id),
      [40],
      'the page that happens to share the title is not a subheader',
    );
  });

  it('ties two same-titled subheaders in order of appearance', () => {
    const result = reconcileModuleItems({
      live: [
        live({ id: 50, type: 'SubHeader', title: 'Oefeningen', position: 1 }),
        live({ id: 51, type: 'SubHeader', title: 'Oefeningen', position: 5 }),
      ],
      desired: [
        { type: 'SubHeader', title: 'Oefeningen', position: 1, indent: 0 },
        { type: 'SubHeader', title: 'Oefeningen', position: 5, indent: 0 },
      ],
    });

    assert.equal(result.create.length, 0);
    assert.equal(result.leftover.length, 0);
    assert.deepEqual(
      result.unchanged.map((entry) => entry.live.id),
      [50, 51],
      'first desired takes the first live one, not the closest position',
    );
  });

  it('lets a live item be claimed once only', () => {
    const result = reconcileModuleItems({
      live: [
        live({ id: 60, type: 'Page', title: 'Welcome', page_url: 'welcome' }),
      ],
      desired: [
        { type: 'Page', title: 'Welcome', pageUrl: 'welcome', position: 1 },
        {
          type: 'Page',
          title: 'Welcome again',
          pageUrl: 'welcome',
          position: 2,
        },
      ],
    });

    assert.equal(result.unchanged.length, 1);
    assert.equal(result.create.length, 1);
    assert.equal(result.create[0].index, 1);
  });

  it('leaves a live item of a type it does not know alone', () => {
    const result = reconcileModuleItems({
      live: [live({ id: 70, type: 'SomethingNew', title: 'Mystery' })],
      desired: [],
    });

    assert.deepEqual(
      result.leftover.map((item) => item.id),
      [70],
    );
  });
});

describe('reconcileModuleItems: what counts as an update', () => {
  const page = live({
    id: 80,
    type: 'Page',
    title: 'Welcome',
    page_url: 'welcome',
    position: 3,
    indent: 1,
  });
  const same = {
    type: 'Page',
    title: 'Welcome',
    pageUrl: 'welcome',
    position: 3,
    indent: 1,
  };

  it('issues nothing when title, position and indent all agree', () => {
    const result = reconcileModuleItems({ live: [page], desired: [same] });

    assert.deepEqual(result.create, []);
    assert.deepEqual(result.update, []);
    assert.deepEqual(result.leftover, []);
    assert.equal(result.unchanged.length, 1);
  });

  for (const [field, value] of [
    ['title', 'Welkom'],
    ['position', 4],
    ['indent', 0],
  ]) {
    it(`produces exactly one update when ${field} changed`, () => {
      const result = reconcileModuleItems({
        live: [page],
        desired: [{ ...same, [field]: value }],
      });

      assert.equal(result.update.length, 1);
      assert.equal(result.unchanged.length, 0);
      assert.deepEqual(
        result.update[0].changes,
        { [field]: value },
        'only the field that moved is sent',
      );
    });
  }

  it('treats an absent indent on the Canvas side as 0', () => {
    const result = reconcileModuleItems({
      live: [
        live({
          id: 81,
          type: 'Page',
          title: 'W',
          page_url: 'w',
          indent: undefined,
        }),
      ],
      desired: [
        { type: 'Page', title: 'W', pageUrl: 'w', position: 1, indent: 0 },
      ],
    });

    assert.equal(result.unchanged.length, 1);
  });

  it('sends new_tab when the author flipped it and Canvas reported the old value', () => {
    const result = reconcileModuleItems({
      live: [
        live({
          id: 83,
          type: 'ExternalUrl',
          title: 'Syllabus',
          external_url: 'https://example.com/s',
          new_tab: true,
        }),
      ],
      desired: [
        {
          type: 'ExternalUrl',
          title: 'Syllabus',
          externalUrl: 'https://example.com/s',
          position: 1,
          indent: 0,
          newTab: false,
        },
      ],
    });

    assert.equal(result.update.length, 1);
    assert.deepEqual(result.update[0].changes, { newTab: false });
  });

  it('never writes new_tab over a value Canvas did not report', () => {
    // The desired side reads `frontmatter.new_tab !== false`, so it says true
    // whenever the author said nothing. Reading an unreported new_tab as false
    // would put those two permanently at odds and issue a PUT that changes
    // nothing on every push — the exact failure reconciling exists to end.
    const result = reconcileModuleItems({
      live: [
        live({
          id: 84,
          type: 'ExternalUrl',
          title: 'Syllabus',
          external_url: 'https://example.com/s',
        }),
      ],
      desired: [
        {
          type: 'ExternalUrl',
          title: 'Syllabus',
          externalUrl: 'https://example.com/s',
          position: 1,
          indent: 0,
          newTab: true,
        },
      ],
    });

    assert.equal(result.unchanged.length, 1);
    assert.equal(result.update.length, 0);
  });

  it('says nothing about new_tab when neither side does', () => {
    const result = reconcileModuleItems({
      live: [
        live({
          id: 85,
          type: 'ExternalTool',
          title: 'Wooclap',
          external_url: 'https://app.wooclap.com/x',
        }),
      ],
      desired: [
        {
          type: 'ExternalTool',
          title: 'Wooclap',
          externalUrl: 'https://app.wooclap.com/x',
          position: 1,
          indent: 0,
        },
      ],
    });

    assert.equal(result.unchanged.length, 1);
  });

  it('leaves new_tab out of the comparison for types that have none', () => {
    const result = reconcileModuleItems({
      live: [live({ id: 86, type: 'Page', title: 'W', page_url: 'w' })],
      desired: [
        { type: 'Page', title: 'W', pageUrl: 'w', position: 1, newTab: true },
      ],
    });

    assert.equal(result.unchanged.length, 1);
  });

  it('says nothing about a field the local tree has no opinion on', () => {
    const result = reconcileModuleItems({
      live: [
        live({ id: 82, type: 'Page', title: 'W', page_url: 'w', position: 9 }),
      ],
      desired: [{ type: 'Page', title: 'W', pageUrl: 'w' }],
    });

    assert.equal(
      result.unchanged.length,
      1,
      'no position asked for, none sent',
    );
  });
});

describe('reconcileModuleItems: the edges', () => {
  it('makes everything a create when the module is empty', () => {
    const result = reconcileModuleItems({
      live: [],
      desired: [
        { type: 'SubHeader', title: 'Part 1', position: 1, indent: 0 },
        { type: 'Page', title: 'Welcome', pageUrl: 'welcome', position: 2 },
      ],
    });

    assert.deepEqual(
      result.create.map((entry) => entry.index),
      [0, 1],
    );
    assert.deepEqual(result.leftover, []);
  });

  it('makes everything leftover when the local tree describes nothing', () => {
    const items = [
      live({ id: 90, type: 'Quiz', title: 'Kennischeck', content_id: 777 }),
      live({ id: 91, type: 'Page', title: 'Hand-written', page_url: 'hand' }),
    ];

    const result = reconcileModuleItems({ live: items, desired: [] });

    assert.deepEqual(result.leftover, items);
    assert.deepEqual(result.create, []);
    assert.deepEqual(result.update, []);
  });

  it('survives being handed nothing at all', () => {
    const result = reconcileModuleItems();

    assert.deepEqual(result, {
      create: [],
      update: [],
      unchanged: [],
      leftover: [],
    });
  });

  it('never mutates its inputs', () => {
    const liveItems = [
      live({ id: 92, type: 'Page', title: 'W', page_url: 'w', position: 1 }),
    ];
    const desired = [
      { type: 'Page', title: 'Welkom', pageUrl: 'w', position: 1 },
    ];
    const liveCopy = JSON.parse(JSON.stringify(liveItems));
    const desiredCopy = JSON.parse(JSON.stringify(desired));

    reconcileModuleItems({ live: liveItems, desired });

    assert.deepEqual(liveItems, liveCopy);
    assert.deepEqual(desired, desiredCopy);
  });
});

describe('applyModuleItems', () => {
  /** Record every call the executor makes, in order. */
  function recorder(results = {}) {
    const calls = [];
    return {
      calls,
      deps: {
        createItem: async (courseId, moduleId, item) => {
          calls.push(['create', item.title]);
          if (results.createThrows === item.title)
            throw new Error('422 Unprocessable');
          return { id: results.newId ? results.newId(item) : 999 };
        },
        updateItem: async (courseId, moduleId, itemId, changes) => {
          calls.push(['update', itemId, changes]);
          return { id: itemId };
        },
      },
    };
  }

  it('issues no request at all for an item that is already right', async () => {
    const plan = reconcileModuleItems({
      live: [live({ id: 100, type: 'Page', title: 'W', page_url: 'w' })],
      desired: [{ type: 'Page', title: 'W', pageUrl: 'w', position: 1 }],
    });
    const { calls, deps } = recorder();

    const applied = await applyModuleItems(45083, 580457, plan, deps);

    assert.deepEqual(calls, [], 'a no-op module costs nothing');
    assert.deepEqual(applied.placed, [
      {
        index: 0,
        desired: plan.unchanged[0].desired,
        id: 100,
        action: 'unchanged',
      },
    ]);
  });

  it('creates and updates in the order the module should end up in', async () => {
    const plan = reconcileModuleItems({
      live: [
        live({ id: 101, type: 'SubHeader', title: 'Part 1', position: 1 }),
        live({
          id: 102,
          type: 'Page',
          title: 'Old',
          page_url: 'two',
          position: 2,
        }),
      ],
      desired: [
        { type: 'SubHeader', title: 'Part 1', position: 1, indent: 0 },
        { type: 'Page', title: 'New', pageUrl: 'one', position: 2, indent: 0 },
        { type: 'Page', title: 'Two', pageUrl: 'two', position: 3, indent: 0 },
      ],
    });
    const { calls, deps } = recorder();

    await applyModuleItems(45083, 580457, plan, deps);

    assert.deepEqual(calls, [
      ['create', 'New'],
      ['update', 102, { title: 'Two', position: 3 }],
    ]);
  });

  it('hands back the id of everything placed, in order', async () => {
    const plan = reconcileModuleItems({
      live: [live({ id: 110, type: 'Page', title: 'One', page_url: 'one' })],
      desired: [
        { type: 'Page', title: 'One', pageUrl: 'one', position: 1 },
        { type: 'Page', title: 'Two', pageUrl: 'two', position: 2 },
      ],
    });
    const { deps } = recorder({ newId: () => 111 });

    const applied = await applyModuleItems(45083, 580457, plan, deps);

    assert.deepEqual(
      applied.placed.map((entry) => [entry.index, entry.id, entry.action]),
      [
        [0, 110, 'unchanged'],
        [1, 111, 'create'],
      ],
    );
  });

  it('records a failure and carries on with the rest of the module', async () => {
    const plan = reconcileModuleItems({
      live: [],
      desired: [
        { type: 'Page', title: 'Broken', pageUrl: 'broken', position: 1 },
        { type: 'Page', title: 'Fine', pageUrl: 'fine', position: 2 },
      ],
    });
    const { calls, deps } = recorder({ createThrows: 'Broken' });

    const applied = await applyModuleItems(45083, 580457, plan, deps);

    assert.deepEqual(calls, [
      ['create', 'Broken'],
      ['create', 'Fine'],
    ]);
    assert.equal(applied.errors.length, 1);
    assert.match(applied.errors[0].error, /422 Unprocessable/);
    assert.deepEqual(
      applied.placed.map((entry) => entry.desired.title),
      ['Fine'],
    );
  });

  it('passes leftovers straight through, deleting nothing', async () => {
    const stray = live({
      id: 120,
      type: 'Quiz',
      title: 'Kennischeck',
      content_id: 7,
    });
    const plan = reconcileModuleItems({ live: [stray], desired: [] });
    const { calls, deps } = recorder();

    const applied = await applyModuleItems(45083, 580457, plan, deps);

    assert.deepEqual(calls, []);
    assert.deepEqual(applied.leftover, [stray]);
  });
});

describe('describeLeftoverItem', () => {
  it('names the item, its type, its position and where it lives', () => {
    assert.equal(
      describeLeftoverItem({
        id: 9001,
        type: 'Quiz',
        title: 'Kennischeck hoofdstuk 1',
        position: 15,
        html_url: 'https://canvas.example.com/courses/45083/modules/items/9001',
      }),
      '  - "Kennischeck hoofdstuk 1" (Quiz, position 15) — ' +
        'https://canvas.example.com/courses/45083/modules/items/9001',
    );
  });

  it('drops what Canvas did not return', () => {
    assert.equal(
      describeLeftoverItem({ type: 'Discussion' }),
      '  - "(untitled)" (Discussion)',
    );
  });
});
