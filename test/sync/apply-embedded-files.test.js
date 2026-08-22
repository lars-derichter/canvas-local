const { describe, it, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { mockCanvas, silence } = require('../helpers/canvas-mock');

process.env.CANVAS_API_URL = 'https://canvas.example.com';
process.env.CANVAS_API_TOKEN = 'test-token-123';

const { applyPlan } = require('../../lib/sync/apply');
const { COURSE_DIR } = require('../../cli/module-utils');

/**
 * Where the binary behind an embedded image ends up.
 *
 * `downloadReferencedFiles` used to resolve its destination against the
 * module-level `COURSE_DIR` constant, fixed at require time, while the engine
 * resolves everything else against the `courseDir` its caller handed it. A run
 * pointed anywhere else therefore wrote the markdown into one tree and the
 * binary it references into the working repo's `course/`: a wrapper pointing at
 * a `_files/` entry that is not beside it, and an already-downloaded check
 * looking in a tree the file was never in, so every run downloaded it again.
 *
 * Both halves are asserted here, and so is the thing that makes this file safe
 * to run at all: **nothing may be written under the repo's own `course/`.**
 * That assertion is explicit rather than implied by the first one, because its
 * job is to fail loudly the moment somebody reintroduces the constant.
 */

const COURSE_ID = 4242;
const FILE_ID = 777;
const BINARY = 'PNG-BYTES';
const EMBEDDED_PATH = '01-intro/_files/diagram.png';
const PAGE_BODY = `<p><img src="/courses/${COURSE_ID}/files/${FILE_ID}/preview" alt="Diagram"></p>`;

afterEach(() => mock.restoreAll());

function tempCourse() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'apply-embedded-test-'));
}

function stateWithModule() {
  return {
    schema_version: 4,
    canvas_base_url: 'https://canvas.example.com',
    course_id: COURSE_ID,
    last_sync: null,
    modules: {
      '01-intro': { canvas_module_id: 10, item_order: [], items: {} },
    },
    icons: {},
    files: {},
  };
}

/** The page the run writes locally, handed over the way `gatherCanvas` hands it. */
function pageContent() {
  return new Map([
    [
      '91',
      {
        item: { id: 91, type: 'Page', title: 'Welcome', indent: 0 },
        content: {
          page_id: 501,
          url: 'welcome',
          title: 'Welcome',
          body: PAGE_BODY,
          updated_at: '2026-08-20T11:00:00.000Z',
        },
      },
    ],
  ]);
}

function writeAction(type) {
  return {
    type,
    folder: '01-intro',
    itemPath: '01-intro/01-welcome.md',
    canvasModuleId: 10,
    moduleItemId: 91,
    canvasType: 'page',
    canvasId: 501,
    pageUrl: 'welcome',
    title: 'Welcome',
    indent: 0,
    position: 1,
    canvasHash: 'page-hash',
  };
}

/** The two metadata reads and the byte fetch one download costs. */
function downloadRoutes() {
  const meta = {
    id: FILE_ID,
    display_name: 'diagram.png',
    url: `https://files.example.com/blob/${FILE_ID}`,
  };
  return [
    { method: 'GET', path: `/api/v1/files/${FILE_ID}`, body: meta },
    { method: 'GET', path: `/api/v1/files/${FILE_ID}`, body: meta },
    { method: 'GET', path: `/blob/${FILE_ID}`, body: BINARY },
  ];
}

/** Every path under the repo's real `course/`, so a stray write shows up. */
function realCourseSnapshot() {
  return fs.readdirSync(COURSE_DIR, { recursive: true }).sort();
}

function run(actions, options) {
  return applyPlan(
    { actions },
    {
      courseId: COURSE_ID,
      save: () => {},
      now: () => '2026-08-20T12:00:00.000Z',
      canvasContent: pageContent(),
      ...options,
    },
  );
}

