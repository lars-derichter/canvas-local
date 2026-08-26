const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  displayTitle,
  safeReadJSON,
  readFrontmatter,
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
  courseLocation,
  promoteActive,
  seedsDestination,
  getCanvasId,
  moduleCanvasId,
  getModuleCanvasId,
  canvasModuleUrl,
  readEnvConfig,
  terminalNumber,
  pickTerminal,
  shellFlavour,
  shellQuote,
  UnquotableValue,
  cliEntryPoint,
  cliChildEnv,
  createSerialQueue,
  announceIfSlow,
  createProgressGate,
} = require('../../.vscode/extensions/course-manager/helpers');
const dotenv = require('dotenv');
const { reorder } = require('../../cli/renumber');
const { getItems } = require('../../cli/item-utils');
const { _moveEntry } = require('../../cli/movetomodule-item');
const {
  displayTitle: libraryDisplayTitle,
} = require('../../lib/convert/course-scanner');

function createFiles(dir, names) {
  for (const name of names) {
    fs.writeFileSync(path.join(dir, name), '', 'utf8');
  }
}

/** Entry names in the order the CLI (and the tree) show them. */
function sortedNames(dir) {
  return getItems(dir).map((i) => i.name);
}

describe('helpers: displayTitle', () => {
  it('strips the numeric prefix and spaces the separators out', () => {
    assert.equal(displayTitle('01-welcome'), 'Welcome');
    assert.equal(displayTitle('02-getting-started'), 'Getting started');
    assert.equal(displayTitle('03-my_page'), 'My page');
  });

  it('raises the first character only, leaving author capitals alone', () => {
    // Sentence case, not title case: capitalising every word is wrong in
    // Dutch and French, and "15-e2e-sub" would come out as "E2e Sub".
    assert.equal(displayTitle('04-rest-API'), 'Rest API');
    assert.equal(displayTitle('15-e2e-sub'), 'E2e sub');
  });

  it('leaves an unnumbered name whole and survives an empty remainder', () => {
    assert.equal(displayTitle('introduction'), 'Introduction');
    assert.equal(displayTitle('01-'), '');
  });

  it('agrees with the library copy it was inlined from', () => {
    // The tree label and the Canvas item title come from two implementations
    // of the same rule — this one, and displayTitle in
    // lib/convert/course-scanner.js. A change to either that the other does
    // not follow shows the author one title in VS Code and pushes another.
    for (const name of [
      '01-welcome',
      '02-getting-started',
      '03-my_page',
      '04-rest-API',
      '15-e2e-sub',
      '01-über-uns',
      'introduction',
      '01-',
      '',
    ]) {
      assert.equal(
        displayTitle(name),
        libraryDisplayTitle(name),
        `the two copies disagree on ${JSON.stringify(name)}`,
      );
    }
  });
});

describe('helpers: safeReadJSON', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'helpers-json-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const write = (name, text) => {
    const file = path.join(tmpDir, name);
    fs.writeFileSync(file, text, 'utf8');
    return file;
  };

  it('parses the file', () => {
    const file = write('_category_.json', '{"label": "Intro", "position": 1}');
    assert.deepStrictEqual(safeReadJSON(file), { label: 'Intro', position: 1 });
  });

  it('falls back on a missing file and on malformed JSON', () => {
    // Both are ordinary states in a course folder being edited: a module
    // without a _category_.json, and one saved half-typed. Neither may take
    // the tree down.
    assert.deepStrictEqual(safeReadJSON(path.join(tmpDir, 'absent.json')), {});
    assert.deepStrictEqual(safeReadJSON(write('bad.json', '{oops')), {});
  });

  it('honours the caller fallback, null included', () => {
    // The tree passes null and then reads `cat?.label`, so an empty object
    // would be a label-less category rather than no category at all.
    assert.equal(safeReadJSON(path.join(tmpDir, 'absent.json'), null), null);
    assert.deepStrictEqual(safeReadJSON(write('bad.json', '{oops'), { a: 1 }), {
      a: 1,
    });
  });
});

describe('helpers: readFrontmatter', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'helpers-frontmatter-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const write = (text) => {
    const file = path.join(tmpDir, 'page.md');
    fs.writeFileSync(file, text, 'utf8');
    return file;
  };

  it('reads the three fields the tree builds a row from', () => {
    const file = write(
      '---\ncanvas_type: external_url\ntitle: Course platform\nexternal_url: https://example.test/x\n---\n\nBody\n',
    );
    assert.deepStrictEqual(readFrontmatter(file), {
      canvasType: 'external_url',
      title: 'Course platform',
      externalUrl: 'https://example.test/x',
    });
  });

  it('strips the quotes a YAML writer may have added', () => {
    const file = write(
      '---\ntitle: "Chapter 1: intro"\nexternal_url: \'https://example.test/x\'\n---\n',
    );
    const fm = readFrontmatter(file);
    assert.equal(fm.title, 'Chapter 1: intro');
    assert.equal(fm.externalUrl, 'https://example.test/x');
  });

  it('defaults to a page with no title for a file without frontmatter', () => {
    assert.deepStrictEqual(readFrontmatter(write('# Just a heading\n')), {
      canvasType: 'page',
      title: null,
      externalUrl: null,
    });
  });

  it('reads a body with a horizontal rule as no frontmatter at all', () => {
    // The guard is the leading `---`. Without it the first rule anywhere in
    // the body closes a block that never opened, and prose above it that
    // happens to look like fields becomes the row's Canvas type and title:
    // this page would render as an assignment called "Fake".
    const file = write(
      'A page with a rule in it\n\ncanvas_type: assignment\ntitle: Fake\n\n---\n\nmore\n',
    );
    assert.deepStrictEqual(readFrontmatter(file), {
      canvasType: 'page',
      title: null,
      externalUrl: null,
    });
  });

  it('defaults when the frontmatter block is never closed', () => {
    const fm = readFrontmatter(write('---\ncanvas_type: assignment\n'));
    assert.equal(fm.canvasType, 'page');
  });

  it('defaults for a file that is not there to read', () => {
    assert.deepStrictEqual(readFrontmatter(path.join(tmpDir, 'gone.md')), {
      canvasType: 'page',
      title: null,
      externalUrl: null,
    });
  });

  it('reads nothing from the body below the closing delimiter', () => {
    // A line that looks like a field is prose once the block has closed —
    // reading it would give a page the icon and the Canvas URL of an
    // assignment.
    const file = write(
      '---\ntitle: Real\n---\n\ncanvas_type: assignment\ntitle: Fake\n',
    );
    const fm = readFrontmatter(file);
    assert.equal(fm.canvasType, 'page');
    assert.equal(fm.title, 'Real');
  });

  it('keeps the carriage return of a CRLF file out of the values', () => {
    // A file written on Windows, or pulled through a CRLF-normalising git
    // checkout, must not leave "page\r" as the canvas type: nothing matches
    // that against the icon map or the Canvas URL branches.
    const file = write(
      '---\r\ncanvas_type: assignment\r\ntitle: Homework\r\n---\r\n',
    );
    assert.equal(readFrontmatter(file).canvasType, 'assignment');
    assert.equal(readFrontmatter(file).title, 'Homework');
  });
});

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

describe('helpers: courseLocation', () => {
  const ws = path.join('/ws');
  const file = (...parts) => path.join('/ws', 'course', ...parts);

  it('finds the module of a file at module root', () => {
    assert.deepStrictEqual(courseLocation(ws, file('01-mod', '03-page.md')), {
      moduleFolder: '01-mod',
      segments: ['03-page.md'],
    });
  });

  it('keeps the whole path below the module for a nested subsection file', () => {
    assert.deepStrictEqual(
      courseLocation(ws, file('01-mod', '02-sub', '01-page.md')),
      { moduleFolder: '01-mod', segments: ['02-sub', '01-page.md'] },
    );
  });

  it('claims a _files asset for its module', () => {
    // segments[0] then names an entry no picker lists, which promotes no
    // item row, but the module answer is what the module pickers need.
    assert.deepStrictEqual(
      courseLocation(ws, file('01-mod', '_files', 'diagram.png')),
      { moduleFolder: '01-mod', segments: ['_files', 'diagram.png'] },
    );
  });

  it('returns null for a file directly in the course/ root', () => {
    assert.equal(courseLocation(ws, file('index.md')), null);
  });

  it('returns null under an underscore or unnumbered top-level folder', () => {
    assert.equal(courseLocation(ws, file('_shared', 'note.md')), null);
    assert.equal(courseLocation(ws, file('drafts', 'note.md')), null);
  });

  it('returns null for a file outside the workspace', () => {
    assert.equal(
      courseLocation(ws, path.join('/elsewhere', 'course', '01-mod', 'a.md')),
      null,
    );
  });

  it('never matches on a bare path prefix', () => {
    // 01-mod-extra is its own module, not a file inside 01-mod; and a
    // course-extra/ sibling of course/ is outside course/ entirely.
    assert.deepStrictEqual(courseLocation(ws, file('01-mod-extra', 'a.md')), {
      moduleFolder: '01-mod-extra',
      segments: ['a.md'],
    });
    assert.equal(
      courseLocation(ws, path.join('/ws', 'course-extra', '01-mod', 'a.md')),
      null,
    );
  });

  it('shrugs off trailing separators', () => {
    assert.deepStrictEqual(
      courseLocation(`${ws}${path.sep}`, file('01-mod', 'a.md')),
      { moduleFolder: '01-mod', segments: ['a.md'] },
    );
    // The module directory itself, trailing separator and all, is not a file
    // inside the module.
    assert.equal(courseLocation(ws, `${file('01-mod')}${path.sep}`), null);
  });

  it('folds case only where the platform does', () => {
    // No case-folding is added here and none is taken away: the comparison is
    // `path.relative`, which is case-sensitive on POSIX and case-insensitive on
    // win32. So `Course/` is a directory of its own on one and the same
    // directory as `course/` on the other, and the answer follows the platform
    // the editor is actually running on.
    const mixed = path.join('/ws', 'Course', '01-m', 'a.md');
    if (process.platform === 'win32') {
      assert.deepStrictEqual(courseLocation(ws, mixed), {
        moduleFolder: '01-m',
        segments: ['a.md'],
      });
    } else {
      assert.equal(courseLocation(ws, mixed), null);
    }
  });

  it('returns null when either input is missing', () => {
    assert.equal(courseLocation(null, file('01-mod', 'a.md')), null);
    assert.equal(courseLocation(ws, null), null);
    assert.equal(courseLocation(ws, path.join('/ws', 'course')), null);
  });
});

