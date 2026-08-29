const { describe, it, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');

// Set required env vars before requiring anything that loads the client.
process.env.CANVAS_API_URL = 'https://canvas.example.com';
process.env.CANVAS_API_TOKEN = 'test-token-123';

const {
  annotateSubmissions,
  describeDoomedItem,
  submissionRiskNoun,
} = require('../../cli/prune-warning');

/**
 * What `--prune-canvas` puts in front of the author before it asks.
 *
 * These three run over the plan's `delete-canvas-item` actions rather than over
 * the sync state, so the fixtures below are actions: `itemPath`, `canvasType`
 * and `canvasId` are the whole of what the planner hands them. Whether the
 * planner emits the right deletes in the first place is `test/sync/plan.test.js`
 * ("plan: pruning" and the truth table), executing one is
 * `test/sync/apply-plan.test.js`, and the refusal that stops a quiz-backed
 * assignment being deleted is `test/sync/canvas-write.test.js`.
 */

describe('annotateSubmissions', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  const states = new Map([
    ['500', { hasSubmissions: true, isNewQuiz: false }],
    ['501', { hasSubmissions: false, isNewQuiz: false }],
  ]);

  it('flags a doomed assignment that has student submissions', async () => {
    const items = [
      {
        itemPath: '01-mod/01-hw.md',
        canvasType: 'assignment',
        canvasId: 500,
      },
    ];

    await annotateSubmissions(42, items, async () => states);

    assert.equal(items[0].hasSubmissions, true);
  });

  it('does not flag a doomed assignment without submissions', async () => {
    const items = [
      {
        itemPath: '01-mod/02-hw.md',
        canvasType: 'assignment',
        canvasId: 501,
      },
    ];

    await annotateSubmissions(42, items, async () => states);

    assert.equal(items[0].hasSubmissions, false);
  });

  it('treats an assignment Canvas no longer lists as nothing left to lose', async () => {
    const items = [
      {
        itemPath: '01-mod/03-hw.md',
        canvasType: 'assignment',
        canvasId: 777,
      },
    ];

    await annotateSubmissions(42, items, async () => states);

    assert.equal(items[0].hasSubmissions, false);
  });

  it('marks the state unknown when the lookup fails', async () => {
    mock.method(console, 'warn', () => {});
    const items = [
      {
        itemPath: '01-mod/01-hw.md',
        canvasType: 'assignment',
        canvasId: 500,
      },
    ];

    await annotateSubmissions(42, items, async () => {
      throw new Error('403 Forbidden');
    });

    assert.equal(
      items[0].hasSubmissions,
      null,
      'a failed check must never read as "no submissions"',
    );
  });

  it('makes no request when no assignment is being deleted', async () => {
    const items = [
      {
        itemPath: '01-mod/01-page.md',
        canvasType: 'page',
        canvasId: 'slug',
      },
      { itemPath: '01-mod/doc.pdf', canvasType: 'file', canvasId: 400 },
    ];

    await annotateSubmissions(42, items, async () => {
      throw new Error('the submission lookup should not have run');
    });

    assert.equal(items[0].hasSubmissions, undefined);
    assert.equal(items[1].hasSubmissions, undefined);
  });

  it('looks the whole course up once for many doomed assignments', async () => {
    let calls = 0;
    const items = [
      {
        itemPath: '01-mod/01-hw.md',
        canvasType: 'assignment',
        canvasId: 500,
      },
      {
        itemPath: '01-mod/02-hw.md',
        canvasType: 'assignment',
        canvasId: 501,
      },
      {
        itemPath: '01-mod/01-page.md',
        canvasType: 'page',
        canvasId: 'slug',
      },
    ];

    await annotateSubmissions(42, items, async () => {
      calls++;
      return states;
    });

    assert.equal(calls, 1);
  });
});