describe('embedded files land in the tree the run was pointed at', () => {
  it('downloads the binary under the run’s courseDir, never under the repo’s course/', async () => {
    silence();
    const courseDir = tempCourse();
    const state = stateWithModule();
    const before = realCourseSnapshot();
    mockCanvas(downloadRoutes());

    const outcome = await run([writeAction('create-local-item')], {
      courseDir,
      state,
    });

    assert.deepEqual(outcome.errors, []);

    // 1. The binary is beside the wrapper that names it.
    assert.equal(
      fs.readFileSync(path.join(courseDir, EMBEDDED_PATH), 'utf8'),
      BINARY,
    );
    const markdown = fs.readFileSync(
      path.join(courseDir, '01-intro/01-welcome.md'),
      'utf8',
    );
    assert.match(markdown, /\.\/_files\/diagram\.png/);

    // 2. Nothing at all reached the repo's own course/ — stated as its own
    //    assertion, not as a consequence of the first.
    assert.equal(
      fs.existsSync(path.join(COURSE_DIR, EMBEDDED_PATH)),
      false,
      'the destination under the repo’s real course/ must not exist',
    );
    assert.deepEqual(
      realCourseSnapshot(),
      before,
      'the repo’s real course/ must be byte-for-byte untouched',
    );

    // 3. The row points at the tree that holds the file.
    assert.equal(state.files[EMBEDDED_PATH].canvas_file_id, FILE_ID);
  });

  it('skips the download on a second run, because it looks in the tree it wrote', async () => {
    silence();
    const courseDir = tempCourse();
    const state = stateWithModule();
    mockCanvas(downloadRoutes());

    await run([writeAction('create-local-item')], { courseDir, state });

    // The half a single run cannot see: the skip-check resolves the recorded
    // path against the same tree, so the second run finds the file it wrote and
    // asks Canvas for nothing at all.
    mock.restoreAll();
    silence();
    const calls = mockCanvas([]);

    const outcome = await run([writeAction('update-local-item')], {
      courseDir,
      state,
    });

    assert.deepEqual(outcome.errors, []);
    assert.deepEqual(
      calls,
      [],
      'a file already in the tree must cost no request',
    );
    assert.equal(
      fs.readFileSync(path.join(courseDir, EMBEDDED_PATH), 'utf8'),
      BINARY,
    );
  });

  it('refuses to download anything when no course directory was given', async () => {
    silence();
    const { downloadReferencedFiles } = require('../../lib/sync/local-write');
    await assert.rejects(
      () =>
        downloadReferencedFiles(
          COURSE_ID,
          PAGE_BODY,
          '01-intro',
          stateWithModule(),
          new Map(),
        ),
      /no course directory/,
    );
  });
});

// ---------------------------------------------------------------------------
// The git guard on an embedded download
// ---------------------------------------------------------------------------

/**
 * What stops a download landing on bytes git holds no copy of.
 *
 * The destination is the Canvas file's `display_name` joined to the module's
 * `_files/`, so an author's own `diagram.png` and a Canvas file called
 * `diagram.png` are the same path — and the Canvas one wins by simply being
 * written over it. Git is the undo for everything this tool writes; an
 * untracked image is precisely the case where the local copy is the only copy,
 * and `_files/` is where those live.
 *
 * The planner cannot make this call: the destination is not known until Canvas
 * has answered `GET /files/:id` with a `display_name`, and the planner never
 * touches the network. So the git answer the run already gathered is threaded
 * through to the executor, and the refusal is shaped like `guardDirty` — a
 * `skipped` entry with a reason and a remedy, not a failed run.
 *
 * The fence that matters most is the last two: a clean tree still downloads,
 * and a destination that does not exist yet is never guarded. A guard that
 * quietly turned embedded images off would pass every test above it.
 */

const AUTHOR_BYTES = 'MY-OWN-DIAGRAM';

const CLEAN = { available: true, paths: new Set(), reason: null };
const NO_GIT = {
  available: false,
  paths: new Set(),
  reason: 'the tree is not inside a git repository',
};
/** What `gitDirtyPaths` returns for a dirty `_files/` binary: ancestors too. */
const DIRTY_BINARY = {
  available: true,
  paths: new Set(['01-intro', '01-intro/_files', EMBEDDED_PATH]),
  reason: null,
};

/** A course tree that already holds the author's own file at the collision. */
function courseHolding(bytes) {
  const courseDir = tempCourse();
  const destination = path.join(courseDir, EMBEDDED_PATH);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, bytes, 'utf8');
  return courseDir;
}

/** Whether the run went past the metadata read to fetch the bytes. */
function fetchedBytes(calls) {
  return calls.some((call) => call.url.includes(`/blob/${FILE_ID}`));
}

