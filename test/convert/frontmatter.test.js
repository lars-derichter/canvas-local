const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseFrontmatter, serializeFrontmatter } = require('../../lib/convert/frontmatter');

describe('parseFrontmatter', () => {
  it('parses YAML frontmatter and body content', () => {
    const input = '---\ntitle: Hello\ncanvas_type: page\n---\n\nBody text here.';
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
    assert.deepEqual(data.submission_types, ['online_upload', 'online_text_entry']);
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
    const original = '---\ntitle: Round Trip\ncanvas_type: assignment\n---\n\nSome body.\n';
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
