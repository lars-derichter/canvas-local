const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// Set required env vars before requiring anything that loads the client.
process.env.CANVAS_API_URL = 'https://canvas.example.com';
process.env.CANVAS_API_TOKEN = 'test-token-123';

const pull = require('../../cli/pull');

const { _createPullFileResolver: createPullFileResolver } = pull;

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

describe('what lib/sync/apply.js borrows', () => {
  // The engine reaches into this module by name through `pullInternals()`, so a
  // rename here is a runtime failure there rather than a build one. Three
  // names, pinned.
  it('keeps the three helpers the engine calls by name', () => {
    assert.equal(typeof pull._writeCategoryFile, 'function');
    assert.equal(typeof pull._downloadReferencedFiles, 'function');
    assert.equal(typeof pull._createPullFileResolver, 'function');
  });
});
