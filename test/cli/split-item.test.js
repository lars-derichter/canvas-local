const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const matter = require('gray-matter');

const { _splitFile, _frontmatterLineCount } = require('../../cli/split-item');

/**
 * Create a markdown file with frontmatter and body content.
 */
function createMdFile(dir, name, frontmatter, body) {
  const content = matter.stringify('\n' + body + '\n', frontmatter);
  fs.writeFileSync(path.join(dir, name), content, 'utf8');
}

describe('_frontmatterLineCount', () => {
  it('counts frontmatter lines including delimiters', () => {
    const raw = '---\ntitle: Test\ncanvas_type: page\n---\nBody here';
    assert.equal(_frontmatterLineCount(raw), 4);
  });

  it('returns 0 for files without frontmatter', () => {
    const raw = 'Just body content\nNo frontmatter';
    assert.equal(_frontmatterLineCount(raw), 0);
  });

  it('handles single-field frontmatter', () => {
    const raw = '---\ntitle: Test\n---\nBody';
    assert.equal(_frontmatterLineCount(raw), 3);
  });
});

describe('_splitFile', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'split-item-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('splits file at the given body line', async () => {
    createMdFile(
      tmpDir,
      '01-original.md',
      { title: 'Original' },
      'Line 1\nLine 2\nLine 3\nLine 4',
    );

    await _splitFile(
      path.join(tmpDir, '01-original.md'),
      2,
      'Part Two',
      tmpDir,
    );

    const original = matter(
      fs.readFileSync(path.join(tmpDir, '01-original.md'), 'utf8'),
    );
    const originalBody = original.content.trim();
    assert.ok(originalBody.includes('Line 1'));
    assert.ok(originalBody.includes('Line 2'));
    assert.ok(!originalBody.includes('Line 3'));

    const newFile = matter(
      fs.readFileSync(path.join(tmpDir, '02-part-two.md'), 'utf8'),
    );
    const newBody = newFile.content.trim();
    assert.ok(newBody.includes('Line 3'));
    assert.ok(newBody.includes('Line 4'));
    assert.ok(!newBody.includes('Line 1'));
  });

  it('original file keeps its frontmatter', async () => {
    createMdFile(
      tmpDir,
      '01-original.md',
      { title: 'Original', canvas_type: 'page', lesson: 3 },
      'Line 1\nLine 2\nLine 3',
    );

    await _splitFile(
      path.join(tmpDir, '01-original.md'),
      1,
      'Part Two',
      tmpDir,
    );

    const original = matter(
      fs.readFileSync(path.join(tmpDir, '01-original.md'), 'utf8'),
    );
    assert.equal(original.data.title, 'Original');
    assert.equal(original.data.canvas_type, 'page');
    assert.equal(original.data.lesson, 3);
  });

  it('new file carries the frontmatter over under its own title', async () => {
    createMdFile(
      tmpDir,
      '01-original.md',
      { title: 'Original', canvas_type: 'page', lesson: 3 },
      'Line 1\nLine 2\nLine 3',
    );

    await _splitFile(
      path.join(tmpDir, '01-original.md'),
      1,
      'New Title',
      tmpDir,
    );

    // The title is the only key the split changes: identity lives in
    // `.canvas-sync.json` keyed by path, so the new path is a new item and
    // nothing in the file has to be cleared to make that true.
    const newFile = matter(
      fs.readFileSync(path.join(tmpDir, '02-new-title.md'), 'utf8'),
    );
    assert.equal(newFile.data.title, 'New Title');
    assert.equal(newFile.data.canvas_type, 'page');
    assert.equal(newFile.data.lesson, 3);
  });

  it('new file is inserted at correct position with renumbering', async () => {
    createMdFile(tmpDir, '01-first.md', { title: 'First' }, 'A1\nA2\nA3');
    createMdFile(tmpDir, '02-second.md', { title: 'Second' }, 'B');
    createMdFile(tmpDir, '03-third.md', { title: 'Third' }, 'C');

    await _splitFile(
      path.join(tmpDir, '01-first.md'),
      1,
      'First Part Two',
      tmpDir,
    );

    const files = fs.readdirSync(tmpDir).sort();
    assert.deepStrictEqual(files, [
      '01-first.md',
      '02-first-part-two.md',
      '03-second.md',
      '04-third.md',
    ]);
  });

  it('handles split at last line minus one', async () => {
    createMdFile(
      tmpDir,
      '01-original.md',
      { title: 'Original' },
      'Line 1\nLine 2\nLine 3',
    );

    await _splitFile(
      path.join(tmpDir, '01-original.md'),
      2,
      'Last Line',
      tmpDir,
    );

    const original = matter(
      fs.readFileSync(path.join(tmpDir, '01-original.md'), 'utf8'),
    );
    assert.ok(original.content.trim().includes('Line 2'));
    assert.ok(!original.content.trim().includes('Line 3'));

    const newFile = matter(
      fs.readFileSync(path.join(tmpDir, '02-last-line.md'), 'utf8'),
    );
    assert.ok(newFile.content.trim().includes('Line 3'));
  });
});
