const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildLinkMap,
  resolveRelativeLink,
  resolveCanvasLink,
  extractFileReferences,
  buildFileMap,
} = require('../../lib/convert/link-resolver');

// --- Fixtures ---

const SYNC_DATA = {
  course_id: 42,
  modules: {
    'mod-101': {
      items: {
        '01-intro/01-welcome.md': {
          canvas_id: 100,
          canvas_type: 'page',
          page_url: 'welcome',
        },
        '01-intro/02-setup.md': {
          canvas_id: 200,
          canvas_type: 'page',
          page_url: 'setup',
        },
        '02-advanced/01-deep-dive.md': {
          canvas_id: 300,
          canvas_type: 'assignment',
        },
      },
    },
  },
  files: {
    '01-intro/_files/diagram.png': {
      canvas_file_id: 500,
      canvas_url: 'https://canvas.example.com/courses/42/files/500/preview',
    },
  },
};

// --- buildLinkMap ---

describe('buildLinkMap', () => {
  it('builds forward and reverse maps from sync data', () => {
    const { relativeToCanvas, canvasToRelative } = buildLinkMap(SYNC_DATA);

    // Forward: relative path -> canvas info
    assert.deepEqual(relativeToCanvas.get('01-intro/01-welcome.md'), {
      canvasType: 'page',
      canvasId: 'welcome',
    });
    assert.deepEqual(relativeToCanvas.get('02-advanced/01-deep-dive.md'), {
      canvasType: 'assignment',
      canvasId: 300,
    });

    // Reverse: canvas URL path -> relative path
    assert.equal(canvasToRelative.get('/courses/42/pages/welcome'), '01-intro/01-welcome.md');
    assert.equal(canvasToRelative.get('/courses/42/assignments/300'), '02-advanced/01-deep-dive.md');
  });

  it('skips items without canvas_id', () => {
    const syncData = {
      course_id: 1,
      modules: { m: { items: { 'file.md': { canvas_type: 'page' } } } },
    };
    const { relativeToCanvas } = buildLinkMap(syncData);
    assert.equal(relativeToCanvas.size, 0);
  });

  it('handles empty sync data', () => {
    const { relativeToCanvas, canvasToRelative } = buildLinkMap({ course_id: 1 });
    assert.equal(relativeToCanvas.size, 0);
    assert.equal(canvasToRelative.size, 0);
  });
});

// --- resolveRelativeLink ---

describe('resolveRelativeLink', () => {
  const { relativeToCanvas } = buildLinkMap(SYNC_DATA);

  it('resolves a relative .md link to a Canvas page URL', () => {
    const result = resolveRelativeLink(
      './02-setup.md',
      '01-intro/01-welcome.md',
      relativeToCanvas,
      42
    );
    assert.equal(result.resolved, '/courses/42/pages/setup');
    assert.equal(result.wasInternal, false);
  });

  it('resolves a cross-module link to a Canvas assignment URL', () => {
    const result = resolveRelativeLink(
      '../02-advanced/01-deep-dive.md',
      '01-intro/01-welcome.md',
      relativeToCanvas,
      42
    );
    assert.equal(result.resolved, '/courses/42/assignments/300');
  });

  it('preserves fragment identifiers', () => {
    const result = resolveRelativeLink(
      './02-setup.md#installation',
      '01-intro/01-welcome.md',
      relativeToCanvas,
      42
    );
    assert.equal(result.resolved, '/courses/42/pages/setup#installation');
  });

  it('skips external URLs', () => {
    const result = resolveRelativeLink(
      'https://example.com/page.md',
      '01-intro/01-welcome.md',
      relativeToCanvas,
      42
    );
    assert.equal(result.resolved, null);
    assert.equal(result.wasInternal, false);
  });

  it('skips fragment-only links', () => {
    const result = resolveRelativeLink('#section', '01-intro/01-welcome.md', relativeToCanvas, 42);
    assert.equal(result.resolved, null);
    assert.equal(result.wasInternal, false);
  });

  it('skips non-.md links', () => {
    const result = resolveRelativeLink('./image.png', '01-intro/01-welcome.md', relativeToCanvas, 42);
    assert.equal(result.resolved, null);
    assert.equal(result.wasInternal, false);
  });

  it('returns wasInternal=true for unresolvable .md links', () => {
    const result = resolveRelativeLink(
      './nonexistent.md',
      '01-intro/01-welcome.md',
      relativeToCanvas,
      42
    );
    assert.equal(result.resolved, null);
    assert.equal(result.wasInternal, true);
  });

  it('handles empty href', () => {
    const result = resolveRelativeLink('', '01-intro/01-welcome.md', relativeToCanvas, 42);
    assert.equal(result.resolved, null);
    assert.equal(result.wasInternal, false);
  });
});

