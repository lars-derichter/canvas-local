const { describe, it, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { mockCanvas, silence } = require('../helpers/canvas-mock');

// Set required env vars before requiring anything that loads the client.
process.env.CANVAS_API_URL = 'https://canvas.example.com';
process.env.CANVAS_API_TOKEN = 'test-token-123';

const push = require('../../cli/push');

const {
  _collectDeletedModules: collectDeletedModules,
  _collectDeletedItems: collectDeletedItems,
  _collectLocalPaths: collectLocalPaths,
  _annotateSubmissions: annotateSubmissions,
  _describeDoomedItem: describeDoomedItem,
  _submissionRiskNoun: submissionRiskNoun,
  _deleteCanvasItemByType: deleteCanvasItemByType,
  _refuseQuizBackedDelete: refuseQuizBackedDelete,
} = push;

describe('collectDeletedModules', () => {
  it('returns modules in sync state that no local folder holds', () => {
    const syncData = {
      modules: {
        '01-intro': { canvas_module_id: 100, items: {} },
        '02-setup': { canvas_module_id: 200, items: {} },
        '03-deleted': { canvas_module_id: 300, items: {} },
      },
    };
    const localModules = [
      { folderName: '01-intro' },
      { folderName: '02-setup' },
    ];

    const result = collectDeletedModules(syncData, localModules);

    assert.equal(result.length, 1);
    assert.equal(result[0].folder, '03-deleted');
    assert.equal(result[0].canvasModuleId, 300);
  });

  it('returns empty array when all sync modules exist locally', () => {
    const syncData = {
      modules: { '01-intro': { canvas_module_id: 100, items: {} } },
    };
    const localModules = [{ folderName: '01-intro' }];

    assert.deepEqual(collectDeletedModules(syncData, localModules), []);
  });

  it('keeps a module whose folder is there, with no _category_.json involved', () => {
    // The folder name is the key. Nothing reads the module folder from disk,
    // which is the point: there is no second copy of the id to disagree with.
    const syncData = {
      modules: { '02-renamed-locally': { canvas_module_id: 200, items: {} } },
    };
    const localModules = [{ folderName: '02-renamed-locally' }];

    assert.deepEqual(collectDeletedModules(syncData, localModules), []);
  });
});

describe('collectLocalPaths', () => {
  it('collects the path of every item, whatever its type', () => {
    const paths = collectLocalPaths([
      {
        folderName: '01-intro',
        items: [
          { relativePath: '01-intro/01-a.md', canvasType: 'page' },
          { relativePath: '01-intro/02-b.md', canvasType: 'assignment' },
          { relativePath: '01-intro/03-c.pdf', canvasType: 'file' },
        ],
      },
    ]);

    assert.deepEqual([...paths].sort(), [
      '01-intro/01-a.md',
      '01-intro/02-b.md',
      '01-intro/03-c.pdf',
    ]);
  });

  it('looks inside subheaders', () => {
    const paths = collectLocalPaths([
      {
        folderName: '01-intro',
        items: [
          { relativePath: '01-intro/01-top.md', canvasType: 'page' },
          {
            type: 'subheader',
            title: 'Sub',
            items: [
              {
                relativePath: '01-intro/01-sub/01-nested.md',
                canvasType: 'page',
              },
            ],
          },
        ],
      },
    ]);

    assert.ok(paths.has('01-intro/01-sub/01-nested.md'));
    assert.equal(paths.size, 2, 'a text header is not a path');
  });

  it('stores a Windows path the way the sync state keys it', () => {
    const paths = collectLocalPaths([
      {
        folderName: '01-intro',
        items: [
          {
            relativePath: '01-intro\\01-sub\\01-nested.md',
            canvasType: 'page',
          },
        ],
      },
    ]);

    assert.ok(paths.has('01-intro/01-sub/01-nested.md'));
  });
});

describe('collectDeletedItems', () => {
  /** A module entry as v4 keys it, with rows keyed by repo-relative path. */
  function syncModule(
    items,
    { folder = '01-intro', canvasModuleId = 100 } = {},
  ) {
    return {
      modules: {
        [folder]: { canvas_module_id: canvasModuleId, items },
      },
    };
  }

  it('returns rows whose file is no longer in the tree', () => {
    const syncData = syncModule({
      '01-intro/01-welcome.md': {
        canvas_type: 'page',
        canvas_id: 'welcome-page',
        page_url: 'welcome-page',
      },
      '01-intro/02-deleted.md': {
        canvas_type: 'page',
        canvas_id: 'deleted-page',
        page_url: 'deleted-page',
      },
      '01-intro/03-assignment.md': {
        canvas_type: 'assignment',
        canvas_id: 500,
      },
    });
    const localModules = [
      {
        folderName: '01-intro',
        items: [
          {
            relativePath: '01-intro/01-welcome.md',
            title: 'Welcome',
            canvasType: 'page',
            frontmatter: {},
          },
        ],
      },
    ];

    const result = collectDeletedItems(syncData, localModules);

    assert.equal(result.length, 2);
    const paths = result.map((r) => r.relativePath).sort();
    assert.deepStrictEqual(paths, [
      '01-intro/02-deleted.md',
      '01-intro/03-assignment.md',
    ]);
  });

  it('leaves a row alone once the rename has been recorded', () => {
    // A renaming command calls `renamePath`, so the row moves with the file and
    // there is nothing here to notice. What a rename must never do is leave the
    // row where it was — see the next case for what that costs.
    const syncData = syncModule({
      '01-intro/05-hello.md': {
        canvas_type: 'page',
        canvas_id: 'welcome-page',
        page_url: 'welcome-page',
      },
    });
    const localModules = [
      {
        folderName: '01-intro',
        items: [
          {
            relativePath: '01-intro/05-hello.md',
            title: 'Hello',
            canvasType: 'page',
            frontmatter: {},
          },
        ],
      },
    ];

    assert.deepEqual(collectDeletedItems(syncData, localModules), []);
  });

  it('reads a rename the sync state never heard about as a deletion', () => {
    // The path is the identity, so a file moved behind the tool's back leaves a
    // row addressing nothing. Prune lists it, names it, and asks before
    // deleting anything — but it is listed, and that is the price of the key.
    const syncData = syncModule({
      '01-intro/01-welcome.md': {
        canvas_type: 'page',
        canvas_id: 'welcome-page',
        page_url: 'welcome-page',
      },
    });
    const localModules = [
      {
        folderName: '01-intro',
        items: [
          {
            relativePath: '01-intro/05-hello.md',
            title: 'Hello',
            canvasType: 'page',
            frontmatter: {},
          },
        ],
      },
    ];

    const result = collectDeletedItems(syncData, localModules);

    assert.equal(result.length, 1);
    assert.equal(result[0].relativePath, '01-intro/01-welcome.md');
  });

  it('skips modules without items in sync state', () => {
    const syncData = { modules: { '01-intro': { canvas_module_id: 100 } } };
    const localModules = [{ folderName: '01-intro', items: [] }];

    assert.deepEqual(collectDeletedItems(syncData, localModules), []);
  });

  it('skips a folder the sync state does not know at all', () => {
    const syncData = { modules: {} };
    const localModules = [{ folderName: '01-intro', items: [] }];

    assert.deepEqual(collectDeletedItems(syncData, localModules), []);
  });

  it('handles subfolder items correctly', () => {
    const syncData = syncModule({
      '01-intro/01-sub/01-nested.md': {
        canvas_type: 'page',
        canvas_id: 'nested',
        page_url: 'nested',
      },
      '01-intro/01-sub/02-gone.md': {
        canvas_type: 'page',
        canvas_id: 'gone',
        page_url: 'gone',
      },
    });
    const localModules = [
      {
        folderName: '01-intro',
        items: [
          {
            type: 'subheader',
            title: 'Sub',
            items: [
              {
                relativePath: '01-intro/01-sub/01-nested.md',
                title: 'Nested',
                canvasType: 'page',
                frontmatter: {},
              },
            ],
          },
        ],
      },
    ];

    const result = collectDeletedItems(syncData, localModules);

    assert.equal(result.length, 1);
    assert.equal(result[0].relativePath, '01-intro/01-sub/02-gone.md');
  });

  it('includes all item types', () => {
    const syncData = syncModule(
      {
        '01-mod/01-page.md': {
          canvas_type: 'page',
          canvas_id: 'slug',
          page_url: 'slug',
        },
        '01-mod/02-assign.md': { canvas_type: 'assignment', canvas_id: 200 },
        '01-mod/03-link.md': {
          canvas_type: 'external_url',
          canvas_id: 42,
          external_url: 'http://example.com',
        },
        '01-mod/04-doc.pdf': { canvas_type: 'file', canvas_id: 400 },
      },
      { folder: '01-mod' },
    );
    const localModules = [{ folderName: '01-mod', items: [] }];

    const result = collectDeletedItems(syncData, localModules);

    assert.equal(result.length, 4);
    const types = result.map((r) => r.canvasType).sort();
    assert.deepStrictEqual(types, [
      'assignment',
      'external_url',
      'file',
      'page',
    ]);
  });
});

describe('collectDeletedItems per type', () => {
  /** One module's worth of sync state, folder-keyed. */
  function syncModule(items) {
    return { modules: { '01-mod': { canvas_module_id: 100, items } } };
  }
  const emptyLocal = [{ folderName: '01-mod', items: [] }];

  it('collects page items with pageUrl for deletion', () => {
    const items = collectDeletedItems(
      syncModule({
        '01-mod/01-page.md': {
          canvas_type: 'page',
          canvas_id: 'my-page',
          page_url: 'my-page',
        },
      }),
      emptyLocal,
    );

    assert.equal(items.length, 1);
    assert.equal(items[0].canvasType, 'page');
    assert.equal(items[0].canvasId, 'my-page');
    assert.equal(items[0].pageUrl, 'my-page');
  });

  it('collects assignment items for deletion', () => {
    const items = collectDeletedItems(
      syncModule({
        '01-mod/01-hw.md': { canvas_type: 'assignment', canvas_id: 999 },
      }),
      emptyLocal,
    );

    assert.equal(items.length, 1);
    assert.equal(items[0].canvasType, 'assignment');
    assert.equal(items[0].canvasId, 999);
  });

  it('collects file items for deletion', () => {
    const items = collectDeletedItems(
      syncModule({
        '01-mod/doc.pdf': { canvas_type: 'file', canvas_id: 777 },
      }),
      emptyLocal,
    );

    assert.equal(items.length, 1);
    assert.equal(items[0].canvasType, 'file');
    assert.equal(items[0].canvasId, 777);
  });

  it('collects a quiz item with the module it has to be unlinked from', () => {
    const items = collectDeletedItems(
      syncModule({
        '01-mod/05-test.md': { canvas_type: 'quiz', canvas_id: 12 },
      }),
      emptyLocal,
    );

    assert.equal(items.length, 1);
    assert.equal(items[0].canvasType, 'quiz');
    assert.equal(items[0].canvasId, 12);
    assert.equal(
      items[0].moduleId,
      100,
      'the module id is what the quiz branch needs: it deletes the item, not the quiz',
    );
  });

  it('leaves a quiz item alone while its file is still there', () => {
    const syncData = syncModule({
      '01-mod/05-test.md': { canvas_type: 'quiz', canvas_id: 12 },
    });
    const localModules = [
      {
        folderName: '01-mod',
        items: [
          {
            relativePath: '01-mod/05-test.md',
            title: 'Test 1',
            canvasType: 'quiz',
            frontmatter: {},
          },
        ],
      },
    ];

    assert.deepEqual(collectDeletedItems(syncData, localModules), []);
  });

  it('collects external_url items with moduleId and externalUrl for deletion', () => {
    const items = collectDeletedItems(
      syncModule({
        '01-mod/01-link.md': {
          canvas_type: 'external_url',
          canvas_id: 42,
          external_url: 'http://example.com',
        },
      }),
      emptyLocal,
    );

    assert.equal(items.length, 1);
    assert.equal(items[0].canvasType, 'external_url');
    assert.equal(items[0].moduleId, 100);
    assert.equal(items[0].externalUrl, 'http://example.com');
  });
});

describe('annotateSubmissions', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  const states = new Map([
    ['500', true],
    ['501', false],
  ]);

  it('flags a doomed assignment that has student submissions', async () => {
    const items = [
      {
        relativePath: '01-mod/01-hw.md',
        canvasType: 'assignment',
        canvasId: 500,
      },
    ];

    await annotateSubmissions(42, items, async () => states);

    assert.equal(items[0].hasSubmissions, true);
  });

  it('does not flag a doomed assignment without submissions', async () => {
    const items = [
      {
        relativePath: '01-mod/02-hw.md',
        canvasType: 'assignment',
        canvasId: 501,
      },
    ];

    await annotateSubmissions(42, items, async () => states);

    assert.equal(items[0].hasSubmissions, false);
  });

  it('treats an assignment Canvas no longer lists as nothing left to lose', async () => {
    const items = [
      {
        relativePath: '01-mod/03-hw.md',
        canvasType: 'assignment',
        canvasId: 777,
      },
    ];

    await annotateSubmissions(42, items, async () => states);

    assert.equal(items[0].hasSubmissions, false);
  });

  it('marks the state unknown when the lookup fails', async () => {
    mock.method(console, 'warn', () => {});
    const items = [
      {
        relativePath: '01-mod/01-hw.md',
        canvasType: 'assignment',
        canvasId: 500,
      },
    ];

    await annotateSubmissions(42, items, async () => {
      throw new Error('403 Forbidden');
    });

    assert.equal(
      items[0].hasSubmissions,
      null,
      'a failed check must never read as "no submissions"',
    );
  });

  it('makes no request when no assignment is being deleted', async () => {
    const items = [
      {
        relativePath: '01-mod/01-page.md',
        canvasType: 'page',
        canvasId: 'slug',
      },
      { relativePath: '01-mod/doc.pdf', canvasType: 'file', canvasId: 400 },
    ];

    await annotateSubmissions(42, items, async () => {
      throw new Error('the submission lookup should not have run');
    });

    assert.equal(items[0].hasSubmissions, undefined);
    assert.equal(items[1].hasSubmissions, undefined);
  });

  it('looks the whole course up once for many doomed assignments', async () => {
    let calls = 0;
    const items = [
      {
        relativePath: '01-mod/01-hw.md',
        canvasType: 'assignment',
        canvasId: 500,
      },
      {
        relativePath: '01-mod/02-hw.md',
        canvasType: 'assignment',
        canvasId: 501,
      },
      {
        relativePath: '01-mod/01-page.md',
        canvasType: 'page',
        canvasId: 'slug',
      },
    ];

    await annotateSubmissions(42, items, async () => {
      calls++;
      return states;
    });

    assert.equal(calls, 1);
  });
});

