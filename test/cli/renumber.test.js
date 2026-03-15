const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { renumberUp, renumberSequential, reorder } = require('../../cli/renumber');

/**
 * Create numbered entries (files or directories) in the given directory.
 * @param {string} dir - Parent directory.
 * @param {Array<{prefix: number, name: string, isDirectory?: boolean}>} entries
 */
function createEntries(dir, entries) {
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory) {
      fs.mkdirSync(fullPath);
    } else {
      fs.writeFileSync(fullPath, '', 'utf8');
    }
  }
}

/**
 * Build an items array matching the format expected by renumberUp and reorder.
 */
function buildItems(entries) {
  return entries.map((e) => ({
    prefix: e.prefix,
    name: e.name,
    isDirectory: !!e.isDirectory,
  }));
}

/**
 * Return sorted list of entry names in a directory (excluding dotfiles).
 */
function listEntries(dir) {
  return fs.readdirSync(dir).filter((n) => !n.startsWith('.')).sort();
}

/**
 * Build a getEntries callback for renumberSequential.
 */
function makeGetEntries(entries) {
  return () =>
    entries
      .slice()
      .sort((a, b) => a.prefix - b.prefix)
      .map((e) => ({
        prefix: e.prefix,
        name: e.name,
        isDirectory: !!e.isDirectory,
      }));
}

describe('renumberUp', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'renumber-up-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('shifts items at and above the given position by +1', () => {
    const entries = [
      { prefix: 1, name: '01-intro.md' },
      { prefix: 2, name: '02-setup.md' },
      { prefix: 3, name: '03-usage.md' },
    ];
    createEntries(tmpDir, entries);

    const renames = renumberUp(tmpDir, buildItems(entries), 2);

    const files = listEntries(tmpDir);
    assert.deepStrictEqual(files, ['01-intro.md', '03-setup.md', '04-usage.md']);
    assert.ok(renames.length >= 2);
    assert.ok(renames.some((r) => r.from === '02-setup.md' && r.to === '03-setup.md'));
    assert.ok(renames.some((r) => r.from === '03-usage.md' && r.to === '04-usage.md'));
  });

  it('does not affect items below the given position', () => {
    const entries = [
      { prefix: 1, name: '01-intro.md' },
      { prefix: 2, name: '02-setup.md' },
      { prefix: 3, name: '03-usage.md' },
    ];
    createEntries(tmpDir, entries);

    renumberUp(tmpDir, buildItems(entries), 3);

    const files = listEntries(tmpDir);
    assert.ok(files.includes('01-intro.md'));
    assert.ok(files.includes('02-setup.md'));
    assert.ok(files.includes('04-usage.md'));
    assert.equal(files.length, 3);
  });
});

describe('renumberSequential', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'renumber-seq-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('closes gaps in numbering', () => {
    const entries = [
      { prefix: 1, name: '01-intro.md' },
      { prefix: 3, name: '03-setup.md' },
      { prefix: 5, name: '05-usage.md' },
    ];
    createEntries(tmpDir, entries);

    const renames = renumberSequential(tmpDir, makeGetEntries(entries));

    const files = listEntries(tmpDir);
    assert.deepStrictEqual(files, ['01-intro.md', '02-setup.md', '03-usage.md']);
    assert.ok(renames.some((r) => r.from === '03-setup.md' && r.to === '02-setup.md'));
    assert.ok(renames.some((r) => r.from === '05-usage.md' && r.to === '03-usage.md'));
  });

  it('is a no-op when items are already sequential', () => {
    const entries = [
      { prefix: 1, name: '01-intro.md' },
      { prefix: 2, name: '02-setup.md' },
      { prefix: 3, name: '03-usage.md' },
    ];
    createEntries(tmpDir, entries);

    const renames = renumberSequential(tmpDir, makeGetEntries(entries));

    const files = listEntries(tmpDir);
    assert.deepStrictEqual(files, ['01-intro.md', '02-setup.md', '03-usage.md']);
    assert.equal(renames.length, 0);
  });
});

describe('reorder', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reorder-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('moves an item forward (lower to higher position)', () => {
    const entries = [
      { prefix: 1, name: '01-intro.md' },
      { prefix: 2, name: '02-setup.md' },
      { prefix: 3, name: '03-usage.md' },
    ];
    createEntries(tmpDir, entries);

    // Move item at position 1 to position 3
    const renames = reorder(tmpDir, buildItems(entries), 1, 3);

    const files = listEntries(tmpDir);
    assert.deepStrictEqual(files, ['01-setup.md', '02-usage.md', '03-intro.md']);
    assert.ok(renames.length > 0);
  });

  it('moves an item backward (higher to lower position)', () => {
    const entries = [
      { prefix: 1, name: '01-intro.md' },
      { prefix: 2, name: '02-setup.md' },
      { prefix: 3, name: '03-usage.md' },
    ];
    createEntries(tmpDir, entries);

    // Move item at position 3 to position 1
    const renames = reorder(tmpDir, buildItems(entries), 3, 1);

    const files = listEntries(tmpDir);
    assert.deepStrictEqual(files, ['01-usage.md', '02-intro.md', '03-setup.md']);
    assert.ok(renames.length > 0);
  });

  it('is a no-op when source equals target', () => {
    const entries = [
      { prefix: 1, name: '01-intro.md' },
      { prefix: 2, name: '02-setup.md' },
      { prefix: 3, name: '03-usage.md' },
    ];
    createEntries(tmpDir, entries);

    const renames = reorder(tmpDir, buildItems(entries), 2, 2);

    const files = listEntries(tmpDir);
    assert.deepStrictEqual(files, ['01-intro.md', '02-setup.md', '03-usage.md']);
    assert.equal(renames.length, 0);
  });
});
