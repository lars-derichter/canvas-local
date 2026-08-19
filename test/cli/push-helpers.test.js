const { describe, it, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Set required env vars before requiring anything that loads the client.
process.env.CANVAS_API_URL = 'https://canvas.example.com';
process.env.CANVAS_API_TOKEN = 'test-token-123';

const push = require('../../cli/push');
const { serializeFrontmatter } = require('../../lib/convert/frontmatter');

const {
  _buildFileResolver: buildFileResolver,
  _pageStrategy: pageStrategy,
  _assignmentStrategy: assignmentStrategy,
  _discussionStrategy: discussionStrategy,
  _pushContentItem: pushContentItem,
  _pushExternalTool: pushExternalTool,
  _pushQuiz: pushQuiz,
  _warnGradeImpact: warnGradeImpact,
  _collectUpdatedAssignments: collectUpdatedAssignments,
} = push;

describe('buildFileResolver', () => {
  const syncData = {
    canvas_base_url: 'https://canvas.example.com',
    files: {
      '01-mod/_files/image.png': {
        canvas_file_id: 100,
        canvas_url: '/courses/1/files/100/preview',
      },
      '02-other/_files/shared.pdf': {
        canvas_file_id: 200,
        canvas_url: '/courses/1/files/200/preview',
      },
    },
  };

  it('resolves a relative file path to a Canvas URL', () => {
    const resolver = buildFileResolver('01-mod/01-page.md', syncData);
    const result = resolver('./_files/image.png');
    assert.equal(
      result,
      'https://canvas.example.com/courses/1/files/100/preview',
    );
  });

  it('resolves cross-directory file references', () => {
    const resolver = buildFileResolver('01-mod/01-page.md', syncData);
    const result = resolver('../02-other/_files/shared.pdf');
    assert.equal(
      result,
      'https://canvas.example.com/courses/1/files/200/preview',
    );
  });

  it('returns null for external URLs', () => {
    const resolver = buildFileResolver('01-mod/01-page.md', syncData);
    assert.equal(resolver('https://example.com/image.png'), null);
  });

  it('returns null for .md links', () => {
    const resolver = buildFileResolver('01-mod/01-page.md', syncData);
    assert.equal(resolver('./02-setup.md'), null);
  });

  it('returns null for unknown files', () => {
    const resolver = buildFileResolver('01-mod/01-page.md', syncData);
    assert.equal(resolver('./_files/unknown.png'), null);
  });

  it('returns null for fragment-only links', () => {
    const resolver = buildFileResolver('01-mod/01-page.md', syncData);
    assert.equal(resolver('#section'), null);
  });

  it('returns null for empty or null href', () => {
    const resolver = buildFileResolver('01-mod/01-page.md', syncData);
    assert.equal(resolver(''), null);
    assert.equal(resolver(null), null);
  });
});

describe('pageStrategy', () => {
  it('builds options with title and body', () => {
    const opts = pageStrategy.buildOpts('My Page', '<p>Hello</p>', {});
    assert.deepEqual(opts, { title: 'My Page', body: '<p>Hello</p>' });
  });

  it('ignores frontmatter fields', () => {
    const opts = pageStrategy.buildOpts('Title', '<p>Body</p>', {
      points_possible: 10,
    });
    assert.deepEqual(opts, { title: 'Title', body: '<p>Body</p>' });
  });

  it('builds a Page module item', () => {
    const item = pageStrategy.buildModuleItem('My Page', 'my-page', 3, 0);
    assert.deepEqual(item, {
      title: 'My Page',
      type: 'Page',
      pageUrl: 'my-page',
      position: 3,
      indent: 0,
    });
  });

  it('extracts id preferring page_id', () => {
    assert.equal(pageStrategy.extractId({ page_id: 42, url: 'slug' }), 42);
  });

  it('falls back to url when page_id is missing', () => {
    assert.equal(pageStrategy.extractId({ url: 'slug' }), 'slug');
  });

  it('extracts slug from result', () => {
    assert.equal(
      pageStrategy.extractSlug({ url: 'my-page-slug' }),
      'my-page-slug',
    );
  });
});

describe('assignmentStrategy', () => {
  it('builds options with name and description', () => {
    const opts = assignmentStrategy.buildOpts(
      'My Assignment',
      '<p>Instructions</p>',
      {},
    );
    assert.deepEqual(opts, {
      name: 'My Assignment',
      description: '<p>Instructions</p>',
    });
  });

  it('maps frontmatter fields to assignment options', () => {
    const frontmatter = {
      points_possible: 100,
      submission_types: ['online_upload'],
      due_at: '2025-06-01T23:59:00Z',
      unlock_at: '2025-05-01T08:00:00Z',
      lock_at: '2025-06-08T23:59:00Z',
      published: true,
    };
    const opts = assignmentStrategy.buildOpts(
      'Title',
      '<p>Body</p>',
      frontmatter,
    );
    assert.equal(opts.pointsPossible, 100);
    assert.deepEqual(opts.submissionTypes, ['online_upload']);
    assert.equal(opts.dueAt, '2025-06-01T23:59:00Z');
    assert.equal(opts.unlockAt, '2025-05-01T08:00:00Z');
    assert.equal(opts.lockAt, '2025-06-08T23:59:00Z');
    assert.equal(opts.published, true);
  });

  it('omits optional fields when not in frontmatter', () => {
    const opts = assignmentStrategy.buildOpts('Title', '<p>Body</p>', {});
    assert.equal(opts.pointsPossible, undefined);
    assert.equal(opts.submissionTypes, undefined);
    assert.equal(opts.dueAt, undefined);
    assert.equal(opts.unlockAt, undefined);
    assert.equal(opts.lockAt, undefined);
    assert.equal(opts.published, undefined);
  });

  it('builds an Assignment module item', () => {
    const item = assignmentStrategy.buildModuleItem('My Assignment', 99, 2, 1);
    assert.deepEqual(item, {
      title: 'My Assignment',
      type: 'Assignment',
      contentId: 99,
      position: 2,
      indent: 1,
    });
  });

  it('extracts id from result', () => {
    assert.equal(assignmentStrategy.extractId({ id: 42 }), 42);
  });

  it('has no slug extraction', () => {
    assert.equal(assignmentStrategy.extractSlug, null);
  });
});

describe('discussionStrategy', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it('builds options with title and message', () => {
    const opts = discussionStrategy.buildOpts(
      'Week 1 debate',
      '<p>Say something.</p>',
      {},
    );
    assert.deepEqual(opts, {
      title: 'Week 1 debate',
      message: '<p>Say something.</p>',
    });
  });

  it('maps frontmatter fields to discussion options', () => {
    const frontmatter = {
      discussion_type: 'threaded',
      require_initial_post: true,
      delayed_post_at: '2026-03-01T08:00:00Z',
      lock_at: '2026-03-08T23:59:00Z',
      published: true,
    };
    const opts = discussionStrategy.buildOpts(
      'Title',
      '<p>Body</p>',
      frontmatter,
    );

    assert.equal(opts.discussionType, 'threaded');
    assert.equal(opts.requireInitialPost, true);
    assert.equal(opts.delayedPostAt, '2026-03-01T08:00:00Z');
    assert.equal(opts.lockAt, '2026-03-08T23:59:00Z');
    assert.equal(opts.published, true);
  });

  it('keeps a frontmatter false rather than dropping it', () => {
    const opts = discussionStrategy.buildOpts('Title', '<p>Body</p>', {
      require_initial_post: false,
      published: false,
    });

    assert.equal(opts.requireInitialPost, false);
    assert.equal(opts.published, false);
  });

  it('omits optional fields when not in frontmatter', () => {
    const opts = discussionStrategy.buildOpts('Title', '<p>Body</p>', {});
    assert.equal(opts.discussionType, undefined);
    assert.equal(opts.requireInitialPost, undefined);
    assert.equal(opts.delayedPostAt, undefined);
    assert.equal(opts.lockAt, undefined);
    assert.equal(opts.published, undefined);
  });

  it('builds a Discussion module item', () => {
    const item = discussionStrategy.buildModuleItem('Week 1 debate', 77, 3, 1);
    assert.deepEqual(item, {
      title: 'Week 1 debate',
      type: 'Discussion',
      contentId: 77,
      position: 3,
      indent: 1,
    });
  });

  it('extracts id from result', () => {
    assert.equal(discussionStrategy.extractId({ id: 77 }), 77);
  });

  it('has no slug extraction', () => {
    assert.equal(discussionStrategy.extractSlug, null);
  });

  it('warns that a graded discussion keeps its grading settings in Canvas', async () => {
    const warned = mock.method(console, 'warn', () => {});
    mock.method(global, 'fetch', async () =>
      fakeResponse({ id: 77, title: 'Week 1 debate', assignment_id: 900 }),
    );

    const result = await discussionStrategy.create(42, {
      title: 'Week 1 debate',
    });

    assert.equal(result.id, 77, 'the result still reaches the caller');
    assert.equal(warned.mock.callCount(), 1);
    assert.match(warned.mock.calls[0].arguments[0], /is graded/);
    assert.match(warned.mock.calls[0].arguments[0], /live only in Canvas/);
  });

  it('warns on an update that returns a graded topic', async () => {
    const warned = mock.method(console, 'warn', () => {});
    mock.method(global, 'fetch', async () =>
      fakeResponse({ id: 77, title: 'Week 1 debate', assignment_id: 900 }),
    );

    await discussionStrategy.update(42, 77, { message: '<p>Hi</p>' });

    assert.equal(warned.mock.callCount(), 1);
    assert.match(warned.mock.calls[0].arguments[0], /is graded/);
  });

  it('says nothing about an ungraded discussion', async () => {
    const warned = mock.method(console, 'warn', () => {});
    mock.method(global, 'fetch', async () =>
      fakeResponse({ id: 77, title: 'Week 1 debate', assignment_id: null }),
    );

    await discussionStrategy.create(42, { title: 'Week 1 debate' });

    assert.equal(warned.mock.callCount(), 0);
  });
});