describe('annotateSubmissions: discussions', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  // 500 is the assignment behind the graded topic 88; 501 the one behind 89.
  const states = new Map([
    ['500', true],
    ['501', false],
  ]);

  /** A doomed discussion item as prune collects it: canvasId is the topic id. */
  function discussion(canvasId, name = 'forum') {
    return {
      relativePath: `01-mod/${name}.md`,
      canvasType: 'discussion',
      canvasId,
    };
  }

  /** Answer topic fetches from a table keyed by topic id. */
  function topics(table) {
    return async (courseId, id) => {
      const topic = table[String(id)];
      if (!topic) throw new Error(`404 Not Found: topic ${id}`);
      return topic;
    };
  }

  it('flags a graded discussion whose assignment has student submissions', async () => {
    const items = [discussion(88)];

    await annotateSubmissions(
      42,
      items,
      async () => states,
      topics({ 88: { id: 88, title: 'Week 1', assignment_id: 500 } }),
    );

    assert.equal(
      items[0].hasSubmissions,
      true,
      'the grades hang off the assignment behind the topic, not off the topic id',
    );
  });

  it('resolves the assignment through a nested assignment object too', async () => {
    const items = [discussion(88)];

    await annotateSubmissions(
      42,
      items,
      async () => states,
      topics({ 88: { id: 88, assignment: { id: 500, name: 'Week 1' } } }),
    );

    assert.equal(items[0].hasSubmissions, true);
  });

  it('does not flag a graded discussion without submissions', async () => {
    const items = [discussion(89)];

    await annotateSubmissions(
      42,
      items,
      async () => states,
      topics({ 89: { id: 89, assignment_id: 501 } }),
    );

    assert.equal(items[0].hasSubmissions, false);
  });

  it('reads an ungraded discussion as a real no, not an unknown', async () => {
    const items = [discussion(90)];

    await annotateSubmissions(
      42,
      items,
      async () => states,
      topics({ 90: { id: 90, title: 'Chat', assignment_id: null } }),
    );

    assert.equal(
      items[0].hasSubmissions,
      false,
      'an ungraded topic has no gradebook column, so there is nothing to warn about',
    );
  });

  it('never looks up an assignment when only ungraded topics are doomed', async () => {
    const items = [discussion(90)];

    await annotateSubmissions(
      42,
      items,
      async () => {
        throw new Error('the submission lookup should not have run');
      },
      topics({ 90: { id: 90, assignment_id: null } }),
    );

    assert.equal(items[0].hasSubmissions, false);
  });

  it('marks the state unknown when the topic fetch fails', async () => {
    mock.method(console, 'warn', () => {});
    const items = [discussion(88)];

    await annotateSubmissions(
      42,
      items,
      async () => states,
      async () => {
        throw new Error('403 Forbidden');
      },
    );

    assert.equal(
      items[0].hasSubmissions,
      null,
      'a topic that could not be read may well be a graded one',
    );
  });

  it('marks the state unknown when the assignment lookup fails', async () => {
    mock.method(console, 'warn', () => {});
    const items = [discussion(88)];

    await annotateSubmissions(
      42,
      items,
      async () => {
        throw new Error('403 Forbidden');
      },
      topics({ 88: { id: 88, assignment_id: 500 } }),
    );

    assert.equal(items[0].hasSubmissions, null);
  });

  it('marks the state unknown when a graded topic names no assignment', async () => {
    const items = [discussion(88)];

    await annotateSubmissions(
      42,
      items,
      async () => states,
      topics({ 88: { id: 88, assignment: { name: 'no id here' } } }),
    );

    assert.equal(items[0].hasSubmissions, null);
  });

  it('marks the state unknown when the named assignment is not listed', async () => {
    const items = [discussion(88)];

    await annotateSubmissions(
      42,
      items,
      async () => states,
      topics({ 88: { id: 88, assignment_id: 999 } }),
    );

    assert.equal(
      items[0].hasSubmissions,
      null,
      'the topic exists and says it is graded, so an unresolvable assignment id ' +
        'is an unanswered question, not a clean bill of health',
    );
  });

  it('looks the whole course up once for assignments and discussions together', async () => {
    let stateCalls = 0;
    const fetched = [];
    const items = [
      {
        relativePath: '01-mod/01-hw.md',
        canvasType: 'assignment',
        canvasId: 500,
      },
      discussion(88, 'forum-a'),
      discussion(89, 'forum-b'),
      {
        relativePath: '01-mod/01-page.md',
        canvasType: 'page',
        canvasId: 'slug',
      },
    ];

    await annotateSubmissions(
      42,
      items,
      async () => {
        stateCalls++;
        return states;
      },
      async (courseId, id) => {
        fetched.push(id);
        return { id, assignment_id: id === 88 ? 500 : 501 };
      },
    );

    assert.equal(stateCalls, 1, 'one list request answers it for every item');
    assert.deepEqual(
      fetched,
      [88, 89],
      'only the doomed topics are fetched, one request each',
    );
    assert.deepEqual(
      items.map((item) => item.hasSubmissions),
      [true, true, false, undefined],
    );
  });

  it('keeps the reply count off the topic it already fetched', async () => {
    const items = [discussion(90)];

    await annotateSubmissions(
      42,
      items,
      async () => states,
      topics({
        90: { id: 90, assignment_id: null, discussion_subentry_count: 14 },
      }),
    );

    assert.equal(
      items[0].replyCount,
      14,
      'an ungraded topic loses no grades but still loses every reply',
    );
  });

  it('keeps the reply count for a graded topic too', async () => {
    const items = [discussion(88)];

    await annotateSubmissions(
      42,
      items,
      async () => states,
      topics({
        88: { id: 88, assignment_id: 500, discussion_subentry_count: 3 },
      }),
    );

    assert.equal(items[0].hasSubmissions, true);
    assert.equal(items[0].replyCount, 3);
  });

  it('leaves the reply count unset when Canvas omits it', async () => {
    const items = [discussion(90)];

    await annotateSubmissions(
      42,
      items,
      async () => states,
      topics({ 90: { id: 90, assignment_id: null } }),
    );

    assert.equal(items[0].replyCount, undefined);
  });

  it('leaves the reply count unset when the topic could not be read', async () => {
    mock.method(console, 'warn', () => {});
    const items = [discussion(91)];

    await annotateSubmissions(42, items, async () => states, topics({}));

    assert.equal(items[0].hasSubmissions, null);
    assert.equal(items[0].replyCount, undefined);
  });

  it('fetches no topic that is not slated for deletion', async () => {
    const items = [
      {
        relativePath: '01-mod/01-page.md',
        canvasType: 'page',
        canvasId: 'slug',
      },
      { relativePath: '01-mod/doc.pdf', canvasType: 'file', canvasId: 400 },
    ];

    await annotateSubmissions(
      42,
      items,
      async () => {
        throw new Error('the submission lookup should not have run');
      },
      async () => {
        throw new Error('no topic should have been fetched');
      },
    );

    assert.equal(items[0].hasSubmissions, undefined);
    assert.equal(items[1].hasSubmissions, undefined);
  });
});

