const { describe, it, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { mockCanvas, silence } = require('../helpers/canvas-mock');

// Set before anything that loads the Canvas client reads them.
process.env.CANVAS_API_URL = 'https://canvas.example.com';
process.env.CANVAS_API_TOKEN = 'test-token-123';

const {
  gatherCanvas,
  gatherLocal,
  gitDirtyPaths,
  subHeaderHash,
} = require('../../lib/sync/gather');
const { hashLocalFile } = require('../../lib/sync/fingerprint');

const COURSE_ID = 4242;

afterEach(() => mock.restoreAll());

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function tempCourse(tree) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gather-test-'));
  for (const [relative, contents] of Object.entries(tree)) {
    const full = path.join(dir, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents, 'utf8');
  }
  return dir;
}

/** Every path clean, which is the answer that lets local writes happen. */
const CLEAN = { available: true, paths: new Set(), reason: null };

/** How many times a URL fragment was requested. */
function countCalls(calls, fragment, method = 'GET') {
  return calls.filter(
    (call) => call.method === method && call.url.includes(fragment),
  ).length;
}

// ---------------------------------------------------------------------------
// gatherLocal
// ---------------------------------------------------------------------------

describe('gatherLocal', () => {
  it('gives a subfolder a sub_header item keyed by the subfolder path', () => {
    const dir = tempCourse({
      '01-intro/01-welcome.md': '---\ntitle: Welcome\n---\n\nHello.\n',
      '01-intro/02-theory/_category_.json': '{ "label": "Theory" }\n',
      '01-intro/02-theory/01-types.md': '---\ntitle: Types\n---\n\nBody.\n',
    });

    const { modules } = gatherLocal({ courseDir: dir, gitDirty: CLEAN });

    assert.equal(modules.length, 1);
    const [header] = modules[0].items.filter(
      (item) => item.canvasType === 'sub_header',
    );
    assert.ok(header, 'the subfolder produced no sub_header item');
    assert.equal(header.itemPath, '01-intro/02-theory');
    assert.equal(header.title, 'Theory');
    assert.equal(
      header.localHash,
      subHeaderHash({ title: 'Theory', indent: 0 }),
    );

    // Positions run straight through the module, the way Canvas counts them,
    // rather than restarting inside the subfolder.
    assert.deepEqual(
      modules[0].items.map((item) => [item.itemPath, item.position]),
      [
        ['01-intro/01-welcome.md', 1],
        ['01-intro/02-theory', 2],
        ['01-intro/02-theory/01-types.md', 3],
      ],
    );
  });

  it('hashes each markdown file exactly as fingerprint.js would', () => {
    const dir = tempCourse({
      '01-intro/01-welcome.md': '---\ntitle: Welcome\n---\n\nHello.\n',
    });

    const { modules } = gatherLocal({ courseDir: dir, gitDirty: CLEAN });

    assert.equal(
      modules[0].items[0].localHash,
      hashLocalFile(path.join(dir, '01-intro/01-welcome.md')),
    );
    assert.equal(typeof modules[0].items[0].localMtimeMs, 'number');
  });

  it('marks only the paths git reported as dirty', () => {
    const dir = tempCourse({
      '01-intro/01-welcome.md': 'a\n',
      '01-intro/02-second.md': 'b\n',
    });

    const { modules } = gatherLocal({
      courseDir: dir,
      gitDirty: {
        available: true,
        paths: new Set(['01-intro/02-second.md']),
        reason: null,
      },
    });

    assert.deepEqual(
      modules[0].items.map((item) => [item.itemPath, item.dirty]),
      [
        ['01-intro/01-welcome.md', false],
        ['01-intro/02-second.md', true],
      ],
    );
  });

  it('marks everything dirty when git could not answer', () => {
    // "Cannot tell" has to read as "do not overwrite": git is the only undo
    // this system has, so a run that cannot consult it never writes locally.
    const dir = tempCourse({
      '01-intro/01-welcome.md': 'a\n',
      '01-intro/02-theory/01-types.md': 'b\n',
    });

    const { modules } = gatherLocal({
      courseDir: dir,
      gitDirty: { available: false, paths: new Set(), reason: 'no git' },
    });

    assert.ok(modules[0].items.every((item) => item.dirty === true));
  });
});

// ---------------------------------------------------------------------------
// gitDirtyPaths
// ---------------------------------------------------------------------------

