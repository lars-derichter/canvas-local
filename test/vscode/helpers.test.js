const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  extractPosition,
  cliSiblings,
  reorderPosition,
  crossContainerPosition,
  nameSuffix,
  matchBySuffix,
  appendPosition,
  batchPositions,
  sortByVisualOrder,
  validateBatchDrop,
  moduleCanvasId,
  canvasModuleUrl,
  terminalNumber,
  pickTerminal,
} = require('../../.vscode/extensions/course-manager/helpers');
const { reorder } = require('../../cli/renumber');
const { getItems } = require('../../cli/item-utils');
const { _moveEntry } = require('../../cli/movetomodule-item');

function createFiles(dir, names) {
  for (const name of names) {
    fs.writeFileSync(path.join(dir, name), '', 'utf8');
  }
}

/** Entry names in the order the CLI (and the tree) show them. */
function sortedNames(dir) {
  return getItems(dir).map((i) => i.name);
}

describe('helpers: cliSiblings', () => {
  it('keeps only numeric-prefixed entries, sorted by prefix', () => {
    assert.deepStrictEqual(
      cliSiblings([
        '07-c.md',
        'notes.md',
        '01-a.md',
        '_files',
        '03-b',
        '_category_.json',
      ]),
      ['01-a.md', '03-b', '07-c.md'],
    );
  });
});

describe('helpers: reorderPosition', () => {
  it('returns the ordinal, not the prefix, with gapped numbering', () => {
    const names = ['01-a.md', '03-b.md', '07-c.md'];
    assert.equal(reorderPosition(names, '01-a.md'), 1);
    assert.equal(reorderPosition(names, '03-b.md'), 2);
    assert.equal(reorderPosition(names, '07-c.md'), 3);
  });

  it('returns 1 for the first entry of a 00-based list', () => {
    const names = ['00-a.md', '01-b.md', '02-c.md'];
    assert.equal(reorderPosition(names, '00-a.md'), 1);
    assert.equal(reorderPosition(names, '02-c.md'), 3);
  });

  it('ignores unnumbered entries and rejects one as a target', () => {
    const names = ['notes.md', '01-a.md', '02-b.md'];
    assert.equal(reorderPosition(names, '02-b.md'), 2);
    assert.equal(reorderPosition(names, 'notes.md'), null);
  });
});

describe('helpers: crossContainerPosition', () => {
  it('returns the literal prefix, because movetomodule-item takes one', () => {
    assert.equal(crossContainerPosition('07-c.md'), 7);
    assert.equal(crossContainerPosition('03-b.md'), 3);
  });

  it('returns 0 for a 00 prefix, a slot the CLI refuses to fill', () => {
    // The CLI rejects positions below 1 and renumberUp cannot shift a 00
    // entry out of the way, so the drop handlers must refuse this drop
    // instead of passing the position on.
    assert.equal(crossContainerPosition('00-a.md'), 0);
  });

  it('rejects an unnumbered target', () => {
    assert.equal(crossContainerPosition('notes.md'), null);
  });
});

describe('helpers: reorderPosition drives reorder() onto the drop slot', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'helpers-reorder-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function drop(draggedName, targetName) {
    const position = reorderPosition(fs.readdirSync(tmpDir), targetName);
    const items = getItems(tmpDir);
    const source = items.find((i) => i.name === draggedName);
    reorder(tmpDir, items, source.prefix, position);
  }

  it('down-move: the dragged item takes the target slot, no off-by-one', () => {
    createFiles(tmpDir, ['01-a.md', '02-b.md', '03-c.md', '04-d.md']);
    // Drag a onto c (slot 3). The CLI removes a first; the splice into the
    // post-removal list must still land a exactly in slot 3.
    drop('01-a.md', '03-c.md');
    assert.deepStrictEqual(sortedNames(tmpDir), [
      '01-b.md',
      '02-c.md',
      '03-a.md',
      '04-d.md',
    ]);
  });

  it('up-move: the dragged item takes the target slot', () => {
    createFiles(tmpDir, ['00-a.md', '01-b.md', '02-c.md', '03-d.md']);
    // 00-based numbering: b sits in slot 2, and dragging d onto it must land
    // d in slot 2 — passing the filename prefix 1 would land it one slot off.
    drop('03-d.md', '01-b.md');
    assert.deepStrictEqual(sortedNames(tmpDir), [
      '01-a.md',
      '02-d.md',
      '03-b.md',
      '04-c.md',
    ]);
  });

  it('gapped numbering: the prefix would be out of range, the ordinal works', () => {
    createFiles(tmpDir, ['01-a.md', '03-b.md', '07-c.md']);
    // Dragging a onto 07-c used to pass position 7 with only 3 items.
    drop('01-a.md', '07-c.md');
    assert.deepStrictEqual(sortedNames(tmpDir), [
      '01-b.md',
      '02-c.md',
      '03-a.md',
    ]);
  });
});

