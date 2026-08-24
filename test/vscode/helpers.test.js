const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  cliSiblings,
  reorderPosition,
  crossContainerPosition,
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
