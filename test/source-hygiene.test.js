const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/**
 * Where the project keeps its own JavaScript. Directories rather than a file
 * list, so a module written tomorrow is covered the day it is written.
 *
 * `.vscode` holds the course-manager extension, which is ours despite the
 * leading dot. Naming it here is safe: the dot rule below filters the entries
 * *inside* a directory being walked, never a root handed in, so it cannot
 * swallow the root it is meant to skip generated trees underneath.
 */
const DIR_ROOTS = ['lib', 'cli', 'src', 'test', '.vscode'];

/** Nothing here is ours, and `node_modules` alone is most of the disk. */
const NOT_OURS = new Set(['node_modules', 'build', 'dist']);

/** Every `.js` file under `dir`, minus the trees nobody here wrote. */
function jsFilesIn(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    // A leading dot covers `.docusaurus`, `.cache-loader` and the rest of the
    // generated trees in one rule, and they are all gitignored.
    if (entry.name.startsWith('.') || NOT_OURS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) jsFilesIn(full, found);
    else if (entry.name.endsWith('.js')) found.push(full);
  }
  return found;
}

/**
 * The repo root's own `.js` files — `docusaurus.config.js` and friends —
 * without descending, since every directory worth walking is a root already.
 * Read off the directory rather than listed by name, so a config added next
 * year is covered without anyone remembering this file.
 */
function rootConfigs() {
  return fs
    .readdirSync(ROOT, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => path.join(ROOT, entry.name));
}

/** The offenders, as `path:line`, so a failure says where to look. */
function nulBytesIn(files, relativeTo) {
  const offenders = [];
  for (const file of files) {
    const bytes = fs.readFileSync(file);
    const at = bytes.indexOf(0);
    if (at === -1) continue;
    const line = bytes.subarray(0, at).toString('utf8').split('\n').length;
    offenders.push(`${path.relative(relativeTo, file)}:${line}`);
  }
  return offenders;
}

describe('the project source', () => {
  it('carries no NUL byte in any JavaScript file', () => {
    // A NUL is invisible in an editor and harmless at runtime, and it makes
    // `grep` and `file` read the whole file as binary. Neither says so: grep
    // prints nothing and exits 1, exactly as it does for a file that genuinely
    // holds no match. The file quietly stops being searchable, and the next
    // person loses an afternoon to it. `lib/sync/rename-detect.js` carried one
    // for nine commits, written as the byte itself where `\0` was meant, and
    // every recursive grep over `lib/` in that window skipped the file without
    // saying so.
    const byRoot = new Map(
      DIR_ROOTS.map((dir) => [dir, jsFilesIn(path.join(ROOT, dir))]),
    );
    byRoot.set('.', rootConfigs());

    // A root that walks nothing would pass the real assertion below in silence,
    // which is the one way this guard rots into a no-op — and `.vscode`, being
    // a dot directory the walk elsewhere skips, is where that would happen
    // first. So every root has to prove it found something.
    for (const [dir, walked] of byRoot) {
      assert.ok(walked.length > 0, `${dir} contributed no .js file`);
    }

    const files = [...byRoot.values()].flat();

    // A floor on the whole walk, for what the per-root check cannot see: a walk
    // that still returns something from every root but far less than the tree
    // holds — an exclusion grown too broad, or a filter that stopped matching
    // most files. Deliberately well under the real count — 128 as this was
    // written — so adding or deleting a file never drags it along behind.
    assert.ok(
      files.length > 100,
      `only ${files.length} files walked; the walk is broken, not the tree`,
    );

    const offenders = nulBytesIn(files, ROOT);
    assert.deepEqual(
      offenders,
      [],
      `NUL byte in ${offenders.join(', ')} — write \\0 instead, or grep and ` +
        'file will treat the whole file as binary',
    );
  });

  it('would catch a NUL byte if one were reintroduced', () => {
    // The guard above passes on a clean tree whether it works or not, so it
    // gets its own fixture: a file with the defect in it, scanned the same way.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nul-fixture-'));
    try {
      fs.writeFileSync(path.join(dir, 'clean.js'), 'const a = 1;\n');
      fs.writeFileSync(
        path.join(dir, 'poisoned.js'),
        'const sep = 1;\nconst key = `a\0b`;\n',
      );

      assert.deepEqual(nulBytesIn(jsFilesIn(dir), dir), ['poisoned.js:2']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
