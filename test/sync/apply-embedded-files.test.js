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