describe('helpers: promoteActive', () => {
  const items = () => [
    { label: 'a', description: '01-a', folder: '01-a' },
    { label: 'b', description: '01-b', folder: '01-b' },
    { label: 'c', description: '01-c', folder: '01-c' },
  ];

  it('moves the match to the front, marked, keeping every entry', () => {
    const result = promoteActive(items(), (i) => i.folder === '01-c', 'here');
    assert.deepStrictEqual(
      result.map((i) => i.label),
      ['c', 'a', 'b'],
    );
    assert.equal(result[0].description, '01-c · here');
    assert.equal(result.length, 3);
  });

  it('marks a match that is already first', () => {
    const result = promoteActive(items(), (i) => i.folder === '01-a', 'here');
    assert.deepStrictEqual(
      result.map((i) => i.label),
      ['a', 'b', 'c'],
    );
    assert.equal(result[0].description, '01-a · here');
  });

  it('uses the note alone when the entry has no description', () => {
    const result = promoteActive(
      [{ label: 'x' }, { label: 'y', description: '' }],
      (i) => i.label === 'y',
      'current file',
    );
    assert.equal(result[0].description, 'current file');
  });

  it('returns the list untouched when nothing matches', () => {
    const input = items();
    assert.deepStrictEqual(
      promoteActive(input, () => false, 'here'),
      input,
    );
  });

  it('mutates neither the list nor the promoted entry', () => {
    const input = items();
    promoteActive(input, (i) => i.folder === '01-b', 'here');
    assert.deepStrictEqual(input, items());
  });
});

describe('helpers: seedsDestination', () => {
  const at = (moduleFolder, ...segments) => ({ moduleFolder, segments });

  it('seeds for an item outside the active module', () => {
    assert.equal(
      seedsDestination(at('02-other', '01-a.md'), at('01-mod', '03-b.md')),
      true,
    );
  });

  it('refuses an item already in the active module', () => {
    // Seeded, Enter would run movetomodule-item onto the item's own module,
    // which appends and gap-closes: a silent move to the end, not a no-op.
    assert.equal(
      seedsDestination(at('01-mod', '01-a.md'), at('01-mod', '03-b.md')),
      false,
    );
    // Same module even when the two sit in different subsections of it.
    assert.equal(
      seedsDestination(
        at('01-mod', '02-sub', '01-a.md'),
        at('01-mod', '03-b.md'),
      ),
      false,
    );
  });

  it('refuses without an active file to offer', () => {
    assert.equal(seedsDestination(at('02-other', '01-a.md'), null), false);
  });

  it('refuses an item it cannot place', () => {
    assert.equal(seedsDestination(null, at('01-mod', '03-b.md')), false);
    assert.equal(seedsDestination(null, null), false);
  });
});

describe('helpers: getCanvasId and getModuleCanvasId', () => {
  // The same v4 state the two lookups read, on disk, because both of them
  // reach for `.canvas-sync.json` themselves: they are what turns a tree row
  // into a Canvas address, and no markdown file carries an id any more.
  const state = {
    schema_version: 4,
    modules: {
      '01-intro': {
        canvas_module_id: 67890,
        name: 'Intro',
        items: {
          '01-intro/01-welcome.md': {
            canvas_type: 'page',
            canvas_id: 'welcome',
          },
          '01-intro/02-sub/01-deep.md': {
            canvas_type: 'assignment',
            canvas_id: 4321,
          },
          '01-intro/03-draft.md': { canvas_type: 'page', canvas_id: null },
        },
      },
      '02-planning': {
        name: 'Planning',
        items: {
          '02-planning/01-brief.md': { canvas_type: 'page', canvas_id: 999 },
        },
      },
    },
  };

  let root;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'helpers-state-'));
    fs.writeFileSync(
      path.join(root, '.canvas-sync.json'),
      JSON.stringify(state),
      'utf8',
    );
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const inCourse = (...parts) => path.join(root, 'course', ...parts);

  it('returns the id as a string, whichever module row holds it', () => {
    // A page id is a slug, an assignment id is a number, and the row may sit
    // under any module: the lookup is by path key, not by module.
    assert.equal(
      getCanvasId(root, inCourse('01-intro', '01-welcome.md')),
      'welcome',
    );
    assert.equal(
      getCanvasId(root, inCourse('02-planning', '01-brief.md')),
      '999',
    );
  });

  it('keys a subsection file with forward slashes', () => {
    // The state is committed and shared between machines, so its keys are
    // always forward-slashed; on Windows the native separator would miss.
    assert.equal(
      getCanvasId(root, inCourse('01-intro', '02-sub', '01-deep.md')),
      '4321',
    );
  });

  it('returns null for a file the state has no id for', () => {
    // Not pushed yet (no row) and pushed-but-idless are the same answer: the
    // caller says "this item has not been pushed to Canvas yet".
    assert.equal(getCanvasId(root, inCourse('01-intro', '99-new.md')), null);
    assert.equal(getCanvasId(root, inCourse('01-intro', '03-draft.md')), null);
  });

  it('returns null outside course/, and for course/ itself', () => {
    assert.equal(
      getCanvasId(root, path.join(root, 'sources', 'note.md')),
      null,
    );
    assert.equal(getCanvasId(root, path.join(root, 'course')), null);
    assert.equal(
      getCanvasId(root, path.join(root, 'course-extra', '01-intro', 'a.md')),
      null,
    );
  });

  it('returns null without a workspace root', () => {
    assert.equal(
      getCanvasId(null, inCourse('01-intro', '01-welcome.md')),
      null,
    );
    assert.equal(getModuleCanvasId(null, '01-intro'), null);
    assert.equal(getModuleCanvasId(root, null), null);
  });

  it('reads the module id off the module row', () => {
    assert.equal(getModuleCanvasId(root, '01-intro'), '67890');
    // Created locally, never pushed: the row exists, the id does not.
    assert.equal(getModuleCanvasId(root, '02-planning'), null);
    assert.equal(getModuleCanvasId(root, '09-unknown'), null);
  });

  it('reads the state fresh, so a push mid-session is seen', () => {
    // A cached state would send the author to the wrong object after a pull,
    // or to none at all for an item that has only just been created.
    assert.equal(getCanvasId(root, inCourse('01-intro', '99-new.md')), null);
    const pushed = JSON.parse(JSON.stringify(state));
    pushed.modules['01-intro'].items['01-intro/99-new.md'] = {
      canvas_type: 'page',
      canvas_id: 555,
    };
    fs.writeFileSync(
      path.join(root, '.canvas-sync.json'),
      JSON.stringify(pushed),
      'utf8',
    );
    assert.equal(getCanvasId(root, inCourse('01-intro', '99-new.md')), '555');
  });

  it('treats a missing or corrupt state as no ids at all', () => {
    fs.writeFileSync(path.join(root, '.canvas-sync.json'), '{oops', 'utf8');
    assert.equal(
      getCanvasId(root, inCourse('01-intro', '01-welcome.md')),
      null,
    );
    assert.equal(getModuleCanvasId(root, '01-intro'), null);
    fs.rmSync(path.join(root, '.canvas-sync.json'), { force: true });
    assert.equal(
      getCanvasId(root, inCourse('01-intro', '01-welcome.md')),
      null,
    );
    assert.equal(getModuleCanvasId(root, '01-intro'), null);
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

describe('helpers: readEnvConfig', () => {
  let root;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'helpers-env-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const writeEnv = (text) => {
    fs.writeFileSync(path.join(root, '.env'), text, 'utf8');
    return readEnvConfig(root);
  };

  it('reads the pairs "Open in Canvas" builds its URL from', () => {
    const env = writeEnv(
      'CANVAS_API_URL=https://school.instructure.com/api/v1\nCANVAS_COURSE_ID=45083\n',
    );
    assert.equal(env.CANVAS_API_URL, 'https://school.instructure.com/api/v1');
    assert.equal(env.CANVAS_COURSE_ID, '45083');
  });

  it('skips comment lines and blank lines, commented-out keys included', () => {
    // A commented-out key is the shape that matters, and the one a hand-edited
    // .env grows: last year's credentials kept alongside this year's. Only the
    // leading `^` of the line pattern tells the two apart, and read as live
    // configuration a stale id would send "Open in Canvas" to the course the
    // author had deliberately retired. dotenv skips them too.
    const env = writeEnv(
      '# Canvas credentials\n\nCANVAS_COURSE_ID=45083\n# CANVAS_COURSE_ID=99999\n# CANVAS_API_TOKEN=last-years-token\n\n# end\n',
    );
    assert.deepStrictEqual(env, { CANVAS_COURSE_ID: '45083' });
  });

  it('trims the whitespace around a bare value', () => {
    const env = writeEnv('CANVAS_COURSE_ID =  45083  \n');
    assert.equal(env.CANVAS_COURSE_ID, '45083');
  });

  it('splits on the first = only', () => {
    // A token is base64 and an API URL carries query strings; both hold =.
    const env = writeEnv('CANVAS_API_TOKEN=abc==def\n');
    assert.equal(env.CANVAS_API_TOKEN, 'abc==def');
  });

  it('reads a key with nothing after the = without losing the rest', () => {
    const env = writeEnv('CANVAS_COURSE_ID=\nCANVAS_API_URL=https://x.test\n');
    assert.equal(env.CANVAS_COURSE_ID, '');
    assert.equal(env.CANVAS_API_URL, 'https://x.test');
  });

  it('reads a CRLF file the same as an LF one', () => {
    // `.` never matches a carriage return and `$` without the `m` flag does
    // not match before one, so `KEY=value\r` used to match nothing at all: a
    // .env written on Windows read as empty, and "Open in Canvas" reported no
    // Canvas configuration on a workspace that had one, while every CLI
    // command read the same file through dotenv without trouble.
    const crlf = writeEnv(
      'CANVAS_API_URL=https://x.test\r\nCANVAS_COURSE_ID=45083\r\n',
    );
    assert.deepStrictEqual(crlf, {
      CANVAS_API_URL: 'https://x.test',
      CANVAS_COURSE_ID: '45083',
    });
    assert.deepStrictEqual(
      writeEnv('CANVAS_API_URL=https://x.test\nCANVAS_COURSE_ID=45083\n'),
      crlf,
    );
  });

  it('reads a file that mixes the two endings', () => {
    // One author on Windows and one on macOS editing the same .env, or an
    // editor that appends in its own ending: every line is read whichever way
    // it ends, the last one included when it ends with nothing at all.
    assert.deepStrictEqual(
      writeEnv(
        '# Canvas credentials\r\nCANVAS_API_URL=https://x.test\nCANVAS_API_TOKEN=abc123\r\n\r\nCANVAS_COURSE_ID=45083',
      ),
      {
        CANVAS_API_URL: 'https://x.test',
        CANVAS_API_TOKEN: 'abc123',
        CANVAS_COURSE_ID: '45083',
      },
    );
  });

  it('takes the quotes off a CRLF line too', () => {
    // The two rules meet on the line a Windows author is most likely to have
    // both of: a quoted URL, ending in CRLF.
    assert.deepStrictEqual(writeEnv('CANVAS_API_URL="https://x.test"\r\n'), {
      CANVAS_API_URL: 'https://x.test',
    });
  });

  it('returns nothing at all when there is no .env to read', () => {
    // The state a fresh clone is in until Init runs; the caller shows its own
    // "no Canvas configuration" warning rather than failing.
    assert.deepStrictEqual(readEnvConfig(root), {});
  });
});

describe('helpers: readEnvConfig takes off surrounding quotes', () => {
  // Quoting a value is ordinary .env practice, and dotenv — which every CLI
  // command loads the same file with — unwraps it. Reading the quotes as part
  // of the value gave the CLI the right host and "Open in Canvas" a URL
  // starting with a quote character.
  let root;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'helpers-env-quotes-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const value = (line) => {
    fs.writeFileSync(path.join(root, '.env'), `${line}\n`, 'utf8');
    return readEnvConfig(root).KEY;
  };

  it('leaves an unquoted value exactly as it is', () => {
    assert.equal(
      value('KEY=https://school.instructure.com/api/v1'),
      'https://school.instructure.com/api/v1',
    );
  });

  it('takes off a matched pair of double quotes', () => {
    assert.equal(
      value('KEY="https://school.instructure.com/api/v1"'),
      'https://school.instructure.com/api/v1',
    );
  });

  it('takes off a matched pair of single quotes', () => {
    assert.equal(value("KEY='45083'"), '45083');
  });

  it('leaves two different quote characters alone', () => {
    // Neither end closes the other, so nothing here is a wrapper.
    assert.equal(value('KEY="45083\''), '"45083\'');
    assert.equal(value('KEY=\'45083"'), '\'45083"');
  });

  it('leaves a quote at one end only alone', () => {
    assert.equal(value('KEY="45083'), '"45083');
    assert.equal(value('KEY=45083"'), '45083"');
    // One quote and nothing else is a one-character value, not a wrapper.
    assert.equal(value('KEY="'), '"');
  });

  it('leaves a quote inside the value alone', () => {
    assert.equal(value('KEY=pa"ss'), 'pa"ss');
    assert.equal(value("KEY=pa'ss"), "pa'ss");
    // Only the outer pair comes off; the inner one is part of the value.
    assert.equal(value('KEY="say "hi""'), 'say "hi"');
  });

  it('reads an empty quoted value as an empty string', () => {
    fs.writeFileSync(path.join(root, '.env'), 'KEY=""\nOTHER=x\n', 'utf8');
    const env = readEnvConfig(root);
    assert.equal(env.KEY, '');
    assert.equal(env.OTHER, 'x');
    // Quoted or bare, an emptied-out value reads the same way.
    assert.equal(value('KEY='), '');
  });

  it('keeps a = inside a quoted value', () => {
    assert.equal(value('KEY="abc==def"'), 'abc==def');
  });

  it('trims outside the quotes and preserves what is inside them', () => {
    // Quotes are how a .env says the whitespace is part of the value.
    assert.equal(value('KEY =  "  spaced  "  '), '  spaced  ');
    assert.equal(value('KEY =   45083  '), '45083');
  });

  it('reads a quoted file whole, past comments and blank lines', () => {
    fs.writeFileSync(
      path.join(root, '.env'),
      '# Canvas credentials\n\nCANVAS_API_URL="https://school.instructure.com/api/v1"\n\nCANVAS_COURSE_ID=\'45083\'\n# "not a value"\n',
      'utf8',
    );
    assert.deepStrictEqual(readEnvConfig(root), {
      CANVAS_API_URL: 'https://school.instructure.com/api/v1',
      CANVAS_COURSE_ID: '45083',
    });
  });
});