describe('helpers: nameSuffix', () => {
  it('strips the numeric prefix and keeps everything after it', () => {
    assert.equal(nameSuffix('03-foo.md'), '-foo.md');
    assert.equal(nameSuffix('00-intro'), '-intro');
  });

  it('leaves an unnumbered name whole', () => {
    assert.equal(nameSuffix('notes.md'), 'notes.md');
  });
});

describe('helpers: matchBySuffix', () => {
  it('finds numbered entries sharing the suffix, in prefix order', () => {
    assert.deepStrictEqual(
      matchBySuffix(['07-a.md', 'notes.md', '01-a.md', '02-b.md'], '-a.md'),
      ['01-a.md', '07-a.md'],
    );
  });

  it('never matches an unnumbered entry', () => {
    assert.deepStrictEqual(matchBySuffix(['notes.md'], 'notes.md'), []);
  });
});

describe('helpers: appendPosition', () => {
  it('is one past the highest prefix, gaps and all', () => {
    assert.equal(appendPosition(['01-a.md', '07-c.md', 'notes.md']), 8);
  });

  it('is 1 for a container with no numbered entries', () => {
    assert.equal(appendPosition([]), 1);
    assert.equal(appendPosition(['notes.md', '_category_.json']), 1);
  });
});

describe('helpers: batchPositions', () => {
  it('counts up from the base, one prefix per dragged entry', () => {
    assert.deepStrictEqual(batchPositions(3, 3), [3, 4, 5]);
    assert.deepStrictEqual(batchPositions(6, 1), [6]);
  });

  it('allows a batch that ends exactly on 99', () => {
    assert.deepStrictEqual(batchPositions(97, 3), [97, 98, 99]);
  });

  it('refuses a batch that would run past 99', () => {
    assert.equal(batchPositions(98, 3), null);
    assert.equal(batchPositions(100, 1), null);
  });
});

// Rows as handleDrag serialises them. `sub` puts a file inside a subsection;
// kind 'subheader' makes the row a subsection itself.
function dragRow(module, entry, { sub = null, kind = 'page' } = {}) {
  const moduleDir = path.join('/ws', 'course', module);
  const container = sub ? path.join(moduleDir, sub) : moduleDir;
  return {
    contextValue: kind,
    filePath: kind === 'subheader' ? null : path.join(container, entry),
    folderPath: kind === 'subheader' ? path.join(moduleDir, entry) : null,
    moduleFolderName: module,
    subfolderName: sub,
    entryName: entry,
    position: extractPosition(entry),
  };
}

describe('helpers: sortByVisualOrder', () => {
  it('orders across modules by module prefix, then entry prefix', () => {
    const rows = [
      dragRow('10-late', '01-a.md'),
      dragRow('02-early', '05-b.md'),
      dragRow('02-early', '01-c.md'),
    ];
    assert.deepStrictEqual(
      sortByVisualOrder(rows).map((r) => r.entryName),
      ['01-c.md', '05-b.md', '01-a.md'],
    );
  });

  it('keeps a subsection header before its children and slots both by the subsection prefix', () => {
    const rows = [
      dragRow('01-m', '03-b.md'),
      dragRow('01-m', '01-x.md', { sub: '02-s' }),
      dragRow('01-m', '02-s', { kind: 'subheader' }),
    ];
    assert.deepStrictEqual(
      sortByVisualOrder(rows).map((r) => r.entryName),
      ['02-s', '01-x.md', '03-b.md'],
    );
  });
});

