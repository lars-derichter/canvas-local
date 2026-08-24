const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// Set required env vars before requiring anything that loads the client.
process.env.CANVAS_API_URL = 'https://canvas.example.com';
process.env.CANVAS_API_TOKEN = 'test-token-123';

const localWrite = require('../../lib/sync/local-write');

const { createPullFileResolver } = localWrite;

describe('createPullFileResolver', () => {
  it('resolves a Canvas file URL to a relative path', () => {
    const canvasToLocal = new Map([
      ['/courses/1/files/100/preview', '01-mod/_files/image.png'],
    ]);
    const resolver = createPullFileResolver(
      1,
      '01-mod/01-page.md',
      canvasToLocal,
    );
    const result = resolver('/courses/1/files/100/preview');
    assert.equal(result, './_files/image.png');
  });

  it('returns null for non-Canvas URLs', () => {
    const resolver = createPullFileResolver(1, '01-mod/01-page.md', new Map());
    assert.equal(resolver('https://example.com/image.png'), null);
  });

  it('returns null for unknown file IDs', () => {
    const resolver = createPullFileResolver(1, '01-mod/01-page.md', new Map());
    assert.equal(resolver('/courses/1/files/999/preview'), null);
  });

  it('returns null for empty href', () => {
    const resolver = createPullFileResolver(1, '01-mod/01-page.md', new Map());
    assert.equal(resolver(''), null);
    assert.equal(resolver(null), null);
  });

  it('handles absolute Canvas URLs with domain', () => {
    const canvasToLocal = new Map([
      ['/courses/1/files/50/preview', '01-mod/_files/doc.pdf'],
    ]);
    const resolver = createPullFileResolver(
      1,
      '01-mod/01-page.md',
      canvasToLocal,
    );
    const result = resolver(
      'https://canvas.example.com/courses/1/files/50/download?wrap=1',
    );
    assert.equal(result, './_files/doc.pdf');
  });

  it('resolves a foreign-course href through the mapped entry', () => {
    // The map decides, not the href's course id: `downloadReferencedFiles`
    // keys a foreign-course embed under this course's preview pattern (and
    // withholds its row), and the resolver derives that same pattern from any
    // href's file id. That is what turns a source-course URL into the
    // `_files/` link the next push uploads from.
    const canvasToLocal = new Map([
      ['/courses/1/files/100/preview', '01-mod/_files/image.png'],
    ]);
    const resolver = createPullFileResolver(
      1,
      '01-mod/01-page.md',
      canvasToLocal,
    );
    assert.equal(
      resolver('/courses/9999/files/100/preview'),
      './_files/image.png',
    );
  });

  it('resolves cross-directory file references', () => {
    const canvasToLocal = new Map([
      ['/courses/1/files/10/preview', '02-other/_files/shared.png'],
    ]);
    const resolver = createPullFileResolver(
      1,
      '01-mod/01-page.md',
      canvasToLocal,
    );
    const result = resolver('/courses/1/files/10/preview');
    assert.equal(result, '../02-other/_files/shared.png');
  });
});

describe('what lib/sync/apply.js calls', () => {
  // The engine destructures these three by name, and a CommonJS destructure of
  // a name that is not exported is silent until the call. So a rename here is
  // still a runtime failure there rather than a build one. Three names, pinned.
  it('keeps the three helpers the engine calls by name', () => {
    assert.equal(typeof localWrite.writeCategoryFile, 'function');
    assert.equal(typeof localWrite.downloadReferencedFiles, 'function');
    assert.equal(typeof localWrite.createPullFileResolver, 'function');
  });
});