describe('helpers: readEnvConfig reads a hand-edited .env', () => {
  // docs/new-academic-year.md tells the author to open .env and change the
  // course id by hand, so the shapes a person writes are the shapes that have
  // to work. Each of these used to drop the line, or keep a comment inside the
  // value, while every CLI command read the same file through dotenv.
  let root;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'helpers-env-hand-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const value = (line) => {
    fs.writeFileSync(path.join(root, '.env'), `${line}\n`, 'utf8');
    return readEnvConfig(root).K;
  };

  it('drops an inline comment after a bare value', () => {
    assert.equal(value('K=45083 # last year was 44012'), '45083');
    // No space needed before the #, the way dotenv reads it.
    assert.equal(value('K=45083# terse'), '45083');
  });

  it('drops an inline comment after a quoted value', () => {
    // The likelier of the two: quoting a URL is what invites a trailing note.
    assert.equal(value('K="https://x.test" # sandbox'), 'https://x.test');
    assert.equal(value("K='45083' # sandbox"), '45083');
  });

  it('keeps a # that the quotes protect', () => {
    assert.equal(value('K="https://x.test/#anchor"'), 'https://x.test/#anchor');
    // Unquoted, the fragment is a comment — to dotenv as well, so the CLI and
    // the extension are wrong about this one together rather than separately.
    assert.equal(value('K=https://x.test/#anchor'), 'https://x.test/');
  });

  it('reads a line the author left an export on', () => {
    assert.equal(value('export K=45083'), '45083');
    assert.equal(value('export K="https://x.test"'), 'https://x.test');
  });

  it('reads a line the author indented', () => {
    assert.equal(value('  K=45083'), '45083');
    assert.equal(value('\tK=45083'), '45083');
  });

  it('reads an emptied-out value as empty rather than dropping the key', () => {
    // Clearing the value is how an author parks a setting. Dropping the key
    // said "no configuration at all", which is a different thing.
    fs.writeFileSync(path.join(root, '.env'), 'K=\nOTHER=x\n', 'utf8');
    const env = readEnvConfig(root);
    assert.equal(env.K, '');
    assert.equal(env.OTHER, 'x');
    assert.equal(value('K= # nothing yet'), '');
  });

  it('still tells a commented-out key from a live one', () => {
    fs.writeFileSync(path.join(root, '.env'), '  # K=99999\nK=45083\n', 'utf8');
    assert.deepStrictEqual(readEnvConfig(root), { K: '45083' });
  });

  it('reads a whole hand-edited file', () => {
    fs.writeFileSync(
      path.join(root, '.env'),
      '# Canvas credentials\nCANVAS_API_URL="https://x.test"  # sandbox\nexport CANVAS_API_TOKEN=abc  \n  CANVAS_COURSE_ID=45083\n# CANVAS_COURSE_ID=99999\n',
      'utf8',
    );
    assert.deepStrictEqual(readEnvConfig(root), {
      CANVAS_API_URL: 'https://x.test',
      CANVAS_API_TOKEN: 'abc',
      CANVAS_COURSE_ID: '45083',
    });
  });
});