describe('helpers: validateBatchDrop', () => {
  const ws = path.join('/ws', 'course');
  const dir = (...parts) => path.join(ws, ...parts);

  // A fake tree: dir path -> entries. Missing dirs list as empty, matching
  // the provider's readdir fallback.
  function readDirFrom(tree) {
    return (d) =>
      (tree[d] || []).map((name) => ({
        name: name.replace(/\/$/, ''),
        isDirectory: name.endsWith('/'),
      }));
  }

  const rootDest = { dir: dir('05-dest'), subfolderName: null };
  const subDest = {
    dir: dir('05-dest', '02-sub'),
    subfolderName: '02-sub',
  };

  it('accepts a clean cross-module batch', () => {
    const rows = [dragRow('01-m', '01-a.md'), dragRow('01-m', '02-b.md')];
    const tree = { [dir('01-m')]: ['01-a.md', '02-b.md'] };
    assert.equal(validateBatchDrop(rows, rootDest, readDirFrom(tree)), null);
  });

  it('refuses an unnumbered dragged entry by name', () => {
    const rows = [dragRow('01-m', '01-a.md'), dragRow('01-m', 'notes.md')];
    assert.match(
      validateBatchDrop(rows, rootDest, readDirFrom({})),
      /"notes\.md" has no numeric prefix/,
    );
  });

  it('refuses a dragged subsection when the destination is a subsection', () => {
    // Not a nesting rule: a single subheader dropped onto a subheader takes
    // its slot at the module root. The batch is refused because files would
    // land inside the target while the subheader lands beside it.
    const rows = [
      dragRow('01-m', '01-a.md'),
      dragRow('01-m', '02-s', { kind: 'subheader' }),
    ];
    assert.match(
      validateBatchDrop(rows, subDest, readDirFrom({})),
      /"02-s" is a subsection, which can only land beside "02-sub"/,
    );
  });

  it('refuses a dragged row inside an unnumbered subsection', () => {
    // Re-resolution finds subsections by suffix among numbered CLI siblings,
    // so an unnumbered one would strand the batch after its first move.
    const rows = [
      dragRow('01-m', '00-a.md'),
      dragRow('01-m', '01-in.md', { sub: 'extra' }),
    ];
    assert.match(
      validateBatchDrop(rows, rootDest, readDirFrom({})),
      /"extra" has no numeric prefix, so the batch cannot re-find it/,
    );
  });

  it('refuses an unnumbered destination subsection', () => {
    const rows = [dragRow('01-m', '01-a.md'), dragRow('01-m', '02-b.md')];
    const dest = { dir: dir('05-dest', 'notes'), subfolderName: 'notes' };
    assert.match(
      validateBatchDrop(rows, dest, readDirFrom({})),
      /"notes" has no numeric prefix, so the batch cannot re-find it/,
    );
  });

  it('refuses a file dragged along with the subsection that holds it', () => {
    const rows = [
      dragRow('01-m', '02-s', { kind: 'subheader' }),
      dragRow('01-m', '01-x.md', { sub: '02-s' }),
    ];
    assert.match(
      validateBatchDrop(rows, rootDest, readDirFrom({})),
      /moving the subsection already moves it/,
    );
  });

  it('refuses a same-container multi-item reorder outright', () => {
    const rows = [dragRow('05-dest', '01-a.md'), dragRow('05-dest', '02-b.md')];
    assert.match(
      validateBatchDrop(rows, rootDest, readDirFrom({})),
      /multi-item reorder/,
    );
  });

  it('refuses a batch that mixes a reorder into a move, naming the resident', () => {
    const rows = [dragRow('01-m', '01-a.md'), dragRow('05-dest', '02-b.md')];
    assert.match(
      validateBatchDrop(rows, rootDest, readDirFrom({})),
      /"02-b\.md" is already in the destination/,
    );
  });

  it('refuses suffix twins in a source container', () => {
    const rows = [dragRow('01-m', '01-a.md'), dragRow('01-m', '02-b.md')];
    const tree = { [dir('01-m')]: ['01-a.md', '02-b.md', '07-a.md'] };
    assert.match(
      validateBatchDrop(rows, rootDest, readDirFrom(tree)),
      /"01-a\.md" and "07-a\.md" differ only in their numeric prefix/,
    );
  });

  it('refuses suffix twins among source subsection directories', () => {
    const rows = [dragRow('01-m', '01-x.md', { sub: '02-s' })];
    const tree = {
      [dir('01-m')]: ['02-s/', '05-s/', '03-b.md'],
      [dir('01-m', '02-s')]: ['01-x.md'],
    };
    assert.match(
      validateBatchDrop(rows, rootDest, readDirFrom(tree)),
      /Subsections "02-s" and "05-s"/,
    );
  });

  it('refuses a dragged subsection landing next to its suffix twin', () => {
    // Dest is 05-dest's root; one row comes out of its subsection 02-s while
    // another row lands a subsection also suffixed "-s" in that same root.
    const rows = [
      dragRow('05-dest', '01-x.md', { sub: '02-s' }),
      dragRow('01-m', '03-s', { kind: 'subheader' }),
    ];
    const tree = {
      [dir('05-dest')]: ['02-s/'],
      [dir('05-dest', '02-s')]: ['01-x.md'],
      [dir('01-m')]: ['03-s/'],
    };
    assert.match(
      validateBatchDrop(rows, rootDest, readDirFrom(tree)),
      /Landing "03-s" next to subsection "02-s"/,
    );
  });

  it('refuses a destination subsection with a suffix twin', () => {
    const rows = [dragRow('01-m', '01-a.md')];
    const tree = {
      [dir('01-m')]: ['01-a.md'],
      [dir('05-dest')]: ['02-sub/', '04-sub/'],
    };
    assert.match(
      validateBatchDrop(rows, subDest, readDirFrom(tree)),
      /could not re-find the destination/,
    );
  });
});