describe('pushing a discussion', () => {
  const tmpDirs = [];

  afterEach(() => {
    mock.restoreAll();
    while (tmpDirs.length) {
      fs.rmSync(tmpDirs.pop(), { recursive: true, force: true });
    }
  });

  /**
   * Run one discussion markdown file through pushContentItem with Canvas
   * mocked out, and hand back every request it made plus the module item it
   * says should point at the topic. Placing that item is the caller's job now,
   * so no module request appears in these route tables.
   */
  async function pushDiscussion({ canvasId = null, routes }) {
    mock.method(console, 'log', () => {});
    const warned = mock.method(console, 'warn', () => {});

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'push-discussion-'));
    tmpDirs.push(dir);
    const filePath = path.join(dir, '03-debate.md');
    const frontmatter = {
      title: 'Week 1 debate',
      canvas_type: 'discussion',
      ...(canvasId != null ? { canvas_id: canvasId } : {}),
    };
    fs.writeFileSync(
      filePath,
      serializeFrontmatter(frontmatter, 'Say something.\n'),
      'utf8',
    );

    const calls = mockCanvas(routes);
    const { moduleItem } = await pushContentItem(
      42,
      {
        title: 'Week 1 debate',
        filePath,
        relativePath: '01-mod/03-debate.md',
        canvasId,
        position: 3,
        indent: 0,
        frontmatter,
      },
      false,
      {},
      new Map(),
      [],
      { files: {} },
      discussionStrategy,
    );

    return { calls, filePath, warned, moduleItem };
  }

  const createdTopic = {
    method: 'POST',
    path: '/discussion_topics',
    body: { id: 77, title: 'Week 1 debate' },
  };

  it('creates the topic when the file has no canvas_id', async () => {
    const { calls, filePath } = await pushDiscussion({
      routes: [createdTopic],
    });

    const created = calls.find((c) => c.url.endsWith('/discussion_topics'));
    assert.ok(created, 'expected a create request');
    assert.equal(created.method, 'POST');
    assert.equal(created.body.title, 'Week 1 debate');
    assert.match(created.body.message, /Say something\./);
    assert.ok(
      !calls.some((c) => c.method === 'PUT'),
      'nothing to update when there is no id yet',
    );
    assert.match(
      fs.readFileSync(filePath, 'utf8'),
      /canvas_id: 77/,
      'the new id is written back to the frontmatter',
    );
  });

  it('updates the topic the frontmatter already names', async () => {
    const { calls } = await pushDiscussion({
      canvasId: 55,
      routes: [
        {
          method: 'PUT',
          path: '/discussion_topics/55',
          body: { id: 55, title: 'Week 1 debate' },
        },
      ],
    });

    const updated = calls.find((c) => c.method === 'PUT');
    assert.ok(updated, 'expected an update request');
    assert.match(
      updated.url,
      /\/courses\/42\/discussion_topics\/55$/,
      'the update goes to the id the frontmatter holds',
    );
    assert.match(updated.body.message, /Say something\./);
    assert.ok(
      !calls.some(
        (c) => c.method === 'POST' && c.url.endsWith('/discussion_topics'),
      ),
      'an existing topic is never created a second time',
    );
  });

  it('creates a new topic when Canvas 404s the id in the frontmatter', async () => {
    const { calls, filePath } = await pushDiscussion({
      canvasId: 55,
      routes: [
        {
          method: 'PUT',
          path: '/discussion_topics/55',
          body: { message: 'not found' },
          status: 404,
        },
        createdTopic,
      ],
    });

    assert.ok(
      calls.some((c) => c.method === 'PUT'),
      'the update is tried first',
    );
    assert.ok(
      calls.some(
        (c) => c.method === 'POST' && c.url.endsWith('/discussion_topics'),
      ),
      'and the 404 falls back to a create',
    );
    assert.match(fs.readFileSync(filePath, 'utf8'), /canvas_id: 77/);
  });

  it('describes the topic as a Discussion module item', async () => {
    const { calls, moduleItem } = await pushDiscussion({
      routes: [createdTopic],
    });

    assert.deepEqual(moduleItem, {
      title: 'Week 1 debate',
      type: 'Discussion',
      contentId: 77,
      position: 3,
      indent: 0,
    });
    assert.ok(
      !calls.some((c) => c.url.includes('/modules/')),
      'the module list is reconciled once per module, not per item',
    );
  });

  it('warns when the topic Canvas returns is graded', async () => {
    const { warned } = await pushDiscussion({
      routes: [
        {
          method: 'POST',
          path: '/discussion_topics',
          body: { id: 77, title: 'Week 1 debate', assignment_id: 900 },
        },
      ],
    });

    const lines = warned.mock.calls.map((c) => c.arguments[0]);
    assert.ok(
      lines.some((line) => /is graded/.test(line)),
      'expected the graded-discussion warning',
    );
    assert.ok(lines.some((line) => /live only in Canvas/.test(line)));
  });
});