describe('helpers: readEnvConfig agrees with dotenv', () => {
  // The CLI loads this same file through dotenv (cli/index.js), so any shape
  // the two read differently is a file the author has configured for one half
  // of the tool and not the other. readEnvConfig cannot call dotenv — the
  // installed extension has no node_modules — so agreement is held by this
  // corpus instead. A dotenv upgrade that moves either list shows up here.
  let root;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'helpers-env-dotenv-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const read = (content) => {
    fs.writeFileSync(path.join(root, '.env'), content, 'utf8');
    return readEnvConfig(root);
  };

  const AGREED = [
    ['plain', 'CANVAS_API_URL=https://school.instructure.com/api/v1'],
    ['double quoted', 'CANVAS_API_URL="https://school.instructure.com/api/v1"'],
    ['single quoted', "CANVAS_COURSE_ID='45083'"],
    ['inline comment, bare', 'K=45083 # my course'],
    ['inline comment, quoted', 'K="https://x.test" # prod'],
    ['inline comment, no space', 'K=45083# terse'],
    ['comment only after =', 'K= # nothing yet'],
    ['export', 'export K=value'],
    ['export quoted', 'export K="value"'],
    ['leading whitespace', '   K=value'],
    ['leading tab', '\tK=value'],
    ['empty value', 'K='],
    ['empty quoted value', 'K=""'],
    ['quoted whitespace', 'K="  spaced  "'],
    ['loose spacing', 'K =  45083  '],
    ['comment line', '# comment'],
    ['commented-out key', '# CANVAS_COURSE_ID=99999'],
    ['commented-out key, indented', '  # CANVAS_COURSE_ID=99999'],
    ['blank line', ''],
    ['mismatched quotes', 'K="45083\''],
    ['open quote', 'K="45083'],
    ['close quote', 'K=45083"'],
    ['bare quote', 'K="'],
    ['internal quote', 'K=pa"ss'],
    ['nested quotes', 'K="say "hi""'],
    ['equals in value', 'K=abc==def'],
    ['equals in quoted value', 'K="abc==def"'],
    ['url fragment, quoted', 'K="https://x.test/#anchor"'],
    // A # inside single quotes, with and without a comment after the closing
    // quote: the single-quote branch of the pattern is the only thing that
    // keeps the # out of the comment, and the `\s*` before the comment is the
    // only thing that lets a comment follow a quoted value at all.
    ['single-quoted #', "K='a#b'"],
    ['single-quoted # with a comment after it', "K='a#b' # c"],
    // An escaped quote inside double quotes, which the `\\"` alternative of
    // the double-quote branch is there for. dotenv leaves the backslash in
    // place as well: only \n and \r are expanded.
    ['escaped quote inside double quotes', 'K="a\\" # b"'],
    ['underscore key', '_K=1'],
    ['digit in key', 'K2=1'],
    ['file, LF', 'A=1\nB=2\n'],
    ['file, CRLF', 'A=1\r\nB=2\r\n'],
    // CRLF and an inline comment together, which no other row combines. The
    // pattern's trailing `\s*` swallows a stray \r on a plain line, so this is
    // the shape — and the only shape here — that the CRLF split is still
    // load-bearing for: `#.*` stops at the \r and the line is dropped whole.
    ['file, CRLF with inline comment', 'A=1 # note\r\nB=2\r\n'],
    ['file, mixed', '# creds\r\nA=1\nB=2\r\n\r\nC=3'],
    [
      'file, hand-edited',
      '# Canvas credentials\nCANVAS_API_URL="https://x.test"  # sandbox\nexport CANVAS_API_TOKEN=abc  \n  CANVAS_COURSE_ID=45083\n# CANVAS_COURSE_ID=99999\n',
    ],
  ];

  // Shapes left to dotenv alone, each because nothing writes it here: this
  // project's keys are the three CANVAS_* names that `npx course init` writes.
  // Listed rather than ignored, so a later reader sees the edge was considered
  // and an implementation that closes one of them fails this test on purpose.
  //
  // Both sides are spelled out. Asserting only that the two differ would pass
  // for any difference at all, including one where the reader has started
  // reading a shape it is documented not to read — `[^#\r]*` widened to
  // `[^#]*` leaves the lone-CR file parsing as {A: '1\rB=2'}, a malformed line
  // read as live configuration, and "they still differ" calls that fine.
  const DIVERGES = [
    {
      name: 'dotted key',
      input: 'K.WITH.DOTS=1',
      ours: {},
      theirs: { 'K.WITH.DOTS': '1' },
    },
    {
      name: 'hyphenated key',
      input: 'K-WITH-DASH=1',
      ours: {},
      theirs: { 'K-WITH-DASH': '1' },
    },
    {
      name: 'colon separator',
      input: 'K: value',
      ours: {},
      theirs: { K: 'value' },
    },
    {
      name: 'backtick quotes',
      input: 'K=`value`',
      ours: { K: '`value`' },
      theirs: { K: 'value' },
    },
    {
      name: 'escape inside double quotes',
      input: 'K="line1\\nline2"',
      ours: { K: 'line1\\nline2' },
      theirs: { K: 'line1\nline2' },
    },
    {
      name: 'value spanning lines',
      input: 'K="line1\nline2"\n',
      ours: { K: '"line1' },
      theirs: { K: 'line1\nline2' },
    },
    {
      // dotenv replaces /\r\n?/mg with \n before it matches anything, so it
      // reads both pairs. Normalising that wide here would turn one malformed
      // line into configuration, so the file goes on reading as nothing.
      name: 'lone CR endings',
      input: 'A=1\rB=2\r',
      ours: {},
      theirs: { A: '1', B: '2' },
    },
    {
      // dotenv matches one global /m pattern whose `\s*=` crosses the newline;
      // this reads a line at a time. Unreachable in a file anyone hand-edits.
      name: 'key and = on separate lines',
      input: 'A\n=v',
      ours: {},
      theirs: { A: 'v' },
    },
  ];

  for (const [name, content] of AGREED) {
    it(`agrees on ${name}`, () => {
      assert.deepStrictEqual(read(content), dotenv.parse(content));
    });
  }

  for (const { name, input, ours, theirs } of DIVERGES) {
    it(`knowingly differs on ${name}`, () => {
      assert.deepStrictEqual(
        read(input),
        ours,
        `readEnvConfig has moved on this shape. If it now reads it the way dotenv does, move the row to AGREED; if it reads it some third way, that is a bug.`,
      );
      assert.deepStrictEqual(
        dotenv.parse(input),
        theirs,
        `dotenv has moved on this shape, which takes a deliberate version bump (package-lock.json pins it and CI runs npm ci). Re-derive the rules from node_modules/dotenv/lib/main.js, then move the row to AGREED if the two now agree.`,
      );
      assert.notDeepStrictEqual(
        ours,
        theirs,
        `this row claims a divergence but spells the same result on both sides — it belongs in AGREED`,
      );
    });
  }
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

// --- Shell quoting -------------------------------------------------------
//
// Golden strings alone would only pin the implementation to itself: had the
// cmd rule been written with `\"` instead of `""`, the golden strings would
// have been written to match it and the suite would have stayed green while
// shipping an injection. So the two flavours that cannot be executed here are
// judged by independent models of the parsers they have to satisfy, written
// from the documented algorithms. `crtArgv` is validated against Microsoft's
// published examples; the other four have no published example table to check
// against, so each is validated below against worked cases of the rules it
// implements. The three flavours that can be executed are executed instead.

/**
 * The MSVC CRT's command-line parser — the one that matters here, because
 * `node.exe` has a `wmain` and so takes its argv from the CRT rather than from
 * `CommandLineToArgvW`. 2n backslashes before a `"` are n backslashes and the
 * quote is a delimiter; 2n+1 are n backslashes and a literal quote; and inside
 * a quoted region `""` is one literal quote that leaves the region open. That
 * last rule is where the two parsers part company: `CommandLineToArgvW` wants
 * three consecutive quotes for the same effect, so a program taking its argv
 * from that would split several of these values.
 */
function crtArgv(line) {
  const args = [];
  let i = 0;
  while (i < line.length) {
    while (line[i] === ' ' || line[i] === '\t') i++;
    if (i >= line.length) break;
    let arg = '';
    let quoted = false;
    while (i < line.length) {
      const c = line[i];
      if (!quoted && (c === ' ' || c === '\t')) break;
      if (c === '\\') {
        let slashes = 0;
        while (line[i] === '\\') {
          slashes++;
          i++;
        }
        if (line[i] === '"') {
          arg += '\\'.repeat(slashes >> 1);
          if (slashes % 2 === 1) {
            arg += '"';
            i++;
          }
        } else {
          arg += '\\'.repeat(slashes);
        }
        continue;
      }
      if (c === '"') {
        if (quoted && line[i + 1] === '"') {
          arg += '"';
          i += 2;
          continue;
        }
        quoted = !quoted;
        i++;
        continue;
      }
      arg += c;
      i++;
    }
    args.push(arg);
  }
  return args;
}

/**
 * cmd.exe percent expansion, command-line rules: an undefined `%VAR%` and a
 * lone `%` are left exactly as typed, and substituted text is not rescanned.
 */
function cmdPercent(line, env) {
  let out = '';
  let i = 0;
  while (i < line.length) {
    if (line[i] !== '%') {
      out += line[i++];
      continue;
    }
    const close = line.indexOf('%', i + 1);
    if (close === -1) {
      out += line[i++];
      continue;
    }
    const name = Object.keys(env).find(
      (k) => k.toLowerCase() === line.slice(i + 1, close).toLowerCase(),
    );
    out += name === undefined ? line.slice(i, close + 1) : env[name];
    i = close + 1;
  }
  return out;
}

/**
 * cmd.exe's caret and quote pass. Returns the text cmd hands on, and every
 * command-splitting metacharacter that was live when it got there — a caret
 * only escapes outside a quoted region, and only there do `&`, `|`, `<` and
 * `>` split the line.
 */
function cmdSpecial(line) {
  let text = '';
  let quoted = false;
  const live = [];
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '^' && !quoted) {
      if (i + 1 < line.length) text += line[++i];
      continue;
    }
    if (c === '"') quoted = !quoted;
    else if (!quoted && '&|<>'.includes(c)) live.push(c);
    text += c;
  }
  return { text, live, quoted };
}

/** A PowerShell single-quoted string literal: `''` is one quote, nothing else escapes. */
function psSingleQuoted(token) {
  assert.equal(token[0], "'", 'not a single-quoted token');
  let value = '';
  let i = 1;
  for (;;) {
    if (i >= token.length) throw new Error('unterminated single-quoted string');
    if (token[i] === "'") {
      if (token[i + 1] === "'") {
        value += "'";
        i += 2;
        continue;
      }
      i++;
      break;
    }
    value += token[i++];
  }
  assert.equal(i, token.length, 'trailing text after the closing quote');
  return value;
}

/** PowerShell argument tokens, honouring both quote forms. */
function psTokens(line) {
  const tokens = [];
  let i = 0;
  while (i < line.length) {
    while (line[i] === ' ') i++;
    if (i >= line.length) break;
    const start = i;
    while (i < line.length && line[i] !== ' ') {
      if (line[i] === "'") {
        i++;
        while (i < line.length) {
          if (line[i] === "'" && line[i + 1] === "'") i += 2;
          else if (line[i] === "'") {
            i++;
            break;
          } else i++;
        }
        continue;
      }
      if (line[i] === '"') {
        i++;
        while (i < line.length && line[i] !== '"') i++;
        i++;
        continue;
      }
      i++;
    }
    tokens.push(line.slice(start, i));
  }
  return tokens;
}

/** A fish single-quoted string literal: only `\\` and `\'` escape. */
function fishSingleQuoted(token) {
  assert.equal(token[0], "'", 'not a single-quoted token');
  let value = '';
  let i = 1;
  for (;;) {
    if (i >= token.length) throw new Error('unterminated single-quoted string');
    const c = token[i];
    if (c === "'") {
      i++;
      break;
    }
    if (c === '\\' && (token[i + 1] === '\\' || token[i + 1] === "'")) {
      value += token[i + 1];
      i += 2;
      continue;
    }
    value += c;
    i++;
  }
  assert.equal(i, token.length, 'trailing text after the closing quote');
  return value;
}