describe('describeDoomedItem', () => {
  it('names the grades on an assignment that has submissions', () => {
    const line = describeDoomedItem({
      relativePath: '01-mod/01-hw.md',
      canvasType: 'assignment',
      hasSubmissions: true,
    });

    assert.match(line, /HAS STUDENT SUBMISSIONS/);
    assert.match(line, /gradebook column/);
    assert.match(line, /01-mod\/01-hw\.md/);
  });

  it('leaves an assignment without submissions unmarked', () => {
    const line = describeDoomedItem({
      relativePath: '01-mod/02-hw.md',
      canvasType: 'assignment',
      hasSubmissions: false,
    });

    assert.equal(line, '  - 01-mod/02-hw.md (assignment)');
  });

  it('says so when the submission status could not be determined', () => {
    const line = describeDoomedItem({
      relativePath: '01-mod/03-hw.md',
      canvasType: 'assignment',
      hasSubmissions: null,
    });

    assert.match(line, /SUBMISSION STATUS UNKNOWN/);
    assert.match(line, /assume grades will be lost/);
  });

  it('leaves other item types as they were', () => {
    assert.equal(
      describeDoomedItem({
        relativePath: '01-mod/01-page.md',
        canvasType: 'page',
      }),
      '  - 01-mod/01-page.md (page)',
    );
  });

  it('names the replies as well as the grades on a graded discussion', () => {
    const line = describeDoomedItem({
      relativePath: '01-mod/06-forum.md',
      canvasType: 'discussion',
      hasSubmissions: true,
    });

    assert.match(line, /GRADED DISCUSSION WITH STUDENT WORK/);
    assert.match(
      line,
      /every student reply/,
      'deleting the topic costs more than a gradebook column',
    );
    assert.match(line, /every grade/);
    assert.match(line, /01-mod\/06-forum\.md/);
  });

  it('counts the replies when Canvas gave a count', () => {
    const line = describeDoomedItem({
      relativePath: '01-mod/06-forum.md',
      canvasType: 'discussion',
      hasSubmissions: true,
      replyCount: 14,
    });

    assert.match(line, /deletes the topic and its 14 replies/);
    assert.match(line, /the gradebook column and every grade/);
  });

  it('leaves an empty discussion unmarked', () => {
    assert.equal(
      describeDoomedItem({
        relativePath: '01-mod/07-forum.md',
        canvasType: 'discussion',
        hasSubmissions: false,
        replyCount: 0,
      }),
      '  - 01-mod/07-forum.md (discussion)',
      'no grades and nothing written in it: there is nothing to warn about',
    );
  });

  it('leaves an unmeasured discussion unmarked', () => {
    assert.equal(
      describeDoomedItem({
        relativePath: '01-mod/07-forum.md',
        canvasType: 'discussion',
        hasSubmissions: false,
      }),
      '  - 01-mod/07-forum.md (discussion)',
    );
  });

  it('names the replies an ungraded discussion still takes with it', () => {
    const line = describeDoomedItem({
      relativePath: '01-mod/07-forum.md',
      canvasType: 'discussion',
      hasSubmissions: false,
      replyCount: 14,
    });

    assert.match(line, /14 REPLIES FROM STUDENTS/);
    assert.match(
      line,
      /no grades at stake/,
      'the reader must not read this as a grade warning',
    );
    assert.match(line, /deleting the topic still deletes every one of them/);
  });

  it('agrees with a single reply', () => {
    const line = describeDoomedItem({
      relativePath: '01-mod/07-forum.md',
      canvasType: 'discussion',
      hasSubmissions: false,
      replyCount: 1,
    });

    assert.match(line, /1 REPLY FROM STUDENTS/);
  });

  it('says so when a discussion could not be checked', () => {
    const line = describeDoomedItem({
      relativePath: '01-mod/08-forum.md',
      canvasType: 'discussion',
      hasSubmissions: null,
    });

    assert.match(line, /SUBMISSION STATUS UNKNOWN/);
    assert.match(line, /assume it is graded/);
    assert.match(line, /replies and grades will be lost/);
  });

  it('still counts the replies when only the grade check failed', () => {
    const line = describeDoomedItem({
      relativePath: '01-mod/08-forum.md',
      canvasType: 'discussion',
      hasSubmissions: null,
      replyCount: 14,
    });

    assert.match(line, /SUBMISSION STATUS UNKNOWN/);
    assert.match(line, /its 14 replies and the grades will be lost/);
  });
});