describe('an embedded download onto uncommitted work', () => {
  it('leaves an untracked binary alone, and reports the download it did not make', async () => {
    silence();
    const courseDir = courseHolding(AUTHOR_BYTES);
    const state = stateWithModule();
    const calls = mockCanvas(downloadRoutes());

    const outcome = await run([writeAction('create-local-item')], {
      courseDir,
      state,
      gitDirty: DIRTY_BINARY,
    });

    assert.deepEqual(outcome.errors, []);
    assert.equal(
      fs.readFileSync(path.join(courseDir, EMBEDDED_PATH), 'utf8'),
      AUTHOR_BYTES,
      'the only copy of the author’s bytes must survive',
    );
    assert.equal(fetchedBytes(calls), false, 'no bytes may be pulled down');

    // Shaped like `guardDirty`: the run does not fail, it says what it would
    // not do and how to let it.
    assert.equal(outcome.skipped.length, 1);
    assert.equal(outcome.skipped[0].reason, 'git-dirty');
    assert.equal(outcome.skipped[0].itemPath, EMBEDDED_PATH);
    assert.match(outcome.skipped[0].remedy, /Commit or stash/);

    // No row: it would claim a Canvas file id and a hash for bytes this run
    // never wrote, and the next run's already-downloaded check would then find
    // the author's file sitting there and skip the download for ever.
    assert.deepEqual(Object.keys(state.files), []);

    // And the page keeps the Canvas URL rather than a relative link to a
    // binary that is not the one Canvas is showing.
    const markdown = fs.readFileSync(
      path.join(courseDir, '01-intro/01-welcome.md'),
      'utf8',
    );
    assert.match(markdown, /\/courses\/4242\/files\/777\/preview/);
    assert.doesNotMatch(markdown, /\.\/_files\/diagram\.png/);
  });

  it('leaves a modified binary alone too', async () => {
    silence();
    // Git spells untracked `??` and modified ` M`; `gitDirtyPaths` collapses
    // both into the same set, and so does the guard. Committed-then-edited
    // bytes are no more recoverable than never-committed ones.
    const courseDir = courseHolding('EDITED-SINCE-COMMIT');
    const state = stateWithModule();
    const calls = mockCanvas(downloadRoutes());

    const outcome = await run([writeAction('update-local-item')], {
      courseDir,
      state,
      gitDirty: DIRTY_BINARY,
    });

    assert.deepEqual(outcome.errors, []);
    assert.equal(
      fs.readFileSync(path.join(courseDir, EMBEDDED_PATH), 'utf8'),
      'EDITED-SINCE-COMMIT',
    );
    assert.equal(fetchedBytes(calls), false);
    assert.equal(outcome.skipped.length, 1);
  });

  it('downloads into a clean tree, so the guard has not turned the feature off', async () => {
    silence();
    const courseDir = tempCourse();
    const state = stateWithModule();
    mockCanvas(downloadRoutes());

    const outcome = await run([writeAction('create-local-item')], {
      courseDir,
      state,
      gitDirty: CLEAN,
    });

    assert.deepEqual(outcome.errors, []);
    assert.deepEqual(outcome.skipped, []);
    assert.equal(
      fs.readFileSync(path.join(courseDir, EMBEDDED_PATH), 'utf8'),
      BINARY,
    );
    assert.equal(state.files[EMBEDDED_PATH].canvas_file_id, FILE_ID);
  });

  it('writes over a committed binary, because git can put that one back', async () => {
    silence();
    // The guard is about what git cannot restore, not about `_files/` being
    // special. A tracked file with no uncommitted changes is one `git checkout`
    // away, so Canvas wins it exactly as it wins a tracked markdown file.
    const courseDir = courseHolding('LAST-YEARS-DIAGRAM');
    const state = stateWithModule();
    mockCanvas(downloadRoutes());

    const outcome = await run([writeAction('update-local-item')], {
      courseDir,
      state,
      gitDirty: CLEAN,
    });

    assert.deepEqual(outcome.skipped, []);
    assert.equal(
      fs.readFileSync(path.join(courseDir, EMBEDDED_PATH), 'utf8'),
      BINARY,
    );
  });

  it('treats a binary already on disk as dirty when git cannot answer', async () => {
    silence();
    const courseDir = courseHolding(AUTHOR_BYTES);
    const state = stateWithModule();
    const calls = mockCanvas(downloadRoutes());

    const outcome = await run([writeAction('update-local-item')], {
      courseDir,
      state,
      gitDirty: NO_GIT,
    });

    assert.equal(fetchedBytes(calls), false);
    assert.equal(outcome.skipped.length, 1);
    assert.equal(
      fs.readFileSync(path.join(courseDir, EMBEDDED_PATH), 'utf8'),
      AUTHOR_BYTES,
    );
  });

  it('protects what is on disk when no git answer was handed in at all', async () => {
    silence();
    // The default is the refusal, not the write. A caller that forgets to pass
    // the git answer must not be the one place in the engine where the guard is
    // quietly off.
    const courseDir = courseHolding(AUTHOR_BYTES);
    const state = stateWithModule();
    const calls = mockCanvas(downloadRoutes());

    const outcome = await run([writeAction('update-local-item')], {
      courseDir,
      state,
    });

    assert.equal(fetchedBytes(calls), false);
    assert.equal(outcome.skipped.length, 1);
    assert.equal(
      fs.readFileSync(path.join(courseDir, EMBEDDED_PATH), 'utf8'),
      AUTHOR_BYTES,
    );
  });

  it('still downloads a file that is not there at all when git cannot answer', async () => {
    silence();
    // "I cannot tell" is a reason to protect what exists, and nothing more.
    // Refusing to create a file that is not there destroys nothing and would
    // disable embedded images entirely outside a checkout — which is also the
    // default `applyPlan` falls back to when no git answer is handed in.
    const courseDir = tempCourse();
    const state = stateWithModule();
    mockCanvas(downloadRoutes());

    const outcome = await run([writeAction('create-local-item')], {
      courseDir,
      state,
      gitDirty: NO_GIT,
    });

    assert.deepEqual(outcome.skipped, []);
    assert.equal(
      fs.readFileSync(path.join(courseDir, EMBEDDED_PATH), 'utf8'),
      BINARY,
    );
  });
});