// The values that separate one quoting rule from another: a lone quote and a
// run of them, a trailing backslash, every expansion sigil, both history
// forms, and a command-chaining attempt for each shell family.
const HOSTILE = [
  '',
  'flexbox',
  'two words',
  "'",
  "it's",
  "''''",
  'he said "hi"',
  'a"b&c',
  '$HOME',
  '$(whoami)',
  '`whoami`',
  'wow!!',
  '!important',
  'a!b',
  'a\\!b',
  '%PATH%',
  '100% done',
  'a; echo PWNED',
  'a && echo PWNED',
  'a | echo PWNED',
  '*.md ?[a-z]',
  'a > /tmp/pwned',
  'C:\\dir\\',
  'a\\\\b',
  'C:\\Users\\lars\\file.md',
  'x^y(z)|w<v>u',
  'café — 日本語',
  '$(id)`id`"x"\'y\'!;&|><*~%A% \\ end',
];

describe('helpers: the parser models these tests judge by', () => {
  // An oracle nobody checked is just a second copy of the bug. crtArgv has
  // Microsoft's table; these four have to be pinned against worked cases of
  // the rules they claim to implement, or the assertions built on them mean
  // nothing. cmdSpecial carries the most weight of any of them: every
  // `live === []` claim in the cmd suite is its word.
  it('cmdSpecial: a caret escapes outside quotes and is literal inside', () => {
    assert.deepStrictEqual(cmdSpecial('echo a&b').live, ['&']);
    assert.deepStrictEqual(cmdSpecial('echo a^&b'), {
      text: 'echo a&b',
      live: [],
      quoted: false,
    });
    // Inside a quoted region the metacharacter is inert and the caret is not
    // an escape — it stays in the text.
    assert.deepStrictEqual(cmdSpecial('echo "a&b"'), {
      text: 'echo "a&b"',
      live: [],
      quoted: false,
    });
    assert.deepStrictEqual(cmdSpecial('echo "a^b"').text, 'echo "a^b"');
    // A caret-escaped quote does not open a region, so what follows is live.
    assert.deepStrictEqual(cmdSpecial('echo ^"a&b^"'), {
      text: 'echo "a&b"',
      live: ['&'],
      quoted: false,
    });
    assert.equal(cmdSpecial('^^').text, '^');
    assert.equal(cmdSpecial('echo "a').quoted, true);
    assert.deepStrictEqual(cmdSpecial('a|b<c>d').live, ['|', '<', '>']);
  });

  it('cmdPercent: expands a defined name, leaves everything else as typed', () => {
    const env = { PATH: 'C:\\Windows', A: '%B%', B: 'x' };
    assert.equal(cmdPercent('%PATH%', env), 'C:\\Windows');
    assert.equal(cmdPercent('%path%', env), 'C:\\Windows', 'names fold case');
    assert.equal(cmdPercent('%NOPE%', env), '%NOPE%');
    assert.equal(cmdPercent('100% done', env), '100% done');
    assert.equal(cmdPercent('%PATH', env), '%PATH');
    // Substituted text is not rescanned, which is why %A% stops at %B%.
    assert.equal(cmdPercent('%A%', env), '%B%');
    // The caret trick this module relies on: the name no longer matches.
    assert.equal(cmdPercent('^%PATH^%', env), '^%PATH^%');
  });

  it('psSingleQuoted: doubled quotes are one quote, nothing else escapes', () => {
    assert.equal(psSingleQuoted("''"), '');
    assert.equal(psSingleQuoted("'a'"), 'a');
    assert.equal(psSingleQuoted("'it''s'"), "it's");
    assert.equal(psSingleQuoted("'$HOME`n\\'"), '$HOME`n\\');
    assert.throws(() => psSingleQuoted("'unterminated"));
    assert.throws(() => psSingleQuoted("'a' trailing"));
  });

  it('psTokens: quotes hold a token together, either kind', () => {
    assert.deepStrictEqual(psTokens('& "node" cli.js'), [
      '&',
      '"node"',
      'cli.js',
    ]);
    assert.deepStrictEqual(psTokens("a 'b c' d"), ['a', "'b c'", 'd']);
    assert.deepStrictEqual(psTokens("'it''s here'"), ["'it''s here'"]);
    assert.deepStrictEqual(psTokens(`'a "b" c'`), [`'a "b" c'`]);
  });

  it("fishSingleQuoted: only \\\\ and \\' escape", () => {
    assert.equal(fishSingleQuoted("'a'"), 'a');
    assert.equal(fishSingleQuoted("'a\\\\b'"), 'a\\b');
    assert.equal(fishSingleQuoted("'a\\'b'"), "a'b");
    // A backslash before anything else is literal, both characters kept.
    assert.equal(fishSingleQuoted("'a\\nb'"), 'a\\nb');
    assert.throws(() => fishSingleQuoted("'unterminated"));
  });
});

describe('helpers: shellQuote refuses what it cannot represent', () => {
  // Refusing is the whole mechanism: there is no string that means "a value
  // with a line break in it" to csh or cmd, so returning anything at all would
  // be returning something that runs a second command.
  for (const flavour of ['csh', 'cmd', 'powershell']) {
    it(`refuses a line break for ${flavour}`, () => {
      for (const value of ['a\nb', 'a\r\nb', 'a\rb', '\n', 'x\ntouch /tmp/p']) {
        assert.throws(
          () => shellQuote(value, flavour),
          (error) => {
            assert.ok(error instanceof UnquotableValue);
            assert.equal(error.flavour, flavour);
            assert.match(error.message, /line break/);
            return true;
          },
          JSON.stringify(value),
        );
      }
    });
  }

  for (const flavour of ['posix', 'fish']) {
    it(`carries a line break for ${flavour}, which is verified there`, () => {
      assert.equal(typeof shellQuote('a\nb', flavour), 'string');
      assert.ok(shellQuote('a\nb', flavour).includes('\n'));
    });
  }

  it('refuses a null byte everywhere, since no argv entry can hold one', () => {
    for (const flavour of ['posix', 'fish', 'csh', 'cmd', 'powershell']) {
      assert.throws(() => shellQuote('a\0b', flavour), UnquotableValue);
    }
  });

  it('names the value and the shell, so the author can act on it', () => {
    const error = (() => {
      try {
        shellQuote('01-intro\ntouch /tmp/pwned', 'csh');
      } catch (e) {
        return e;
      }
    })();
    assert.match(error.message, /01-intro/);
    assert.match(error.message, /csh would run as a second command/);
    assert.equal(error.value, '01-intro\ntouch /tmp/pwned');
  });

  it('shortens a long value rather than pasting a whole path into a popup', () => {
    const error = (() => {
      try {
        shellQuote(`${'x'.repeat(200)}\n`, 'cmd');
      } catch (e) {
        return e;
      }
    })();
    assert.ok(error.message.length < 130, error.message.length);
    assert.match(error.message, /…/);
  });

  it('refuses a flavour it does not know instead of guessing POSIX', () => {
    // Silently falling through to POSIX would quote for the wrong shell, which
    // is the injection this module exists to prevent.
    assert.throws(() => shellQuote('x', 'nushell'), /unknown shell flavour/);
    assert.throws(() => shellQuote('x', undefined), /unknown shell flavour/);
  });
});

describe('helpers: shellFlavour', () => {
  it('reads the flavour off the shell name, not the platform', () => {
    assert.equal(shellFlavour('/bin/zsh', 'darwin'), 'posix');
    assert.equal(shellFlavour('/bin/bash', 'linux'), 'posix');
    assert.equal(shellFlavour('/bin/dash', 'linux'), 'posix');
    assert.equal(shellFlavour('/usr/bin/fish', 'darwin'), 'fish');
    assert.equal(shellFlavour('/bin/tcsh', 'darwin'), 'csh');
    assert.equal(shellFlavour('/bin/csh', 'freebsd'), 'csh');
    assert.equal(
      shellFlavour('C:\\Windows\\System32\\cmd.exe', 'win32'),
      'cmd',
    );
    assert.equal(
      shellFlavour('C:\\Program Files\\PowerShell\\7\\pwsh.exe', 'win32'),
      'powershell',
    );
    assert.equal(
      shellFlavour(
        'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
        'win32',
      ),
      'powershell',
    );
  });

  it('keeps the POSIX shells that ship on Windows POSIX', () => {
    assert.equal(
      shellFlavour('C:\\Program Files\\Git\\bin\\bash.exe', 'win32'),
      'posix',
    );
    assert.equal(
      shellFlavour('C:\\Windows\\System32\\wsl.exe', 'win32'),
      'posix',
    );
    assert.equal(
      shellFlavour('C:\\msys64\\usr\\bin\\sh.exe', 'win32'),
      'posix',
    );
  });

  it('ignores case and accepts either separator', () => {
    assert.equal(
      shellFlavour('C:\\WINDOWS\\SYSTEM32\\CMD.EXE', 'win32'),
      'cmd',
    );
    assert.equal(shellFlavour('C:/Windows/System32/cmd.exe', 'win32'), 'cmd');
    assert.equal(
      shellFlavour('C:/Program Files/pwsh.EXE', 'win32'),
      'powershell',
    );
  });

  it('survives a trailing space, quotes, and appended arguments', () => {
    // Any of these used to slip past the .exe suffix and land on the platform
    // guess, which on Windows is the unsafe direction.
    assert.equal(
      shellFlavour('C:\\Windows\\System32\\cmd.exe ', 'win32'),
      'cmd',
    );
    assert.equal(
      shellFlavour('"C:\\Windows\\System32\\cmd.exe"', 'win32'),
      'cmd',
    );
    assert.equal(
      shellFlavour(
        '"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -NoLogo',
        'win32',
      ),
      'powershell',
    );
    assert.equal(
      shellFlavour(
        'C:\\Program Files\\PowerShell\\7\\pwsh.exe -NoLogo -NoProfile',
        'win32',
      ),
      'powershell',
    );
    assert.equal(shellFlavour('/bin/bash -l', 'linux'), 'posix');
    assert.equal(shellFlavour('  /bin/zsh  ', 'darwin'), 'posix');
    // A stray trailing quote defeated the .exe strip and sent cmd.exe to the
    // platform guess — the unsafe direction on Windows.
    assert.equal(
      shellFlavour('C:\\Windows\\System32\\cmd.exe"', 'win32'),
      'cmd',
    );
    assert.equal(shellFlavour('\\\\server\\share\\cmd.exe', 'win32'), 'cmd');
    assert.equal(
      shellFlavour('C:\\Windows\\System32\\wsl.exe -d Ubuntu', 'win32'),
      'posix',
    );
  });

  it('falls back on the platform for a name it does not know', () => {
    // A shell with its own rules must not be guessed at: on win32 the likelier
    // shell is PowerShell, and a wrong POSIX guess there is the unsafe one.
    assert.equal(shellFlavour('C:\\tools\\nu.exe', 'win32'), 'powershell');
    assert.equal(shellFlavour('C:\\tools\\xonsh.exe', 'win32'), 'powershell');
    assert.equal(shellFlavour('/usr/local/bin/nu', 'darwin'), 'posix');
    assert.equal(shellFlavour('/usr/local/bin/xonsh', 'linux'), 'posix');
  });

  it('falls back on the platform when there is no name at all', () => {
    assert.equal(shellFlavour(undefined, 'darwin'), 'posix');
    assert.equal(shellFlavour(undefined, 'win32'), 'powershell');
    assert.equal(shellFlavour('', 'linux'), 'posix');
    assert.equal(shellFlavour('   ', 'win32'), 'powershell');
  });
});