// --- resolveCanvasLink ---

describe('resolveCanvasLink', () => {
  const { canvasToRelative } = buildLinkMap(SYNC_DATA);

  it('resolves a Canvas page URL to a relative markdown path', () => {
    const result = resolveCanvasLink(
      '/courses/42/pages/welcome',
      '01-intro/02-setup.md',
      canvasToRelative
    );
    assert.equal(result, './01-welcome.md');
  });

  it('resolves a Canvas assignment URL', () => {
    const result = resolveCanvasLink(
      '/courses/42/assignments/300',
      '01-intro/01-welcome.md',
      canvasToRelative
    );
    assert.equal(result, '../02-advanced/01-deep-dive.md');
  });

  it('preserves fragment identifiers', () => {
    const result = resolveCanvasLink(
      '/courses/42/pages/welcome#section',
      '01-intro/02-setup.md',
      canvasToRelative
    );
    assert.equal(result, './01-welcome.md#section');
  });

  it('handles absolute Canvas URLs with domain', () => {
    const result = resolveCanvasLink(
      'https://canvas.example.com/courses/42/pages/welcome',
      '01-intro/02-setup.md',
      canvasToRelative
    );
    assert.equal(result, './01-welcome.md');
  });

  it('returns null for non-Canvas links', () => {
    assert.equal(resolveCanvasLink('/other/path', '01-intro/01-welcome.md', canvasToRelative), null);
    assert.equal(resolveCanvasLink('https://example.com', '01-intro/01-welcome.md', canvasToRelative), null);
  });

  it('returns null for empty href', () => {
    assert.equal(resolveCanvasLink('', '01-intro/01-welcome.md', canvasToRelative), null);
  });

  it('returns null for unknown Canvas URLs', () => {
    const result = resolveCanvasLink(
      '/courses/42/pages/nonexistent',
      '01-intro/01-welcome.md',
      canvasToRelative
    );
    assert.equal(result, null);
  });
});

// --- extractFileReferences ---

describe('extractFileReferences', () => {
  it('extracts image references', () => {
    const md = '![diagram](./_files/diagram.png)';
    const refs = extractFileReferences(md, '01-intro/01-welcome.md');
    assert.deepEqual(refs, ['01-intro/_files/diagram.png']);
  });

  it('extracts link references to non-markdown files', () => {
    const md = '[Download PDF](./_files/guide.pdf)';
    const refs = extractFileReferences(md, '01-intro/01-welcome.md');
    assert.deepEqual(refs, ['01-intro/_files/guide.pdf']);
  });

  it('skips external URLs', () => {
    const md = '![logo](https://example.com/logo.png)';
    const refs = extractFileReferences(md, '01-intro/01-welcome.md');
    assert.deepEqual(refs, []);
  });

  it('skips .md links', () => {
    const md = '[next](./02-setup.md)';
    const refs = extractFileReferences(md, '01-intro/01-welcome.md');
    assert.deepEqual(refs, []);
  });

  it('deduplicates references', () => {
    const md = '![a](./_files/img.png)\n![b](./_files/img.png)';
    const refs = extractFileReferences(md, '01-intro/01-welcome.md');
    assert.deepEqual(refs, ['01-intro/_files/img.png']);
  });

  it('handles cross-module file references', () => {
    const md = '![diagram](../_shared/diagram.svg)';
    const refs = extractFileReferences(md, '02-module/01-page.md');
    assert.deepEqual(refs, ['_shared/diagram.svg']);
  });

  it('returns empty array for content without references', () => {
    const refs = extractFileReferences('Just plain text.', '01-intro/01-welcome.md');
    assert.deepEqual(refs, []);
  });
});

// --- buildFileMap ---

describe('buildFileMap', () => {
  it('builds local-to-canvas and canvas-to-local maps', () => {
    const { localToCanvas, canvasToLocal } = buildFileMap(SYNC_DATA);

    assert.deepEqual(localToCanvas.get('01-intro/_files/diagram.png'), {
      canvas_file_id: 500,
      canvas_url: 'https://canvas.example.com/courses/42/files/500/preview',
    });
    assert.equal(
      canvasToLocal.get('https://canvas.example.com/courses/42/files/500/preview'),
      '01-intro/_files/diagram.png'
    );
  });

  it('handles empty files object', () => {
    const { localToCanvas, canvasToLocal } = buildFileMap({ files: {} });
    assert.equal(localToCanvas.size, 0);
    assert.equal(canvasToLocal.size, 0);
  });

  it('handles missing files key', () => {
    const { localToCanvas, canvasToLocal } = buildFileMap({});
    assert.equal(localToCanvas.size, 0);
    assert.equal(canvasToLocal.size, 0);
  });
});