describe('submissionRiskNoun', () => {
  it('says "assignment" when only assignments are counted', () => {
    assert.equal(
      submissionRiskNoun([
        { canvasType: 'assignment' },
        { canvasType: 'assignment' },
      ]),
      'assignment',
    );
  });

  it('says "item" as soon as a discussion is counted', () => {
    assert.equal(
      submissionRiskNoun([
        { canvasType: 'assignment' },
        { canvasType: 'discussion' },
      ]),
      'item',
      'the count covers both, so naming one of them would be a false line',
    );
  });

  it('says "item" for discussions alone', () => {
    assert.equal(submissionRiskNoun([{ canvasType: 'discussion' }]), 'item');
  });

  it('does not care whether the discussion turned out graded', () => {
    assert.equal(
      submissionRiskNoun([{ canvasType: 'discussion', hasSubmissions: false }]),
      'item',
    );
  });

  it('handles an empty or missing list', () => {
    assert.equal(submissionRiskNoun([]), 'assignment');
    assert.equal(submissionRiskNoun(undefined), 'assignment');
  });
});

describe('collectDeletedItems with multiple modules', () => {
  it('collects items across multiple modules', () => {
    const syncData = {
      modules: {
        '01-intro': {
          canvas_module_id: 100,
          items: {
            '01-intro/01-page.md': { canvas_type: 'page', canvas_id: 'page-1' },
            '01-intro/02-deleted.md': {
              canvas_type: 'page',
              canvas_id: 'page-2',
            },
          },
        },
        '02-setup': {
          canvas_module_id: 200,
          items: {
            '02-setup/01-install.md': {
              canvas_type: 'page',
              canvas_id: 'install',
            },
            '02-setup/02-gone.md': {
              canvas_type: 'assignment',
              canvas_id: 300,
            },
          },
        },
      },
    };
    const localModules = [
      {
        folderName: '01-intro',
        items: [
          {
            relativePath: '01-intro/01-page.md',
            title: 'Page',
            canvasType: 'page',
            frontmatter: {},
          },
        ],
      },
      {
        folderName: '02-setup',
        items: [
          {
            relativePath: '02-setup/01-install.md',
            title: 'Install',
            canvasType: 'page',
            frontmatter: {},
          },
        ],
      },
    ];

    const result = collectDeletedItems(syncData, localModules);

    assert.equal(result.length, 2);
    assert.ok(result.some((r) => r.relativePath === '01-intro/02-deleted.md'));
    assert.ok(result.some((r) => r.relativePath === '02-setup/02-gone.md'));
  });

  it('only checks filtered modules', () => {
    const syncData = {
      modules: {
        '01-intro': {
          canvas_module_id: 100,
          items: {
            '01-intro/01-deleted.md': {
              canvas_type: 'page',
              canvas_id: 'page-1',
            },
          },
        },
        '02-setup': {
          canvas_module_id: 200,
          items: {
            '02-setup/01-deleted.md': {
              canvas_type: 'page',
              canvas_id: 'page-2',
            },
          },
        },
      },
    };
    // Only filtering to 01-intro
    const filteredModules = [{ folderName: '01-intro', items: [] }];

    const result = collectDeletedItems(syncData, filteredModules);

    // Should only find the deleted item in 01-intro, not 02-setup
    assert.equal(result.length, 1);
    assert.equal(result[0].folder, '01-intro');
    assert.equal(result[0].moduleId, 100);
  });

  it('never mistakes a move into an unfiltered module for a deletion', () => {
    // Claims are gathered from every module the run scanned, not only the ones
    // it pushes, so a file that left 01-intro for 02-setup is still claimed.
    const syncData = {
      modules: {
        '01-intro': {
          canvas_module_id: 100,
          items: {
            '01-intro/01-page.md': { canvas_type: 'page', canvas_id: 'page-1' },
          },
        },
      },
    };
    const filtered = [{ folderName: '01-intro', items: [] }];
    const all = [
      ...filtered,
      {
        folderName: '02-setup',
        items: [
          {
            relativePath: '01-intro/01-page.md',
            title: 'Page',
            canvasType: 'page',
            frontmatter: {},
          },
        ],
      },
    ];

    assert.deepEqual(collectDeletedItems(syncData, filtered, all), []);
  });
});