describe('helpers: crossContainerPosition drives moveEntry onto the drop slot', () => {
  let tmpDir;
  let sourceDir;
  let destDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'helpers-crossmove-'));
    sourceDir = path.join(tmpDir, 'source');
    destDir = path.join(tmpDir, 'dest');
    fs.mkdirSync(sourceDir);
    fs.mkdirSync(destDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('lands in a gapped destination at the target slot', () => {
    createFiles(sourceDir, ['01-x.md']);
    createFiles(destDir, ['01-a.md', '03-b.md', '07-c.md']);
    _moveEntry(
      sourceDir,
      '01-x.md',
      destDir,
      crossContainerPosition('03-b.md'),
    );
    // x takes b's slot (second in the visual list); b and c shift a prefix up.
    assert.deepStrictEqual(sortedNames(destDir), [
      '01-a.md',
      '03-x.md',
      '04-b.md',
      '08-c.md',
    ]);
  });

  it('lands on the last item of a gapped destination without a range error', () => {
    createFiles(sourceDir, ['01-x.md']);
    createFiles(destDir, ['01-a.md', '03-b.md', '07-c.md']);
    _moveEntry(
      sourceDir,
      '01-x.md',
      destDir,
      crossContainerPosition('07-c.md'),
    );
    assert.deepStrictEqual(sortedNames(destDir), [
      '01-a.md',
      '03-b.md',
      '07-x.md',
      '08-c.md',
    ]);
  });
});

