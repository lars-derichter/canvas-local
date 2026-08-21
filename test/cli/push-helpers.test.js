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
  _warnGradeImpact: warnGradeImpact,
  _collectUpdatedAssignments: collectUpdatedAssignments,
} = push;

// ---------------------------------------------------------------------------
// The grades an assignment update moves
// ---------------------------------------------------------------------------

const gradeTrees = [];

/** Both suites below build trees through `planned`, and both clear them here. */
function cleanUpGradeTrees() {
  mock.restoreAll();
  while (gradeTrees.length) {
    fs.rmSync(gradeTrees.pop(), { recursive: true, force: true });
  }
}

/**
 * A course tree and the plan over it, which is the pair the check reads: the
 * plan says which assignments this run updates, the file says what will be
 * sent for each one.
 *
 * Each entry becomes one action and one markdown file. `type` and `canvasType`
 * default to the case that matters — an assignment being updated — so a test
 * that cares about another one names it.
 */
function planned(entries) {
  const courseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'push-grades-'));
  gradeTrees.push(courseDir);

  const actions = entries.map((entry) => {
    const itemPath = entry.itemPath || '01-mod/03-homework.md';
    const title = entry.title || 'Homework';
    const canvasType = entry.canvasType || 'assignment';
    const full = path.join(courseDir, itemPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(
      full,
      serializeFrontmatter(
        { title, canvas_type: canvasType, ...(entry.frontmatter || {}) },
        '',
      ),
      'utf8',
    );
    return {
      type: entry.type || 'update-canvas-item',
      folder: itemPath.split('/')[0],
      itemPath,
      title,
      canvasType,
      canvasId: entry.canvasId ?? null,
    };
  });

  return { courseDir, report: { actions } };
}

/** `collectUpdatedAssignments` over the plan these entries describe. */
function collectFor(entries) {
  const { courseDir, report } = planned(entries);
  return collectUpdatedAssignments(report, { courseDir });
}