describe('annotateSubmissions: discussions', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  // 500 is the assignment behind the graded topic 88; 501 the one behind 89.
  const states = new Map([
    ['500', { hasSubmissions: true, isNewQuiz: false }],
    ['501', { hasSubmissions: false, isNewQuiz: false }],
  ]);

  /** A doomed discussion item as prune collects it: canvasId is the topic id. */
  function discussion(canvasId, name = 'forum') {
    return {
      itemPath: `01-mod/${name}.md`,
      canvasType: 'discussion',
      canvasId,
    };
  }

  /** Answer topic fetches from a table keyed by topic id. */
  function topics(table) {
    return async (courseId, id) => {
      const topic = table[String(id)];
      if (!topic) throw new Error(`404 Not Found: topic ${id}`);
      return topic;
    };
  }

  it('flags a graded discussion whose assignment has student submissions', async () => {
    const items = [discussion(88)];

    await annotateSubmissions(
      42,
      items,
      async () => states,
      topics({ 88: { id: 88, title: 'Week 1', assignment_id: 500 } }),
    );

    assert.equal(
      items[0].hasSubmissions,
      true,
      'the grades hang off the assignment behind the topic, not off the topic id',
    );
  });

  it('resolves the assignment through a nested assignment object too', async () => {
    const items = [discussion(88)];

    await annotateSubmissions(
      42,
      items,
      async () => states,
      topics({ 88: { id: 88, assignment: { id: 500, name: 'Week 1' } } }),
    );

    assert.equal(items[0].hasSubmissions, true);
  });

  it('does not flag a graded discussion without submissions', async () => {
    const items = [discussion(89)];

    await annotateSubmissions(
      42,
      items,
      async () => states,
      topics({ 89: { id: 89, assignment_id: 501 } }),
    );

    assert.equal(items[0].hasSubmissions, false);
  });

  it('reads an ungraded discussion as a real no, not an unknown', async () => {
    const items = [discussion(90)];

    await annotateSubmissions(
      42,
      items,
      async () => states,
      topics({ 90: { id: 90, title: 'Chat', assignment_id: null } }),
    );

    assert.equal(
      items[0].hasSubmissions,
      false,
      'an ungraded topic has no gradebook column, so there is nothing to warn about',
    );
  });

  it('never looks up an assignment when only ungraded topics are doomed', async () => {
    const items = [discussion(90)];

    await annotateSubmissions(
      42,
      items,
      async () => {
        throw new Error('the submission lookup should not have run');
      },
      topics({ 90: { id: 90, assignment_id: null } }),
    );

    assert.equal(items[0].hasSubmissions, false);
  });

  it('marks the state unknown when the topic fetch fails', async () => {
    mock.method(console, 'warn', () => {});
    const items = [discussion(88)];

    await annotateSubmissions(
      42,
      items,
      async () => states,
      async () => {
        throw new Error('403 Forbidden');
      },
    );

    assert.equal(
      items[0].hasSubmissions,
      null,
      'a topic that could not be read may well be a graded one',
    );
  });

  it('marks the state unknown when the assignment lookup fails', async () => {
    mock.method(console, 'warn', () => {});
    const items = [discussion(88)];

    await annotateSubmissions(
      42,
      items,
      async () => {
        throw new Error('403 Forbidden');
      },
      topics({ 88: { id: 88, assignment_id: 500 } }),
    );

    assert.equal(items[0].hasSubmissions, null);
  });

  it('marks the state unknown when a graded topic names no assignment', async () => {
    const items = [discussion(88)];

    await annotateSubmissions(
      42,
      items,
      async () => states,
      topics({ 88: { id: 88, assignment: { name: 'no id here' } } }),
    );

    assert.equal(items[0].hasSubmissions, null);
  });

  it('marks the state unknown when the named assignment is not listed', async () => {
    const items = [discussion(88)];

    await annotateSubmissions(
      42,
      items,
      async () => states,
      topics({ 88: { id: 88, assignment_id: 999 } }),
    );

    assert.equal(
      items[0].hasSubmissions,
      null,
      'the topic exists and says it is graded, so an unresolvable assignment id ' +
        'is an unanswered question, not a clean bill of health',
    );
  });

  it('looks the whole course up once for assignments and discussions together', async () => {
    let stateCalls = 0;
    const fetched = [];
    const items = [
      {
        itemPath: '01-mod/01-hw.md',
        canvasType: 'assignment',
        canvasId: 500,
      },
      discussion(88, 'forum-a'),
      discussion(89, 'forum-b'),
      {
        itemPath: '01-mod/01-page.md',
        canvasType: 'page',
        canvasId: 'slug',
      },
    ];

    await annotateSubmissions(
      42,
      items,
      async () => {
        stateCalls++;
        return states;
      },
      async (courseId, id) => {
        fetched.push(id);
        return { id, assignment_id: id === 88 ? 500 : 501 };
      },
    );

    assert.equal(stateCalls, 1, 'one list request answers it for every item');
    assert.deepEqual(
      fetched,
      [88, 89],
      'only the doomed topics are fetched, one request each',
    );
    assert.deepEqual(
      items.map((item) => item.hasSubmissions),
      [true, true, false, undefined],
    );
  });

  it('keeps the reply count off the topic it already fetched', async () => {
    const items = [discussion(90)];

    await annotateSubmissions(
      42,
      items,
      async () => states,
      topics({
        90: { id: 90, assignment_id: null, discussion_subentry_count: 14 },
      }),
    );

    assert.equal(
      items[0].replyCount,
      14,
      'an ungraded topic loses no grades but still loses every reply',
    );
  });

  it('keeps the reply count for a graded topic too', async () => {
    const items = [discussion(88)];

    await annotateSubmissions(
      42,
      items,
      async () => states,
      topics({
        88: { id: 88, assignment_id: 500, discussion_subentry_count: 3 },
      }),
    );

    assert.equal(items[0].hasSubmissions, true);
    assert.equal(items[0].replyCount, 3);
  });

  it('leaves the reply count unset when Canvas omits it', async () => {
    const items = [discussion(90)];

    await annotateSubmissions(
      42,
      items,
      async () => states,
      topics({ 90: { id: 90, assignment_id: null } }),
    );

    assert.equal(items[0].replyCount, undefined);
  });

  it('leaves the reply count unset when the topic could not be read', async () => {
    mock.method(console, 'warn', () => {});
    const items = [discussion(91)];

    await annotateSubmissions(42, items, async () => states, topics({}));

    assert.equal(items[0].hasSubmissions, null);
    assert.equal(items[0].replyCount, undefined);
  });

  it('fetches no topic that is not slated for deletion', async () => {
    const items = [
      {
        itemPath: '01-mod/01-page.md',
        canvasType: 'page',
        canvasId: 'slug',
      },
      { itemPath: '01-mod/doc.pdf', canvasType: 'file', canvasId: 400 },
    ];

    await annotateSubmissions(
      42,
      items,
      async () => {
        throw new Error('the submission lookup should not have run');
      },
      async () => {
        throw new Error('no topic should have been fetched');
      },
    );

    assert.equal(items[0].hasSubmissions, undefined);
    assert.equal(items[1].hasSubmissions, undefined);
  });
});

