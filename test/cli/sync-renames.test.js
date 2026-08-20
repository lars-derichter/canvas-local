const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { recordRenames } = require('../../cli/sync-renames');

/**
 * Every renaming command ends in `recordRenames`, handing it the batches it has
 * just applied to disk. These tests build each command's batch by hand — the
 * commands themselves resolve `course/` and `.canvas-sync.json` from the
 * project root, which a test cannot move — so what is pinned here is the shape
 * each of them passes and what the state looks like afterwards.
 */
describe('recordRenames', () => {
  let root;
  let courseDir;
  let file;

  /** A page row carrying everything a sync writes onto one. */
  function pageRow(canvasId, slug) {
    return {
      canvas_type: 'page',
      canvas_id: canvasId,
      page_url: slug,
      module_item_id: canvasId + 1000,
      local_hash: `local-${canvasId}`,
      canvas_hash: `canvas-${canvasId}`,
      canvas_updated_at: '2026-08-19T09:59:00.000Z',
      synced_at: '2026-08-19T10:00:00.000Z',
    };
  }

  /** Write a state holding the given modules, each `{folder: {id, items}}`. */
  function writeState(modules) {
    const state = {
      schema_version: 4,
      canvas_base_url: '',
      course_id: 0,
      last_sync: null,
      modules: {},
      icons: {},
      files: {},
    };
    for (const [folder, { id, items = {}, files = {} }] of Object.entries(
      modules,
    )) {
      state.modules[folder] = {
        canvas_module_id: id,
        item_order: Object.keys(items),
        items,
      };
      Object.assign(state.files, files);
    }
    fs.writeFileSync(file, JSON.stringify(state, null, 2) + '\n', 'utf8');
    return state;
  }

  function readState() {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }

  const at = (...parts) => path.join(courseDir, ...parts);

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-renames-'));
    courseDir = path.join(root, 'course');
    file = path.join(root, '.canvas-sync.json');
    fs.mkdirSync(courseDir, { recursive: true });
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  const opts = () => ({ courseDir, file });

  it('carries a renamed item to its new path, ids and fingerprints intact', () => {
    // rename-item: one entry, one directory.
    writeState({
      '01-mod': {
        id: 100,
        items: { '01-mod/01-welcome.md': pageRow(1234, 'w') },
      },
    });

    const moved = recordRenames(
      [
        {
          fromDir: at('01-mod'),
          renames: [{ from: '01-welcome.md', to: '01-hello.md' }],
        },
      ],
      opts(),
    );

    assert.equal(moved, 1);
    const items = readState().modules['01-mod'].items;
    assert.deepEqual(items['01-mod/01-hello.md'], pageRow(1234, 'w'));
    assert.equal(items['01-mod/01-welcome.md'], undefined);
  });

  it("carries a renumbered batch that shifts files into each other's slots", () => {
    // delete-item, merge-items, move-item, split-item, new-item: whatever
    // renumberSequential / renumberUp / reorder just did to one directory.
    writeState({
      '01-mod': {
        id: 100,
        items: {
          '01-mod/02-b.md': pageRow(2, 'b'),
          '01-mod/03-c.md': pageRow(3, 'c'),
          '01-mod/04-d.md': pageRow(4, 'd'),
        },
      },
    });

    const moved = recordRenames(
      [
        {
          fromDir: at('01-mod'),
          renames: [
            { from: '02-b.md', to: '01-b.md' },
            { from: '03-c.md', to: '02-c.md' },
            { from: '04-d.md', to: '03-d.md' },
          ],
        },
      ],
      opts(),
    );

    assert.equal(moved, 3);
    const items = readState().modules['01-mod'].items;
    assert.deepEqual(Object.keys(items), [
      '01-mod/01-b.md',
      '01-mod/02-c.md',
      '01-mod/03-d.md',
    ]);
    assert.equal(items['01-mod/01-b.md'].canvas_id, 2);
    assert.equal(items['01-mod/03-d.md'].canvas_id, 4);
  });

  it('carries an item into another module, in the order the move happened', () => {
    // movetomodule-item: make room at the destination, move the file, close
    // the gap at the source — three batches, one command, one write.
    writeState({
      '01-mod': {
        id: 100,
        items: {
          '01-mod/01-stay.md': pageRow(1, 'stay'),
          '01-mod/02-go.md': pageRow(2, 'go'),
        },
      },
      '02-mod': {
        id: 200,
        items: { '02-mod/01-there.md': pageRow(3, 'there') },
      },
    });

    const moved = recordRenames(
      [
        {
          fromDir: at('02-mod'),
          renames: [{ from: '01-there.md', to: '02-there.md' }],
        },
        {
          fromDir: at('01-mod'),
          toDir: at('02-mod'),
          renames: [{ from: '02-go.md', to: '01-go.md' }],
        },
        {
          fromDir: at('01-mod'),
          renames: [{ from: '01-stay.md', to: '01-stay.md' }],
        },
      ],
      opts(),
    );

    assert.equal(moved, 2);
    const state = readState();
    assert.deepEqual(Object.keys(state.modules['01-mod'].items), [
      '01-mod/01-stay.md',
    ]);
    assert.deepEqual(state.modules['01-mod'].item_order, ['01-mod/01-stay.md']);
    assert.equal(state.modules['02-mod'].items['02-mod/01-go.md'].canvas_id, 2);
    assert.equal(
      state.modules['02-mod'].items['02-mod/02-there.md'].canvas_id,
      3,
    );
  });

  it('carries a renamed module, its items and its _files/ rows', () => {
    // rename-module: one folder directly under course/.
    writeState({
      '01-intro': {
        id: 100,
        items: { '01-intro/01-a.md': pageRow(1, 'a') },
        files: { '01-intro/_files/one.png': { canvas_file_id: 501 } },
      },
    });

    const moved = recordRenames(
      [
        {
          fromDir: courseDir,
          renames: [{ from: '01-intro', to: '01-introduction' }],
        },
      ],
      opts(),
    );

    assert.equal(moved, 1);
    const state = readState();
    assert.equal(state.modules['01-intro'], undefined);
    assert.equal(state.modules['01-introduction'].canvas_module_id, 100);
    assert.ok(
      state.modules['01-introduction'].items['01-introduction/01-a.md'],
    );
    assert.ok(state.files['01-introduction/_files/one.png']);
  });

  it('carries reordered modules past each other', () => {
    // move-module, and delete-module's gap-closing renumber.
    writeState({
      '01-intro': { id: 100, items: { '01-intro/01-a.md': pageRow(1, 'a') } },
      '02-setup': { id: 200, items: { '02-setup/01-b.md': pageRow(2, 'b') } },
    });

    const moved = recordRenames(
      [
        {
          fromDir: courseDir,
          renames: [
            { from: '02-setup', to: '01-setup' },
            { from: '01-intro', to: '02-intro' },
          ],
        },
      ],
      opts(),
    );

    assert.equal(moved, 2);
    const state = readState();
    assert.equal(state.modules['01-setup'].canvas_module_id, 200);
    assert.equal(state.modules['02-intro'].canvas_module_id, 100);
    assert.ok(state.modules['02-intro'].items['02-intro/01-a.md']);
  });

  it('carries everything under a renamed subsection folder', () => {
    writeState({
      '01-mod': {
        id: 100,
        items: { '01-mod/01-sub/01-a.md': pageRow(1, 'a') },
        files: { '01-mod/01-sub/_files/x.png': { canvas_file_id: 7 } },
      },
    });

    recordRenames(
      [{ fromDir: at('01-mod'), renames: [{ from: '01-sub', to: '02-sub' }] }],
      opts(),
    );

    const state = readState();
    assert.ok(state.modules['01-mod'].items['01-mod/02-sub/01-a.md']);
    assert.ok(state.files['01-mod/02-sub/_files/x.png']);
  });

  it('changes nothing for a file the state never knew, and does not throw', () => {
    writeState({
      '01-mod': { id: 100, items: { '01-mod/01-a.md': pageRow(1, 'a') } },
    });
    const before = fs.readFileSync(file, 'utf8');

    const moved = recordRenames(
      [
        {
          fromDir: at('01-mod'),
          renames: [{ from: '09-untracked.md', to: '08-untracked.md' }],
        },
      ],
      opts(),
    );

    assert.equal(moved, 0);
    assert.equal(
      fs.readFileSync(file, 'utf8'),
      before,
      'a batch that moved nothing does not rewrite the file either',
    );
  });

  it('does nothing on a course that has never been synced', () => {
    const moved = recordRenames(
      [{ fromDir: at('01-mod'), renames: [{ from: 'a.md', to: 'b.md' }] }],
      opts(),
    );

    assert.equal(moved, 0);
    assert.equal(fs.existsSync(file), false, 'and writes no sync state');
  });

  it('does nothing for an empty or absent batch list', () => {
    writeState({ '01-mod': { id: 100 } });
    assert.equal(recordRenames([], opts()), 0);
    assert.equal(recordRenames(undefined, opts()), 0);
    assert.equal(
      recordRenames([{ fromDir: at('01-mod'), renames: [] }], opts()),
      0,
    );
  });
});

describe('the commands that rename', () => {
  // A rename that does not reach the sync state leaves a row addressing a file
  // that is gone: the next push reads it as a deletion at the old path and a
  // create at the new one. Six commands rename directly, and three more do it
  // through `renumber` as a side effect of creating, deleting or splitting an
  // item — so the check is on all nine.
  const callers = [
    'move-item.js',
    'rename-item.js',
    'movetomodule-item.js',
    'move-module.js',
    'rename-module.js',
    'delete-item.js',
    'merge-items.js',
    'split-item.js',
    'new-item.js',
  ];

  for (const caller of callers) {
    it(`${caller} carries its renames into the sync state`, () => {
      const source = fs.readFileSync(
        path.join(__dirname, '..', '..', 'cli', caller),
        'utf8',
      );
      assert.match(source, /require\('\.\/sync-renames'\)/);
      assert.match(source, /recordRenames\(/);
    });
  }

  it('delete-module carries its own, holding the state it already loaded', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', '..', 'cli', 'delete-module.js'),
      'utf8',
    );
    assert.match(source, /renameFolders\(syncData, renames\)/);
  });
});
