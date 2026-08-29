const { describe, it, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');

// Set required env vars before requiring anything that loads the client.
process.env.CANVAS_API_URL = 'https://canvas.example.com';
process.env.CANVAS_API_TOKEN = 'test-token-123';

const {
  hasStudentSubmissions,
  getSubmissionStates,
  isQuizBackedAssignment,
  isNewQuizAssignment,
} = require('../../lib/canvas/assignments');

/**
 * Helper: create a fake Response object compatible with the fetch API.
 */
function fakeResponse(body, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe('hasStudentSubmissions', () => {
  it('reports an assignment with submissions', () => {
    assert.equal(
      hasStudentSubmissions({ id: 1, has_submitted_submissions: true }),
      true,
    );
  });

  it('reports an assignment without submissions', () => {
    assert.equal(
      hasStudentSubmissions({ id: 1, has_submitted_submissions: false }),
      false,
    );
  });

  it('returns null when Canvas did not send the flag', () => {
    assert.equal(
      hasStudentSubmissions({ id: 1 }),
      null,
      'a missing flag is unknown, never "no submissions"',
    );
  });

  it('returns null for a missing assignment object', () => {
    assert.equal(hasStudentSubmissions(undefined), null);
    assert.equal(hasStudentSubmissions(null), null);
  });
});

describe('isQuizBackedAssignment', () => {
  it('recognises the shadow assignment of a graded Classic Quiz', () => {
    assert.equal(
      isQuizBackedAssignment({
        id: 833216,
        name: 'Test 1',
        is_quiz_assignment: true,
        quiz_id: 245808,
        submission_types: ['online_quiz'],
      }),
      true,
      'deleting this assignment deletes the quiz behind it',
    );
  });

  it('recognises one by quiz_id alone', () => {
    assert.equal(
      isQuizBackedAssignment({ id: 1, quiz_id: 245808 }),
      true,
      'either field is enough: a quiz id on an assignment means a quiz',
    );
  });

  it('leaves an ordinary assignment alone', () => {
    assert.equal(
      isQuizBackedAssignment({
        id: 500,
        name: 'Homework',
        is_quiz_assignment: false,
        quiz_id: null,
        submission_types: ['online_upload'],
      }),
      false,
    );
  });

  it('leaves a New Quiz alone: it is genuinely an assignment', () => {
    assert.equal(
      isQuizBackedAssignment({
        id: 700,
        name: 'New Quizzes test',
        is_quiz_assignment: false,
        is_quiz_lti_assignment: true,
        submission_types: ['external_tool'],
      }),
      false,
      'a New Quiz has no separate Quiz object for this to protect',
    );
  });

  it('returns false for a missing assignment object', () => {
    assert.equal(isQuizBackedAssignment(undefined), false);
    assert.equal(isQuizBackedAssignment(null), false);
  });
});

describe('isNewQuizAssignment', () => {
  it('recognises a New Quiz by its LTI flag', () => {
    assert.equal(
      isNewQuizAssignment({
        id: 700,
        name: 'New Quizzes test',
        is_quiz_assignment: false,
        is_quiz_lti_assignment: true,
        submission_types: ['external_tool'],
      }),
      true,
    );
  });

  it('leaves an ordinary assignment alone', () => {
    assert.equal(
      isNewQuizAssignment({
        id: 500,
        name: 'Homework',
        is_quiz_assignment: false,
        submission_types: ['online_upload'],
      }),
      false,
    );
  });

  it('does not mistake a Classic quiz assignment for a New Quiz', () => {
    assert.equal(
      isNewQuizAssignment({
        id: 833216,
        name: 'Test 1',
        is_quiz_assignment: true,
        quiz_id: 245808,
        submission_types: ['online_quiz'],
      }),
      false,
      'the two are different objects and cost different things to delete',
    );
  });

  it('returns false for a missing assignment object', () => {
    assert.equal(isNewQuizAssignment(undefined), false);
    assert.equal(isNewQuizAssignment(null), false);
  });
});

describe('getSubmissionStates', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it('maps every assignment id to its submission state in one request', async () => {
    const fetchMock = mock.method(global, 'fetch', async () =>
      fakeResponse([
        { id: 500, name: 'Graded', has_submitted_submissions: true },
        { id: 501, name: 'Untouched', has_submitted_submissions: false },
        { id: 502, name: 'No flag' },
      ]),
    );

    const states = await getSubmissionStates(42);

    assert.equal(
      fetchMock.mock.calls.length,
      1,
      'one list call answers it for the whole course',
    );
    assert.equal(states.get('500').hasSubmissions, true);
    assert.equal(states.get('501').hasSubmissions, false);
    assert.equal(states.get('502').hasSubmissions, null);
  });

  it('carries the New Quiz flag beside the submission state', async () => {
    mock.method(global, 'fetch', async () =>
      fakeResponse([
        {
          id: 600,
          name: 'Chapter test',
          is_quiz_lti_assignment: true,
          has_submitted_submissions: true,
        },
        { id: 601, name: 'Essay', has_submitted_submissions: true },
      ]),
    );

    const states = await getSubmissionStates(42);

    assert.equal(
      states.get('600').isNewQuiz,
      true,
      'the list response already carries the flag, so nothing has to ask twice',
    );
    assert.equal(states.get('600').hasSubmissions, true);
    assert.equal(states.get('601').isNewQuiz, false);
  });

  it('keys the map by string so numeric sync-state ids match', async () => {
    mock.method(global, 'fetch', async () =>
      fakeResponse([{ id: 999, has_submitted_submissions: true }]),
    );

    const states = await getSubmissionStates(42);

    assert.equal(states.get(String(999)).hasSubmissions, true);
    assert.equal(states.has('123'), false, 'unlisted ids are simply absent');
  });

  it('propagates a failed lookup instead of reporting no submissions', async () => {
    mock.method(console, 'log', () => {});
    // 403 is not retryable, so this is the permissions case, not a slow retry.
    mock.method(global, 'fetch', async () =>
      fakeResponse({ message: 'forbidden' }, { status: 403 }),
    );

    await assert.rejects(() => getSubmissionStates(42), /403/);
  });
});