describe('deleteCanvasItemByType: quiz', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  const quizItem = {
    moduleIdKey: '9',
    itemKey: 'quiz:12',
    moduleId: 9,
    relativePath: '01-mod/05-test.md',
    canvasId: 12,
    canvasType: 'quiz',
  };

  it('removes the module item and never touches the quiz', async () => {
    silence();
    const calls = mockCanvas([
      {
        method: 'GET',
        path: '/modules/9/items',
        body: [
          { id: 76, type: 'Page', page_url: 'welcome' },
          { id: 77, type: 'Quiz', content_id: 12 },
        ],
      },
      { method: 'DELETE', path: '/modules/9/items/77', body: {} },
    ]);
    const errors = [];

    const ok = await deleteCanvasItemByType(42, quizItem, errors);

    assert.equal(ok, true);
    assert.deepEqual(errors, []);
    assert.deepEqual(
      calls.map((c) => `${c.method} ${c.url}`),
      [
        'GET https://canvas.example.com/api/v1/courses/42/modules/9/items',
        'DELETE https://canvas.example.com/api/v1/courses/42/modules/9/items/77',
      ],
    );
    assert.ok(
      !calls.some((c) => /\/quizzes\b/.test(c.url)),
      'pruning a quiz item must never issue a request against the quiz object',
    );
  });

  it('deletes nothing when the module no longer holds the quiz item', async () => {
    silence();
    const calls = mockCanvas([
      { method: 'GET', path: '/modules/9/items', body: [] },
    ]);
    const errors = [];

    const ok = await deleteCanvasItemByType(42, quizItem, errors);

    assert.equal(ok, true, 'already gone counts as done, as it does elsewhere');
    assert.deepEqual(errors, []);
    assert.ok(
      !calls.some((c) => c.method === 'DELETE'),
      'nothing is deleted when the item that named the quiz is not there',
    );
  });

  it('matches the module item by content_id, not by position', async () => {
    silence();
    const calls = mockCanvas([
      {
        method: 'GET',
        path: '/modules/9/items',
        body: [
          { id: 80, type: 'Quiz', content_id: 44 },
          { id: 81, type: 'Quiz', content_id: 12 },
        ],
      },
      { method: 'DELETE', path: '/modules/9/items/81', body: {} },
    ]);

    const ok = await deleteCanvasItemByType(42, quizItem, []);

    assert.equal(ok, true);
    assert.ok(
      calls.some(
        (c) => c.method === 'DELETE' && c.url.endsWith('/modules/9/items/81'),
      ),
      'the other quiz in the module must be left where it is',
    );
  });
});