describe('helpers: batchPositions drives sequential moveEntry in dragged order', () => {
  let tmpDir;
  let sourceDir;
  let destDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'helpers-batchmove-'));
    sourceDir = path.join(tmpDir, 'source');
    destDir = path.join(tmpDir, 'dest');
    fs.mkdirSync(sourceDir);
    fs.mkdirSync(destDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // The batch loop the provider runs: each entry is re-found by suffix in the
  // freshly listed source, because the gap-close after every move renames the
  // entries still waiting their turn.
  function moveBatch(entryNames, positions) {
    for (const [i, name] of entryNames.entries()) {
      const matches = matchBySuffix(
        fs.readdirSync(sourceDir),
        nameSuffix(name),
      );
      assert.equal(matches.length, 1, `stale "${name}" must resolve uniquely`);
      _moveEntry(sourceDir, matches[0], destDir, positions[i]);
    }
  }

  it('take-slot: three entries land in dragged order on the target slot, gapped destination and renumbered source included', () => {
    createFiles(sourceDir, ['01-a.md', '02-b.md', '03-c.md']);
    createFiles(destDir, ['01-x.md', '03-t.md', '07-y.md']);
    const positions = batchPositions(crossContainerPosition('03-t.md'), 3);
    assert.deepStrictEqual(positions, [3, 4, 5]);
    // After the first move the source gap-close renames 02-b -> 01-b and
    // 03-c -> 02-c: the serialised paths are stale from then on.
    moveBatch(['01-a.md', '02-b.md', '03-c.md'], positions);
    assert.deepStrictEqual(sortedNames(destDir), [
      '01-x.md',
      '03-a.md',
      '04-b.md',
      '05-c.md',
      '06-t.md',
      '10-y.md',
    ]);
    assert.deepStrictEqual(sortedNames(sourceDir), []);
  });

  it('append: each entry advances one past the previous, never re-reading the CLI default', () => {
    createFiles(sourceDir, ['01-a.md', '02-b.md', '03-c.md']);
    createFiles(destDir, ['02-x.md', '05-y.md']);
    const base = appendPosition(fs.readdirSync(destDir));
    assert.equal(base, 6);
    moveBatch(['01-a.md', '02-b.md', '03-c.md'], batchPositions(base, 3));
    assert.deepStrictEqual(sortedNames(destDir), [
      '02-x.md',
      '05-y.md',
      '06-a.md',
      '07-b.md',
      '08-c.md',
    ]);
  });
});

describe('helpers: moduleCanvasId', () => {
  // A v4 sync state, trimmed to what the lookup reads: 01-intro has been
  // pushed, 02-planning was created locally and never has.
  const state = {
    schema_version: 4,
    modules: {
      '01-intro': {
        canvas_module_id: 67890,
        name: 'Intro',
        items: {
          '01-intro/01-welcome.md': { canvas_type: 'page', canvas_id: 1234 },
        },
      },
      '02-planning': {
        name: 'Planning',
        items: {
          '02-planning/01-brief.md': { canvas_type: 'page', canvas_id: 4321 },
        },
      },
    },
  };

  it('returns the module id as a string, as the URL needs it', () => {
    assert.equal(moduleCanvasId(state, '01-intro'), '67890');
  });

  it('returns null for a module the state records without an id', () => {
    // The row exists the moment an item is dragged into the folder; the
    // canvas_module_id only arrives with the first push.
    assert.equal(moduleCanvasId(state, '02-planning'), null);
  });

  it('never reads a module id out of an item row', () => {
    // The items under 02-planning do carry Canvas ids. Mistaking one of them
    // for the module's would anchor the modules page at a page's id.
    assert.equal(moduleCanvasId(state, '02-planning'), null);
    assert.notEqual(moduleCanvasId(state, '01-intro'), '4321');
  });

  it('returns null for a folder the state does not know', () => {
    assert.equal(moduleCanvasId(state, '09-new'), null);
  });

  it('survives a missing or empty state', () => {
    assert.equal(moduleCanvasId(null, '01-intro'), null);
    assert.equal(moduleCanvasId({}, '01-intro'), null);
    assert.equal(moduleCanvasId({ modules: {} }, '01-intro'), null);
  });
});

