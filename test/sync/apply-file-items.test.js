const { describe, it, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { mockCanvas, silence } = require('../helpers/canvas-mock');

process.env.CANVAS_API_URL = 'https://canvas.example.com';
process.env.CANVAS_API_TOKEN = 'test-token-123';

const { applyPlan } = require('../../lib/sync/apply');
const { gatherLocal } = require('../../lib/sync/gather');
const { hashLocalFile } = require('../../lib/sync/fingerprint');

/**
 * What a `file` item does to the Canvas file behind it.
 *
 * Canvas keys an upload on the filename, so renaming a binary lands it as a new
 * Canvas file and leaves the previous one in the course Files area with nothing
 * pointing at it. Deleting that one is the only cleanup this tool does without
 * a flag, which is why the tests below spend more effort on the cases that must
 * *not* delete than on the one that must.
 *
 * The mock's route table is the assertion: a route is spliced out once it
 * matches, so a call the code should not make finds no route and fails the
 * action instead of passing quietly. Every test here also counts the DELETEs
 * that reached `/api/v1/files/`, because "one" and "none" are the whole
 * behaviour.
 */

const COURSE_ID = 4242;
const MODULE_ID = 10;
const MODULE_ITEM_ID = 91;
const OLD_FILE_ID = 770;
const NEW_FILE_ID = 771;
const WRAPPER = '01-intro/03-syllabus.md';

/** Every path clean, which is what lets `gatherLocal` answer at all. */
const CLEAN = { available: true, paths: new Set(), reason: null };

afterEach(() => mock.restoreAll());

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A module holding one file item: a markdown wrapper and the binary it names. */
function tempCourse(binaryName = 'handbook.pdf') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apply-file-test-'));
  fs.mkdirSync(path.join(dir, '01-intro/_files'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '01-intro/_category_.json'),
    '{ "label": "Intro", "position": 1 }\n',
    'utf8',
  );
  fs.writeFileSync(
    path.join(dir, '01-intro/03-syllabus.md'),
    `---\ntitle: Syllabus\ncanvas_type: file\nfile_ref: _files/${binaryName}\n---\n`,
    'utf8',
  );
  fs.writeFileSync(
    path.join(dir, `01-intro/_files/${binaryName}`),
    'PDF-BYTES',
    'utf8',
  );
  return dir;
}

/** The state a previous sync left: the item points at the old Canvas file. */
function stateWithFileItem() {
  return {
    schema_version: 4,
    canvas_base_url: 'https://canvas.example.com',
    course_id: COURSE_ID,
    last_sync: '2026-08-19T10:00:00.000Z',
    modules: {
      '01-intro': {
        canvas_module_id: MODULE_ID,
        name: 'Intro',
        position: 1,
        item_order: ['01-intro/03-syllabus.md'],
        items: {
          '01-intro/03-syllabus.md': {
            canvas_type: 'file',
            canvas_id: OLD_FILE_ID,
            module_item_id: MODULE_ITEM_ID,
            title: 'Syllabus',
            local_hash: 'stale',
            canvas_hash: 'stale',
            synced_at: '2026-08-19T10:00:00.000Z',
          },
        },
      },
    },
    icons: {},
    files: {},
  };
}

function updateAction() {
  return {
    type: 'update-canvas-item',
    folder: '01-intro',
    canvasModuleId: MODULE_ID,
    itemPath: '01-intro/03-syllabus.md',
    title: 'Syllabus',
    canvasType: 'file',
    canvasId: OLD_FILE_ID,
    pageUrl: null,
    moduleItemId: MODULE_ITEM_ID,
    indent: 0,
  };
}

/** The two hops an upload takes: the grant, then the form post it points at. */
function uploadRoutes(fileId, displayName) {
  return [
    {
      method: 'POST',
      path: `/api/v1/courses/${COURSE_ID}/files`,
      body: {
        upload_url: 'https://canvas.example.com/upload/binary',
        upload_params: {},
      },
    },
    {
      method: 'POST',
      path: '/upload/binary',
      body: { id: fileId, display_name: displayName, size: 9 },
    },
  ];
}

/** What a new Canvas file costs the module item, which cannot be repointed. */
function recreateItemRoutes() {
  return [
    {
      method: 'DELETE',
      path: `/modules/${MODULE_ID}/items/${MODULE_ITEM_ID}`,
      body: {},
    },
    {
      method: 'POST',
      path: `/modules/${MODULE_ID}/items`,
      body: { id: 92, title: 'Syllabus', indent: 0 },
    },
  ];
}

