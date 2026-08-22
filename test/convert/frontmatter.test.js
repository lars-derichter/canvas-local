const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  insertFrontmatterKey,
  parseFrontmatter,
  serializeFrontmatter,
} = require('../../lib/convert/frontmatter');

describe('parseFrontmatter', () => {
  it('parses YAML frontmatter and body content', () => {
    const input =
      '---\ntitle: Hello\ncanvas_type: page\n---\n\nBody text here.';
    const { data, content } = parseFrontmatter(input);

    assert.equal(data.title, 'Hello');
    assert.equal(data.canvas_type, 'page');
    assert.match(content.trim(), /^Body text here\.$/);
  });

  it('returns empty data when no frontmatter is present', () => {
    const input = 'Just plain content.';
    const { data, content } = parseFrontmatter(input);

    assert.deepEqual(data, {});
    assert.match(content.trim(), /^Just plain content\.$/);
  });

  it('handles empty input', () => {
    const { data, content } = parseFrontmatter('');
    assert.deepEqual(data, {});
    assert.equal(content, '');
  });

  it('preserves complex frontmatter types', () => {
    const input = [
      '---',
      'title: Test',
      'points_possible: 10',
      'submission_types:',
      '  - online_upload',
      '  - online_text_entry',
      'published: true',
      '---',
      '',
      'Content.',
    ].join('\n');

    const { data } = parseFrontmatter(input);
    assert.equal(data.points_possible, 10);
    assert.deepEqual(data.submission_types, [
      'online_upload',
      'online_text_entry',
    ]);
    assert.equal(data.published, true);
  });
});

describe('serializeFrontmatter', () => {
  it('produces a valid frontmatter string', () => {
    const data = { title: 'Hello', canvas_type: 'page' };
    const content = 'Body text.';
    const result = serializeFrontmatter(data, content);

    assert.match(result, /^---\n/);
    assert.match(result, /title: Hello/);
    assert.match(result, /canvas_type: page/);
    assert.match(result, /---\n/);
    assert.match(result, /Body text\./);
  });

  it('round-trips through parse and serialize', () => {
    const original =
      '---\ntitle: Round Trip\ncanvas_type: assignment\n---\n\nSome body.\n';
    const { data, content } = parseFrontmatter(original);
    const serialized = serializeFrontmatter(data, content);
    const reparsed = parseFrontmatter(serialized);

    assert.deepEqual(reparsed.data, data);
    assert.equal(reparsed.content.trim(), content.trim());
  });

  it('handles empty data', () => {
    const result = serializeFrontmatter({}, 'Content only.');
    assert.match(result, /Content only\./);
  });
});