describe('pushing an external tool', () => {
  const tmpDirs = [];

  afterEach(() => {
    mock.restoreAll();
    while (tmpDirs.length) {
      fs.rmSync(tmpDirs.pop(), { recursive: true, force: true });
    }
  });

  /**
   * Run one external-tool markdown file through pushExternalTool with Canvas
   * mocked out, and hand back every request it made, what it warned about, and
   * the module item it says should carry the launch URL.
   */
  async function pushTool({ frontmatter: extra = {}, routes, dryRun = false }) {
    mock.method(console, 'log', () => {});
    const warned = mock.method(console, 'warn', () => {});

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'push-external-tool-'));
    tmpDirs.push(dir);
    const filePath = path.join(dir, '04-lab.md');
    const frontmatter = {
      title: 'Week 1 lab',
      canvas_type: 'external_tool',
      external_url: LAUNCH_URL,
      ...extra,
    };
    if (frontmatter.external_url === null) delete frontmatter.external_url;
    fs.writeFileSync(filePath, serializeFrontmatter(frontmatter, ''), 'utf8');

    const calls = mockCanvas(routes || []);
    const moduleItem = await pushExternalTool(
      42,
      { title: 'Week 1 lab', position: 4, indent: 0, frontmatter },
      dryRun,
    );

    return { calls, filePath, frontmatter, warned, moduleItem };
  }

  const LAUNCH_URL = 'https://tool.example.com/launch';
  const toolResolves = {
    method: 'GET',
    path: '/external_tools/sessionless_launch',
    body: { id: 7, name: 'Codegrade', url: 'https://canvas/launch?verifier=1' },
  };
  const toolDoesNotResolve = {
    method: 'GET',
    path: '/external_tools/sessionless_launch',
    body: {
      errors: { external_tool: 'Unable to find a matching external tool' },
    },
    status: 400,
  };
  const probeFails = {
    method: 'GET',
    path: '/external_tools/sessionless_launch',
    body: { errors: [{ message: 'user not authorized' }] },
    status: 401,
  };
  const toolsInstalled = {
    method: 'GET',
    path: '/external_tools?include_parents',
    body: [{ name: 'Panopto' }, { name: 'Zoom' }],
  };

  it('describes the launch URL as an ExternalTool module item', async () => {
    const { moduleItem } = await pushTool({ routes: [toolResolves] });

    assert.deepEqual(moduleItem, {
      title: 'Week 1 lab',
      type: 'ExternalTool',
      externalUrl: LAUNCH_URL,
      position: 4,
      indent: 0,
    });
  });

  it('probes the launch URL, and that is the only request it makes', async () => {
    // The module item itself is placed by the reconcile, once for the whole
    // module; the id it gets back is written to the frontmatter there.
    const { calls } = await pushTool({ routes: [toolResolves] });

    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/external_tools\/sessionless_launch\?url=/);
  });

  it('says nothing when a tool answers the launch URL', async () => {
    const { warned } = await pushTool({ routes: [toolResolves] });

    assert.equal(warned.mock.callCount(), 0);
  });

  it('warns and skips when the frontmatter has no external_url', async () => {
    const { calls, warned, moduleItem } = await pushTool({
      frontmatter: { external_url: null },
      routes: [],
    });

    assert.equal(calls.length, 0, 'nothing is placed without a launch URL');
    assert.equal(moduleItem, null);
    const lines = warned.mock.calls.map((c) => c.arguments[0]);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /Skipping "Week 1 lab"/);
    assert.match(lines[0], /external_url field is missing/);
  });

  it('warns with both remedies but still places the item when no tool matches', async () => {
    const { moduleItem, warned } = await pushTool({
      routes: [toolDoesNotResolve, toolsInstalled],
    });

    const text = warned.mock.calls.map((c) => c.arguments[0]).join('\n');
    assert.match(
      text,
      /no external tool in this course matches the launch URL/,
    );
    assert.match(text, /Week 1 lab/);
    assert.match(text, /https:\/\/tool\.example\.com\/launch/);
    assert.match(text, /Couldn't find valid settings for this link/);
    assert.match(text, /ACCOUNT level/);
    assert.match(text, /survives a rollover/);
    assert.match(text, /Course Copy/);
    assert.match(text, /Panopto, Zoom/);

    assert.ok(
      moduleItem,
      'a visible broken item beats silently dropping the author content',
    );
    assert.equal(moduleItem.externalUrl, LAUNCH_URL);
  });

  it('still names the remedies when the installed tools cannot be listed', async () => {
    const { moduleItem, warned } = await pushTool({
      routes: [toolDoesNotResolve],
    });

    const text = warned.mock.calls.map((c) => c.arguments[0]).join('\n');
    assert.match(text, /could not be listed/);
    assert.match(text, /ACCOUNT level/);
    assert.ok(moduleItem);
  });

  it('says the check could not be run when the probe itself fails', async () => {
    const { calls, warned, moduleItem } = await pushTool({
      routes: [probeFails],
    });

    const text = warned.mock.calls.map((c) => c.arguments[0]).join('\n');
    assert.match(text, /could not check whether an external tool matches/);
    assert.doesNotMatch(
      text,
      /no external tool in this course matches/,
      'an unrunnable check must not be reported as a verdict',
    );
    assert.ok(
      !calls.some((c) => c.url.includes('include_parents')),
      'no point listing the tools when nothing was established',
    );
    assert.ok(moduleItem);
  });

  it('sends new_tab only when the frontmatter asks for it', async () => {
    const { moduleItem } = await pushTool({
      frontmatter: { new_tab: true },
      routes: [toolResolves],
    });

    assert.equal(moduleItem.newTab, true);
  });

  it('describes the item on a dry run without probing for the tool', async () => {
    // The frontmatter says what the item is; only the probe costs a request,
    // and a dry run makes none — so the plan still knows the item is there.
    const { calls, moduleItem } = await pushTool({ routes: [], dryRun: true });

    assert.equal(calls.length, 0);
    assert.deepEqual(moduleItem, {
      title: 'Week 1 lab',
      type: 'ExternalTool',
      externalUrl: LAUNCH_URL,
      position: 4,
      indent: 0,
    });
  });
});