describe('gitDirtyPaths', () => {
  const fakeRun = (statusOutput) => (args) => {
    if (args[0] === 'rev-parse') return '/repo\n';
    return statusOutput;
  };

  it('reads modified, untracked and renamed paths, relative to the course', () => {
    const status = [
      ' M course/01-intro/01-welcome.md\0',
      '?? course/01-intro/03-new.md\0',
      'R  course/01-intro/05-to.md\0course/01-intro/04-from.md\0',
      ' M docs/user-guide.md\0',
    ].join('');

    const result = gitDirtyPaths({
      courseDir: '/repo/course',
      cwd: '/repo',
      run: fakeRun(status),
    });

    assert.equal(result.available, true);
    assert.ok(result.paths.has('01-intro/01-welcome.md'));
    assert.ok(result.paths.has('01-intro/03-new.md'));
    // Both halves of a rename are uncommitted work.
    assert.ok(result.paths.has('01-intro/05-to.md'));
    assert.ok(result.paths.has('01-intro/04-from.md'));
    // A folder inherits the state of what is inside it, so a text header can
    // be asked the same question as a file.
    assert.ok(result.paths.has('01-intro'));
    // Anything outside course/ is none of a sync's business.
    assert.ok(!result.paths.has('docs/user-guide.md'));
  });

  it('says everything is dirty when git is not there', () => {
    const result = gitDirtyPaths({
      courseDir: '/repo/course',
      cwd: '/repo',
      run: () => {
        throw new Error('spawn git ENOENT');
      },
    });

    assert.equal(result.available, false);
    assert.match(result.reason, /git could not be run/);
    assert.equal(result.paths.size, 0);
  });

  it('issues exactly two git commands, whatever the course holds', () => {
    const calls = [];
    gitDirtyPaths({
      courseDir: '/repo/course',
      cwd: '/repo',
      run: (args) => {
        calls.push(args[0]);
        return args[0] === 'rev-parse' ? '/repo\n' : '';
      },
    });
    assert.deepEqual(calls, ['rev-parse', 'status']);
  });
});

// ---------------------------------------------------------------------------
// gatherCanvas
// ---------------------------------------------------------------------------

