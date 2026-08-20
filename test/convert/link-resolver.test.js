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
    '01-intro': {
      canvas_module_id: 101,
      items: {
        '01-intro/01-welcome.md': {
          canvas_type: 'page',
          canvas_id: 100,
          page_url: 'welcome',
        },
        '01-intro/02-setup.md': {
          canvas_type: 'page',
          canvas_id: 200,
          page_url: 'setup',
        },
        // Deliberately filed under 01-intro while its path says otherwise: the
        // map is built from the row keys, and the module it sits in is not
        // supposed to matter to it.
        '02-advanced/01-deep-dive.md': {
          canvas_type: 'assignment',
          canvas_id: 300,
        },
        '01-intro/03-debate.md': {
          canvas_type: 'discussion',
          canvas_id: 77,
        },
        '01-intro/04-check.md': { canvas_type: 'quiz', canvas_id: 88 },
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
    assert.equal(
      canvasToRelative.get('/courses/42/pages/welcome'),
      '01-intro/01-welcome.md',
    );
    assert.equal(
      canvasToRelative.get('/courses/42/assignments/300'),
      '02-advanced/01-deep-dive.md',
    );
  });

  it('maps a discussion to a discussion_topics URL', () => {
    const { relativeToCanvas, canvasToRelative } = buildLinkMap(SYNC_DATA);

    assert.deepEqual(relativeToCanvas.get('01-intro/03-debate.md'), {
      canvasType: 'discussion',
      canvasId: 77,
    });
    assert.equal(
      canvasToRelative.get('/courses/42/discussion_topics/77'),
      '01-intro/03-debate.md',
    );
    assert.equal(canvasToRelative.get('/courses/42/pages/77'), undefined);
  });

  it('maps a quiz to a quizzes URL', () => {
    const { relativeToCanvas, canvasToRelative } = buildLinkMap(SYNC_DATA);

    assert.deepEqual(relativeToCanvas.get('01-intro/04-check.md'), {
      canvasType: 'quiz',
      canvasId: 88,
    });
    assert.equal(
      canvasToRelative.get('/courses/42/quizzes/88'),
      '01-intro/04-check.md',
    );
    // The page fallback would collide with a real page whose numeric id is 88.
    assert.equal(canvasToRelative.get('/courses/42/pages/88'), undefined);
  });

  it('skips items without canvas_id', () => {
    const syncData = {
      course_id: 1,
      modules: {
        '01-mod': { items: { '01-mod/file.md': { canvas_type: 'page' } } },
      },
    };
    const { relativeToCanvas } = buildLinkMap(syncData);
    assert.equal(relativeToCanvas.size, 0);
  });

  it('handles empty sync data', () => {
    const { relativeToCanvas, canvasToRelative } = buildLinkMap({
      course_id: 1,
    });
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
      42,
    );
    assert.equal(result.resolved, '/courses/42/pages/setup');
    assert.equal(result.wasInternal, false);
  });

  it('resolves a cross-module link to a Canvas assignment URL', () => {
    const result = resolveRelativeLink(
      '../02-advanced/01-deep-dive.md',
      '01-intro/01-welcome.md',
      relativeToCanvas,
      42,
    );
    assert.equal(result.resolved, '/courses/42/assignments/300');
  });

  it('resolves a link to a discussion to a discussion_topics URL', () => {
    const result = resolveRelativeLink(
      './03-debate.md',
      '01-intro/01-welcome.md',
      relativeToCanvas,
      42,
    );
    assert.equal(result.resolved, '/courses/42/discussion_topics/77');
    assert.equal(result.wasInternal, false);
  });

  it('preserves fragment identifiers on discussion links', () => {
    const result = resolveRelativeLink(
      './03-debate.md#rules',
      '01-intro/01-welcome.md',
      relativeToCanvas,
      42,
    );
    assert.equal(result.resolved, '/courses/42/discussion_topics/77#rules');
  });

  it('preserves fragment identifiers', () => {
    const result = resolveRelativeLink(
      './02-setup.md#installation',
      '01-intro/01-welcome.md',
      relativeToCanvas,
      42,
    );
    assert.equal(result.resolved, '/courses/42/pages/setup#installation');
  });

  it('skips external URLs', () => {
    const result = resolveRelativeLink(
      'https://example.com/page.md',
      '01-intro/01-welcome.md',
      relativeToCanvas,
      42,
    );
    assert.equal(result.resolved, null);
    assert.equal(result.wasInternal, false);
  });

  it('skips fragment-only links', () => {
    const result = resolveRelativeLink(
      '#section',
      '01-intro/01-welcome.md',
      relativeToCanvas,
      42,
    );
    assert.equal(result.resolved, null);
    assert.equal(result.wasInternal, false);
  });

  it('skips non-.md links', () => {
    const result = resolveRelativeLink(
      './image.png',
      '01-intro/01-welcome.md',
      relativeToCanvas,
      42,
    );
    assert.equal(result.resolved, null);
    assert.equal(result.wasInternal, false);
  });

  it('returns wasInternal=true for unresolvable .md links', () => {
    const result = resolveRelativeLink(
      './nonexistent.md',
      '01-intro/01-welcome.md',
      relativeToCanvas,
      42,
    );
    assert.equal(result.resolved, null);
    assert.equal(result.wasInternal, true);
  });

  it('handles empty href', () => {
    const result = resolveRelativeLink(
      '',
      '01-intro/01-welcome.md',
      relativeToCanvas,
      42,
    );
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
      canvasToRelative,
    );
    assert.equal(result, './01-welcome.md');
  });

  it('resolves a Canvas assignment URL', () => {
    const result = resolveCanvasLink(
      '/courses/42/assignments/300',
      '01-intro/01-welcome.md',
      canvasToRelative,
    );
    assert.equal(result, '../02-advanced/01-deep-dive.md');
  });

  it('resolves a Canvas discussion URL', () => {
    const result = resolveCanvasLink(
      '/courses/42/discussion_topics/77',
      '01-intro/01-welcome.md',
      canvasToRelative,
    );
    assert.equal(result, './03-debate.md');
  });

  it('resolves a Canvas quiz URL', () => {
    const result = resolveCanvasLink(
      '/courses/42/quizzes/88',
      '01-intro/01-welcome.md',
      canvasToRelative,
    );
    assert.equal(result, './04-check.md');
  });

  it('resolves an absolute Canvas discussion URL with a fragment', () => {
    const result = resolveCanvasLink(
      'https://canvas.example.com/courses/42/discussion_topics/77#rules',
      '02-advanced/01-deep-dive.md',
      canvasToRelative,
    );
    assert.equal(result, '../01-intro/03-debate.md#rules');
  });

  it('preserves fragment identifiers', () => {
    const result = resolveCanvasLink(
      '/courses/42/pages/welcome#section',
      '01-intro/02-setup.md',
      canvasToRelative,
    );
    assert.equal(result, './01-welcome.md#section');
  });

  it('handles absolute Canvas URLs with domain', () => {
    const result = resolveCanvasLink(
      'https://canvas.example.com/courses/42/pages/welcome',
      '01-intro/02-setup.md',
      canvasToRelative,
    );
    assert.equal(result, './01-welcome.md');
  });

  it('returns null for non-Canvas links', () => {
    assert.equal(
      resolveCanvasLink(
        '/other/path',
        '01-intro/01-welcome.md',
        canvasToRelative,
      ),
      null,
    );
    assert.equal(
      resolveCanvasLink(
        'https://example.com',
        '01-intro/01-welcome.md',
        canvasToRelative,
      ),
      null,
    );
  });

  it('returns null for empty href', () => {
    assert.equal(
      resolveCanvasLink('', '01-intro/01-welcome.md', canvasToRelative),
      null,
    );
  });

  it('returns null for unknown Canvas URLs', () => {
    const result = resolveCanvasLink(
      '/courses/42/pages/nonexistent',
      '01-intro/01-welcome.md',
      canvasToRelative,
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
    const refs = extractFileReferences(
      'Just plain text.',
      '01-intro/01-welcome.md',
    );
    assert.deepEqual(refs, []);
  });

  it('ignores link syntax inside inline code spans', () => {
    const md = 'Links look like `[text](url)` in markdown.';
    const refs = extractFileReferences(md, '01-intro/01-welcome.md');
    assert.deepEqual(refs, []);
  });

  it('ignores link syntax inside multi-backtick inline code', () => {
    const md = 'Code: `` `[text](url)` `` here.';
    const refs = extractFileReferences(md, '01-intro/01-welcome.md');
    assert.deepEqual(refs, []);
  });

  it('ignores references inside fenced code blocks', () => {
    const md = '```markdown\n![Alt](./_files/example.svg)\n```';
    const refs = extractFileReferences(md, '01-intro/01-welcome.md');
    assert.deepEqual(refs, []);
  });

  it('still extracts real references alongside code examples', () => {
    const md = [
      'Example syntax: `[text](url)`',
      '',
      '```markdown',
      '![ignored](./_files/ignored.png)',
      '```',
      '',
      '![Real](./_files/real.png)',
    ].join('\n');
    const refs = extractFileReferences(md, '01-intro/01-welcome.md');
    assert.deepEqual(refs, ['01-intro/_files/real.png']);
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
      canvasToLocal.get(
        'https://canvas.example.com/courses/42/files/500/preview',
      ),
      '01-intro/_files/diagram.png',
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