describe('pushing a quiz', () => {
  const tmpDirs = [];

  afterEach(() => {
    mock.restoreAll();
    while (tmpDirs.length) {
      fs.rmSync(tmpDirs.pop(), { recursive: true, force: true });
    }
  });

  /**
   * Run one quiz markdown file through pushQuiz with Canvas mocked out, and
   * hand back every request it made, what it warned about, and the module item
   * it says should point at the quiz.
   */
  async function pushQuizItem({
    frontmatter: extra = {},
    routes,
    dryRun = false,
  }) {
    mock.method(console, 'log', () => {});
    const warned = mock.method(console, 'warn', () => {});

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'push-quiz-'));
    tmpDirs.push(dir);
    const filePath = path.join(dir, '05-test.md');
    const frontmatter = {
      title: 'Test 1',
      canvas_type: 'quiz',
      quiz_ref: QUIZ_REF,
      ...extra,
    };
    if (frontmatter.quiz_ref === null) delete frontmatter.quiz_ref;
    fs.writeFileSync(filePath, serializeFrontmatter(frontmatter, ''), 'utf8');

    const calls = mockCanvas(routes || []);
    const moduleItem = await pushQuiz(
      42,
      { title: 'Test 1', filePath, position: 5, indent: 0, frontmatter },
      dryRun,
    );

    return { calls, filePath, frontmatter, warned, moduleItem };
  }

  const QUIZ_REF = 'evaluations/2526/test-1/test-1-qti.zip';
  const quizListed = {
    method: 'GET',
    path: '/quizzes',
    body: [
      { id: 12, title: 'Test 1' },
      { id: 13, title: 'Practice' },
    ],
  };
  const noQuizzes = { method: 'GET', path: '/quizzes', body: [] };
  const twoOfTheSameName = {
    method: 'GET',
    path: '/quizzes',
    body: [
      { id: 12, title: 'Test 1' },
      { id: 44, title: 'Test 1' },
    ],
  };
  it('describes the quiz as a Quiz module item', async () => {
    const { moduleItem } = await pushQuizItem({
      frontmatter: { canvas_id: 12 },
      routes: [quizListed],
    });

    assert.deepEqual(moduleItem, {
      title: 'Test 1',
      type: 'Quiz',
      contentId: 12,
      position: 5,
      indent: 0,
    });
  });

  it('never writes to the quiz itself', async () => {
    const { calls } = await pushQuizItem({
      frontmatter: { canvas_id: 12 },
      routes: [quizListed],
    });

    assert.ok(
      !calls.some((c) => c.url.includes('/quizzes') && c.method !== 'GET'),
      'the quiz object is read and nothing more',
    );
  });

  it('matches by title and writes the id back when the file has no canvas_id', async () => {
    const { moduleItem, filePath } = await pushQuizItem({
      routes: [quizListed],
    });

    assert.match(
      fs.readFileSync(filePath, 'utf8'),
      /canvas_id: 12/,
      'the resolved id is written back so the next push skips the lookup',
    );
    assert.equal(moduleItem.contentId, 12);
  });

  it('recovers by title when the canvas_id is no longer in the course', async () => {
    const { moduleItem, filePath, warned } = await pushQuizItem({
      frontmatter: { canvas_id: 999 },
      routes: [quizListed],
    });

    const text = warned.mock.calls.map((c) => c.arguments[0]).join('\n');
    assert.match(text, /Quiz 999 is no longer in this course/);
    assert.match(fs.readFileSync(filePath, 'utf8'), /canvas_id: 12/);
    assert.equal(moduleItem.contentId, 12);
  });

  it('warns and skips when two quizzes carry the same title', async () => {
    const { moduleItem, filePath, warned } = await pushQuizItem({
      routes: [twoOfTheSameName],
    });

    const text = warned.mock.calls.map((c) => c.arguments[0]).join('\n');
    assert.match(text, /2 quizzes in this course carry that title/);
    assert.match(text, /ids 12, 44/);
    assert.equal(
      moduleItem,
      null,
      'an ambiguous match must never be guessed at',
    );
    assert.doesNotMatch(fs.readFileSync(filePath, 'utf8'), /canvas_id/);
  });

  it('prints the import procedure and skips when the quiz is not in Canvas', async () => {
    const { moduleItem, warned } = await pushQuizItem({ routes: [noQuizzes] });

    const text = warned.mock.calls.map((c) => c.arguments[0]).join('\n');
    assert.match(text, /holds no quiz by that name yet/);
    assert.match(text, /Import Course Content/);
    assert.match(text, /QTI \.zip file/);
    assert.match(text, /Current Jobs/);
    assert.ok(
      text.includes(QUIZ_REF),
      'the message names the package the item is waiting for',
    );
    assert.equal(
      moduleItem,
      null,
      'a module item pointing at nothing is worse than no item',
    );
  });

  it('places a quiz that has no quiz_ref but whose canvas_id resolves', async () => {
    // A quiz pulled from a Canvas-authored course carries an id and no
    // quiz_ref, and validate deliberately keeps that state valid. Skipping it
    // here would drop the quiz out of its module on the next push, which is
    // the exact loss this content type exists to prevent.
    const { moduleItem, warned } = await pushQuizItem({
      frontmatter: { quiz_ref: null, canvas_id: 12 },
      routes: [quizListed],
    });

    assert.ok(moduleItem, 'expected the item to be placed anyway');
    assert.equal(moduleItem.contentId, 12);
    assert.equal(warned.mock.calls.length, 0);
  });

  it('places a quiz that has no quiz_ref but matches by title', async () => {
    const { moduleItem, filePath } = await pushQuizItem({
      frontmatter: { quiz_ref: null },
      routes: [quizListed],
    });

    assert.ok(moduleItem, 'expected the item to be placed anyway');
    assert.equal(moduleItem.contentId, 12);
    assert.match(fs.readFileSync(filePath, 'utf8'), /canvas_id: 12/);
  });

  it('says there is nothing to import when the quiz is missing and so is quiz_ref', async () => {
    const { moduleItem, warned } = await pushQuizItem({
      frontmatter: { quiz_ref: null },
      routes: [noQuizzes],
    });

    const lines = warned.mock.calls.map((c) => c.arguments[0]);
    assert.equal(lines.length, 1, 'no import procedure without a package');
    assert.match(lines[0], /Skipping "Test 1"/);
    assert.match(lines[0], /names no quiz_ref/);
    assert.equal(
      moduleItem,
      null,
      'a module item pointing at nothing is worse than no item',
    );
  });

  it('makes no request at all on a dry run', async () => {
    const { calls, moduleItem } = await pushQuizItem({
      routes: [],
      dryRun: true,
    });

    assert.equal(calls.length, 0);
    assert.equal(moduleItem, null);
  });
});

