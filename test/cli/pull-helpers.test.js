const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Set required env vars before requiring anything that loads the client.
process.env.CANVAS_API_URL = 'https://canvas.example.com';
process.env.CANVAS_API_TOKEN = 'test-token-123';

const pull = require('../../cli/pull');

const {
  _findOldSyncPath: findOldSyncPath,
  _overwriteSkipReason: overwriteSkipReason,
  _courseHasMarkdown: courseHasMarkdown,
  _createPullFileResolver: createPullFileResolver,
  _pullStrategies: pullStrategies,
} = pull;

describe('findOldSyncPath', () => {
  it('finds a row by its page slug', () => {
    const items = {
      '01-mod/01-page.md': {
        canvas_type: 'page',
        canvas_id: 42,
        page_url: 'my-page',
      },
    };
    assert.equal(
      findOldSyncPath({ page_url: 'my-page' }, items),
      '01-mod/01-page.md',
    );
  });

  it('finds a row by its launch URL', () => {
    const items = {
      '01-mod/02-link.md': {
        canvas_type: 'external_url',
        canvas_id: 5,
        external_url: 'https://example.com',
      },
    };
    assert.equal(
      findOldSyncPath({ external_url: 'https://example.com' }, items),
      '01-mod/02-link.md',
    );
  });

  it('finds a page by the wiki page id its slug resolved to', () => {
    const items = {
      '01-mod/01-page.md': { canvas_type: 'page', canvas_id: 42 },
    };
    assert.equal(
      findOldSyncPath({ _resolvedPageId: 42 }, items),
      '01-mod/01-page.md',
    );
  });

  it('finds a row by content_id', () => {
    const items = {
      '01-mod/03-assign.md': { canvas_type: 'assignment', canvas_id: 99 },
    };
    assert.equal(
      findOldSyncPath({ content_id: 99 }, items),
      '01-mod/03-assign.md',
    );
  });

  it('finds a row by the module item id as a fallback', () => {
    const items = {
      '01-mod/04-item.md': { canvas_type: 'external_url', canvas_id: 7 },
    };
    assert.equal(findOldSyncPath({ id: 7 }, items), '01-mod/04-item.md');
  });

  it('returns null when no row matches', () => {
    assert.equal(findOldSyncPath({ id: 999 }, {}), null);
    assert.equal(findOldSyncPath({ id: 999 }, undefined), null);
  });

  it('prefers the slug over the id', () => {
    const items = {
      '01-mod/by-slug.md': { canvas_type: 'page', page_url: 'slug' },
      '01-mod/by-id.md': { canvas_type: 'page', canvas_id: 42 },
    };
    assert.equal(
      findOldSyncPath({ page_url: 'slug', id: 42 }, items),
      '01-mod/by-slug.md',
    );
  });

  it('compares an id Canvas gave as a number against one stored as a string', () => {
    const items = {
      '01-mod/03-assign.md': { canvas_type: 'assignment', canvas_id: '99' },
    };
    assert.equal(
      findOldSyncPath({ content_id: 99 }, items),
      '01-mod/03-assign.md',
    );
  });
});

describe('overwriteSkipReason', () => {
  let tmpDir;

  const existingFile = (name = 'test.md') => {
    const file = path.join(tmpDir, name);
    fs.writeFileSync(file, 'hand-written markdown');
    return file;
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pull-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes a file that does not exist yet', () => {
    assert.equal(
      overwriteSkipReason(
        path.join(tmpDir, 'nope.md'),
        { last_sync: '2020-01-01T00:00:00Z' },
        false,
      ),
      null,
    );
  });

  it('writes a file that has not been touched since the last sync', () => {
    // last_sync is in the future, so the file predates it
    assert.equal(
      overwriteSkipReason(
        existingFile(),
        { last_sync: '2099-01-01T00:00:00Z' },
        false,
      ),
      null,
    );
  });

  it('skips a file modified since the last sync', () => {
    // last_sync is in the past, so the file was touched after it
    const reason = overwriteSkipReason(
      existingFile(),
      { last_sync: '2000-01-01T00:00:00Z' },
      false,
    );
    assert.match(reason, /locally modified since last sync/);
    assert.match(reason, /--force/);
  });

  it('skips an existing file when there is no sync state', () => {
    const reason = overwriteSkipReason(existingFile(), {}, false);
    assert.ok(reason, 'a file that cannot be judged must not be overwritten');
    assert.match(reason, /no sync state/);
    assert.match(reason, /--force/);
  });

  it('explains the missing sync state rather than claiming a local edit', () => {
    const reason = overwriteSkipReason(existingFile(), {}, false);
    assert.doesNotMatch(reason, /locally modified/);
  });

  it('treats a missing sync file the same as an empty one', () => {
    assert.ok(overwriteSkipReason(existingFile(), undefined, false));
    assert.ok(overwriteSkipReason(existingFile('other.md'), null, false));
  });

  it('still writes a missing file when there is no sync state', () => {
    // A first import onto an empty tree must work exactly as before.
    assert.equal(
      overwriteSkipReason(path.join(tmpDir, 'new.md'), {}, false),
      null,
    );
  });

  it('overwrites everything under --force', () => {
    const file = existingFile();
    assert.equal(overwriteSkipReason(file, {}, true), null);
    assert.equal(
      overwriteSkipReason(file, { last_sync: '2000-01-01T00:00:00Z' }, true),
      null,
    );
  });
});