describe('helpers: canvasModuleUrl', () => {
  const base = 'https://school.instructure.com';

  it('anchors the modules page at the module itself', () => {
    assert.equal(
      canvasModuleUrl(base, 12345, '67890'),
      'https://school.instructure.com/courses/12345/modules#module_67890',
    );
  });

  it('falls back to the plain modules page without an id', () => {
    // A module that has never been pushed has nothing to anchor on, and the
    // list is still where the author was heading.
    assert.equal(
      canvasModuleUrl(base, 12345, null),
      'https://school.instructure.com/courses/12345/modules',
    );
  });
});

describe('helpers: terminalNumber', () => {
  const BASE = 'Canvas Course Builder';

  it('numbers the bare base name 1 and "<base> N" its N', () => {
    assert.equal(terminalNumber(BASE, BASE), 1);
    assert.equal(terminalNumber(`${BASE} 2`, BASE), 2);
    assert.equal(terminalNumber(`${BASE} 10`, BASE), 10);
  });

  it('rejects "<base> 1", a name the pool never issues', () => {
    assert.equal(terminalNumber(`${BASE} 1`, BASE), null);
  });

  it('rejects foreign names: the preview terminal, a user shell, prose', () => {
    assert.equal(terminalNumber(`${BASE}: Preview`, BASE), null);
    assert.equal(terminalNumber('zsh', BASE), null);
    assert.equal(terminalNumber(`${BASE} two`, BASE), null);
    assert.equal(terminalNumber(`${BASE} 2 extra`, BASE), null);
  });
});

describe('helpers: pickTerminal', () => {
  // The pool is most recently used last; index is into that ordering.
  const t = (name, busy) => ({ name, busy });

  it('creates the bare-named terminal for an empty pool', () => {
    assert.deepStrictEqual(pickTerminal([], 'CM'), {
      action: 'create',
      name: 'CM',
    });
  });

  it('reuses the lowest-numbered idle terminal, not the most recent one', () => {
    const pool = [t('CM 2', false), t('CM', false)];
    assert.deepStrictEqual(pickTerminal(pool, 'CM'), {
      action: 'reuse',
      index: 1,
    });
  });

  it('creates "<base> 2" instead of typing into the busy bare terminal', () => {
    assert.deepStrictEqual(pickTerminal([t('CM', true)], 'CM'), {
      action: 'create',
      name: 'CM 2',
    });
  });

  it('fills the lowest number a closed terminal freed', () => {
    const pool = [t('CM', true), t('CM 3', true)];
    assert.deepStrictEqual(pickTerminal(pool, 'CM'), {
      action: 'create',
      name: 'CM 2',
    });
  });

  it('recreates the bare name when only numbered terminals remain', () => {
    const pool = [t('CM 2', true), t('CM 3', true)];
    assert.deepStrictEqual(pickTerminal(pool, 'CM'), {
      action: 'create',
      name: 'CM',
    });
  });

  it('reuses the most recently used terminal at the cap, busy and all', () => {
    const pool = [
      t('CM', true),
      t('CM 2', true),
      t('CM 4', true),
      t('CM 5', true),
      t('CM 3', true),
    ];
    assert.deepStrictEqual(pickTerminal(pool, 'CM'), {
      action: 'reuse',
      index: 4,
    });
  });

  it('still prefers an idle terminal at the cap', () => {
    const pool = [
      t('CM', true),
      t('CM 2', false),
      t('CM 3', true),
      t('CM 4', true),
      t('CM 5', true),
    ];
    assert.deepStrictEqual(pickTerminal(pool, 'CM'), {
      action: 'reuse',
      index: 1,
    });
  });

  it('honours a caller-supplied cap', () => {
    const pool = [t('CM', true), t('CM 2', true)];
    assert.deepStrictEqual(pickTerminal(pool, 'CM', 2), {
      action: 'reuse',
      index: 1,
    });
  });
});