describe('collectUpdatedAssignments', () => {
  it('collects only the assignments Canvas already holds', () => {
    const updated = collectUpdatedAssignments([
      courseModule([
        assignmentItem({ canvas_id: 500, points_possible: 10 }),
        assignmentItem(
          { points_possible: 20 },
          { title: 'New', relativePath: '01-mod/04-new.md' },
        ),
        {
          canvasType: 'page',
          title: 'Intro',
          relativePath: '01-mod/01-intro.md',
          frontmatter: { canvas_id: 700 },
          position: 3,
        },
      ]),
    ]);

    assert.equal(updated.length, 1);
    assert.equal(updated[0].canvasId, 500);
    assert.equal(updated[0].relativePath, '01-mod/03-homework.md');
  });

  it('carries the options push itself would send', () => {
    const [entry] = collectUpdatedAssignments([
      courseModule([
        assignmentItem({
          canvas_id: 500,
          points_possible: 12,
          due_at: '2026-03-08T23:59:00Z',
          submission_types: ['online_url'],
        }),
      ]),
    ]);

    assert.equal(entry.opts.pointsPossible, 12);
    assert.equal(entry.opts.dueAt, '2026-03-08T23:59:00Z');
    assert.deepEqual(entry.opts.submissionTypes, ['online_url']);
  });

  it('looks inside subfolders', () => {
    const updated = collectUpdatedAssignments([
      courseModule([
        {
          type: 'subheader',
          title: 'Week 1',
          position: 1,
          indent: 0,
          items: [assignmentItem({ canvas_id: 501 })],
        },
      ]),
    ]);

    assert.equal(updated.length, 1);
    assert.equal(updated[0].canvasId, 501);
  });
});