/** `warnGradeImpact` over the plan these entries describe. */
function warnFor(entries, fetchAssignments) {
  const { courseDir, report } = planned(entries);
  return warnGradeImpact(42, report, { courseDir, fetchAssignments });
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

describe('collectUpdatedAssignments', () => {
  afterEach(cleanUpGradeTrees);

  it('collects the assignments the plan updates, and nothing else', () => {
    const updated = collectFor([
      { canvasId: 500, frontmatter: { points_possible: 10 } },
      // Brand new on Canvas, so it can hold no student work yet.
      {
        type: 'create-canvas-item',
        itemPath: '01-mod/04-new.md',
        title: 'New',
        frontmatter: { points_possible: 20 },
      },
      // The right verb, the wrong type.
      {
        itemPath: '01-mod/01-intro.md',
        title: 'Intro',
        canvasType: 'page',
        canvasId: 700,
      },
    ]);

    assert.equal(updated.length, 1);
    assert.equal(updated[0].canvasId, 500);
    assert.equal(updated[0].relativePath, '01-mod/03-homework.md');
  });

  it('carries the options push itself would send', () => {
    const [entry] = collectFor([
      {
        canvasId: 500,
        frontmatter: {
          points_possible: 12,
          due_at: '2026-03-08T23:59:00Z',
          submission_types: ['online_url'],
        },
      },
    ]);

    assert.equal(entry.opts.pointsPossible, 12);
    assert.equal(entry.opts.dueAt, '2026-03-08T23:59:00Z');
    assert.deepEqual(entry.opts.submissionTypes, ['online_url']);
  });

  it('leaves an update the plan gave no Canvas id alone', () => {
    // An adoption fills the id in from the Canvas side, so a null one means
    // there is no Canvas object to have collected submissions.
    assert.deepEqual(
      collectFor([{ frontmatter: { points_possible: 12 } }]),
      [],
    );
  });

  it('reads an item in a subfolder like any other', () => {
    const updated = collectFor([
      {
        canvasId: 501,
        itemPath: '01-mod/week-1/03-homework.md',
        frontmatter: { points_possible: 12 },
      },
    ]);

    assert.equal(updated.length, 1);
    assert.equal(updated[0].canvasId, 501);
  });
});

describe('warnGradeImpact', () => {
  afterEach(cleanUpGradeTrees);

  /** Silence the warnings the helper logs on its way out. */
  function quiet() {
    mock.method(console, 'warn', () => {});
  }

  it('warns that a new denominator leaves the grades already given unscaled', async () => {
    quiet();
    const lines = await warnFor(
      [{ canvasId: 500, frontmatter: { points_possible: 12 } }],
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
    const lines = await warnFor(
      [{ canvasId: 500, frontmatter: { points_possible: 10 } }],
      async () => [canvasAssignment()],
    );

    assert.deepEqual(lines, []);
  });

  it('warns that a new due date re-runs the late policy', async () => {
    quiet();
    const lines = await warnFor(
      [{ canvasId: 500, frontmatter: { due_at: '2026-03-08T23:59:00Z' } }],
      async () => [canvasAssignment()],
    );

    assert.equal(lines.length, 1);
    assert.match(lines[0], /changes due_at from 2026-03-01T23:59:00Z to /);
    assert.match(lines[0], /2026-03-08T23:59:00/);
    assert.match(lines[0], /recomputes late status/);
  });

  it('reads a due date as an instant, not as a string', async () => {
    quiet();
    const lines = await warnFor(
      [{ canvasId: 500, frontmatter: { due_at: '2026-03-02T00:59:00+01:00' } }],
      async () => [canvasAssignment()],
    );

    assert.deepEqual(lines, [], 'the same moment, written differently');
  });

  it('warns that Canvas ignores a submission type change once work is in', async () => {
    quiet();
    const lines = await warnFor(
      [
        {
          canvasId: 500,
          frontmatter: { submission_types: ['online_text_entry'] },
        },
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
    const lines = await warnFor(
      [
        {
          canvasId: 500,
          frontmatter: {
            points_possible: 12,
            due_at: '2026-03-08T23:59:00Z',
            submission_types: ['online_text_entry'],
          },
        },
      ],
      async () => [canvasAssignment({ has_submitted_submissions: false })],
    );

    assert.deepEqual(lines, []);
  });

  it('hedges when the submission state could not be read', async () => {
    quiet();
    const lines = await warnFor(
      [{ canvasId: 500, frontmatter: { points_possible: 12 } }],
      async () => [canvasAssignment({ has_submitted_submissions: undefined })],
    );

    assert.equal(lines.length, 1);
    assert.match(lines[0], /could not determine whether/);
    assert.match(lines[0], /Treat it as if it does/);
  });

  it('warns once per changed field', async () => {
    quiet();
    const lines = await warnFor(
      [
        {
          canvasId: 500,
          frontmatter: {
            points_possible: 12,
            due_at: '2026-03-08T23:59:00Z',
            submission_types: ['online_text_entry'],
          },
        },
      ],
      async () => [canvasAssignment()],
    );

    assert.equal(lines.length, 3);
  });

  it('looks the whole course up once however many assignments are pushed', async () => {
    quiet();
    let calls = 0;
    const lines = await warnFor(
      [
        { canvasId: 500, frontmatter: { points_possible: 12 } },
        {
          canvasId: 501,
          itemPath: '01-mod/04-second.md',
          title: 'Second',
          frontmatter: { points_possible: 12 },
        },
        {
          canvasId: 502,
          itemPath: '02-mod/03-third.md',
          title: 'Third',
          frontmatter: { points_possible: 12 },
        },
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

  it('makes no request when the run creates every assignment it touches', async () => {
    quiet();
    const lines = await warnFor(
      [
        {
          type: 'create-canvas-item',
          frontmatter: { points_possible: 12 },
        },
        {
          itemPath: '01-mod/01-intro.md',
          title: 'Intro',
          canvasType: 'page',
          canvasId: 700,
        },
      ],
      async () => {
        throw new Error('the assignment lookup should not have run');
      },
    );

    assert.deepEqual(lines, []);
  });

  it('leaves an assignment Canvas no longer lists alone', async () => {
    quiet();
    const lines = await warnFor(
      [{ canvasId: 999, frontmatter: { points_possible: 12 } }],
      async () => [canvasAssignment()],
    );

    assert.deepEqual(lines, []);
  });

  it('degrades to a warning when the lookup fails, and lets the push run', async () => {
    const warned = mock.method(console, 'warn', () => {});
    const lines = await warnFor(
      [{ canvasId: 500, frontmatter: { points_possible: 12 } }],
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
