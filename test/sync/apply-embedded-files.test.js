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