describe('helpers: shellQuote (posix)', () => {
  const q = (value) => shellQuote(value, 'posix');

  it('single-quotes a plain value, empty string included', () => {
    assert.equal(q(''), "''");
    assert.equal(q('flexbox'), "'flexbox'");
    assert.equal(q('two words'), "'two words'");
  });

  it('closes, escapes and reopens around an embedded single quote', () => {
    assert.equal(q("it's"), "'it'\\''s'");
    assert.equal(q("'"), "''\\'''");
  });

  it('leaves everything else to the quotes', () => {
    assert.equal(q('he said "hi"'), '\'he said "hi"\'');
    assert.equal(q('$HOME'), "'$HOME'");
    assert.equal(q('`whoami`'), "'`whoami`'");
    assert.equal(q('wow!!'), "'wow!!'");
    assert.equal(q('a && echo PWNED'), "'a && echo PWNED'");
    assert.equal(q('%PATH%'), "'%PATH%'");
    assert.equal(q('C:\\dir\\'), "'C:\\dir\\'");
    assert.equal(q('line1\nline2'), "'line1\nline2'");
    assert.equal(q('café — 日本語'), "'café — 日本語'");
  });
});

describe('helpers: shellQuote (csh)', () => {
  const q = (value) => shellQuote(value, 'csh');

  it('escapes the bang inside the quotes, which csh needs and POSIX does not', () => {
    // csh runs history expansion before it parses quotes, so 'wow!!' aborts
    // the line with "Event not found" and 'a\!b' silently loses its backslash.
    assert.equal(q('wow!!'), "'wow\\!\\!'");
    assert.equal(q('!important'), "'\\!important'");
    assert.equal(q('a\\!b'), "'a\\\\!b'");
  });

  it('keeps the POSIX idiom for an embedded single quote', () => {
    assert.equal(q("it's"), "'it'\\''s'");
    assert.equal(q("it's a !bang"), "'it'\\''s a \\!bang'");
  });

  it('leaves the rest alone, backslashes included', () => {
    assert.equal(q('$HOME'), "'$HOME'");
    assert.equal(q('a && echo PWNED'), "'a && echo PWNED'");
    assert.equal(q('C:\\dir\\'), "'C:\\dir\\'");
  });
});

describe('helpers: shellQuote (fish)', () => {
  const q = (value) => shellQuote(value, 'fish');

  it('escapes the backslash, which POSIX single quotes do not', () => {
    assert.equal(q('C:\\dir\\'), "'C:\\\\dir\\\\'");
    assert.equal(q('a\\\\b'), "'a\\\\\\\\b'");
    assert.equal(q("it's"), "'it\\'s'");
  });

  it("round-trips every hostile value through fish's quoting rule", () => {
    // The model of fish's documented rule: inside single quotes only \\ and \'
    // escape. Executed against a real fish below, where one is installed.
    for (const value of HOSTILE) {
      assert.equal(fishSingleQuoted(q(value)), value, JSON.stringify(value));
    }
  });

  it('shows why the POSIX rule cannot be reused here', () => {
    // A path ending in a backslash escapes fish's closing quote and hangs the
    // line on a continuation prompt; a doubled backslash silently loses one.
    assert.throws(() => fishSingleQuoted(shellQuote('C:\\dir\\', 'posix')));
    assert.equal(fishSingleQuoted(shellQuote('a\\\\b', 'posix')), 'a\\b');
  });
});

describe('helpers: shellQuote (powershell)', () => {
  const q = (value) => shellQuote(value, 'powershell');

  it('single-quotes, doubling an embedded quote', () => {
    assert.equal(q(''), "''");
    assert.equal(q('two words'), "'two words'");
    assert.equal(q("it's"), "'it''s'");
    assert.equal(q("''"), "''''''");
    assert.equal(q('$HOME'), "'$HOME'");
    assert.equal(q('C:\\dir\\'), "'C:\\dir\\'");
  });

  it('survives both parses on the way to node', () => {
    // npx resolves to npm's npx.ps1 shim under PowerShell, and its interactive
    // branch rebuilds the call from each argument's AST extent — the token's
    // own source text — and runs Invoke-Expression on it. So the token is
    // parsed once as typed and once more inside the shim.
    for (const value of HOSTILE) {
      const token = q(value);
      assert.equal(psSingleQuoted(token), value, JSON.stringify(value));

      const rebuilt = `& "node" "npx-cli.js" ${token}`;
      const tokens = psTokens(rebuilt);
      assert.equal(
        tokens.length,
        4,
        `token split for ${JSON.stringify(value)}`,
      );
      assert.equal(psSingleQuoted(tokens[3]), value);
    }
  });
});

