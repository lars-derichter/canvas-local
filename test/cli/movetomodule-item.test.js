const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { _moveEntry } = require('../../cli/movetomodule-item');

const CLI = path.resolve(__dirname, '../../cli/index.js');

/**
 * Create a subsection folder with a _category_.json holding the given position.
 */
function createSubsection(parent, name, position, label = 'Sub') {
  const dir = path.join(parent, name);
  fs.mkdirSync(dir);
  fs.writeFileSync(
    path.join(dir, '_category_.json'),
    JSON.stringify({ label, position }, null, 2) + '\n',
    'utf8',
  );
  return dir;
}

function readPosition(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, '_category_.json'), 'utf8'))
    .position;
}

function listEntries(dir) {
  return fs
    .readdirSync(dir)
    .filter((n) => !n.startsWith('.'))
    .sort();
}

describe('moveEntry (movetomodule-item)', () => {
  let tmpDir;
  let sourceDir;
  let destDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'movetomodule-'));
    sourceDir = path.join(tmpDir, 'source');
    destDir = path.join(tmpDir, 'dest');
    fs.mkdirSync(sourceDir);
    fs.mkdirSync(destDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('moves a subsection into an empty destination and aligns its _category_.json position', () => {
    createSubsection(sourceDir, '02-week-two', 2);

    _moveEntry(sourceDir, '02-week-two', destDir, 1);

    assert.deepStrictEqual(listEntries(destDir), ['01-week-two']);
    assert.ok(!fs.existsSync(path.join(sourceDir, '02-week-two')));
    // The moved subsection keeps its category file, with position == new prefix.
    assert.equal(readPosition(path.join(destDir, '01-week-two')), 1);
  });

  it('shifts existing destination subsections up and fixes their positions', () => {
    createSubsection(destDir, '01-existing', 1, 'Existing');
    createSubsection(sourceDir, '01-incoming', 1, 'Incoming');

    _moveEntry(sourceDir, '01-incoming', destDir, 1);

    assert.deepStrictEqual(listEntries(destDir), [
      '01-incoming',
      '02-existing',
    ]);
    assert.equal(readPosition(path.join(destDir, '01-incoming')), 1);
    assert.equal(readPosition(path.join(destDir, '02-existing')), 2);
  });

  it('renumbers the source to close the gap after a move', () => {
    createSubsection(sourceDir, '01-keep', 1, 'Keep');
    createSubsection(sourceDir, '02-move', 2, 'Move');
    createSubsection(sourceDir, '03-tail', 3, 'Tail');

    _moveEntry(sourceDir, '02-move', destDir, 1);

    assert.deepStrictEqual(listEntries(sourceDir), ['01-keep', '02-tail']);
    assert.equal(readPosition(path.join(sourceDir, '01-keep')), 1);
    assert.equal(readPosition(path.join(sourceDir, '02-tail')), 2);
  });

  it('moves a plain file without a _category_.json', () => {
    fs.writeFileSync(path.join(sourceDir, '01-page.md'), '# Page\n', 'utf8');

    _moveEntry(sourceDir, '01-page.md', destDir, 1);

    assert.deepStrictEqual(listEntries(destDir), ['01-page.md']);
    assert.ok(!fs.existsSync(path.join(sourceDir, '01-page.md')));
  });
});

/**
 * The command spawned in a throwaway project, for the reason
 * `test/cli/move-module.test.js` gives: `COURSE_DIR` and the sync-state path
 * are module-level constants resolved from `process.cwd()` at require time, so
 * only a child process with its cwd in the fixture exercises `recordRenames`
 * against a state file the test controls.
 */
