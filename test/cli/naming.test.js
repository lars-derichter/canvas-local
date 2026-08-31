const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  toFolderName,
  toFileName,
  toFileSlug,
  computeRelativePath,
} = require('../../cli/naming');
const { MAX_SLUG_LENGTH } = require('../../cli/module-utils');

describe('toFolderName', () => {
  it('creates a numbered folder name from name and position', () => {
    assert.equal(toFolderName('Introduction', 1), '01-introduction');
  });

  it('pads position to two digits', () => {
    assert.equal(toFolderName('Module', 12), '12-module');
  });

  it('replaces special characters with hyphens', () => {
    assert.equal(toFolderName('Hello & World!', 3), '03-hello-world');
  });

  it('handles multi-word names', () => {
    assert.equal(toFolderName('My New Module', 2), '02-my-new-module');
  });

  it('strips leading and trailing hyphens', () => {
    assert.equal(toFolderName('--test--', 1), '01-test');
  });
});

describe('toFileName', () => {
  it('creates a numbered markdown filename', () => {
    assert.equal(toFileName('Welcome', 1), '01-welcome.md');
  });

  it('handles multi-word titles', () => {
    assert.equal(
      toFileName('Getting Started Guide', 5),
      '05-getting-started-guide.md',
    );
  });

  it('replaces special characters', () => {
    assert.equal(toFileName('What is C++?', 3), '03-what-is-c.md');
  });
});

/**
 * The arithmetic the cap was chosen for, held to rather than described. A
 * Windows checkout is the thing that breaks first, at 260 characters, and it
 * breaks completely: `git clone` cannot create the directory, so the course
 * cannot be opened on Windows at all.
 */
describe('the deepest path the tool generates', () => {
  it('stays inside a Windows checkout, runner prefix included', () => {
    const sentence = 'a really quite unreasonably long canvas title '.repeat(8);
    const relative = [
      'course',
      toFolderName(sentence, 12),
      toFolderName(sentence, 12),
      toFileName(sentence, 12),
    ].join('/');
    // `D:\a\<repo>\<repo>\` on a GitHub runner, for a 20-character name.
    const prefix = 'D:\\a\\'.length + 2 * 20 + 2;

    assert.ok(
      prefix + relative.length < 260,
      `expected under 260 characters, got ${prefix + relative.length}: ` +
        relative,
    );
  });
});

describe('toFileSlug', () => {
  it('preserves file extension', () => {
    assert.equal(toFileSlug('diagram.svg'), 'diagram.svg');
  });

  it('lowercases the entire name', () => {
    assert.equal(toFileSlug('Photo.JPEG'), 'photo.jpeg');
  });

  it('preserves multiple dots in name', () => {
    assert.equal(toFileSlug('archive.tar.gz'), 'archive.tar.gz');
  });

  it('handles spaces in filenames', () => {
    assert.equal(toFileSlug('my file.pdf'), 'my-file.pdf');
  });

  it('caps the stem but never the extension', () => {
    const slug = toFileSlug(`${'a very long word '.repeat(8)}.pdf`);
    assert.ok(slug.endsWith('.pdf'), `expected a .pdf, got ${slug}`);
    assert.ok(
      slug.length - '.pdf'.length <= MAX_SLUG_LENGTH,
      `expected a stem of at most ${MAX_SLUG_LENGTH} characters, got ${slug}`,
    );
  });

  it('caps a dotfile whole, having no extension to protect', () => {
    const slug = toFileSlug('.'.concat('b'.repeat(200)));
    assert.equal(slug.length, MAX_SLUG_LENGTH);
  });
});

describe('computeRelativePath', () => {
  it('computes posix-style relative path within a module folder', () => {
    const courseDir = '/abs/course';
    const filePath = '/abs/course/01-intro/01-page.md';
    assert.equal(
      computeRelativePath('01-intro', filePath, courseDir),
      '01-intro/01-page.md',
    );
  });

  it('handles subfolder paths', () => {
    const courseDir = '/abs/course';
    const filePath = '/abs/course/01-intro/02-sub/01-file.md';
    assert.equal(
      computeRelativePath('01-intro', filePath, courseDir),
      '01-intro/02-sub/01-file.md',
    );
  });
});