describe('gatherCanvas', () => {
  it('skips getPage for a page whose updated_at has not moved, and fetches the one that has', async () => {
    silence();
    const base = {
      modules: {
        '01-intro': {
          canvas_module_id: 10,
          items: {
            '01-intro/01-stable.md': {
              canvas_type: 'page',
              canvas_id: 501,
              page_url: 'stable',
              module_item_id: 91,
              title: 'Stable',
              canvas_hash: 'stored-stable-hash',
              canvas_updated_at: '2026-08-01T10:00:00.000Z',
            },
            '01-intro/02-moved.md': {
              canvas_type: 'page',
              canvas_id: 502,
              page_url: 'moved',
              module_item_id: 92,
              title: 'Moved',
              canvas_hash: 'stored-moved-hash',
              canvas_updated_at: '2026-08-01T10:00:00.000Z',
            },
          },
        },
      },
    };

    const calls = mockCanvas([
      {
        method: 'GET',
        path: '/modules/10/items',
        body: [
          {
            id: 91,
            type: 'Page',
            title: 'Stable',
            page_url: 'stable',
            content_id: 501,
            position: 1,
            indent: 0,
          },
          {
            id: 92,
            type: 'Page',
            title: 'Moved',
            page_url: 'moved',
            content_id: 502,
            position: 2,
            indent: 0,
          },
        ],
      },
      {
        method: 'GET',
        path: '/modules',
        body: [{ id: 10, name: 'Intro', position: 1 }],
      },
      {
        method: 'GET',
        path: '/pages/moved',
        body: {
          page_id: 502,
          url: 'moved',
          title: 'Moved',
          body: '<p>new</p>',
          updated_at: '2026-08-19T10:00:00.000Z',
        },
      },
      {
        method: 'GET',
        path: '/pages',
        body: [
          {
            page_id: 501,
            url: 'stable',
            title: 'Stable',
            updated_at: '2026-08-01T10:00:00.000Z',
          },
          {
            page_id: 502,
            url: 'moved',
            title: 'Moved',
            updated_at: '2026-08-19T10:00:00.000Z',
          },
        ],
      },
    ]);

    const { modules } = await gatherCanvas({ courseId: COURSE_ID, base });

    // One page list for the whole course, and one body fetch: the page that
    // moved. The unchanged one costs nothing at all.
    assert.equal(countCalls(calls, '/pages/moved'), 1);
    assert.equal(
      calls.filter((call) => /\/pages\/[a-z]/.test(call.url)).length,
      1,
      'a page whose updated_at is unchanged must not be fetched',
    );

    const [stable, moved] = modules[0].items;
    assert.equal(stable.canvasHash, 'stored-stable-hash');
    assert.equal(stable.canvasUpdatedAt, '2026-08-01T10:00:00.000Z');
    assert.notEqual(moved.canvasHash, 'stored-moved-hash');
    assert.equal(moved.canvasUpdatedAt, '2026-08-19T10:00:00.000Z');
  });

  it('fetches a page whose module item was renamed even though the page did not move', async () => {
    silence();
    const base = {
      modules: {
        '01-intro': {
          canvas_module_id: 10,
          items: {
            '01-intro/01-stable.md': {
              canvas_type: 'page',
              canvas_id: 501,
              page_url: 'stable',
              module_item_id: 91,
              title: 'Old label',
              canvas_hash: 'stored-hash',
              canvas_updated_at: '2026-08-01T10:00:00.000Z',
            },
          },
        },
      },
    };

    mockCanvas([
      {
        method: 'GET',
        path: '/modules/10/items',
        body: [
          {
            id: 91,
            type: 'Page',
            title: 'New label',
            page_url: 'stable',
            content_id: 501,
            position: 1,
            indent: 0,
          },
        ],
      },
      {
        method: 'GET',
        path: '/modules',
        body: [{ id: 10, name: 'Intro', position: 1 }],
      },
      {
        method: 'GET',
        path: '/pages/stable',
        body: {
          page_id: 501,
          url: 'stable',
          title: 'Stable',
          body: '<p>same</p>',
          updated_at: '2026-08-01T10:00:00.000Z',
        },
      },
      {
        method: 'GET',
        path: '/pages',
        body: [
          {
            page_id: 501,
            url: 'stable',
            title: 'Stable',
            updated_at: '2026-08-01T10:00:00.000Z',
          },
        ],
      },
    ]);

    const { modules } = await gatherCanvas({ courseId: COURSE_ID, base });
    assert.notEqual(modules[0].items[0].canvasHash, 'stored-hash');
  });

  it('costs one list request for assignments and one for discussions, whatever the item count', async () => {
    silence();
    const items = [];
    const assignments = [];
    const discussions = [];
    for (let i = 1; i <= 3; i++) {
      items.push({
        id: 100 + i,
        type: 'Assignment',
        title: `A${i}`,
        content_id: 200 + i,
        position: i,
        indent: 0,
      });
      assignments.push({
        id: 200 + i,
        name: `A${i}`,
        description: `<p>${i}</p>`,
        updated_at: '2026-08-01T10:00:00.000Z',
      });
    }
    for (let i = 1; i <= 2; i++) {
      items.push({
        id: 300 + i,
        type: 'Discussion',
        title: `D${i}`,
        content_id: 400 + i,
        position: 3 + i,
        indent: 0,
      });
      discussions.push({
        id: 400 + i,
        title: `D${i}`,
        message: `<p>${i}</p>`,
        updated_at: '2026-08-01T10:00:00.000Z',
      });
    }

    const calls = mockCanvas([
      { method: 'GET', path: '/modules/10/items', body: items },
      {
        method: 'GET',
        path: '/modules',
        body: [{ id: 10, name: 'Intro', position: 1 }],
      },
      { method: 'GET', path: '/assignments', body: assignments },
      { method: 'GET', path: '/discussion_topics', body: discussions },
    ]);

    const { modules } = await gatherCanvas({ courseId: COURSE_ID, base: null });

    assert.equal(countCalls(calls, '/assignments'), 1);
    assert.equal(countCalls(calls, '/discussion_topics'), 1);
    assert.equal(modules[0].items.length, 5);
    assert.ok(modules[0].items.every((item) => item.canvasHash != null));
  });

  it('reports an unrecognised item type instead of throwing', async () => {
    silence();
    mockCanvas([
      {
        method: 'GET',
        path: '/modules/10/items',
        body: [
          {
            id: 91,
            type: 'Sasquatch',
            title: 'Something new',
            position: 1,
            indent: 0,
          },
        ],
      },
      {
        method: 'GET',
        path: '/modules',
        body: [{ id: 10, name: 'Intro', position: 1 }],
      },
    ]);

    const { modules } = await gatherCanvas({ courseId: COURSE_ID, base: null });

    const [item] = modules[0].items;
    assert.equal(item.recognised, false);
    assert.equal(item.canvasHash, null);
    assert.equal(item.rawType, 'Sasquatch');
    assert.equal(item.canvasType, null);
  });

  it('fingerprints a text header and the reference types from the module item alone', async () => {
    silence();
    const calls = mockCanvas([
      {
        method: 'GET',
        path: '/modules/10/items',
        body: [
          {
            id: 91,
            type: 'SubHeader',
            title: 'Theory',
            position: 1,
            indent: 0,
          },
          {
            id: 92,
            type: 'ExternalUrl',
            title: 'Docs',
            external_url: 'https://example.com',
            new_tab: true,
            position: 2,
            indent: 1,
          },
          {
            id: 93,
            type: 'Quiz',
            title: 'Test',
            content_id: 700,
            position: 3,
            indent: 0,
          },
        ],
      },
      {
        method: 'GET',
        path: '/modules',
        body: [{ id: 10, name: 'Intro', position: 1 }],
      },
    ]);

    const { modules } = await gatherCanvas({ courseId: COURSE_ID, base: null });

    // Two requests for the whole run: the module list and its items.
    assert.equal(calls.length, 2);
    assert.ok(modules[0].items.every((item) => item.canvasHash != null));
    assert.equal(modules[0].items[0].suggestedPath, '01-intro/01-theory');
    assert.equal(
      modules[0].items[1].suggestedPath,
      '01-intro/01-theory/01-docs.md',
    );
    assert.equal(modules[0].items[2].canvasId, 700);
  });
});