describe('movetomodule-item in a temp project', () => {
  const made = [];
  afterEach(() => {
    for (const dir of made.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function project() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'movetomodule-cli-'));
    made.push(dir);
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      '{ "name": "fixture", "private": true }\n',
      'utf8',
    );
    return dir;
  }

  /**
   * The reviewer's layout: a module whose top level holds a page and a
   * subsection, with the file to move inside that subsection. Making room at
   * position 2 renames the subsection itself, out from under the source path.
   */
  function subsectionProject() {
    const dir = project();
    const mod = path.join(dir, 'course', '01-mod');
    fs.mkdirSync(path.join(mod, '05-sub'), { recursive: true });
    fs.writeFileSync(path.join(mod, '01-b.md'), '# B\n', 'utf8');
    fs.writeFileSync(
      path.join(mod, '05-sub', '_category_.json'),
      JSON.stringify({ label: 'Sub', position: 5 }, null, 2) + '\n',
      'utf8',
    );
    fs.writeFileSync(
      path.join(mod, '05-sub', '01-inside.md'),
      '# In\n',
      'utf8',
    );
    return { dir, mod };
  }

  function run(dir, args) {
    return spawnSync(process.execPath, [CLI, 'movetomodule-item', ...args], {
      cwd: dir,
      input: '',
      encoding: 'utf8',
      timeout: 30000,
    });
  }

  /** A page row with just enough identity to prove it survived a re-key. */
  function pageRow(canvasId) {
    return {
      canvas_type: 'page',
      canvas_id: canvasId,
      module_item_id: canvasId + 1000,
    };
  }

  /** Write a fabricated v4 state that claims no course, so no `.env` is needed. */
  function writeSyncState(dir, modules, files = {}) {
    const state = {
      schema_version: 4,
      canvas_base_url: '',
      course_id: 0,
      last_sync: null,
      modules: {},
      icons: {},
      files,
    };
    for (const [folder, items] of Object.entries(modules)) {
      state.modules[folder] = {
        canvas_module_id: 100,
        item_order: Object.keys(items),
        items,
      };
    }
    fs.writeFileSync(
      path.join(dir, '.canvas-sync.json'),
      JSON.stringify(state, null, 2) + '\n',
      'utf8',
    );
  }

  function readSyncState(dir) {
    return JSON.parse(
      fs.readFileSync(path.join(dir, '.canvas-sync.json'), 'utf8'),
    );
  }

  it('completes a same-module move out of a subsection the shift renames', () => {
    // Making room at position 2 renames 05-sub to 06-sub before the file is
    // moved out of it. The stale 05-sub path used to hit ENOENT here, leaving
    // the module half-renumbered and the sync state never told.
    const { dir, mod } = subsectionProject();

    const result = run(dir, [
      '--path',
      path.join('course', '01-mod', '05-sub', '01-inside.md'),
      '--to-module',
      '01-mod',
      '--position',
      '2',
    ]);

    assert.equal(result.status, 0, result.stderr);
    assert.deepStrictEqual(listEntries(mod), [
      '01-b.md',
      '02-inside.md',
      '06-sub',
    ]);
    assert.deepStrictEqual(listEntries(path.join(mod, '06-sub')), [
      '_category_.json',
    ]);
    assert.equal(readPosition(path.join(mod, '06-sub')), 6);
  });

  it('carries every rename of that move into the sync state', () => {
    const { dir } = subsectionProject();
    writeSyncState(
      dir,
      {
        '01-mod': {
          '01-mod/01-b.md': pageRow(1),
          '01-mod/05-sub': { canvas_type: 'sub_header', module_item_id: 12 },
          '01-mod/05-sub/01-inside.md': pageRow(2),
        },
      },
      { '01-mod/05-sub/_files/x.png': { canvas_file_id: 7 } },
    );

    const result = run(dir, [
      '--path',
      path.join('course', '01-mod', '05-sub', '01-inside.md'),
      '--to-module',
      '01-mod',
      '--position',
      '2',
    ]);

    assert.equal(result.status, 0, result.stderr);
    const state = readSyncState(dir);
    const items = state.modules['01-mod'].items;
    assert.deepStrictEqual(Object.keys(items).sort(), [
      '01-mod/01-b.md',
      '01-mod/02-inside.md',
      '01-mod/06-sub',
    ]);
    assert.equal(items['01-mod/02-inside.md'].canvas_id, 2);
    assert.equal(items['01-mod/06-sub'].module_item_id, 12);
    assert.deepStrictEqual(Object.keys(state.files), [
      '01-mod/06-sub/_files/x.png',
    ]);
  });

  it('moves across modules exactly as before', () => {
    const dir = project();
    const source = path.join(dir, 'course', '01-mod');
    const dest = path.join(dir, 'course', '02-mod');
    fs.mkdirSync(source, { recursive: true });
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(source, '01-stay.md'), '# Stay\n', 'utf8');
    fs.writeFileSync(path.join(source, '02-go.md'), '# Go\n', 'utf8');
    fs.writeFileSync(path.join(dest, '01-there.md'), '# There\n', 'utf8');
    writeSyncState(dir, {
      '01-mod': {
        '01-mod/01-stay.md': pageRow(1),
        '01-mod/02-go.md': pageRow(2),
      },
      '02-mod': { '02-mod/01-there.md': pageRow(3) },
    });

    const result = run(dir, [
      '--path',
      path.join('course', '01-mod', '02-go.md'),
      '--to-module',
      '02-mod',
      '--position',
      '1',
    ]);

    assert.equal(result.status, 0, result.stderr);
    assert.ok(
      result.stdout.includes(
        `Moved 02-go.md -> ${path.join('course', '02-mod', '01-go.md')}`,
      ),
      result.stdout,
    );
    assert.deepStrictEqual(listEntries(source), ['01-stay.md']);
    assert.deepStrictEqual(listEntries(dest), ['01-go.md', '02-there.md']);
    const state = readSyncState(dir);
    assert.deepStrictEqual(Object.keys(state.modules['01-mod'].items), [
      '01-mod/01-stay.md',
    ]);
    assert.equal(state.modules['02-mod'].items['02-mod/01-go.md'].canvas_id, 2);
    assert.equal(
      state.modules['02-mod'].items['02-mod/02-there.md'].canvas_id,
      3,
    );
  });

  it('records the renames that landed when the move itself fails', () => {
    // A failure after the destination shift must not leave the sync state
    // believing the old names are still on disk. The driver fails the entry
    // move the way any fs fault would, after the shift has already landed.
    const { dir, mod } = subsectionProject();
    writeSyncState(dir, {
      '01-mod': {
        '01-mod/01-b.md': pageRow(1),
        '01-mod/05-sub': { canvas_type: 'sub_header', module_item_id: 12 },
        '01-mod/05-sub/01-inside.md': pageRow(2),
      },
    });
    const moduleUnderTest = path.resolve(
      __dirname,
      '../../cli/movetomodule-item.js',
    );
    fs.writeFileSync(
      path.join(dir, 'driver.js'),
      [
        `const fs = require('fs');`,
        `const path = require('path');`,
        `const { _moveEntry } = require(${JSON.stringify(moduleUnderTest)});`,
        `const real = fs.renameSync;`,
        `fs.renameSync = (from, to) => {`,
        `  if (path.basename(String(to)) === '02-inside.md') {`,
        `    throw Object.assign(new Error('EACCES: injected failure'), {`,
        `      code: 'EACCES',`,
        `    });`,
        `  }`,
        `  return real(from, to);`,
        `};`,
        `_moveEntry(`,
        `  path.join(process.cwd(), 'course', '01-mod', '05-sub'),`,
        `  '01-inside.md',`,
        `  path.join(process.cwd(), 'course', '01-mod'),`,
        `  2,`,
        `);`,
      ].join('\n'),
      'utf8',
    );

    const result = spawnSync(process.execPath, ['driver.js'], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 30000,
    });

    assert.notEqual(result.status, 0, 'the injected fault must propagate');
    assert.match(result.stderr, /EACCES: injected failure/);
    // On disk: the shift landed, the entry never left the subsection.
    assert.deepStrictEqual(listEntries(mod), ['01-b.md', '06-sub']);
    assert.deepStrictEqual(listEntries(path.join(mod, '06-sub')), [
      '01-inside.md',
      '_category_.json',
    ]);
    // And the state matches that disk, no more and no less.
    const items = readSyncState(dir).modules['01-mod'].items;
    assert.deepStrictEqual(Object.keys(items).sort(), [
      '01-mod/01-b.md',
      '01-mod/06-sub',
      '01-mod/06-sub/01-inside.md',
    ]);
    assert.equal(items['01-mod/06-sub/01-inside.md'].canvas_id, 2);
  });
});