describe('insertFrontmatterKey', () => {
  it('adds the key and leaves every other byte of the block alone', () => {
    // The three things `serializeFrontmatter` destroys on the way through
    // `matter.stringify`, which is why this function exists at all: a YAML
    // comment is dropped, `canvas_type:   assignment` is respaced, and
    // `tags: [ intro , welcome ]` is rewritten as a two-line list.
    const original = [
      '---',
      '# The Canvas type is deliberate: this is graded.',
      'canvas_type:   assignment',
      'tags: [ intro , welcome ]',
      '---',
      '',
      'Body text.',
      '',
    ].join('\n');

    const result = insertFrontmatterKey(original, 'title', 'Welcome');

    assert.equal(
      result,
      [
        '---',
        'title: Welcome',
        '# The Canvas type is deliberate: this is graded.',
        'canvas_type:   assignment',
        'tags: [ intro , welcome ]',
        '---',
        '',
        'Body text.',
        '',
      ].join('\n'),
    );
    // And the block still means what it meant.
    const { data } = parseFrontmatter(result);
    assert.equal(data.canvas_type, 'assignment');
    assert.deepEqual(data.tags, ['intro', 'welcome']);
  });

  it('escapes a value so the parser hands back the string that went in', () => {
    // A title is a filename with its prefix stripped and its hyphens turned
    // into spaces (`displayTitle` in lib/convert/course-scanner.js), so it is
    // not a string anybody sanitised for YAML. Each of these breaks a bare
    // scalar in a different way: `Yes` and `2024` change type, `#` opens a
    // comment, `:` ends the key, padding is eaten, a newline ends the line.
    const titles = [
      'Welcome',
      'Notes: Part One',
      '#Tag',
      'Yes',
      'Off',
      'Null',
      '2024',
      '1.5',
      '  Padded  ',
      'Quote "Inside"',
      "Apostrophe's",
      '- Dashy',
      '[Bracket]',
      '*Star',
      '&Amp',
      'Tab\tSep',
      'Line\nBreak',
      '---',
    ];

    for (const title of titles) {
      const result = insertFrontmatterKey(
        '---\ncanvas_type: page\n---\n\nBody.\n',
        'title',
        title,
      );
      const { data } = parseFrontmatter(result);
      assert.equal(
        data.title,
        title,
        `did not round-trip: ${JSON.stringify(title)}`,
      );
      assert.equal(
        data.canvas_type,
        'page',
        `the escaping swallowed the next key: ${JSON.stringify(title)}`,
      );
    }
  });

  it('gives a file with no frontmatter a block, and the blank line after it', () => {
    assert.equal(
      insertFrontmatterKey('Just a body.\n', 'title', 'Welcome'),
      '---\ntitle: Welcome\n---\n\nJust a body.\n',
    );
  });

  it('gives an empty file the block and nothing after it', () => {
    // The trailing blank line the branch above needs is the one thing Prettier
    // strips from a file that is only frontmatter.
    assert.equal(
      insertFrontmatterKey('', 'title', 'Welcome'),
      '---\ntitle: Welcome\n---\n',
    );
  });

  it('writes the line with the line ending the file already uses', () => {
    assert.equal(
      insertFrontmatterKey(
        '---\r\ncanvas_type: page\r\n---\r\n\r\nBody.\r\n',
        'title',
        'Welcome',
      ),
      '---\r\ntitle: Welcome\r\ncanvas_type: page\r\n---\r\n\r\nBody.\r\n',
    );
  });

  it('refuses an opening fence with no closing one rather than guessing', () => {
    // gray-matter reads this file as YAML all the way to the end, so a key
    // spliced in "after the opening fence" would land in the author's prose.
    assert.equal(
      insertFrontmatterKey('---\n\nBody.\n', 'title', 'Welcome'),
      null,
    );
  });

  it('refuses a block written in one of gray-matter’s other languages', () => {
    assert.equal(
      insertFrontmatterKey(
        '---js\nmodule.exports = { a: 1 };\n---\nBody.\n',
        'title',
        'X',
      ),
      null,
    );
  });

  it('still refuses a string gray-matter has already been asked about', () => {
    // The call order every caller really uses, and the one the two tests above
    // do not reach. `matter()` caches by input string and hands back
    // `Object.assign({}, cached)` on a hit — and `.matter`, unlike everything
    // else on that object, is non-enumerable, so the copy does not have it.
    // A refusal that asked gray-matter whether it saw frontmatter therefore
    // held on the first call for a string and collapsed on every later one,
    // letting a second `---` block be written above the author's and pushing
    // all of their keys into the body.
    for (const text of [
      '---\ncanvas_type: assignment\npoints_possible: 20\n',
      '---js\nmodule.exports = { a: 1 };\n---\nBody.\n',
      // gray-matter strips the BOM before it looks for the delimiter, so a
      // detection that does not strip it too calls this file frontmatter-free
      // and writes a block above keys that are already there.
      '﻿---\ncanvas_type: assignment\npoints_possible: 20\n',
    ]) {
      const before = parseFrontmatter(text).data;
      assert.equal(
        insertFrontmatterKey(text, 'title', 'Welcome'),
        null,
        `refused only until gray-matter had seen it: ${JSON.stringify(text)}`,
      );
      // And the reading it refuses over is a real one: there are keys here to
      // lose.
      assert.ok(Object.keys(before).length > 0);
    }
  });

  it('adds a block above a thematic break, which is not frontmatter', () => {
    // Four dashes is where gray-matter stops calling it a delimiter, so there
    // is nothing above to demote and a block is the right thing to add. The
    // rule is mirrored from gray-matter rather than guessed at, so this is the
    // edge that says the mirror is the right shape.
    const result = insertFrontmatterKey('----\nBody.\n', 'title', 'Welcome');
    assert.equal(result, '---\ntitle: Welcome\n---\n\n----\nBody.\n');
    assert.deepEqual(parseFrontmatter(result).data, { title: 'Welcome' });
  });
});