describe('warnGradeImpact', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  /** Silence the warnings the helper logs on its way out. */
  function quiet() {
    mock.method(console, 'warn', () => {});
  }

  it('warns that a new denominator leaves the grades already given unscaled', async () => {
    quiet();
    const lines = await warnGradeImpact(
      42,
      [courseModule([assignmentItem({ canvas_id: 500, points_possible: 12 })])],
      async () => [canvasAssignment()],
    );

    assert.equal(lines.length, 1);
    assert.match(lines[0], /"Homework" \(01-mod\/03-homework\.md\)/);
    assert.match(lines[0], /has student submissions/);
    assert.match(lines[0], /changes points_possible from 10 to 12/);
    assert.match(lines[0], /does not rescale the grades already given/);
  });

  it('stays silent when the points possible are unchanged', async () => {
    quiet();
    const lines = await warnGradeImpact(
      42,
      [courseModule([assignmentItem({ canvas_id: 500, points_possible: 10 })])],
      async () => [canvasAssignment()],
    );

    assert.deepEqual(lines, []);
  });

  it('warns that a new due date re-runs the late policy', async () => {
    quiet();
    const lines = await warnGradeImpact(
      42,
      [
        courseModule([
          assignmentItem({ canvas_id: 500, due_at: '2026-03-08T23:59:00Z' }),
        ]),
      ],
      async () => [canvasAssignment()],
    );

    assert.equal(lines.length, 1);
    assert.match(
      lines[0],
      /changes due_at from 2026-03-01T23:59:00Z to 2026-03-08T23:59:00Z/,
    );
    assert.match(lines[0], /recomputes late status/);
  });

  it('reads a due date as an instant, not as a string', async () => {
    quiet();
    const lines = await warnGradeImpact(
      42,
      [
        courseModule([
          assignmentItem({
            canvas_id: 500,
            due_at: new Date('2026-03-02T00:59:00+01:00'),
          }),
        ]),
      ],
      async () => [canvasAssignment()],
    );

    assert.deepEqual(lines, [], 'the same moment, written differently');
  });

  it('warns that Canvas ignores a submission type change once work is in', async () => {
    quiet();
    const lines = await warnGradeImpact(
      42,
      [
        courseModule([
          assignmentItem({
            canvas_id: 500,
            submission_types: ['online_text_entry'],
          }),
        ]),
      ],
      async () => [canvasAssignment()],
    );

    assert.equal(lines.length, 1);
    assert.match(
      lines[0],
      /changes submission_types from online_upload to online_text_entry/,
    );
    assert.match(lines[0], /it ignores this one/);
    assert.match(lines[0], /reports the push as a success/);
  });

  it('says nothing about an assignment without student submissions', async () => {
    quiet();
    const lines = await warnGradeImpact(
      42,
      [
        courseModule([
          assignmentItem({
            canvas_id: 500,
            points_possible: 12,
            due_at: '2026-03-08T23:59:00Z',
            submission_types: ['online_text_entry'],
          }),
        ]),
      ],
      async () => [canvasAssignment({ has_submitted_submissions: false })],
    );

    assert.deepEqual(lines, []);
  });

  it('hedges when the submission state could not be read', async () => {
    quiet();
    const lines = await warnGradeImpact(
      42,
      [courseModule([assignmentItem({ canvas_id: 500, points_possible: 12 })])],
      async () => [canvasAssignment({ has_submitted_submissions: undefined })],
    );

    assert.equal(lines.length, 1);
    assert.match(lines[0], /could not determine whether/);
    assert.match(lines[0], /Treat it as if it does/);
  });

  it('warns once per changed field', async () => {
    quiet();
    const lines = await warnGradeImpact(
      42,
      [
        courseModule([
          assignmentItem({
            canvas_id: 500,
            points_possible: 12,
            due_at: '2026-03-08T23:59:00Z',
            submission_types: ['online_text_entry'],
          }),
        ]),
      ],
      async () => [canvasAssignment()],
    );

    assert.equal(lines.length, 3);
  });

  it('looks the whole course up once however many assignments are pushed', async () => {
    quiet();
    let calls = 0;
    const lines = await warnGradeImpact(
      42,
      [
        courseModule([
          assignmentItem({ canvas_id: 500, points_possible: 12 }),
          assignmentItem(
            { canvas_id: 501, points_possible: 12 },
            { title: 'Second', relativePath: '01-mod/04-second.md' },
          ),
        ]),
        courseModule(
          [
            assignmentItem(
              { canvas_id: 502, points_possible: 12 },
              { title: 'Third', relativePath: '02-mod/03-third.md' },
            ),
          ],
          '02-mod',
        ),
      ],
      async () => {
        calls++;
        return [
          canvasAssignment(),
          canvasAssignment({ id: 501 }),
          canvasAssignment({ id: 502 }),
        ];
      },
    );

    assert.equal(calls, 1);
    assert.equal(lines.length, 3);
  });

  it('makes no request when no assignment exists on Canvas yet', async () => {
    quiet();
    const lines = await warnGradeImpact(
      42,
      [
        courseModule([
          assignmentItem({ points_possible: 12 }),
          {
            canvasType: 'page',
            title: 'Intro',
            relativePath: '01-mod/01-intro.md',
            frontmatter: { canvas_id: 700 },
            position: 2,
          },
        ]),
      ],
      async () => {
        throw new Error('the assignment lookup should not have run');
      },
    );

    assert.deepEqual(lines, []);
  });

  it('leaves an assignment Canvas no longer lists alone', async () => {
    quiet();
    const lines = await warnGradeImpact(
      42,
      [courseModule([assignmentItem({ canvas_id: 999, points_possible: 12 })])],
      async () => [canvasAssignment()],
    );

    assert.deepEqual(lines, []);
  });

  it('degrades to a warning when the lookup fails, and lets the push run', async () => {
    const warned = mock.method(console, 'warn', () => {});
    const lines = await warnGradeImpact(
      42,
      [courseModule([assignmentItem({ canvas_id: 500, points_possible: 12 })])],
      async () => {
        throw new Error('403 Forbidden');
      },
    );

    assert.deepEqual(lines, [], 'a failed lookup warns instead of throwing');
    assert.equal(warned.mock.callCount(), 1);
    assert.match(warned.mock.calls[0].arguments[0], /could not check/);
    assert.match(warned.mock.calls[0].arguments[0], /403 Forbidden/);
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

/**
 * Answer Canvas requests from a route table of { method, path, body, status },
 * and record every request that was made. An unrouted request gets a 400, so a
 * missing route fails the test instead of hanging on the client's retries.
 */
function mockCanvas(routes) {
  const calls = [];
  const remaining = routes.map((route) => ({ ...route }));
  mock.method(global, 'fetch', async (url, opts) => {
    calls.push({
      url,
      method: opts.method,
      body: opts.body ? JSON.parse(opts.body) : null,
    });
    const index = remaining.findIndex(
      (route) => route.method === opts.method && url.includes(route.path),
    );
    if (index === -1) {
      return fakeResponse(
        { message: `unrouted ${opts.method} ${url}` },
        {
          status: 400,
        },
      );
    }
    const [route] = remaining.splice(index, 1);
    return fakeResponse(route.body, { status: route.status || 200 });
  });
  return calls;
}

/** A scanned module, shaped as scanCourse returns it. */
function courseModule(items, folderName = '01-mod') {
  return {
    folderName,
    moduleName: 'Module',
    position: 1,
    items,
  };
}

/** A scanned assignment item carrying the given frontmatter. */
function assignmentItem(frontmatter, overrides = {}) {
  return {
    canvasType: 'assignment',
    title: 'Homework',
    relativePath: '01-mod/03-homework.md',
    frontmatter,
    position: 1,
    indent: 0,
    ...overrides,
  };
}

/** A Canvas Assignment object as a list response returns it. */
function canvasAssignment(overrides = {}) {
  return {
    id: 500,
    has_submitted_submissions: true,
    points_possible: 10,
    due_at: '2026-03-01T23:59:00Z',
    submission_types: ['online_upload'],
    ...overrides,
  };
}