// ---------------------------------------------------------------------------
// What the binary is called on disk
// ---------------------------------------------------------------------------

/**
 * One Canvas file, one local name, whichever route reaches it.
 *
 * A Canvas file can arrive here two ways: embedded in a page's HTML, which is
 * this module's `downloadReferencedFiles`, or as a `file` module item, which is
 * `writeLocalFileItem` in `lib/sync/apply.js`. The second slugs Canvas's
 * `display_name` and the first took it raw, so a file reachable both ways
 * landed twice under two names — `Week 1 Handout.PDF` beside
 * `week-1-handout.pdf`, each with its own row.
 *
 * The slug is the one to keep: every other path this tool writes is lowercase
 * and hyphenated, and `toFileSlug` returns a name that already follows that
 * convention unchanged, so nothing that was already right moves.
 */

const RAW_NAME = 'Week 1 Handout.PDF';
const SLUGGED = '01-intro/_files/week-1-handout.pdf';
const AWKWARD_ID = 778;

function awkwardRoutes() {
  const meta = {
    id: AWKWARD_ID,
    display_name: RAW_NAME,
    url: `https://files.example.com/blob/${AWKWARD_ID}`,
  };
  return [
    { method: 'GET', path: `/api/v1/files/${AWKWARD_ID}`, body: meta },
    { method: 'GET', path: `/api/v1/files/${AWKWARD_ID}`, body: meta },
    { method: 'GET', path: `/blob/${AWKWARD_ID}`, body: BINARY },
  ];
}

/** The same page, embedding the awkwardly named file instead. */
function awkwardPageContent() {
  return new Map([
    [
      '91',
      {
        item: { id: 91, type: 'Page', title: 'Welcome', indent: 0 },
        content: {
          page_id: 501,
          url: 'welcome',
          title: 'Welcome',
          body: `<p><img src="/courses/${COURSE_ID}/files/${AWKWARD_ID}/preview"></p>`,
          updated_at: '2026-08-20T11:00:00.000Z',
        },
      },
    ],
  ]);
}

