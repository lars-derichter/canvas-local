const { describe, it, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { fakeResponse, mockCanvas } = require('../helpers/canvas-mock');

// Set required env vars before requiring anything that loads the client.
process.env.CANVAS_API_URL = 'https://canvas.example.com';
process.env.CANVAS_API_TOKEN = 'test-token-123';

const {
  buildFileResolver,
  pageStrategy,
  assignmentStrategy,
  discussionStrategy,
  pushExternalTool,
  pushQuiz,
  refuseQuizBackedDelete,
} = require('../../lib/sync/canvas-write');
const { serializeFrontmatter } = require('../../lib/convert/frontmatter');

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
   *
   * A refusal throws, so `expectRefusal` says the throw is the thing under
   * test and hands the error back as `refusal`. Without it an unexpected throw
   * still fails the test it happened in, rather than reading as no item.
   */
  async function pushTool({
    frontmatter: extra = {},
    routes,
    dryRun = false,
    expectRefusal = false,
  }) {
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
    let moduleItem = null;
    let refusal = null;
    try {
      moduleItem = await pushExternalTool(
        42,
        { title: 'Week 1 lab', position: 4, indent: 0, frontmatter },
        dryRun,
      );
    } catch (err) {
      if (!expectRefusal) throw err;
      refusal = err;
    }

    return { calls, filePath, frontmatter, warned, moduleItem, refusal };
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

  it('refuses when the frontmatter has no external_url', async () => {
    const { calls, moduleItem, refusal } = await pushTool({
      frontmatter: { external_url: null },
      routes: [],
      expectRefusal: true,
    });

    assert.equal(calls.length, 0, 'nothing is placed without a launch URL');
    assert.equal(moduleItem, null);
    // A throw rather than a warning, because a warning is dropped by --quiet
    // and the caller has to remember to check a null.
    assert.ok(refusal, 'expected the missing field to fail the item');
    assert.match(refusal.message, /"Week 1 lab"/);
    assert.match(refusal.message, /names no external_url/);
    assert.match(refusal.message, /nothing was created/);
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
   *
   * A quiz that cannot be resolved throws, so `expectRefusal` says the throw is
   * the thing under test and hands the error back as `refusal`.
   */
  async function pushQuizItem({
    frontmatter: extra = {},
    canvasId = null,
    routes,
    dryRun = false,
    expectRefusal = false,
  }) {
    mock.method(console, 'log', () => {});
    const warned = mock.method(console, 'warn', () => {});

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'push-quiz-'));
    tmpDirs.push(dir);
    const filePath = path.join(dir, '05-test.md');
    // Which quiz this file names comes in as `canvasId`, read from the sync
    // state by the caller. The file itself only declares its type and package.
    const frontmatter = {
      title: 'Test 1',
      canvas_type: 'quiz',
      quiz_ref: QUIZ_REF,
      ...extra,
    };
    if (frontmatter.quiz_ref === null) delete frontmatter.quiz_ref;
    fs.writeFileSync(filePath, serializeFrontmatter(frontmatter, ''), 'utf8');

    const calls = mockCanvas(routes || []);
    let moduleItem = null;
    let refusal = null;
    try {
      moduleItem = await pushQuiz(
        42,
        { title: 'Test 1', canvasId, position: 5, indent: 0, frontmatter },
        dryRun,
      );
    } catch (err) {
      if (!expectRefusal) throw err;
      refusal = err;
    }

    return { calls, filePath, frontmatter, warned, moduleItem, refusal };
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
      canvasId: 12,
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
      canvasId: 12,
      routes: [quizListed],
    });

    assert.ok(
      !calls.some((c) => c.url.includes('/quizzes') && c.method !== 'GET'),
      'the quiz object is read and nothing more',
    );
  });

  it('matches by title when the sync state names no quiz', async () => {
    const { moduleItem, filePath } = await pushQuizItem({
      routes: [quizListed],
    });

    assert.equal(
      moduleItem.contentId,
      12,
      'the resolved id comes back for the caller to record',
    );
    assert.doesNotMatch(
      fs.readFileSync(filePath, 'utf8'),
      /canvas_id/,
      'and never reaches the file',
    );
  });

  it('recovers by title when the recorded id is no longer in the course', async () => {
    const { moduleItem, filePath, warned } = await pushQuizItem({
      canvasId: 999,
      routes: [quizListed],
    });

    const text = warned.mock.calls.map((c) => c.arguments[0]).join('\n');
    assert.match(text, /Quiz 999 is no longer in this course/);
    assert.doesNotMatch(fs.readFileSync(filePath, 'utf8'), /canvas_id/);
    assert.equal(moduleItem.contentId, 12);
  });

  it('refuses when two quizzes carry the same title', async () => {
    const { moduleItem, filePath, refusal } = await pushQuizItem({
      routes: [twoOfTheSameName],
      expectRefusal: true,
    });

    assert.ok(refusal, 'an ambiguous match must never be guessed at');
    assert.match(refusal.message, /2 quizzes in this course carry that title/);
    assert.match(refusal.message, /ids 12, 44/);
    assert.equal(moduleItem, null);
    assert.doesNotMatch(fs.readFileSync(filePath, 'utf8'), /canvas_id/);

    // Both remedies have to be ones that work. Writing the id into the sync
    // state does not: a row is matched to Canvas through `matchBaseToCanvas`,
    // which only reads module items, so a row naming a quiz outside every
    // module matches nothing and the planner writes nothing. This message said
    // exactly that for as long as it was true of the old push, and kept saying
    // it afterwards.
    assert.match(refusal.message, /Delete the stale one in Canvas/);
    assert.match(refusal.message, /add the one you mean to this module/);
    assert.doesNotMatch(refusal.message, /\.canvas-sync\.json/);
  });

  it('carries the import procedure in the refusal when the quiz is not in Canvas', async () => {
    const { moduleItem, refusal } = await pushQuizItem({
      routes: [noQuizzes],
      expectRefusal: true,
    });

    // The procedure travels in the message rather than beside it in a warning,
    // because a scripted run under --quiet is told nothing else about the item
    // it did not get.
    assert.ok(refusal, 'a module item pointing at nothing is worse than none');
    assert.match(refusal.message, /holds no quiz by that name yet/);
    assert.match(refusal.message, /Import Course Content/);
    assert.match(refusal.message, /QTI \.zip file/);
    assert.match(refusal.message, /Current Jobs/);
    assert.ok(
      refusal.message.includes(QUIZ_REF),
      'the message names the package the item is waiting for',
    );
    assert.equal(moduleItem, null);
  });

  it('places a quiz that has no quiz_ref but whose recorded id resolves', async () => {
    // A quiz pulled from a Canvas-authored course has a recorded id and no
    // quiz_ref, and validate deliberately keeps that state valid. Skipping it
    // here would drop the quiz out of its module on the next push, which is
    // the exact loss this content type exists to prevent.
    const { moduleItem, warned } = await pushQuizItem({
      frontmatter: { quiz_ref: null },
      canvasId: 12,
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
    assert.doesNotMatch(fs.readFileSync(filePath, 'utf8'), /canvas_id/);
  });

  it('says there is nothing to import when the quiz is missing and so is quiz_ref', async () => {
    const { moduleItem, refusal } = await pushQuizItem({
      frontmatter: { quiz_ref: null },
      routes: [noQuizzes],
      expectRefusal: true,
    });

    assert.ok(refusal, 'a module item pointing at nothing is worse than none');
    assert.match(refusal.message, /"Test 1" was not placed/);
    assert.match(refusal.message, /names no quiz_ref/);
    assert.doesNotMatch(
      refusal.message,
      /Import Course Content/,
      'no import procedure without a package to import',
    );
    assert.equal(moduleItem, null);
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

describe('refuseQuizBackedDelete', () => {
  const item = { canvasId: 500, itemPath: '01-mod/03-homework.md' };

  it('allows an ordinary assignment through', async () => {
    assert.equal(
      await refuseQuizBackedDelete(42, item, async () => ({
        id: 500,
        is_quiz_assignment: false,
      })),
      null,
    );
  });

  it('allows a New Quiz through: it is an assignment and nothing else', async () => {
    assert.equal(
      await refuseQuizBackedDelete(42, item, async () => ({
        id: 500,
        is_quiz_lti_assignment: true,
        submission_types: ['external_tool'],
      })),
      null,
    );
  });

  it('names the quiz it is protecting', async () => {
    const refusal = await refuseQuizBackedDelete(42, item, async () => ({
      id: 500,
      quiz_id: 12,
    }));

    assert.match(refusal.lines[0], /gradebook half of quiz 12/);
    assert.match(refusal.error, /quiz 12/);
  });

  it('refuses without a quiz id too', async () => {
    const refusal = await refuseQuizBackedDelete(42, item, async () => ({
      id: 500,
      is_quiz_assignment: true,
    }));

    assert.match(refusal.lines[0], /gradebook half of a quiz/);
  });

  it('refuses when the check itself could not be made', async () => {
    const refusal = await refuseQuizBackedDelete(42, item, async () => {
      throw new Error('403 Forbidden');
    });

    assert.match(refusal.lines[0], /could not check whether assignment 500/);
    assert.match(refusal.error, /403 Forbidden/);
  });

  it('lets a 404 through: the assignment is already gone', async () => {
    assert.equal(
      await refuseQuizBackedDelete(42, item, async () => {
        throw new Error('Canvas API GET failed with status 404');
      }),
      null,
    );
  });
});