describe('courseHasMarkdown', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pull-course-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('is false for a missing directory', () => {
    assert.equal(courseHasMarkdown(path.join(tmpDir, 'absent')), false);
  });

  it('is false for an empty course directory', () => {
    assert.equal(courseHasMarkdown(tmpDir), false);
  });

  it('finds markdown nested in a module folder', () => {
    fs.mkdirSync(path.join(tmpDir, '01-intro'));
    fs.writeFileSync(path.join(tmpDir, '01-intro', '01-page.md'), '# hi');
    assert.equal(courseHasMarkdown(tmpDir), true);
  });

  it('ignores non-markdown files', () => {
    fs.writeFileSync(path.join(tmpDir, '_category_.json'), '{}');
    assert.equal(courseHasMarkdown(tmpDir), false);
  });
});

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

describe('pullStrategies', () => {
  it('Page strategy extracts page_url as id', () => {
    assert.equal(pullStrategies.Page.getId({ page_url: 'my-page' }), 'my-page');
  });

  it('Page strategy builds sync entry with page_url and module item id', () => {
    const entry = pullStrategies.Page.buildSyncEntry(
      { id: 5002, page_url: 'my-page' },
      { page_id: 42, url: 'my-page' },
    );
    assert.deepEqual(entry, {
      canvas_type: 'page',
      canvas_id: 42,
      page_url: 'my-page',
      module_item_id: 5002,
    });
  });

  it('Page strategy falls back to url when page_id is missing', () => {
    const entry = pullStrategies.Page.buildSyncEntry(
      { page_url: 'slug' },
      { url: 'slug' },
    );
    assert.equal(entry.canvas_id, 'slug');
  });

  it('Assignment strategy extracts content_id as id', () => {
    assert.equal(pullStrategies.Assignment.getId({ content_id: 99 }), 99);
  });

  it('Assignment strategy builds sync entry', () => {
    const entry = pullStrategies.Assignment.buildSyncEntry({
      id: 5003,
      content_id: 99,
    });
    assert.deepEqual(entry, {
      canvas_type: 'assignment',
      canvas_id: 99,
      module_item_id: 5003,
    });
  });

  it('Discussion strategy extracts content_id as id', () => {
    assert.equal(pullStrategies.Discussion.getId({ content_id: 77 }), 77);
  });

  it('Discussion strategy reads the message as the body', () => {
    assert.equal(
      pullStrategies.Discussion.getBody({ message: '<p>Say something.</p>' }),
      '<p>Say something.</p>',
    );
    assert.equal(pullStrategies.Discussion.getBody({}), '');
  });

  it('Discussion strategy builds sync entry', () => {
    const entry = pullStrategies.Discussion.buildSyncEntry({
      id: 5004,
      content_id: 77,
    });
    assert.deepEqual(entry, {
      canvas_type: 'discussion',
      canvas_id: 77,
      module_item_id: 5004,
    });
  });

  it('Discussion strategy fetches the topic the module item names', async () => {
    mock.method(global, 'fetch', async (url) =>
      fakeResponse({ id: 77, title: 'Week 1 debate', _url: url }),
    );

    const topic = await pullStrategies.Discussion.fetch(42, 77);

    assert.equal(topic.id, 77);
    assert.match(topic._url, /\/courses\/42\/discussion_topics\/77$/);
    mock.restoreAll();
  });

  it('Discussion strategy warns about a graded topic', async () => {
    const warned = mock.method(console, 'warn', () => {});
    mock.method(global, 'fetch', async () =>
      fakeResponse({ id: 77, title: 'Week 1 debate', assignment_id: 900 }),
    );

    await pullStrategies.Discussion.fetch(42, 77);

    assert.equal(warned.mock.callCount(), 1);
    assert.match(warned.mock.calls[0].arguments[0], /is graded/);
    assert.match(warned.mock.calls[0].arguments[0], /live only in Canvas/);
    mock.restoreAll();
  });

  it('Quiz strategy extracts content_id as id', () => {
    assert.equal(pullStrategies.Quiz.getId({ content_id: 12 }), 12);
  });

  it('Quiz strategy fetches nothing', () => {
    // The questions live in Canvas and in the QTI package; pulling them back
    // would invent a source this project cannot push.
    assert.equal(pullStrategies.Quiz.fetch, null);
    assert.equal(pullStrategies.Quiz.getBody, null);
  });

  it('Quiz strategy builds sync entry keyed on the quiz id', () => {
    const entry = pullStrategies.Quiz.buildSyncEntry({
      id: 5005,
      content_id: 12,
    });
    assert.deepEqual(entry, {
      canvas_type: 'quiz',
      canvas_id: 12,
      // The quiz outlives the item that links it, so the two are kept apart.
      module_item_id: 5005,
    });
  });

  it('Quiz strategy requires a content_id, so a quiz item is not written blind', () => {
    assert.equal(pullStrategies.Quiz.idLabel, 'content_id');
  });

  it('ExternalUrl strategy has no fetch function', () => {
    assert.equal(pullStrategies.ExternalUrl.fetch, null);
  });

  it('ExternalUrl strategy builds sync entry with external_url', () => {
    const entry = pullStrategies.ExternalUrl.buildSyncEntry({
      id: 7,
      external_url: 'https://example.com',
    });
    assert.deepEqual(entry, {
      canvas_type: 'external_url',
      // The module item is the whole of a link, so both ids are the same one.
      canvas_id: 7,
      module_item_id: 7,
      external_url: 'https://example.com',
    });
  });
});

/** A fake Response object compatible with the fetch API. */
function fakeResponse(body, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}