function run(actions, options) {
  return applyPlan(
    { actions },
    {
      courseId: COURSE_ID,
      save: () => {},
      now: () => '2026-08-22T12:00:00.000Z',
      ...options,
    },
  );
}

/** Every DELETE aimed at a Canvas file, which is the number under test. */
function fileDeletes(calls) {
  return calls.filter(
    (call) =>
      call.method === 'DELETE' && /\/api\/v1\/files\/\d+/.test(call.url),
  );
}

/** Every read of a Canvas file's metadata. */
function fileReads(calls) {
  return calls.filter(
    (call) => call.method === 'GET' && /\/api\/v1\/files\/\d+/.test(call.url),
  );
}

// ---------------------------------------------------------------------------

describe('the local fingerprint a push records for a wrapper', () => {
  it('is the one gather computes, and it covers the binary', async () => {
    silence();
    // Two claims in one test because either alone is satisfied by the defect.
    // The sides *agreeing* is what stops the item being pushed again on every
    // run for ever (`lib/sync/fingerprint.js:1-25`); the hash covering the
    // binary is what makes an edited PDF reach Canvas at all. Before the fix
    // both sides agreed on a hash of the wrapper's text, so agreement held and
    // the edit was invisible.
    const courseDir = tempCourse();
    const state = stateWithFileItem();
    mockCanvas([
      ...uploadRoutes(OLD_FILE_ID, 'handbook.pdf'),
      {
        method: 'PUT',
        path: `/modules/${MODULE_ID}/items/${MODULE_ITEM_ID}`,
        body: { id: MODULE_ITEM_ID, title: 'Syllabus', indent: 0 },
      },
    ]);

    const outcome = await run([updateAction()], { courseDir, state });
    assert.deepEqual(outcome.errors, []);

    const recorded = state.modules['01-intro'].items[WRAPPER].local_hash;
    const { modules } = gatherLocal({ courseDir, gitDirty: CLEAN });
    const gathered = modules
      .flatMap((mod) => mod.items)
      .find((item) => item.itemPath === WRAPPER);

    assert.equal(
      recorded,
      gathered.localHash,
      'apply and gather must fingerprint the same wrapper identically',
    );
    assert.notEqual(
      recorded,
      hashLocalFile(path.join(courseDir, WRAPPER)),
      'the wrapper’s text alone is not a fingerprint of the file it stands for',
    );
  });
});

describe('a renamed binary leaves no orphan behind', () => {
  it('deletes the previous Canvas file, exactly once', async () => {
    silence();
    const courseDir = tempCourse();
    const state = stateWithFileItem();
    const calls = mockCanvas([
      ...uploadRoutes(NEW_FILE_ID, 'handbook.pdf'),
      ...recreateItemRoutes(),
      {
        method: 'GET',
        path: `/api/v1/files/${OLD_FILE_ID}`,
        body: { id: OLD_FILE_ID, display_name: 'syllabus.pdf' },
      },
      { method: 'DELETE', path: `/api/v1/files/${OLD_FILE_ID}`, body: {} },
    ]);

    const outcome = await run([updateAction()], { courseDir, state });

    assert.deepEqual(outcome.errors, []);
    const deletes = fileDeletes(calls);
    assert.equal(deletes.length, 1, 'the orphan must be deleted once');
    assert.match(deletes[0].url, new RegExp(`/api/v1/files/${OLD_FILE_ID}$`));

    // The row names the file that now exists, not the one just deleted.
    assert.equal(
      state.modules['01-intro'].items['01-intro/03-syllabus.md'].canvas_id,
      NEW_FILE_ID,
    );
  });

  it('carries on when the delete fails, rather than failing the run', async () => {
    silence();
    const courseDir = tempCourse();
    const state = stateWithFileItem();
    const calls = mockCanvas([
      ...uploadRoutes(NEW_FILE_ID, 'handbook.pdf'),
      ...recreateItemRoutes(),
      {
        method: 'GET',
        path: `/api/v1/files/${OLD_FILE_ID}`,
        body: { id: OLD_FILE_ID, display_name: 'syllabus.pdf' },
      },
      {
        method: 'DELETE',
        path: `/api/v1/files/${OLD_FILE_ID}`,
        body: { message: 'gone already' },
        status: 404,
      },
    ]);

    const outcome = await run([updateAction()], { courseDir, state });

    // A file somebody already deleted by hand, or one the token may not touch,
    // is not a reason to fail a push whose every other write landed.
    assert.deepEqual(outcome.errors, []);
    assert.equal(outcome.applied.length, 1);
    assert.equal(fileDeletes(calls).length, 1);
  });
});

