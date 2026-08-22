const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const matter = require('gray-matter');

const { _mergeFiles } = require('../../cli/merge-items');

/**
 * Create a markdown file with frontmatter and body content.
 */
function createMdFile(dir, name, frontmatter, body) {
  const content = matter.stringify('\n' + body + '\n', frontmatter);
  fs.writeFileSync(path.join(dir, name), content, 'utf8');
}

describe('_mergeFiles', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-items-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('appends source body into target file', async () => {
    createMdFile(tmpDir, '01-first.md', { title: 'First' }, 'Content A');
    createMdFile(tmpDir, '02-second.md', { title: 'Second' }, 'Content B');

    const targetPath = path.join(tmpDir, '01-first.md');
    const sourcePath = path.join(tmpDir, '02-second.md');

    await _mergeFiles(targetPath, sourcePath, tmpDir);

    const result = fs.readFileSync(targetPath, 'utf8');
    assert.ok(result.includes('Content A'));
    assert.ok(result.includes('Content B'));
  });

  it('keeps target frontmatter', async () => {
    createMdFile(
      tmpDir,
      '01-first.md',
      { title: 'First', canvas_type: 'page', canvas_id: 'first-page' },
      'Content A',
    );
    createMdFile(
      tmpDir,
      '02-second.md',
      { title: 'Second', canvas_type: 'assignment', canvas_id: 42 },
      'Content B',
    );

    const targetPath = path.join(tmpDir, '01-first.md');
    const sourcePath = path.join(tmpDir, '02-second.md');

    await _mergeFiles(targetPath, sourcePath, tmpDir);

    const parsed = matter(fs.readFileSync(targetPath, 'utf8'));
    assert.equal(parsed.data.title, 'First');
    assert.equal(parsed.data.canvas_type, 'page');
    assert.equal(parsed.data.canvas_id, 'first-page');
  });

  it('discards source frontmatter', async () => {
    createMdFile(tmpDir, '01-first.md', { title: 'First' }, 'Content A');
    createMdFile(
      tmpDir,
      '02-second.md',
      { title: 'Second', canvas_id: 'second-page' },
      'Content B',
    );

    const targetPath = path.join(tmpDir, '01-first.md');
    const sourcePath = path.join(tmpDir, '02-second.md');

    await _mergeFiles(targetPath, sourcePath, tmpDir);

    const parsed = matter(fs.readFileSync(targetPath, 'utf8'));
    assert.equal(parsed.data.title, 'First');
    assert.ok(
      !parsed.data.canvas_id || parsed.data.canvas_id !== 'second-page',
    );
  });

  it('deletes the source file', async () => {
    createMdFile(tmpDir, '01-first.md', { title: 'First' }, 'Content A');
    createMdFile(tmpDir, '02-second.md', { title: 'Second' }, 'Content B');

    const targetPath = path.join(tmpDir, '01-first.md');
    const sourcePath = path.join(tmpDir, '02-second.md');

    await _mergeFiles(targetPath, sourcePath, tmpDir);

    assert.ok(!fs.existsSync(sourcePath));
  });

  it('renumbers remaining items sequentially', async () => {
    createMdFile(tmpDir, '01-first.md', { title: 'First' }, 'A');
    createMdFile(tmpDir, '02-second.md', { title: 'Second' }, 'B');
    createMdFile(tmpDir, '03-third.md', { title: 'Third' }, 'C');

    const targetPath = path.join(tmpDir, '01-first.md');
    const sourcePath = path.join(tmpDir, '02-second.md');

    await _mergeFiles(targetPath, sourcePath, tmpDir);

    const files = fs.readdirSync(tmpDir).sort();
    assert.deepStrictEqual(files, ['01-first.md', '02-third.md']);
  });

  it('combines multi-line content with a blank line separator', async () => {
    createMdFile(tmpDir, '01-first.md', { title: 'First' }, 'Line 1\nLine 2');
    createMdFile(tmpDir, '02-second.md', { title: 'Second' }, 'Line 3\nLine 4');

    const targetPath = path.join(tmpDir, '01-first.md');
    const sourcePath = path.join(tmpDir, '02-second.md');

    await _mergeFiles(targetPath, sourcePath, tmpDir);

    const parsed = matter(fs.readFileSync(targetPath, 'utf8'));
    const body = parsed.content.trim();
    assert.ok(body.includes('Line 1\nLine 2'));
    assert.ok(body.includes('Line 3\nLine 4'));
    // Should have a blank line between the two parts
    assert.ok(body.includes('Line 2\n\nLine 3'));
  });
});