describe('helpers: shellQuote (cmd)', () => {
  const q = (value) => shellQuote(value, 'cmd');

  it('models the CRT parser correctly before using it as an oracle', () => {
    // Microsoft's published "Parsing C++ command-line arguments" examples,
    // plus the documented doubled-quote rule.
    const cases = [
      ['"a b c" d e', ['a b c', 'd', 'e']],
      ['"ab\\"c" "\\\\" d', ['ab"c', '\\', 'd']],
      ['a\\\\\\b d"e f"g h', ['a\\\\\\b', 'de fg', 'h']],
      ['a\\\\\\"b c d', ['a\\"b', 'c', 'd']],
      ['a\\\\\\\\"b c" d e', ['a\\\\b c', 'd', 'e']],
      ['"a""b"', ['a"b']],
      ['""', ['']],
      ['x "" y', ['x', '', 'y']],
    ];
    for (const [line, expected] of cases) {
      assert.deepStrictEqual(crtArgv(line), expected, line);
    }
  });

  it('caret-escapes the quotes so cmd never enters a quoted section', () => {
    assert.equal(q(''), '^"^"');
    assert.equal(q('flexbox'), '^"flexbox^"');
    assert.equal(q('two words'), '^"two words^"');
  });

  it('escapes %, which quoting alone would not stop expanding', () => {
    assert.equal(q('%PATH%'), '^"^%PATH^%^"');
    assert.equal(q('100% done'), '^"100^% done^"');
  });

  it('escapes every cmd metacharacter, ! and ^ included', () => {
    assert.equal(q('wow!!'), '^"wow^!^!^"');
    assert.equal(q('x^y(z)|w<v>u'), '^"x^^y^(z^)^|w^<v^>u^"');
    assert.equal(q('a && echo PWNED'), '^"a ^&^& echo PWNED^"');
  });

  it('writes an embedded double quote as "" and doubles the backslashes before it', () => {
    assert.equal(q('he said "hi"'), '^"he said ^"^"hi^"^"^"');
    assert.equal(q('C:\\dir\\'), '^"C:\\dir\\\\^"');
    assert.equal(q('a\\"b'), '^"a\\\\^"^"b^"');
  });

  // The oracle. Every hop a value takes between the terminal and node's argv:
  // cmd's percent pass, cmd's caret and quote pass, the npx.cmd shim
  // forwarding %* into a line cmd parses again, and finally the CRT.
  function throughWindows(quoted, env) {
    const typed = `npx course search ${quoted}`;
    const prompt = cmdSpecial(cmdPercent(typed, env));
    // The shim forwards its arguments verbatim through %*; substituted text is
    // not percent-expanded a second time, so only the caret pass runs again.
    const forwarded = prompt.text.slice('npx course search '.length);
    const shim = cmdSpecial(`node "npx-cli.js" ${forwarded}`);
    return {
      live: [...prompt.live, ...shim.live],
      argv: crtArgv(shim.text),
    };
  }

  it('delivers every hostile value to node as exactly one argument', () => {
    const env = { PATH: 'C:\\Windows', A: 'boom', FOO: 'x & calc' };
    for (const value of HOSTILE) {
      const { live, argv } = throughWindows(q(value), env);
      assert.deepStrictEqual(
        live,
        [],
        `live metacharacter for ${JSON.stringify(value)}`,
      );
      assert.deepStrictEqual(
        argv,
        ['node', 'npx-cli.js', value],
        JSON.stringify(value),
      );
    }
  });

  it('catches the backslash-escaped variant this rule was chosen over', () => {
    // `\"` is what list2cmdline and cross-spawn emit. It parses correctly in
    // the CRT, but cmd does not know backslash escapes, so at the shim's
    // re-parse the quoted section closes early and the `&` goes live.
    const naive = (value) => {
      const crt = `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`;
      return crt.replace(/[()%!^"<>&|]/g, '^$&');
    };
    const { live } = throughWindows(naive('a" & calc & "b'), {});
    assert.ok(live.length > 0, 'the naive form should break out, and does');
    assert.deepStrictEqual(throughWindows(q('a" & calc & "b'), {}).live, []);
  });
});

// The POSIX and csh rules can be proved rather than modelled, so they are:
// every value goes through a real shell and has to come back as its own argv
// entry, byte for byte. Passing the whole corpus in one command line also
// proves no value bleeds into its neighbour. Skipped where the shell is not
// installed, and on Windows, where none of these is the shell being quoted for.
describe('helpers: shellQuote survives a real shell', () => {
  const PRINT = 'JSON.stringify(process.argv.slice(1))';
  // tcsh aborts on some LS_COLORS values before it ever reads the line, so the
  // colour variables are dropped for these runs.
  const shellEnv = { ...process.env };
  delete shellEnv.LS_COLORS;
  delete shellEnv.LSCOLORS;

  // fish is asked not to read the user's config: what is being tested is
  // fish's parser, not whatever a developer has in config.fish.
  const flagsFor = (shell) => (shell === 'fish' ? ['--no-config'] : []);

  function available(shell) {
    try {
      execFileSync(shell, [...flagsFor(shell), '-c', 'exit 0'], {
        stdio: 'ignore',
        env: shellEnv,
      });
      return true;
    } catch {
      return false;
    }
  }

  function argvThrough(shell, flavour, values) {
    const head = [process.execPath, '-p', PRINT]
      .map((part) => shellQuote(part, flavour))
      .join(' ');
    const line = `${head} ${values.map((v) => shellQuote(v, flavour)).join(' ')}`;
    const out = execFileSync(shell, [...flagsFor(shell), '-c', line], {
      encoding: 'utf8',
      env: shellEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const lines = out.split('\n').filter((l) => l.trim());
    return JSON.parse(lines[lines.length - 1]);
  }

  for (const shell of ['sh', 'bash', 'zsh', 'dash', 'ksh']) {
    it(`hands ${shell} every hostile value back unchanged`, (t) => {
      if (process.platform === 'win32') return t.skip('POSIX shells only');
      if (!available(shell)) return t.skip(`${shell} is not installed`);
      const values = [...HOSTILE, 'line1\nline2'];
      assert.deepStrictEqual(argvThrough(shell, 'posix', values), values);
    });
  }

  for (const shell of ['csh', 'tcsh']) {
    it(`hands ${shell} every hostile value back unchanged`, (t) => {
      if (process.platform === 'win32') return t.skip('POSIX shells only');
      if (!available(shell)) return t.skip(`${shell} is not installed`);
      // No newline in the corpus: shellQuote refuses that one for csh, and the
      // test below is why.
      assert.deepStrictEqual(argvThrough(shell, 'csh', HOSTILE), HOSTILE);
    });
  }

  it('hands fish every hostile value back unchanged', (t) => {
    if (process.platform === 'win32') return t.skip('POSIX shells only');
    if (!available('fish')) return t.skip('fish is not installed');
    assert.deepStrictEqual(argvThrough('fish', 'fish', HOSTILE), HOSTILE);
  });

  it('needs the csh rule for csh: the POSIX rule breaks there', (t) => {
    if (process.platform === 'win32') return t.skip('POSIX shells only');
    if (!available('tcsh')) return t.skip('tcsh is not installed');
    // Loud failure on a search term a CSS course types every week...
    assert.throws(() => argvThrough('tcsh', 'posix', ['!important']));
    // ...and silent corruption when the bang is already escaped.
    assert.deepStrictEqual(argvThrough('tcsh', 'posix', ['a\\!b']), ['a!b']);
  });

  it('shows why a newline is refused for csh rather than quoted', (t) => {
    if (process.platform === 'win32') return t.skip('POSIX shells only');
    if (!available('tcsh')) return t.skip('tcsh is not installed');
    // This is the value a module folder named with a line break produces — a
    // real object on a POSIX filesystem, where every byte but NUL and / is a
    // legal name. Quoted by any rule that does not refuse it, csh reports
    // "Unmatched '" for the first line and then runs the second as a fresh
    // command. The marker is the proof, and the reason shellQuote throws.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccb-csh-'));
    const marker = path.join(dir, 'ran');
    const value = `01-intro\ntouch ${marker}\nx`;

    assert.throws(
      () => shellQuote(value, 'csh'),
      UnquotableValue,
      'the refusal is the fix; the rest of this test is the reason for it',
    );

    try {
      execFileSync('tcsh', ['-c', `echo ${shellQuote(value, 'posix')}`], {
        encoding: 'utf8',
        env: shellEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      /* csh exits 1 on the unmatched quote — and runs line 2 regardless */
    }
    assert.ok(
      fs.existsSync(marker),
      'expected csh to run the injected line, which is why the refusal exists',
    );
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('protects a bang from history expansion where double quotes do not', (t) => {
    if (process.platform === 'win32') return t.skip('POSIX shells only');
    if (!available('bash')) return t.skip('bash is not installed');
    // History expansion is off in a non-interactive bash, so it is switched on
    // explicitly and the history seeded — otherwise this test would pass on a
    // shell that never expanded anything and prove nothing.
    const run = (argument) => {
      const script = [
        'set -o history',
        'set -H',
        'echo seeded',
        `${shellQuote(process.execPath, 'posix')} -p ${shellQuote(PRINT, 'posix')} ${argument}`,
      ].join('\n');
      const out = execFileSync('bash', ['-c', script], {
        encoding: 'utf8',
        env: shellEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const lines = out.split('\n').filter((l) => l.trim());
      return JSON.parse(lines[lines.length - 1]);
    };

    // The control: with expansion on, a double-quoted bang is rewritten.
    assert.notDeepStrictEqual(run('"wow!!"'), ['wow!!']);
    // The claim: single quotes hold.
    assert.deepStrictEqual(run(shellQuote('wow!!', 'posix')), ['wow!!']);
  });
});

describe('helpers: cliEntryPoint', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'helpers-cli-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('finds the CLI the template ships beside course/', () => {
    fs.mkdirSync(path.join(tmpDir, 'cli'));
    fs.writeFileSync(path.join(tmpDir, 'cli', 'index.js'), '', 'utf8');
    assert.equal(
      cliEntryPoint(tmpDir),
      path.join(tmpDir, 'cli', 'index.js'),
      'the runner needs the absolute path it will hand to node',
    );
  });

  it('returns null rather than a second way to fail', () => {
    // What used to happen here was `execFile('npx', ['course', ...])`, which
    // on Windows cannot work at all: the program is npx.cmd, libuv resolves no
    // .cmd from PATH, and Node refuses to run one without a shell. The author
    // got an ENOENT naming a program they never typed. Null is the runner's
    // cue to say which file is missing instead.
    assert.equal(cliEntryPoint(tmpDir), null, 'no cli/ at all');
    fs.mkdirSync(path.join(tmpDir, 'cli'));
    assert.equal(cliEntryPoint(tmpDir), null, 'a cli/ with no index.js in it');
  });

  it('takes a missing workspace root without throwing', () => {
    // Defence, not a live path, and worth being exact about which. No call
    // site can reach it today: every palette command checks the workspace
    // first, and with no folder open the tree draws no rows at all, so a drop
    // has nothing to land on. What it replaces is not a crash either —
    // path.join(undefined, …) throws inside a promise executor, which rejects
    // the promise, so the author gets a bare "command failed". The guard is
    // here to make the answer total: a root or nothing, never a TypeError.
    assert.equal(cliEntryPoint(undefined), null);
    assert.equal(cliEntryPoint(null), null);
    assert.equal(cliEntryPoint(''), null);
  });
});

describe('helpers: cliChildEnv', () => {
  it('sets ELECTRON_RUN_AS_NODE, which decides whether the CLI runs at all', () => {
    // process.execPath in a desktop extension host is the Electron helper
    // binary, not node; it behaves as node only for a child whose environment
    // carries this. Measured on a live host: the variable is absent from the
    // extension host's own OS-level environment, and present only because
    // VS Code's bootstrap assigns it to process.env at runtime.
    assert.equal(cliChildEnv({}).ELECTRON_RUN_AS_NODE, '1');
    assert.equal(cliChildEnv({ PATH: '/usr/bin' }).ELECTRON_RUN_AS_NODE, '1');
  });

  it('wins over a value already in the environment', () => {
    assert.equal(
      cliChildEnv({ ELECTRON_RUN_AS_NODE: '0' }).ELECTRON_RUN_AS_NODE,
      '1',
    );
  });

  it('keeps the rest of the environment and copies rather than mutates', () => {
    // The child needs PATH, HOME and the rest to behave like a hand-run
    // command, and process.env itself must not be edited on the way past.
    const source = { PATH: '/usr/bin', CANVAS_API_URL: 'https://example.test' };
    const child = cliChildEnv(source);
    assert.equal(child.PATH, '/usr/bin');
    assert.equal(child.CANVAS_API_URL, 'https://example.test');
    assert.deepStrictEqual(source, {
      PATH: '/usr/bin',
      CANVAS_API_URL: 'https://example.test',
    });
  });
});

describe('helpers: createSerialQueue', () => {
  /** A promise plus its settle functions, so a task can be held open. */
  const deferred = () => {
    const box = {};
    box.promise = new Promise((resolve, reject) => {
      box.resolve = resolve;
      box.reject = reject;
    });
    return box;
  };

  /** Let every pending microtask and immediate run. */
  const tick = () => new Promise((resolve) => setImmediate(resolve));

  /** Fail loudly instead of hanging the suite when the queue deadlocks. */
  const withTimeout = (promise, message) => {
    let timer;
    const guard = new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(message)), 1000);
    });
    return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
  };

  it('starts the second task only when the first has finished', async () => {
    const queue = createSerialQueue();
    const log = [];
    const first = deferred();
    const second = deferred();

    const a = queue(() => {
      log.push('a:start');
      return first.promise.then(() => log.push('a:end'));
    });
    const b = queue(() => {
      log.push('b:start');
      return second.promise.then(() => log.push('b:end'));
    });

    await tick();
    assert.deepStrictEqual(log, ['a:start'], 'b must not have started');

    first.resolve();
    await a;
    await tick();
    assert.deepStrictEqual(log, ['a:start', 'a:end', 'b:start']);

    second.resolve();
    await b;
    assert.deepStrictEqual(log, ['a:start', 'a:end', 'b:start', 'b:end']);
  });

  it('queues a call arriving while a task is already running', async () => {
    // The case a plain "are we busy?" flag gets wrong. Two commands the author
    // starts seconds apart are exactly the pair that must not overlap: each
    // renumbers a directory and rewrites .canvas-sync.json, and the second
    // would read what the first is halfway through writing.
    const queue = createSerialQueue();
    const log = [];
    const running = deferred();

    const a = queue(() => {
      log.push('a:start');
      return running.promise;
    });
    await tick();

    const b = queue(() => {
      log.push('b:start');
    });
    await tick();
    assert.deepStrictEqual(log, ['a:start'], 'b must wait its turn');

    running.resolve();
    await a;
    await b;
    assert.deepStrictEqual(log, ['a:start', 'b:start']);
  });

  it('runs the tasks in the order they arrived', async () => {
    const queue = createSerialQueue();
    const log = [];
    const results = await Promise.all(
      ['first', 'second', 'third'].map((name) =>
        queue(async () => {
          log.push(name);
          return name;
        }),
      ),
    );
    assert.deepStrictEqual(log, ['first', 'second', 'third']);
    assert.deepStrictEqual(results, ['first', 'second', 'third']);
  });

  it('hands the task result back to the caller', async () => {
    // runCli's true/false is what half the call sites branch on.
    const queue = createSerialQueue();
    assert.equal(await queue(() => true), true);
    assert.equal(await queue(async () => false), false);
  });

  it('lets a failed task through to its own caller without wedging', async () => {
    const queue = createSerialQueue();
    const rejected = queue(() => Promise.reject(new Error('boom')));
    await assert.rejects(rejected, /boom/);

    const thrown = queue(() => {
      throw new Error('thrown');
    });
    await assert.rejects(thrown, /thrown/);

    assert.equal(
      await withTimeout(
        queue(() => 'after'),
        'a failed task wedged the queue: nothing after it ever ran',
      ),
      'after',
      'the queue has to survive a CLI run that blew up',
    );
  });

  it('does not deadlock on a task that queues another and waits for it', async () => {
    // No call site does this today, and a plain promise chain would hang the
    // extension for the rest of the session if one ever did: the inner call
    // waits for the queue to drain, and what the queue is waiting on is the
    // outer call that made it.
    const queue = createSerialQueue();
    const log = [];

    const outer = queue(async () => {
      log.push('outer:start');
      const inner = await queue(() => {
        log.push('inner');
        return 'inner value';
      });
      log.push(`outer:got ${inner}`);
      return 'outer value';
    });

    assert.equal(
      await withTimeout(outer, 'the queue deadlocked on a re-entrant call'),
      'outer value',
    );
    assert.deepStrictEqual(log, [
      'outer:start',
      'inner',
      'outer:got inner value',
    ]);
  });

  it('keeps queueing for everyone else while a re-entrant call runs', async () => {
    // Re-entrancy costs the serialisation guarantee for the nested call only.
    // A command started from the palette in the meantime still waits.
    const queue = createSerialQueue();
    const log = [];
    const held = deferred();

    const outer = queue(async () => {
      log.push('outer:start');
      await queue(() => log.push('nested'));
      await held.promise;
      log.push('outer:end');
    });
    await tick();

    const other = queue(() => log.push('other'));
    await tick();
    assert.deepStrictEqual(log, ['outer:start', 'nested']);

    held.resolve();
    await outer;
    await other;
    assert.deepStrictEqual(log, [
      'outer:start',
      'nested',
      'outer:end',
      'other',
    ]);
  });

  it('queues a call the finished task only seeded', async () => {
    // The escape has to end when the run does. A store is inherited by every
    // async resource started while the task ran, and those outlive it: the
    // timer below is registered inside the run and fires after it, which is
    // exactly the shape of a notification button handler — a Retry on the
    // runner's own error message would be one. Left unscoped, such a call sails
    // past the queue and a second CLI child runs beside whatever is running
    // then. Only a call from a task that is *still going* may skip the queue.
    const queue = createSerialQueue();
    const log = [];
    let seeded;

    await queue(() => {
      log.push('first');
      seeded = new Promise((resolve) => {
        setTimeout(() => resolve(queue(() => log.push('seeded'))), 0);
      });
    });

    const held = deferred();
    const slow = queue(() => {
      log.push('slow:start');
      return held.promise.then(() => log.push('slow:end'));
    });
    // Long enough for a zero-delay timer, which fires on the next turn of the
    // loop; the seeded call has been made by now, and must be waiting.
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.deepStrictEqual(
      log,
      ['first', 'slow:start'],
      'the seeded call jumped the queue and ran beside the slow one',
    );

    held.resolve();
    await slow;
    await seeded;
    assert.deepStrictEqual(log, ['first', 'slow:start', 'slow:end', 'seeded']);
  });
});

describe('helpers: announceIfSlow', () => {
  /** A scheduler with the clock taken out: nothing fires until fire() says so. */
  const manual = () => {
    const windows = [];
    return {
      windows,
      schedule(fn) {
        const entry = { fn, closed: false };
        windows.push(entry);
        return () => {
          entry.closed = true;
        };
      },
      fire() {
        for (const entry of windows) if (!entry.closed) entry.fn();
      },
    };
  };

  const tick = () => new Promise((resolve) => setImmediate(resolve));

  it('says nothing about a run that finished inside the window', async () => {
    const clock = manual();
    let announced = 0;
    announceIfSlow(Promise.resolve(true), () => announced++, clock.schedule);
    await tick();

    clock.fire();
    assert.equal(announced, 0, 'a fast rename must not flash a spinner');
    assert.equal(clock.windows[0].closed, true, 'the window has to be closed');
  });

  it('announces a run still going when the window expires', async () => {
    const clock = manual();
    let announced = 0;
    let finish;
    const work = new Promise((resolve) => {
      finish = resolve;
    });
    announceIfSlow(work, () => announced++, clock.schedule);

    clock.fire();
    assert.equal(announced, 1);

    finish(true);
    await tick();
    assert.equal(announced, 1, 'once, not once per settle path');
  });

  it('closes the window on a failed run too', async () => {
    // The spinner comes down whichever way the run ended, and attaching the
    // rejection handler is also what keeps a failed run from reaching the
    // extension host as an unhandled rejection — which is what this test
    // reports if that handler is ever dropped, since nothing else here
    // catches it.
    const clock = manual();
    let announced = 0;
    announceIfSlow(
      Promise.reject(new Error('the CLI blew up')),
      () => announced++,
      clock.schedule,
    );
    await tick();

    clock.fire();
    assert.equal(announced, 0);
    assert.equal(clock.windows[0].closed, true);
  });
});

describe('helpers: createProgressGate', () => {
  /** A gate with the clock and the indicator taken out. */
  const rig = () => {
    const windows = [];
    const titles = [];
    let live = 0;
    let peak = 0;
    return {
      titles,
      get live() {
        return live;
      },
      get peak() {
        return peak;
      },
      schedule(fn) {
        const window = { fn, closed: false };
        windows.push(window);
        return () => {
          window.closed = true;
        };
      },
      /** Expire every window still open, once each, the way timers fire. */
      fire() {
        for (const window of windows) {
          if (window.closed) continue;
          window.closed = true;
          window.fn();
        }
      },
      show(title) {
        titles.push(title);
        live += 1;
        peak = Math.max(peak, live);
        return () => {
          live -= 1;
        };
      },
    };
  };

  const deferred = () => {
    const box = {};
    box.promise = new Promise((resolve, reject) => {
      box.resolve = resolve;
      box.reject = reject;
    });
    return box;
  };

  const tick = () => new Promise((resolve) => setImmediate(resolve));

  it('opens one indicator for a queue of runs, not one per run', async () => {
    // Ten rows dropped on a module are ten runs, nine of them waiting. Before
    // the gate they opened eight spinners at once and unwound them one at a
    // time.
    const gate = rig();
    const track = createProgressGate(gate.schedule, gate.show);
    const runs = [deferred(), deferred(), deferred(), deferred()];
    runs.forEach((run, i) => track(run.promise, `run ${i}`));

    gate.fire();
    assert.equal(gate.peak, 1, 'one indicator, however many runs are waiting');
    assert.deepStrictEqual(
      gate.titles,
      ['run 0'],
      'titled by whoever opened it',
    );

    for (const run of runs) run.resolve();
    await tick();
    assert.equal(gate.live, 0, 'and it comes down when the last one settles');
  });

  it('holds the indicator until the last run settles, not the first', async () => {
    const gate = rig();
    const track = createProgressGate(gate.schedule, gate.show);
    const first = deferred();
    const last = deferred();
    track(first.promise, 'first');
    track(last.promise, 'last');

    gate.fire();
    assert.equal(gate.live, 1);

    first.resolve();
    await tick();
    assert.equal(gate.live, 1, 'work is still going: the spinner stays');

    last.resolve();
    await tick();
    assert.equal(gate.live, 0);
  });

  it('lets a failed run take the indicator down like any other', async () => {
    // A run can reject — execFile validates its arguments and throws where the
    // run starts. Counting only fulfilment would leave a spinner turning with
    // nothing behind it, for the rest of the session.
    const gate = rig();
    const track = createProgressGate(gate.schedule, gate.show);
    const failing = deferred();
    track(failing.promise, 'failing');
    gate.fire();
    assert.equal(gate.live, 1);

    failing.reject(new Error('spawn threw'));
    await tick();
    assert.equal(gate.live, 0, 'a rejected run has to release the indicator');
    await failing.promise.catch(() => {});
  });

  it('says nothing about runs that finish inside the window', async () => {
    const gate = rig();
    const track = createProgressGate(gate.schedule, gate.show);
    track(Promise.resolve(true), 'quick');
    await tick();

    gate.fire();
    assert.equal(gate.peak, 0, 'a fast rename must not flash a spinner');
  });

  it('opens again for a run that comes after the quiet', async () => {
    const gate = rig();
    const track = createProgressGate(gate.schedule, gate.show);
    const first = deferred();
    track(first.promise, 'first');
    gate.fire();
    first.resolve();
    await tick();
    assert.equal(gate.live, 0);

    const second = deferred();
    track(second.promise, 'second');
    gate.fire();
    assert.equal(gate.live, 1, 'the gate has to rearm');
    assert.deepStrictEqual(gate.titles, ['first', 'second']);
    second.resolve();
    await tick();
    assert.equal(gate.live, 0);
  });
});