describe('an upload that renamed nothing deletes nothing', () => {
  it('costs no lookup at all when the upload landed on the same file', async () => {
    silence();
    const courseDir = tempCourse();
    const state = stateWithFileItem();
    const calls = mockCanvas([
      ...uploadRoutes(OLD_FILE_ID, 'handbook.pdf'),
      {
        method: 'PUT',
        path: `/modules/${MODULE_ID}/items/${MODULE_ITEM_ID}`,
        body: { id: MODULE_ITEM_ID, title: 'Syllabus', indent: 0 },
      },
    ]);

    const outcome = await run([updateAction()], { courseDir, state });

    assert.deepEqual(outcome.errors, []);
    assert.deepEqual(fileDeletes(calls), []);
    assert.deepEqual(
      fileReads(calls),
      [],
      'the same id proves there is no orphan, so nothing needs fetching',
    );
  });

  it('is not fooled by a Canvas id that changed under an unchanged name', async () => {
    silence();
    // The case `1ee4bb1` declined to bet against, and the reason the id
    // comparison is only half the test: Canvas answers `on_duplicate=overwrite`
    // by replacing the file of that name, and nothing here has ever verified
    // which id comes back. If it is a new one, the old file was consumed by the
    // overwrite and deleting it would be deleting the author's live binary.
    const courseDir = tempCourse();
    const state = stateWithFileItem();
    const calls = mockCanvas([
      ...uploadRoutes(NEW_FILE_ID, 'handbook.pdf'),
      ...recreateItemRoutes(),
      {
        method: 'GET',
        path: `/api/v1/files/${OLD_FILE_ID}`,
        body: { id: OLD_FILE_ID, display_name: 'handbook.pdf' },
      },
    ]);

    const outcome = await run([updateAction()], { courseDir, state });

    assert.deepEqual(outcome.errors, []);
    assert.equal(fileReads(calls).length, 1, 'the name has to be checked');
    assert.deepEqual(
      fileDeletes(calls),
      [],
      'the same name means the upload replaced it, so there is no orphan',
    );
  });

  it('leaves a renamed-away file alone while something else still names it', async () => {
    silence();
    // The same binary is linked from a page, so `state.files` holds a row for
    // it and the page's HTML in Canvas points at that id. Deleting the file
    // would break an image or a download in a page this run never touched.
    const courseDir = tempCourse();
    const state = stateWithFileItem();
    state.files['01-intro/_files/syllabus.pdf'] = {
      canvas_file_id: OLD_FILE_ID,
      canvas_url: `/courses/${COURSE_ID}/files/${OLD_FILE_ID}/preview`,
      sha256: 'whatever',
    };
    const calls = mockCanvas([
      ...uploadRoutes(NEW_FILE_ID, 'handbook.pdf'),
      ...recreateItemRoutes(),
      {
        method: 'GET',
        path: `/api/v1/files/${OLD_FILE_ID}`,
        body: { id: OLD_FILE_ID, display_name: 'syllabus.pdf' },
      },
    ]);

    const outcome = await run([updateAction()], { courseDir, state });

    assert.deepEqual(outcome.errors, []);
    assert.deepEqual(
      fileDeletes(calls),
      [],
      'a file another row still points at is not this run’s to delete',
    );
  });

  it('deletes nothing on the first upload of a file item', async () => {
    silence();
    // A create has no previous file to orphan. Stated as its own test because
    // the cheapest way to reintroduce the defect in reverse is a cleanup that
    // reads a missing id as "delete everything you can find".
    const courseDir = tempCourse();
    const state = stateWithFileItem();
    delete state.modules['01-intro'].items['01-intro/03-syllabus.md'];
    const calls = mockCanvas([
      ...uploadRoutes(NEW_FILE_ID, 'handbook.pdf'),
      {
        method: 'POST',
        path: `/modules/${MODULE_ID}/items`,
        body: { id: 92, title: 'Syllabus', indent: 0 },
      },
    ]);

    const outcome = await run(
      [{ ...updateAction(), type: 'create-canvas-item', canvasId: null }],
      { courseDir, state },
    );

    assert.deepEqual(outcome.errors, []);
    assert.deepEqual(fileDeletes(calls), []);
    assert.deepEqual(fileReads(calls), []);
  });
});