describe('deleteCanvasItemByType: assignment', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  const assignmentItem = {
    moduleIdKey: '9',
    itemKey: 'assignment:500',
    moduleId: 9,
    relativePath: '01-mod/03-homework.md',
    canvasId: 500,
    canvasType: 'assignment',
  };

  it('deletes an ordinary assignment', async () => {
    silence();
    const calls = mockCanvas([
      {
        method: 'GET',
        path: '/assignments/500',
        body: { id: 500, name: 'Homework', is_quiz_assignment: false },
      },
      { method: 'DELETE', path: '/assignments/500', body: {} },
    ]);
    const errors = [];

    const ok = await deleteCanvasItemByType(42, assignmentItem, errors);

    assert.equal(ok, true);
    assert.deepEqual(errors, []);
    assert.ok(calls.some((c) => c.method === 'DELETE'));
  });

  it('refuses to delete the assignment that fronts a quiz', async () => {
    const errored = silence().error;
    const calls = mockCanvas([
      {
        method: 'GET',
        path: '/assignments/500',
        body: {
          id: 500,
          name: 'Test 1',
          is_quiz_assignment: true,
          quiz_id: 12,
          submission_types: ['online_quiz'],
        },
      },
    ]);
    const errors = [];

    const ok = await deleteCanvasItemByType(42, assignmentItem, errors);

    assert.equal(ok, false);
    assert.ok(
      !calls.some((c) => c.method === 'DELETE'),
      'deleting that assignment would delete the quiz with it',
    );
    assert.equal(errors.length, 1);
    assert.equal(errors[0].module, '01-mod/03-homework.md');
    assert.match(errors[0].error, /not deleted/);
    assert.match(errors[0].error, /quiz 12/);

    const said = errored.mock.calls.map((c) => c.arguments[0]).join('\n');
    assert.match(said, /Refusing to delete/);
    assert.match(said, /every submission on it/);
    assert.match(said, /canvas_type: quiz/);
  });

  it('refuses when the check itself could not be made', async () => {
    silence();
    const calls = mockCanvas([
      {
        method: 'GET',
        path: '/assignments/500',
        body: { message: 'forbidden' },
        status: 403,
      },
    ]);
    const errors = [];

    const ok = await deleteCanvasItemByType(42, assignmentItem, errors);

    assert.equal(ok, false, 'could not tell is not permission to delete');
    assert.ok(!calls.some((c) => c.method === 'DELETE'));
    assert.equal(errors.length, 1);
    assert.match(errors[0].error, /could not check/);
  });

  it('treats an assignment Canvas no longer has as already deleted', async () => {
    silence();
    mockCanvas([
      {
        method: 'GET',
        path: '/assignments/500',
        body: { message: 'not found' },
        status: 404,
      },
      {
        method: 'DELETE',
        path: '/assignments/500',
        body: { message: 'not found' },
        status: 404,
      },
    ]);
    const errors = [];

    const ok = await deleteCanvasItemByType(42, assignmentItem, errors);

    assert.equal(ok, true, 'a 404 is not a refusal: there is nothing left');
    assert.deepEqual(errors, []);
  });
});

describe('refuseQuizBackedDelete', () => {
  const item = { canvasId: 500, relativePath: '01-mod/03-homework.md' };

  it('allows an ordinary assignment through', async () => {
    assert.equal(
      await refuseQuizBackedDelete(42, item, async () => ({
        id: 500,
        is_quiz_assignment: false,
      })),
      null,
    );
  });

  it('allows a New Quiz through: it is an assignment and nothing else', async () => {
    assert.equal(
      await refuseQuizBackedDelete(42, item, async () => ({
        id: 500,
        is_quiz_lti_assignment: true,
        submission_types: ['external_tool'],
      })),
      null,
    );
  });

  it('names the quiz it is protecting', async () => {
    const refusal = await refuseQuizBackedDelete(42, item, async () => ({
      id: 500,
      quiz_id: 12,
    }));

    assert.match(refusal.lines[0], /gradebook half of quiz 12/);
    assert.match(refusal.error, /quiz 12/);
  });

  it('refuses without a quiz id too', async () => {
    const refusal = await refuseQuizBackedDelete(42, item, async () => ({
      id: 500,
      is_quiz_assignment: true,
    }));

    assert.match(refusal.lines[0], /gradebook half of a quiz/);
  });
});
