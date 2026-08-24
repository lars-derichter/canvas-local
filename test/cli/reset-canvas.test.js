const { describe, it, mock, afterEach, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// Set required env vars before requiring anything that loads the client.
process.env.CANVAS_API_URL = 'https://canvas.example.com';
process.env.CANVAS_API_TOKEN = 'test-token-123';
process.env.CANVAS_COURSE_ID = '42';

const resetCanvas = require('../../cli/reset-canvas');

const {
  _partitionAssignments: partitionAssignments,
  _quizSkipNotice: quizSkipNotice,
  _collectNewQuizzes: collectNewQuizzes,
  _newQuizNotice: newQuizNotice,
} = resetCanvas;

/** A Canvas Assignment object as the course's assignment list returns it. */
function assignment(overrides = {}) {
  return {
    id: 500,
    name: 'Homework',
    has_submitted_submissions: false,
    is_quiz_assignment: false,
    ...overrides,
  };
}

/** The assignment Canvas keeps for a graded Classic Quiz. */
function quizAssignment(overrides = {}) {
  return assignment({
    id: 833216,
    name: 'Test 1',
    is_quiz_assignment: true,
    quiz_id: 245808,
    submission_types: ['online_quiz'],
    ...overrides,
  });
}

/** A New Quiz, which Canvas returns as an LTI-backed assignment. */
function newQuiz(overrides = {}) {
  return assignment({
    id: 900123,
    name: 'Quiz 2',
    is_quiz_assignment: false,
    is_quiz_lti_assignment: true,
    submission_types: ['external_tool'],
    ...overrides,
  });
}

describe('partitionAssignments', () => {
  it('keeps the assignment that fronts a quiz out of the deletions', () => {
    const { deletable, quizBacked } = partitionAssignments([
      assignment({ id: 500 }),
      quizAssignment(),
      assignment({ id: 501, name: 'Essay' }),
    ]);

    assert.deepEqual(
      deletable.map((a) => a.id),
      [500, 501],
    );
    assert.deepEqual(
      quizBacked.map((a) => a.id),
      [833216],
      'deleting this one would delete the quiz, its questions and its submissions',
    );
  });

  it('splits nothing out of a course without quizzes', () => {
    const { deletable, quizBacked } = partitionAssignments([assignment()]);

    assert.equal(deletable.length, 1);
    assert.deepEqual(quizBacked, []);
  });

  it('handles an empty or missing list', () => {
    assert.deepEqual(partitionAssignments([]), {
      deletable: [],
      quizBacked: [],
    });
    assert.deepEqual(partitionAssignments(undefined), {
      deletable: [],
      quizBacked: [],
    });
  });
});

describe('quizSkipNotice', () => {
  it('says nothing when the course has no quiz assignments', () => {
    assert.equal(quizSkipNotice([]), null);
  });

  it('names the consequence, not just the count', () => {
    const notice = quizSkipNotice([quizAssignment()]);

    assert.match(notice, /^1 of the assignments/);
    assert.match(notice, /It is skipped/);
    assert.match(
      notice,
      /deletes the quiz, its questions and every submission/,
    );
  });

  it('agrees with more than one', () => {
    const notice = quizSkipNotice([quizAssignment(), quizAssignment()]);

    assert.match(notice, /^2 of the assignments/);
    assert.match(notice, /They are skipped/);
  });
});

describe('collectNewQuizzes', () => {
  it('picks the New Quizzes out of the deletions', () => {
    const found = collectNewQuizzes([
      assignment({ id: 500 }),
      newQuiz(),
      assignment({ id: 501, name: 'Essay' }),
    ]);

    assert.deepEqual(
      found.map((a) => a.id),
      [900123],
    );
  });

  it('does not pick up a Classic quiz assignment', () => {
    assert.deepEqual(collectNewQuizzes([quizAssignment()]), []);
  });

  it('handles an empty or missing list', () => {
    assert.deepEqual(collectNewQuizzes([]), []);
    assert.deepEqual(collectNewQuizzes(undefined), []);
  });
});

describe('newQuizNotice', () => {
  it('says nothing when the course has no New Quizzes', () => {
    assert.equal(newQuizNotice([]), null);
  });

  it('names the loss and denies that "Classic quizzes" covers it', () => {
    const notice = newQuizNotice([newQuiz()]);

    assert.match(notice, /^1 of the assignments counted above is a New Quiz/);
    assert.match(
      notice,
      /only Classic quizzes are left alone/,
      'the reader has just been told quizzes survive; this one does not',
    );
    assert.match(notice, /its questions and every submission on it/);
    assert.match(notice, /Nothing here could rebuild the questions/);
  });

  it('agrees with more than one', () => {
    const notice = newQuizNotice([newQuiz(), newQuiz({ id: 900124 })]);

    assert.match(notice, /^2 of the assignments counted above are New Quizzes/);
    assert.match(notice, /they are deleted with the rest/);
  });
});

describe('resetCanvas --dry-run', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  /** Run the command against a mocked course and return everything it printed. */
  async function run(assignments) {
    const logged = mock.method(console, 'log', () => {});
    const warned = mock.method(console, 'warn', () => {});
    mock.method(console, 'error', () => {});
    mockCanvas([
      { method: 'GET', path: '/pages', body: [] },
      { method: 'GET', path: '/files', body: [] },
      { method: 'GET', path: '/modules', body: [{ id: 9, name: 'Module' }] },
      { method: 'GET', path: '/assignments', body: assignments },
    ]);

    await resetCanvas({ dryRun: true });

    const said = (fn) => fn.mock.calls.map((c) => c.arguments[0]).join('\n');
    return { out: said(logged), warnings: said(warned) };
  }

  it('leaves the quiz assignment out of the count and says why', async () => {
    const { out } = await run([assignment(), quizAssignment()]);

    assert.match(
      out,
      /contains 1 module, 1 assignment\./,
      'the assignment that is really a quiz is not one of the deletions',
    );
    assert.match(out, /1 of the assignments on this course is the gradebook/);
    assert.match(out, /- Test 1 \(kept, with its quiz\)/);
  });

  it('promises only what it does', async () => {
    const { out } = await run([assignment()]);

    assert.match(
      out,
      /Classic quizzes, discussions, announcements and rubrics are left alone/,
    );
    assert.doesNotMatch(
      out,
      /gradebook half of a graded quiz/,
      'a course without quiz assignments hears nothing about them',
    );
  });

  it('counts no grades at stake on a quiz it is not deleting', async () => {
    const { out, warnings } = await run([
      assignment({ has_submitted_submissions: false }),
      quizAssignment({ has_submitted_submissions: true }),
    ]);

    assert.equal(
      warnings,
      '',
      'the skipped quiz puts no submissions at risk, so nothing warns about it',
    );
    assert.match(out, /The assignment has no student submissions\./);
  });

  it('counts a New Quiz among the deletions and names what goes with it', async () => {
    const { out, warnings } = await run([assignment(), newQuiz()]);

    assert.match(
      out,
      /contains 1 module, 2 assignments\./,
      'a New Quiz is an assignment here, so it stays in the count',
    );
    assert.match(warnings, /1 of the assignments counted above is a New Quiz/);
    assert.match(warnings, /only Classic quizzes are left alone/);
    assert.match(
      warnings,
      /- Quiz 2 \(New Quiz: deleted, with its questions\)/,
    );
  });

  it('still says Classic quizzes survive, next to the New Quiz warning', async () => {
    const { out, warnings } = await run([newQuiz(), quizAssignment()]);

    assert.match(
      out,
      /Classic quizzes, discussions, announcements and rubrics are left alone/,
    );
    assert.match(out, /- Test 1 \(kept, with its quiz\)/);
    assert.match(
      warnings,
      /- Quiz 2 \(New Quiz: deleted, with its questions\)/,
    );
  });

  it('says nothing about New Quizzes on a course without one', async () => {
    const { out, warnings } = await run([assignment()]);

    assert.doesNotMatch(out, /New Quiz/);
    assert.doesNotMatch(warnings, /New Quiz/);
  });

  it('says the course holds nothing to delete when only a quiz is left', async () => {
    const logged = mock.method(console, 'log', () => {});
    mock.method(console, 'warn', () => {});
    mockCanvas([
      { method: 'GET', path: '/pages', body: [] },
      { method: 'GET', path: '/files', body: [] },
      { method: 'GET', path: '/modules', body: [] },
      { method: 'GET', path: '/assignments', body: [quizAssignment()] },
    ]);

    await resetCanvas({ dryRun: true });

    const out = logged.mock.calls.map((c) => c.arguments[0]).join('\n');
    assert.match(out, /holds nothing this command deletes/);
    assert.doesNotMatch(
      out,
      /already empty/,
      'a course with a quiz in it is not empty',
    );
  });
});

