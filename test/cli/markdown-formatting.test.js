const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const matter = require('gray-matter');

const { _createEntry } = require('../../cli/new-item');
const { _splitFile } = require('../../cli/split-item');
const { _mergeFiles } = require('../../cli/merge-items');
const { _renameEntry } = require('../../cli/rename-item');
const {
  prettierCheck,
  seedPrettierConfig,
} = require('../helpers/prettier-config');

/**
 * The item commands write markdown too, and the same rule holds for them.
 *
 * A file this tool writes has to be the file `npm run format` would leave, or
 * the author's next format run turns into an edit they did not make — and for
 * anything sync tracks, an edit it did not make is a local change it pushes
 * back. The sync engine is where that costs the most, but a `split-item` that
 * leaves two half-wrapped paragraphs behind produces exactly the same phantom
 * change from the other end.
 *
 * Every case here is checked by running the Prettier binary over the result,
 * which is the same binary `npm run format` runs.
 */

const LONG =
  'Dit is een paragraaf die ver over de tachtig tekens loopt en die Prettier ' +
  'dus zou herwikkelen, precies zoals hij dat met elk ander bestand in deze ' +
  'repo doet.';

let dir;

beforeEach(() => {
  dir = seedPrettierConfig(
    fs.mkdtempSync(path.join(os.tmpdir(), 'md-formatting-')),
  );
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** A markdown file with frontmatter and a body, written raw. */
function write(name, frontmatter, body) {
  fs.writeFileSync(
    path.join(dir, name),
    matter.stringify(`\n${body}\n`, frontmatter),
    'utf8',
  );
  return path.join(dir, name);
}

/** Assert that Prettier has nothing left to say about a file. */
function assertClean(file) {
  assert.equal(
    prettierCheck(dir, file),
    true,
    `${path.basename(file)} is not what \`npm run format\` would leave`,
  );
}

describe('new-item', () => {
  it('creates a page Prettier already agrees with', async () => {
    const created = await _createEntry(dir, 'page', {
      name: 'Een titel met een dubbele punt: en aanhalingstekens "zo"',
      position: 1,
    });
    assertClean(path.join(dir, created));
  });

  it('creates an assignment Prettier already agrees with', async () => {
    const created = await _createEntry(dir, 'assignment', {
      name: 'Opdracht 1',
      position: 1,
      points: 20,
    });
    assertClean(path.join(dir, created));
  });
});

describe('split-item', () => {
  it('leaves both halves formatted', async () => {
    // Two paragraphs, split between them, so both halves carry real prose and
    // neither assertion is passing on an empty file. Each half keeps the line
    // breaks of the whole, so both come out needing a reflow that no author
    // asked for.
    const file = write(
      '01-original.md',
      { title: 'Original' },
      `${LONG}\n\n${LONG}`,
    );
    await _splitFile(file, 2, 'Part Two', dir);

    assertClean(file);
    assertClean(path.join(dir, '02-part-two.md'));
  });
});

describe('merge-items', () => {
  it('leaves the merged file formatted', async () => {
    const target = write('01-first.md', { title: 'First' }, LONG);
    const source = write('02-second.md', { title: 'Second' }, LONG);
    await _mergeFiles(target, source, dir);

    assertClean(target);
  });
});

describe('rename-item', () => {
  it('leaves the file it retitled formatted', async () => {
    // Renaming re-serialises the whole file to change one frontmatter key, so
    // it is a full rewrite whether the author wanted one or not.
    write('01-original.md', { title: 'Original' }, LONG);
    const renamed = await _renameEntry(dir, '01-original.md', 'New Name');

    assertClean(path.join(dir, renamed));
  });

  it('still renames the file and its title', async () => {
    // The formatting must not have cost the command its actual job.
    write('01-original.md', { title: 'Original' }, LONG);
    const renamed = await _renameEntry(dir, '01-original.md', 'New Name');

    assert.equal(renamed, '01-new-name.md');
    assert.equal(
      matter(fs.readFileSync(path.join(dir, renamed), 'utf8')).data.title,
      'New Name',
    );
  });
});
