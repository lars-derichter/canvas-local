const { describe, it, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');

const {
  BACKUP_DOC,
  confirm,
  confirmFirstPush,
  confirmForcedPull,
  countSubmissionRisk,
  describeContents,
  submissionRiskSuffix,
  submissionWarningLines,
} = require('../../cli/backup-warning');

afterEach(() => {
  mock.restoreAll();
});

/** Everything the warning printed, as one string. */
function said(spy) {
  return spy.mock.calls.map((call) => call.arguments.join(' ')).join('\n');
}

describe('describeContents', () => {
  it('summarises the counts that are non-zero', () => {
    const summary = describeContents({
      modules: 3,
      pages: 12,
      assignments: 0,
      files: 1,
    });
    assert.equal(summary, '3 modules, 12 pages, 1 file');
  });

  it('returns an empty string for an empty course', () => {
    assert.equal(
      describeContents({ modules: 0, pages: 0, assignments: 0, files: 0 }),
      '',
    );
  });
});

describe('countSubmissionRisk', () => {
  it('counts the assignments that hold graded work', () => {
    assert.deepEqual(countSubmissionRisk([true, false, true]), {
      graded: 2,
      unknown: 0,
    });
  });

  it('counts an undetermined state as its own risk, not as safe', () => {
    assert.deepEqual(countSubmissionRisk([null, false, undefined]), {
      graded: 0,
      unknown: 2,
    });
  });

  it('returns zeroes when nothing is at stake', () => {
    assert.deepEqual(countSubmissionRisk([]), { graded: 0, unknown: 0 });
    assert.deepEqual(countSubmissionRisk([false, false]), {
      graded: 0,
      unknown: 0,
    });
  });
});

describe('submissionWarningLines', () => {
  it('warns about student submissions and the gradebook column', () => {
    const [line, ...rest] = submissionWarningLines({ graded: 2, unknown: 0 });
    assert.equal(rest.length, 0);
    assert.match(line, /2 assignments being deleted have student submissions/);
    assert.match(line, /gradebook column and every submission and grade/);
  });

  it('agrees with a single assignment', () => {
    const [line] = submissionWarningLines({ graded: 1, unknown: 0 });
    assert.match(line, /1 assignment being deleted has student submissions/);
  });

  it('warns separately that a status could not be determined', () => {
    const [line] = submissionWarningLines({ graded: 0, unknown: 1 });
    assert.match(line, /could not determine whether 1 assignment/);
    assert.match(line, /Treat it as if it does/);
  });

  it('warns twice when some are graded and others unchecked', () => {
    assert.equal(submissionWarningLines({ graded: 1, unknown: 2 }).length, 2);
  });

  it('says nothing when no assignment carries student work', () => {
    assert.deepEqual(submissionWarningLines({ graded: 0, unknown: 0 }), []);
    assert.deepEqual(submissionWarningLines(), []);
  });

  it('counts whatever noun the caller is counting', () => {
    const [line] = submissionWarningLines({ graded: 2, unknown: 0 }, 'item');
    assert.match(
      line,
      /2 items being deleted have student submissions/,
      'a prune counts graded discussions too, so it cannot say "assignments"',
    );
    assert.match(line, /Deleting an item deletes its gradebook column/);
  });

  it('keeps the article right on a single item', () => {
    const [line] = submissionWarningLines({ graded: 0, unknown: 1 }, 'item');
    assert.match(line, /could not determine whether 1 item being deleted has/);
    assert.match(line, /deleting an item takes its gradebook column/);
  });
});

describe('submissionRiskSuffix', () => {
  it('names the grades in the question when submissions exist', () => {
    assert.equal(
      submissionRiskSuffix({ graded: 1, unknown: 0 }),
      ', including the student submissions and grades',
    );
  });

  it('hedges when the status could not be determined', () => {
    assert.equal(
      submissionRiskSuffix({ graded: 0, unknown: 3 }),
      ', including any student submissions and grades',
    );
  });

  it('adds nothing when no grades are at stake', () => {
    assert.equal(submissionRiskSuffix({ graded: 0, unknown: 0 }), '');
    assert.equal(submissionRiskSuffix(), '');
  });
});

describe('confirm', () => {
  it('cancels when stdin ends without an answer', async () => {
    const answer = await withStdin('', () =>
      within(confirm('[test] Continue? (y/N)')),
    );
    assert.notEqual(
      answer,
      HUNG,
      'rl.question never fires its callback at EOF, so a confirm that waits ' +
        'only for one hangs the caller instead of cancelling it',
    );
    assert.equal(answer, false);
  });

  it('still takes a piped "y"', async () => {
    const answer = await withStdin('y\n', () =>
      within(confirm('[test] Continue? (y/N)')),
    );
    assert.equal(
      answer,
      true,
      'piping the answer in is a legitimate way to script this and has no ' +
        'terminal either, so cancelling on EOF must not cancel on that',
    );
  });

  it('still takes a piped "n"', async () => {
    const answer = await withStdin('n\n', () =>
      within(confirm('[test] Continue? (y/N)')),
    );
    assert.equal(answer, false);
  });
});

describe('confirmFirstPush', () => {
  const counts = { modules: 2, pages: 5, assignments: 1, files: 0 };
  const never = () => {
    throw new Error('fetchCounts should not have been called');
  };

  it('never asks on a dry run', async () => {
    const ok = await confirmFirstPush({
      courseId: 1,
      syncData: { modules: {} },
      dryRun: true,
      fetchCounts: never,
    });
    assert.equal(ok, true);
  });

  it('never asks once the course is already tracked', async () => {
    const ok = await confirmFirstPush({
      courseId: 1,
      syncData: {
        modules: { '01-intro': { canvas_module_id: 42, items: {} } },
      },
      dryRun: false,
      fetchCounts: never,
    });
    assert.equal(ok, true);
  });

  it('proceeds when the Canvas course is empty', async () => {
    const ok = await confirmFirstPush({
      courseId: 1,
      syncData: { modules: {} },
      dryRun: false,
      fetchCounts: async () => ({
        modules: 0,
        pages: 0,
        assignments: 0,
        files: 0,
      }),
    });
    assert.equal(ok, true);
  });

  it('proceeds when the pre-flight check fails', async () => {
    const ok = await confirmFirstPush({
      courseId: 1,
      syncData: { modules: {} },
      dryRun: false,
      fetchCounts: async () => {
        throw new Error('network down');
      },
    });
    assert.equal(ok, true, 'a failed check must not block a legitimate push');
  });

  it('cancels when the answer is not "y"', async () => {
    const ok = await withStdin('n\n', () =>
      confirmFirstPush({
        courseId: 1,
        syncData: { modules: {} },
        dryRun: false,
        fetchCounts: async () => counts,
      }),
    );
    assert.equal(ok, false);
  });

  it('continues when the answer is "y"', async () => {
    const ok = await withStdin('y\n', () =>
      confirmFirstPush({
        courseId: 1,
        syncData: { modules: {} },
        dryRun: false,
        fetchCounts: async () => counts,
      }),
    );
    assert.equal(ok, true);
  });

  it('cancels, and says so, when a scripted run has no answer to give', async () => {
    const spy = mock.method(console, 'log', () => {});
    const ok = await withStdin('', () =>
      within(
        confirmFirstPush({
          courseId: 1,
          syncData: { modules: {} },
          dryRun: false,
          fetchCounts: async () => counts,
        }),
      ),
    );
    assert.notEqual(ok, HUNG, 'the question has to settle without a terminal');
    assert.equal(ok, false);
    assert.match(
      said(spy),
      /Cancelled/,
      'everything after the question used to be unreachable, this line first',
    );
  });
});

describe('confirmForcedPull', () => {
  // A prompt with no stdin behind it would hang, so any test that reaches one
  // without withStdin() would time out rather than pass by accident.
  it('does not ask on an ordinary pull', async () => {
    const ok = await confirmForcedPull({ force: false, guarded: 4 });
    assert.equal(ok, true);
  });

  it('does not ask when --force has nothing to force', async () => {
    const ok = await confirmForcedPull({ force: true, guarded: 0 });
    assert.equal(ok, true, 'a clean tree keeps --force scriptable');
  });

  it('never asks on a dry run', async () => {
    const ok = await confirmForcedPull({
      force: true,
      guarded: 3,
      dryRun: true,
    });
    assert.equal(ok, true, 'a preview must not stop for permission');
  });

  it('asks when --force is about to write over uncommitted work', async () => {
    const ok = await withStdin('y\n', () =>
      confirmForcedPull({ force: true, guarded: 1 }),
    );
    assert.equal(ok, true);
  });

  it('cancels when the answer is not "y"', async () => {
    const ok = await withStdin('n\n', () =>
      confirmForcedPull({ force: true, guarded: 1 }),
    );
    assert.equal(ok, false);
  });

  it('names the count, and the reason git could not answer', async () => {
    const spy = mock.method(console, 'log', () => {});
    await withStdin('n\n', () =>
      confirmForcedPull({
        force: true,
        guarded: 7,
        gitReason: 'course/ is not inside a git repository',
      }),
    );
    assert.match(
      said(spy),
      /not inside a git repository/,
      'the reason every file counts as dirty has to be in the question',
    );
    assert.match(said(spy), /7 local files/);
  });

  it('says a delete is at stake too when the run also prunes', async () => {
    const spy = mock.method(console, 'log', () => {});
    await withStdin('n\n', () =>
      confirmForcedPull({ force: true, guarded: 1, pruneLocal: true }),
    );
    assert.match(said(spy), /deleted where Canvas no longer/);
  });

  // -------------------------------------------------------------------------
  // A count of one
  //
  // The ordinary case, not the edge one: the count comes from git, and a tree
  // holding one uncommitted lesson is what most runs look like. The sentence
  // used to be written for the plural with the number swapped in, so it read
  // "1 local file hold uncommitted or untracked changes".
  // -------------------------------------------------------------------------

  it('reads as a singular sentence for one file', async () => {
    const spy = mock.method(console, 'log', () => {});
    await withStdin('n\n', () =>
      confirmForcedPull({ force: true, guarded: 1 }),
    );
    const text = said(spy);
    assert.match(text, /1 local file holds uncommitted or untracked changes/);
    assert.match(text, /and it is overwritten with the Canvas version/);
    assert.match(text, /Git has no copy of what is in it\./);
  });

  it('keeps the plural sentence plural', async () => {
    const spy = mock.method(console, 'log', () => {});
    await withStdin('n\n', () =>
      confirmForcedPull({ force: true, guarded: 2 }),
    );
    const text = said(spy);
    assert.match(text, /2 local files hold uncommitted or untracked changes/);
    assert.match(text, /and each is overwritten with the Canvas version/);
    assert.match(text, /Git has no copy of what is in them\./);
  });

  it('agrees in the branch where git could not answer either', async () => {
    const spy = mock.method(console, 'log', () => {});
    await withStdin('n\n', () =>
      confirmForcedPull({
        force: true,
        guarded: 1,
        gitReason: 'course/ is not inside a git repository',
      }),
    );
    const text = said(spy);
    assert.match(text, /so the 1 local file under course\/ counts as holding/);
    assert.match(text, /It is overwritten with the Canvas version\./);
    assert.doesNotMatch(text, /all 1 local file/);
  });

  it('agrees in the pronoun a prune adds, which is a third sentence', async () => {
    // `fate` is built once and dropped into whichever sentence runs, so it
    // inflects on its own: "deleted where Canvas no longer holds them" is the
    // same defect one clause further along.
    const spy = mock.method(console, 'log', () => {});
    await withStdin('n\n', () =>
      confirmForcedPull({ force: true, guarded: 1, pruneLocal: true }),
    );
    assert.match(said(spy), /deleted where Canvas no longer holds it\./);
  });
});

describe('BACKUP_DOC', () => {
  it('points at a guide that exists', () => {
    const fs = require('fs');
    const path = require('path');
    const doc = path.join(__dirname, '..', '..', BACKUP_DOC);
    assert.ok(fs.existsSync(doc), `Expected ${BACKUP_DOC} to exist`);
  });
});

/** Returned in place of a promise that never settled. */
const HUNG = Symbol('hung');

/**
 * Resolve to HUNG when `promise` has not settled shortly, so a question that
 * never answers fails the test that awaited it instead of hanging the run.
 *
 * A plain await would be worse than no test at all here: the suite would stop
 * dead on the first hung prompt, and `withStdin` would never reach its restore,
 * leaving every test after it running against a stdin that is not stdin.
 *
 * The timer is deliberately not unref'd. A hung prompt leaves nothing else
 * keeping the loop alive — that is the defect, a run that exits 0 with the
 * question still on screen — so an unref'd timer would let the process exit
 * before the test could fail.
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
 * readline prompt resolves without a terminal. An empty `input` is a stream
 * that ends without ever producing a line — what `< /dev/null`, a CI runner or
 * a piped command with nothing left to say hands a prompt.
 */
async function withStdin(input, fn) {
  const { Readable } = require('stream');
  const original = Object.getOwnPropertyDescriptor(process, 'stdin');
  const fake = Readable.from(input ? [input] : []);
  fake.isTTY = false;
  Object.defineProperty(process, 'stdin', {
    value: fake,
    configurable: true,
  });
  try {
    return await fn();
  } finally {
    Object.defineProperty(process, 'stdin', original);
  }
}