describe('an embedded binary takes the same name as a file item would', () => {
  it('slugs the Canvas display_name rather than writing it raw', async () => {
    silence();
    const courseDir = tempCourse();
    const state = stateWithModule();
    mockCanvas(awkwardRoutes());

    const outcome = await run([writeAction('create-local-item')], {
      courseDir,
      state,
      gitDirty: CLEAN,
      canvasContent: awkwardPageContent(),
    });

    assert.deepEqual(outcome.errors, []);
    assert.deepEqual(fs.readdirSync(path.join(courseDir, '01-intro/_files')), [
      'week-1-handout.pdf',
    ]);
    assert.equal(state.files[SLUGGED].canvas_file_id, AWKWARD_ID);

    // The page points at the name that is really there.
    const markdown = fs.readFileSync(
      path.join(courseDir, '01-intro/01-welcome.md'),
      'utf8',
    );
    assert.match(markdown, /\.\/_files\/week-1-handout\.pdf/);
  });

  it('renames nothing in a course that already holds the raw name', async () => {
    // The migration question, and the answer is that there is none. A file the
    // state already tracks and that is on disk short-circuits before the
    // metadata read, so an existing course keeps the names and the rows it has;
    // only a file being downloaded for the first time takes the new one.
    silence();
    const courseDir = tempCourse();
    const raw = `01-intro/_files/${RAW_NAME}`;
    fs.mkdirSync(path.join(courseDir, '01-intro/_files'), { recursive: true });
    fs.writeFileSync(path.join(courseDir, raw), BINARY, 'utf8');

    const state = stateWithModule();
    state.files[raw] = {
      canvas_file_id: AWKWARD_ID,
      canvas_url: `/courses/${COURSE_ID}/files/${AWKWARD_ID}/preview`,
      sha256: 'recorded-by-an-earlier-run',
    };
    const calls = mockCanvas([]);

    const outcome = await run([writeAction('update-local-item')], {
      courseDir,
      state,
      gitDirty: CLEAN,
      canvasContent: awkwardPageContent(),
    });

    assert.deepEqual(outcome.errors, []);
    assert.deepEqual(calls, [], 'a tracked file on disk costs no request');
    assert.deepEqual(fs.readdirSync(path.join(courseDir, '01-intro/_files')), [
      RAW_NAME,
    ]);
    assert.deepEqual(Object.keys(state.files), [raw]);
  });
});

// ---------------------------------------------------------------------------
// Deleting an embedded binary nothing points at any more
// ---------------------------------------------------------------------------

/**
 * What `delete-canvas-file` does, and — mostly — what it refuses to do.
 *
 * The planner has already proved the hard part: it read every markdown item in
 * `course/` and none of them names this row's path
 * (`planEmbeddedFileOrphans` in `lib/sync/plan.js`). What is left here is a
 * delete nobody typed the file's name into, so the executor asks Canvas one
 * question first — is this still the file the row describes — and it holds to
 * one rule throughout: **the row is never dropped while the file it names is
 * still there.** The row is the only record that the file exists, so a row
 * dropped without its file strands that file for good.
 *
 * The route table is the assertion, as in `apply-file-items.test.js`: a call
 * the code should not make finds no route and fails the action rather than
 * passing quietly.
 */

const ORPHAN_REF = '01-intro/_files/logo.png';
const ORPHAN_ID = 500;

/** A state whose only embedded row is the orphan, plus whatever else is given. */
function stateWithOrphan(extra = {}) {
  const state = stateWithModule();
  state.files[ORPHAN_REF] = {
    canvas_file_id: ORPHAN_ID,
    canvas_url: `/courses/${COURSE_ID}/files/${ORPHAN_ID}/preview`,
    sha256: 'abc123',
  };
  return { ...state, ...extra };
}

function sweepAction(ref = ORPHAN_REF) {
  return {
    type: 'delete-canvas-file',
    itemPath: ref,
    canvasFileId: ORPHAN_ID,
    title: path.posix.basename(ref),
  };
}

/** Every DELETE aimed at a Canvas file, which is the number under test. */
function fileDeletes(calls) {
  return calls.filter(
    (call) =>
      call.method === 'DELETE' && /\/api\/v1\/files\/\d+/.test(call.url),
  );
}