// ---------------------------------------------------------------------------
// Exit codes
//
// The command reports its verdict through `process.exitCode` rather than
// `process.exit`, so a test can read it — and has to put it back afterwards,
// or the first run that legitimately fails would fail the whole suite.
//
// Three paths are a failure: a run with no course to reset, a run that ended
// with content it was told to delete still in the course, and a run cancelled
// at the prompt. The last follows the rule push and pull already apply:
// however the "no" arrived, the reset the command was asked for did not
// happen. A preview is not a failure; a dry run does everything a dry run is
// for.
// ---------------------------------------------------------------------------

describe('resetCanvas exit code', () => {
  beforeEach(() => {
    process.exitCode = 0;
  });
  afterEach(() => {
    mock.restoreAll();
    process.exitCode = 0;
  });

  /** Mute the three sinks the logger writes to. */
  function silence() {
    mock.method(console, 'log', () => {});
    mock.method(console, 'warn', () => {});
    mock.method(console, 'error', () => {});
  }

  /** The four list calls, for a course holding one module and nothing else. */
  function oneModule() {
    return [
      { method: 'GET', path: '/pages', body: [] },
      { method: 'GET', path: '/files', body: [] },
      { method: 'GET', path: '/modules', body: [{ id: 9, name: 'Module' }] },
      { method: 'GET', path: '/assignments', body: [] },
    ];
  }

  const deletions = (calls) => calls.filter((c) => c.method === 'DELETE');

  it('exits non-zero when no Canvas course is configured', async () => {
    silence();
    const configured = process.env.CANVAS_COURSE_ID;
    delete process.env.CANVAS_COURSE_ID;
    try {
      await resetCanvas({});
    } finally {
      process.env.CANVAS_COURSE_ID = configured;
    }

    assert.equal(
      process.exitCode,
      1,
      'the run reset nothing, so a script must not read it as a clean sweep',
    );
  });

  it('exits non-zero when a deletion failed', async () => {
    silence();
    // No DELETE route, so the one deletion this run makes answers 400, a
    // status the client does not retry, and the run reports one error.
    mockCanvas(oneModule());

    const outcome = await withStdin('y\n', () => within(resetCanvas({})));

    assert.notEqual(outcome, HUNG);
    assert.equal(
      process.exitCode,
      1,
      'the module is still in the course, so the reset did not do what it said',
    );
  });

  it('leaves the exit code alone when every deletion landed', async () => {
    silence();
    mockCanvas([
      ...oneModule(),
      { method: 'DELETE', path: '/modules/9', body: {} },
    ]);

    const outcome = await withStdin('y\n', () => within(resetCanvas({})));

    assert.notEqual(outcome, HUNG);
    assert.equal(process.exitCode, 0);
  });

  it('exits non-zero when the answer is not "y"', async () => {
    silence();
    const calls = mockCanvas(oneModule());

    const outcome = await withStdin('n\n', () => within(resetCanvas({})));

    assert.notEqual(outcome, HUNG);
    assert.deepEqual(deletions(calls), []);
    assert.equal(
      process.exitCode,
      1,
      'asked to reset, reset nothing: same verdict as a declined push or pull',
    );
  });

  it('exits non-zero when the input stream ends unanswered', async () => {
    silence();
    const calls = mockCanvas(oneModule());

    // `< /dev/null`, a CI step, an editor task: silence reads as "no", and a
    // "no" is a "no" however it arrived.
    const outcome = await withStdin('', () => within(resetCanvas({})));

    assert.notEqual(
      outcome,
      HUNG,
      'a question nothing will ever answer must settle rather than hang',
    );
    assert.deepEqual(deletions(calls), []);
    assert.equal(process.exitCode, 1);
  });

  it('leaves the exit code alone on a dry run', async () => {
    silence();
    mockCanvas(oneModule());

    await resetCanvas({ dryRun: true });

    assert.equal(
      process.exitCode,
      0,
      'a preview that exits non-zero is a broken preview',
    );
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
 * Answer Canvas requests from a route table of { method, path, body, status }.
 * An unrouted request gets a 400, so a missing route fails the test instead of
 * hanging on the client's retries.
 */
function mockCanvas(routes) {
  const calls = [];
  const remaining = routes.map((route) => ({ ...route }));
  mock.method(global, 'fetch', async (url, opts) => {
    calls.push({ url, method: opts.method });
    const index = remaining.findIndex(
      (route) => route.method === opts.method && url.includes(route.path),
    );
    if (index === -1) {
      return fakeResponse(
        { message: `unrouted ${opts.method} ${url}` },
        { status: 400 },
      );
    }
    const [route] = remaining.splice(index, 1);
    return fakeResponse(route.body, { status: route.status || 200 });
  });
  return calls;
}

/** Returned in place of a promise that never settled. */
const HUNG = Symbol('hung');

/**
 * Resolve to HUNG when `promise` has not settled shortly, so a confirmation
 * that never answers fails the test that awaited it instead of hanging the
 * whole run — and `withStdin` reaches its restore either way.
 */
function within(promise, ms = 2000) {
  let timer;
  const expiry = new Promise((resolve) => {
    timer = setTimeout(() => resolve(HUNG), ms);
  });
  return Promise.race([promise, expiry]).finally(() => clearTimeout(timer));
}

/**
 * Run a function with stdin replaced by a readable stream of `input`, so the
 * confirmation resolves without a terminal. An empty `input` is a stream that
 * ends without ever producing a line — what `< /dev/null`, a CI runner or a
 * piped command with nothing left to say hands a question.
 */
async function withStdin(input, fn) {
  const { Readable } = require('stream');
  const original = Object.getOwnPropertyDescriptor(process, 'stdin');
  const fake = Readable.from(input ? [input] : []);
  fake.isTTY = false;
  Object.defineProperty(process, 'stdin', { value: fake, configurable: true });
  try {
    return await fn();
  } finally {
    Object.defineProperty(process, 'stdin', original);
  }
}