describe('describeDoomedItem', () => {
  it('names the grades on an assignment that has submissions', () => {
    const line = describeDoomedItem({
      itemPath: '01-mod/01-hw.md',
      canvasType: 'assignment',
      hasSubmissions: true,
    });

    assert.match(line, /HAS STUDENT SUBMISSIONS/);
    assert.match(line, /gradebook column/);
    assert.match(line, /01-mod\/01-hw\.md/);
  });

  it('leaves an assignment without submissions unmarked', () => {
    const line = describeDoomedItem({
      itemPath: '01-mod/02-hw.md',
      canvasType: 'assignment',
      hasSubmissions: false,
    });

    assert.equal(line, '  - 01-mod/02-hw.md (assignment)');
  });

  it('says so when the submission status could not be determined', () => {
    const line = describeDoomedItem({
      itemPath: '01-mod/03-hw.md',
      canvasType: 'assignment',
      hasSubmissions: null,
    });

    assert.match(line, /SUBMISSION STATUS UNKNOWN/);
    assert.match(line, /assume grades will be lost/);
  });

  it('leaves other item types as they were', () => {
    assert.equal(
      describeDoomedItem({
        itemPath: '01-mod/01-page.md',
        canvasType: 'page',
      }),
      '  - 01-mod/01-page.md (page)',
    );
  });

  it('names the replies as well as the grades on a graded discussion', () => {
    const line = describeDoomedItem({
      itemPath: '01-mod/06-forum.md',
      canvasType: 'discussion',
      hasSubmissions: true,
    });

    assert.match(line, /GRADED DISCUSSION WITH STUDENT WORK/);
    assert.match(
      line,
      /every student reply/,
      'deleting the topic costs more than a gradebook column',
    );
    assert.match(line, /every grade/);
    assert.match(line, /01-mod\/06-forum\.md/);
  });

  it('counts the replies when Canvas gave a count', () => {
    const line = describeDoomedItem({
      itemPath: '01-mod/06-forum.md',
      canvasType: 'discussion',
      hasSubmissions: true,
      replyCount: 14,
    });

    assert.match(line, /deletes the topic and its 14 replies/);
    assert.match(line, /the gradebook column and every grade/);
  });

  it('leaves an empty discussion unmarked', () => {
    assert.equal(
      describeDoomedItem({
        itemPath: '01-mod/07-forum.md',
        canvasType: 'discussion',
        hasSubmissions: false,
        replyCount: 0,
      }),
      '  - 01-mod/07-forum.md (discussion)',
      'no grades and nothing written in it: there is nothing to warn about',
    );
  });

  it('leaves an unmeasured discussion unmarked', () => {
    assert.equal(
      describeDoomedItem({
        itemPath: '01-mod/07-forum.md',
        canvasType: 'discussion',
        hasSubmissions: false,
      }),
      '  - 01-mod/07-forum.md (discussion)',
    );
  });

  it('names the replies an ungraded discussion still takes with it', () => {
    const line = describeDoomedItem({
      itemPath: '01-mod/07-forum.md',
      canvasType: 'discussion',
      hasSubmissions: false,
      replyCount: 14,
    });

    assert.match(line, /14 REPLIES FROM STUDENTS/);
    assert.match(
      line,
      /no grades at stake/,
      'the reader must not read this as a grade warning',
    );
    assert.match(line, /deleting the topic still deletes every one of them/);
  });

  it('agrees with a single reply', () => {
    const line = describeDoomedItem({
      itemPath: '01-mod/07-forum.md',
      canvasType: 'discussion',
      hasSubmissions: false,
      replyCount: 1,
    });

    assert.match(line, /1 REPLY FROM STUDENTS/);
  });

  it('says so when a discussion could not be checked', () => {
    const line = describeDoomedItem({
      itemPath: '01-mod/08-forum.md',
      canvasType: 'discussion',
      hasSubmissions: null,
    });

    assert.match(line, /SUBMISSION STATUS UNKNOWN/);
    assert.match(line, /assume it is graded/);
    assert.match(line, /replies and grades will be lost/);
  });

  it('still counts the replies when only the grade check failed', () => {
    const line = describeDoomedItem({
      itemPath: '01-mod/08-forum.md',
      canvasType: 'discussion',
      hasSubmissions: null,
      replyCount: 14,
    });

    assert.match(line, /SUBMISSION STATUS UNKNOWN/);
    assert.match(line, /its 14 replies and the grades will be lost/);
  });
});

describe('submissionRiskNoun', () => {
  it('says "assignment" when only assignments are counted', () => {
    assert.equal(
      submissionRiskNoun([
        { canvasType: 'assignment' },
        { canvasType: 'assignment' },
      ]),
      'assignment',
    );
  });

  it('says "item" as soon as a discussion is counted', () => {
    assert.equal(
      submissionRiskNoun([
        { canvasType: 'assignment' },
        { canvasType: 'discussion' },
      ]),
      'item',
      'the count covers both, so naming one of them would be a false line',
    );
  });

  it('says "item" for discussions alone', () => {
    assert.equal(submissionRiskNoun([{ canvasType: 'discussion' }]), 'item');
  });

  it('does not care whether the discussion turned out graded', () => {
    assert.equal(
      submissionRiskNoun([{ canvasType: 'discussion', hasSubmissions: false }]),
      'item',
    );
  });

  it('handles an empty or missing list', () => {
    assert.equal(submissionRiskNoun([]), 'assignment');
    assert.equal(submissionRiskNoun(undefined), 'assignment');
  });
});