describe('an embedded binary nothing points at any more', () => {
  it('deletes the Canvas file and drops the row with it', async () => {
    silence();
    const state = stateWithOrphan();
    const calls = mockCanvas([
      {
        method: 'GET',
        path: `/api/v1/files/${ORPHAN_ID}`,
        body: { id: ORPHAN_ID, display_name: 'logo.png' },
      },
      { method: 'DELETE', path: `/api/v1/files/${ORPHAN_ID}`, body: {} },
    ]);

    const outcome = await run([sweepAction()], {
      courseDir: tempCourse(),
      state,
    });

    assert.deepEqual(outcome.errors, []);
    assert.equal(fileDeletes(calls).length, 1);
    assert.deepEqual(Object.keys(state.files), []);
  });

  it('leaves a file Canvas calls something else alone, and keeps its row', async () => {
    silence();
    // The caution `46906ee` insisted on, pointed the other way. There it proved
    // a file had been orphaned; here it proves nobody has taken it over. An
    // upload goes up under the local basename, so a Canvas file wearing a
    // different name is one somebody renamed by hand — and the row stays too,
    // so the next run asks again instead of forgetting the question exists.
    const state = stateWithOrphan();
    const calls = mockCanvas([
      {
        method: 'GET',
        path: `/api/v1/files/${ORPHAN_ID}`,
        body: { id: ORPHAN_ID, display_name: 'course-logo-final.png' },
      },
    ]);

    const outcome = await run([sweepAction()], {
      courseDir: tempCourse(),
      state,
    });

    assert.deepEqual(outcome.errors, []);
    assert.deepEqual(fileDeletes(calls), [], 'a renamed file must survive');
    assert.deepEqual(Object.keys(state.files), [ORPHAN_REF]);
  });

  it('keeps the file but drops the row when something else names it', async () => {
    silence();
    // A second row, an alert icon or a `file` item can carry the same id, and
    // the file is reachable through that one. Only this row's dead bookkeeping
    // goes: nothing is stranded, because the holder is still pointing at it.
    const state = stateWithOrphan();
    state.icons.note = {
      canvas_file_id: ORPHAN_ID,
      preview_url: 'https://canvas.example.com/icons/note',
      theme: 'whatever',
    };
    const calls = mockCanvas([
      {
        method: 'GET',
        path: `/api/v1/files/${ORPHAN_ID}`,
        body: { id: ORPHAN_ID, display_name: 'logo.png' },
      },
    ]);

    const outcome = await run([sweepAction()], {
      courseDir: tempCourse(),
      state,
    });

    assert.deepEqual(outcome.errors, []);
    assert.deepEqual(fileDeletes(calls), []);
    assert.deepEqual(Object.keys(state.files), []);
  });

  it('drops the row when Canvas no longer holds the file', async () => {
    silence();
    const state = stateWithOrphan();
    const calls = mockCanvas([
      {
        method: 'GET',
        path: `/api/v1/files/${ORPHAN_ID}`,
        body: { message: 'not found' },
        status: 404,
      },
    ]);

    const outcome = await run([sweepAction()], {
      courseDir: tempCourse(),
      state,
    });

    assert.deepEqual(outcome.errors, []);
    assert.deepEqual(fileDeletes(calls), []);
    assert.deepEqual(
      Object.keys(state.files),
      [],
      'a row for a file that is gone would be reported for ever',
    );
  });

  it('keeps the row when the delete fails, so the file is not stranded', async () => {
    silence();
    const state = stateWithOrphan();
    mockCanvas([
      {
        method: 'GET',
        path: `/api/v1/files/${ORPHAN_ID}`,
        body: { id: ORPHAN_ID, display_name: 'logo.png' },
      },
      {
        method: 'DELETE',
        path: `/api/v1/files/${ORPHAN_ID}`,
        body: { message: 'forbidden' },
        status: 403,
      },
    ]);

    const outcome = await run([sweepAction()], {
      courseDir: tempCourse(),
      state,
    });

    assert.equal(outcome.errors.length, 1, 'the failure must reach the report');
    assert.equal(outcome.errors[0].action.type, 'delete-canvas-file');
    assert.deepEqual(
      Object.keys(state.files),
      [ORPHAN_REF],
      'the row is the only thing that knows the file is still there',
    );
  });

  it('does nothing at all on a second run', async () => {
    silence();
    const state = stateWithOrphan();
    mockCanvas([
      {
        method: 'GET',
        path: `/api/v1/files/${ORPHAN_ID}`,
        body: { id: ORPHAN_ID, display_name: 'logo.png' },
      },
      { method: 'DELETE', path: `/api/v1/files/${ORPHAN_ID}`, body: {} },
    ]);
    await run([sweepAction()], { courseDir: tempCourse(), state });

    // The row is gone, so a replayed action costs no request whatsoever — not
    // even the metadata read that would otherwise precede the refusal.
    mock.restoreAll();
    silence();
    const calls = mockCanvas([]);
    const outcome = await run([sweepAction()], {
      courseDir: tempCourse(),
      state,
    });

    assert.deepEqual(outcome.errors, []);
    assert.deepEqual(calls, [], 'a swept row must cost nothing to re-sweep');
  });
});
