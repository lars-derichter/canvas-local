const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  SCHEMA_VERSION,
  allItems,
  assertStateMatchesEnv,
  deleteItem,
  deleteModule,
  emptyState,
  ensureModule,
  getItem,
  getModule,
  loadState,
  renameFolder,
  renameFolders,
  renamePath,
  renamePaths,
  saveState,
  setItem,
  toPosixPath,
} = require('../../lib/sync/state');
const { RefusalError } = require('../../lib/errors');

const URL = 'https://school.instructure.com';
const ENV = { CANVAS_COURSE_ID: '45083', CANVAS_API_URL: URL };

/** An item row as the sync engine leaves it, fingerprints and all. */
function row(overrides = {}) {
  return {
    canvas_type: 'page',
    canvas_id: 1234,
    page_url: 'welcome',
    module_item_id: 5678,
    local_hash: 'sha256-local',
    canvas_hash: 'sha256-canvas',
    canvas_updated_at: '2026-08-19T09:59:00.000Z',
    synced_at: '2026-08-19T10:00:00.000Z',
    ...overrides,
  };
}

/** A two-module state with two items in the first module. */
function twoModules() {
  const state = emptyState(ENV);
  ensureModule(state, '01-introduction', {
    canvas_module_id: 100,
    name: 'Introduction',
    position: 1,
  });
  ensureModule(state, '02-basics', {
    canvas_module_id: 200,
    name: 'Basics',
    position: 2,
  });
  setItem(state, '01-introduction', '01-introduction/01-welcome.md', row());
  setItem(
    state,
    '01-introduction',
    '01-introduction/02-setup.md',
    row({ canvas_id: 1235, page_url: 'setup', module_item_id: 5679 }),
  );
  return state;
}

describe('toPosixPath', () => {
  it('stores a Windows path the way every other platform reads it', () => {
    assert.equal(
      toPosixPath('01-intro\\01-welcome.md'),
      '01-intro/01-welcome.md',
    );
    assert.equal(
      toPosixPath('01-intro/01-welcome.md'),
      '01-intro/01-welcome.md',
    );
  });
});

describe('emptyState', () => {
  it('seeds the schema version and all four containers', () => {
    const state = emptyState(ENV);
    assert.equal(state.schema_version, 4);
    assert.equal(SCHEMA_VERSION, 4);
    assert.deepEqual(state.modules, {});
    assert.deepEqual(state.icons, {});
    assert.deepEqual(state.files, {});
    assert.equal(state.last_sync, null);
  });

  it('takes its identity from the environment, normalised', () => {
    const state = emptyState({
      CANVAS_COURSE_ID: '45083',
      CANVAS_API_URL: `${URL}/api/v1/`,
    });
    assert.equal(state.course_id, 45083);
    assert.equal(state.canvas_base_url, URL);
  });

  it('claims nothing when the environment names nothing', () => {
    const state = emptyState({});
    assert.equal(state.course_id, 0);
    assert.equal(state.canvas_base_url, '');
  });
});

describe('assertStateMatchesEnv', () => {
  /** Sync state as a course that has been pushed to leaves it. */
  function synced(overrides = {}) {
    return {
      schema_version: SCHEMA_VERSION,
      canvas_base_url: URL,
      course_id: 45083,
      modules: {
        '01-intro': { canvas_module_id: 100, item_order: [], items: {} },
      },
      icons: {},
      files: {},
      ...overrides,
    };
  }

  it('accepts a file that describes the course in the environment', () => {
    const state = synced();
    assert.equal(assertStateMatchesEnv(state, ENV), state);
  });

  it('accepts a course id given as a number against a string env var', () => {
    assert.doesNotThrow(() =>
      assertStateMatchesEnv(synced({ course_id: 45083 }), ENV),
    );
  });

  it('refuses a file describing a different course', () => {
    assert.throws(
      () =>
        assertStateMatchesEnv(synced(), {
          CANVAS_COURSE_ID: '58155',
          CANVAS_API_URL: URL,
        }),
      (err) => {
        assert.match(err.message, /describes course 45083/);
        assert.match(err.message, /`\.env` names course 58155/);
        return true;
      },
    );
  });

  it('names the global file id in the refusal', () => {
    assert.throws(
      () =>
        assertStateMatchesEnv(synced(), {
          CANVAS_COURSE_ID: '58155',
          CANVAS_API_URL: URL,
        }),
      // The one id that is not scoped to a course is the reason this is a
      // refusal rather than a warning; the message has to say so.
      /a file id is global/,
    );
  });

  it('offers both remedies', () => {
    assert.throws(
      () =>
        assertStateMatchesEnv(synced(), {
          CANVAS_COURSE_ID: '58155',
          CANVAS_API_URL: URL,
        }),
      (err) => {
        assert.match(err.message, /point `\.env` back at the course/);
        assert.match(err.message, /npx course reset-sync-state/);
        assert.match(
          err.message,
          /creates everything fresh/,
          'the remedy has a consequence worth stating before it is followed',
        );
        return true;
      },
    );
  });

  it('refuses the same course id on a different Canvas instance', () => {
    assert.throws(
      () =>
        assertStateMatchesEnv(synced(), {
          CANVAS_COURSE_ID: '45083',
          CANVAS_API_URL: 'https://other.instructure.com',
        }),
      /describes https:\/\/school\.instructure\.com/,
    );
  });

  it('reports both differences at once', () => {
    assert.throws(
      () =>
        assertStateMatchesEnv(synced(), {
          CANVAS_COURSE_ID: '58155',
          CANVAS_API_URL: 'https://other.instructure.com',
        }),
      (err) => {
        assert.match(err.message, /describes course 45083/);
        assert.match(err.message, /and https:\/\/school\.instructure\.com/);
        return true;
      },
    );
  });

  it('ignores a base URL that differs only by punctuation', () => {
    assert.doesNotThrow(() =>
      assertStateMatchesEnv(synced({ canvas_base_url: `${URL}/api/v1` }), {
        CANVAS_COURSE_ID: '45083',
        CANVAS_API_URL: `${URL}/`,
      }),
    );
  });

  it('adopts the environment when the file claims no course', () => {
    const state = synced({ course_id: 0, canvas_base_url: '' });

    assertStateMatchesEnv(state, {
      CANVAS_COURSE_ID: '45083',
      CANVAS_API_URL: `${URL}/`,
    });

    assert.equal(
      state.course_id,
      45083,
      'a file written before the env var was set gains a claim, so the next ' +
        'save protects it like any other',
    );
    assert.equal(state.canvas_base_url, URL);
  });

  it('treats a missing course_id as no claim rather than a mismatch', () => {
    const state = synced();
    delete state.course_id;

    assert.doesNotThrow(() => assertStateMatchesEnv(state, ENV));
    assert.equal(state.course_id, 45083);
  });

  it('cannot be contradicted by an environment that names nothing', () => {
    const state = synced();

    assert.doesNotThrow(() => assertStateMatchesEnv(state, {}));
    assert.equal(state.course_id, 45083, 'and the claim is left as it was');
    assert.equal(state.canvas_base_url, URL);
  });

  it('handles a null sync state', () => {
    assert.equal(assertStateMatchesEnv(null, { CANVAS_COURSE_ID: '1' }), null);
  });
});

describe('loadState and saveState', () => {
  let dir;
  let file;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccb-state-'));
    file = path.join(dir, '.canvas-sync.json');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** Write a state file straight to disk, whatever shape the test needs. */
  function writeRaw(data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
  }

  it('returns a fresh state when the file is missing', () => {
    assert.deepEqual(loadState({ file, env: ENV }), emptyState(ENV));
  });

  it('returns null for a missing file under allowNull', () => {
    assert.equal(loadState({ file, env: ENV, allowNull: true }), null);
  });

  it('refuses a file left with git conflict markers, and names them', () => {
    // How this happens in practice: the file is committed and every push
    // changes it, so two checkouts pushing produce a merge somebody left
    // half-finished. It used to read as a course that had never been synced,
    // and the push after it re-created on Canvas everything whose title had
    // moved since.
    fs.writeFileSync(
      file,
      [
        '<<<<<<< HEAD',
        `{ "schema_version": ${SCHEMA_VERSION}, "course_id": 45083 }`,
        '=======',
        `{ "schema_version": ${SCHEMA_VERSION}, "course_id": 45083, "modules": {} }`,
        '>>>>>>> origin/main',
        '',
      ].join('\n'),
      'utf8',
    );

    assert.throws(
      () => loadState({ file, env: ENV }),
      (err) => {
        assert.ok(err instanceof RefusalError, 'a decision, not a crash');
        assert.ok(err.message.includes(file), 'the message names the file');
        assert.match(err.message, /exists, but it could not be parsed as JSON/);
        assert.match(err.message, /conflict markers/);
        assert.match(err.message, /git checkout/);
        return true;
      },
    );
  });

  it('refuses plain garbage without blaming a merge for it', () => {
    fs.writeFileSync(file, '{ this is not json', 'utf8');

    assert.throws(
      () => loadState({ file, env: ENV }),
      (err) => {
        assert.ok(err instanceof RefusalError);
        assert.match(err.message, /could not be parsed as JSON/);
        assert.doesNotMatch(
          err.message,
          /It still holds git conflict markers/,
          'nothing in this file says a merge is what broke it',
        );
        return true;
      },
    );

    // `allowNull` chooses between two answers for a file that is not there. It
    // is not a way to read past one that is, which is what the course-identity
    // hook passes it for.
    assert.throws(
      () => loadState({ file, env: ENV, allowNull: true }),
      RefusalError,
    );
  });

  it('refuses an empty file rather than call it a first run', () => {
    fs.writeFileSync(file, '', 'utf8');

    assert.throws(
      () => loadState({ file, env: ENV }),
      (err) => {
        assert.ok(err instanceof RefusalError);
        assert.match(err.message, /could not be parsed as JSON/);
        return true;
      },
    );
  });

  it('refuses a file that parses to nothing', () => {
    // The one shape that gets past `JSON.parse` and still holds no state.
    fs.writeFileSync(file, 'null\n', 'utf8');

    assert.throws(
      () => loadState({ file, env: ENV }),
      (err) => {
        assert.ok(err instanceof RefusalError);
        assert.match(err.message, /holds no sync state/);
        return true;
      },
    );
  });

  it('refuses the v3 schema and names the way out', () => {
    writeRaw({ schema_version: 3, modules: {} });
    assert.throws(
      () => loadState({ file, env: ENV }),
      (err) => {
        assert.match(err.message, /schema_version 3/);
        assert.match(err.message, /only reads 4/);
        assert.match(err.message, /npx course reset-sync-state/);
        return true;
      },
    );
  });

  it('refuses a schema from the future just as firmly', () => {
    // Reading a newer file with older rules is the same guess as reading an
    // older one, and it ends the same way: duplicates on Canvas.
    writeRaw({ schema_version: 5, modules: {} });
    assert.throws(
      () => loadState({ file, env: ENV }),
      /schema_version 5[\s\S]*npx course reset-sync-state/,
    );
  });

  it('refuses a file describing another course', () => {
    writeRaw({
      schema_version: SCHEMA_VERSION,
      canvas_base_url: URL,
      course_id: 45083,
      modules: {},
      icons: {},
      files: {},
    });
    assert.throws(
      () =>
        loadState({
          file,
          env: { CANVAS_COURSE_ID: '58155', CANVAS_API_URL: URL },
        }),
      /describes course 45083/,
    );
  });

  it('skips the course check for the command that repairs it', () => {
    writeRaw({
      schema_version: SCHEMA_VERSION,
      canvas_base_url: URL,
      course_id: 45083,
      modules: {},
      icons: {},
      files: {},
    });
    const state = loadState({
      file,
      skipEnvCheck: true,
      env: { CANVAS_COURSE_ID: '58155', CANVAS_API_URL: URL },
    });
    assert.equal(state.course_id, 45083);
  });

  it('hands back the containers a hand-edited file dropped', () => {
    writeRaw({ schema_version: SCHEMA_VERSION, course_id: 45083 });
    const state = loadState({ file, env: ENV });
    assert.deepEqual(state.modules, {});
    assert.deepEqual(state.icons, {});
    assert.deepEqual(state.files, {});
  });

  it('round-trips a state and leaves no .tmp behind', () => {
    const state = twoModules();
    state.last_sync = '2026-08-19T10:00:00.000Z';
    state.icons.note = {
      canvas_file_id: 1,
      preview_url: `${URL}/courses/45083/files/1/preview`,
      theme: 'abc',
    };
    state.files['01-introduction/_files/diagram.png'] = {
      canvas_file_id: 222,
      canvas_url: '/courses/45083/files/222/preview',
      sha256: '9f2c',
    };

    saveState(state, file);

    assert.deepEqual(fs.readdirSync(dir), ['.canvas-sync.json']);
    assert.deepEqual(loadState({ file, env: ENV }), state);
  });

  it('replaces the previous state rather than merging with it', () => {
    saveState(twoModules(), file);
    const replacement = emptyState(ENV);
    saveState(replacement, file);
    assert.deepEqual(loadState({ file, env: ENV }), replacement);
  });
});

describe('ensureModule', () => {
  it('creates a module with its Canvas identity and both containers', () => {
    const state = emptyState(ENV);
    const entry = ensureModule(state, '01-introduction', {
      canvas_module_id: 100,
      name: 'Introduction',
      position: 1,
    });

    assert.deepEqual(entry, {
      canvas_module_id: 100,
      name: 'Introduction',
      position: 1,
      item_order: [],
      items: {},
    });
    assert.equal(state.modules['01-introduction'], entry);
  });

  it('merges later fields without touching the items it holds', () => {
    const state = twoModules();
    ensureModule(state, '01-introduction', { position: 3 });

    const entry = getModule(state, '01-introduction');
    assert.equal(entry.position, 3);
    assert.equal(entry.name, 'Introduction', 'an unmentioned field stays');
    assert.equal(entry.item_order.length, 2);
    assert.ok(entry.items['01-introduction/01-welcome.md']);
  });

  it('ignores an undefined field rather than blanking what is stored', () => {
    const state = twoModules();
    ensureModule(state, '01-introduction', { name: undefined, position: 9 });

    assert.equal(getModule(state, '01-introduction').name, 'Introduction');
    assert.equal(getModule(state, '01-introduction').position, 9);
  });
});

describe('getModule and deleteModule', () => {
  it('finds a module by folder, and returns null for an unknown one', () => {
    const state = twoModules();
    assert.equal(getModule(state, '02-basics').canvas_module_id, 200);
    assert.equal(getModule(state, '99-nope'), null);
  });

  it('deletes a module and reports what it removed', () => {
    const state = twoModules();
    const removed = deleteModule(state, '02-basics');

    assert.equal(removed.canvas_module_id, 200);
    assert.equal(getModule(state, '02-basics'), null);
    assert.equal(deleteModule(state, '02-basics'), null);
  });
});

describe('setItem', () => {
  it('writes the row and gives it a place in the base order', () => {
    const state = twoModules();
    assert.deepEqual(getModule(state, '01-introduction').item_order, [
      '01-introduction/01-welcome.md',
      '01-introduction/02-setup.md',
    ]);
    assert.equal(
      getModule(state, '01-introduction').items['01-introduction/01-welcome.md']
        .canvas_id,
      1234,
    );
  });

  it('rewrites a row in place without duplicating its order slot', () => {
    const state = twoModules();
    setItem(
      state,
      '01-introduction',
      '01-introduction/01-welcome.md',
      row({ canvas_hash: 'sha256-fresher' }),
    );

    assert.deepEqual(getModule(state, '01-introduction').item_order, [
      '01-introduction/01-welcome.md',
      '01-introduction/02-setup.md',
    ]);
    assert.equal(
      getItem(state, '01-introduction/01-welcome.md').entry.canvas_hash,
      'sha256-fresher',
    );
  });

  it('leaves no copy of the path in another module', () => {
    const state = twoModules();
    // The state that pull produces when it finds the item in a new module: the
    // same path must not be claimed by two modules at once.
    setItem(state, '02-basics', '01-introduction/01-welcome.md', row());

    assert.equal(
      getModule(state, '01-introduction').items[
        '01-introduction/01-welcome.md'
      ],
      undefined,
    );
    assert.deepEqual(getModule(state, '01-introduction').item_order, [
      '01-introduction/02-setup.md',
    ]);
    assert.equal(
      getItem(state, '01-introduction/01-welcome.md').folder,
      '02-basics',
    );
  });

  it('refuses to invent a module for a row', () => {
    const state = twoModules();
    assert.throws(
      () => setItem(state, '09-missing', '09-missing/01-x.md', row()),
      /no module 09-missing[\s\S]*ensureModule/,
    );
  });
});

describe('getItem', () => {
  it('finds a row without being told which module holds it', () => {
    const state = twoModules();
    const found = getItem(state, '01-introduction/02-setup.md');

    assert.equal(found.folder, '01-introduction');
    assert.equal(found.entry.page_url, 'setup');
  });

  it('returns null for a path the state does not know', () => {
    assert.equal(getItem(twoModules(), '01-introduction/99-nope.md'), null);
  });
});

describe('deleteItem', () => {
  it('removes the row and its slot in the base order', () => {
    const state = twoModules();
    const removed = deleteItem(state, '01-introduction/01-welcome.md');

    assert.equal(removed.canvas_id, 1234);
    assert.equal(getItem(state, '01-introduction/01-welcome.md'), null);
    assert.deepEqual(getModule(state, '01-introduction').item_order, [
      '01-introduction/02-setup.md',
    ]);
  });

  it('returns null for a path nothing holds', () => {
    assert.equal(deleteItem(twoModules(), '01-introduction/99-nope.md'), null);
  });
});

describe('renamePath', () => {
  it('keeps the renamed item at the same index in the base order', () => {
    const state = twoModules();
    assert.equal(
      renamePath(
        state,
        '01-introduction/01-welcome.md',
        '01-introduction/01-hello.md',
      ),
      true,
    );

    assert.deepEqual(
      getModule(state, '01-introduction').item_order,
      ['01-introduction/01-hello.md', '01-introduction/02-setup.md'],
      'a rename is not a reorder: the slot is the same one',
    );
    assert.equal(getItem(state, '01-introduction/01-welcome.md'), null);
  });

  it('carries the Canvas ids and both fingerprints across unchanged', () => {
    const state = twoModules();
    const before = structuredClone(
      getItem(state, '01-introduction/01-welcome.md').entry,
    );

    renamePath(
      state,
      '01-introduction/01-welcome.md',
      '01-introduction/03-welcome.md',
    );

    assert.deepEqual(
      getItem(state, '01-introduction/03-welcome.md').entry,
      before,
      'the row travels with the file; only sync itself may touch a fingerprint',
    );
  });

  it('re-keys in place rather than moving the row to the end', () => {
    const state = twoModules();
    renamePath(
      state,
      '01-introduction/01-welcome.md',
      '01-introduction/01-hello.md',
    );

    assert.deepEqual(Object.keys(getModule(state, '01-introduction').items), [
      '01-introduction/01-hello.md',
      '01-introduction/02-setup.md',
    ]);
  });

  it('moves a row between modules, updating both base orders', () => {
    const state = twoModules();
    setItem(
      state,
      '02-basics',
      '02-basics/01-loops.md',
      row({ canvas_id: 22 }),
    );

    assert.equal(
      renamePath(
        state,
        '01-introduction/01-welcome.md',
        '02-basics/02-welcome.md',
      ),
      true,
    );

    assert.deepEqual(getModule(state, '01-introduction').item_order, [
      '01-introduction/02-setup.md',
    ]);
    assert.deepEqual(getModule(state, '02-basics').item_order, [
      '02-basics/01-loops.md',
      '02-basics/02-welcome.md',
    ]);
    assert.equal(
      getModule(state, '01-introduction').items[
        '01-introduction/01-welcome.md'
      ],
      undefined,
    );
    assert.deepEqual(
      getItem(state, '02-basics/02-welcome.md').entry,
      row(),
      'the ids and fingerprints cross the module boundary untouched',
    );
  });

  it('leaves the state alone for a path that was never synced', () => {
    const state = twoModules();
    const before = structuredClone(state);

    assert.equal(
      renamePath(
        state,
        '01-introduction/09-draft.md',
        '01-introduction/10-draft.md',
      ),
      false,
      'the tool renames untracked files all the time; that is not an error',
    );
    assert.deepEqual(state, before);
  });

  it('does nothing when the two paths are the same', () => {
    const state = twoModules();
    const before = structuredClone(state);

    assert.equal(
      renamePath(
        state,
        '01-introduction/01-welcome.md',
        '01-introduction/01-welcome.md',
      ),
      false,
    );
    assert.deepEqual(state, before);
  });

  it('refuses to rename onto a path the state already holds', () => {
    const state = twoModules();
    const before = structuredClone(state);

    assert.throws(
      () =>
        renamePath(
          state,
          '01-introduction/01-welcome.md',
          '01-introduction/02-setup.md',
        ),
      /already holds a row[\s\S]*duplicate content/,
    );
    assert.deepEqual(state, before, 'and nothing is half-applied');
  });

  it('refuses a move into a module the state does not know', () => {
    const state = twoModules();
    const before = structuredClone(state);

    assert.throws(
      () =>
        renamePath(
          state,
          '01-introduction/01-welcome.md',
          '09-missing/01-welcome.md',
        ),
      /no module 09-missing[\s\S]*ensureModule/,
    );
    assert.deepEqual(state, before);
  });

  it('reads a Windows path as the POSIX key it is stored under', () => {
    const state = twoModules();

    assert.equal(
      renamePath(
        state,
        '01-introduction\\01-welcome.md',
        '01-introduction\\01-hello.md',
      ),
      true,
    );
    assert.deepEqual(getModule(state, '01-introduction').item_order, [
      '01-introduction/01-hello.md',
      '01-introduction/02-setup.md',
    ]);
  });
});

describe('renameFolder', () => {
  it('re-keys the module and every path inside it', () => {
    const state = twoModules();

    assert.equal(renameFolder(state, '01-introduction', '01-intro'), true);

    assert.equal(getModule(state, '01-introduction'), null);
    const entry = getModule(state, '01-intro');
    assert.equal(entry.canvas_module_id, 100);
    assert.deepEqual(entry.item_order, [
      '01-intro/01-welcome.md',
      '01-intro/02-setup.md',
    ]);
    assert.deepEqual(Object.keys(entry.items), [
      '01-intro/01-welcome.md',
      '01-intro/02-setup.md',
    ]);
    assert.equal(getItem(state, '01-intro/02-setup.md').folder, '01-intro');
  });

  it('keeps the module in the slot it had, and its neighbours untouched', () => {
    const state = twoModules();
    renameFolder(state, '01-introduction', '01-intro');

    assert.deepEqual(Object.keys(state.modules), ['01-intro', '02-basics']);
    assert.equal(getModule(state, '02-basics').canvas_module_id, 200);
  });

  it('renumbering a module keeps the base order as it was', () => {
    const state = twoModules();
    renameFolder(state, '01-introduction', '03-introduction');

    assert.deepEqual(
      getModule(state, '03-introduction').item_order,
      ['03-introduction/01-welcome.md', '03-introduction/02-setup.md'],
      'the items did not move relative to each other, so neither does the base',
    );
  });

  it('takes the embedded files of that folder with it', () => {
    const state = twoModules();
    const diagram = {
      canvas_file_id: 222,
      canvas_url: '/courses/45083/files/222/preview',
      sha256: '9f2c',
    };
    state.files['01-introduction/_files/diagram.png'] = diagram;

    renameFolder(state, '01-introduction', '03-introduction');

    // The binary never moved on Canvas; only its local address did. A row left
    // under the old path would send the next push to upload it a second time.
    assert.deepEqual(Object.keys(state.files), [
      '03-introduction/_files/diagram.png',
    ]);
    assert.deepEqual(
      state.files['03-introduction/_files/diagram.png'],
      diagram,
    );
  });

  it('leaves the embedded files of other modules where they are', () => {
    const state = twoModules();
    state.files['01-introduction/_files/diagram.png'] = { canvas_file_id: 222 };
    state.files['02-basics/_files/loop.png'] = { canvas_file_id: 333 };

    renameFolder(state, '01-introduction', '03-introduction');

    assert.deepEqual(Object.keys(state.files), [
      '03-introduction/_files/diagram.png',
      '02-basics/_files/loop.png',
    ]);
  });

  it('rewrites what is under the folder, not what merely mentions it', () => {
    const state = twoModules();
    // A screenshot of the intro module, filed under another module. Matching on
    // `01-introduction/` and not on the bare name is what keeps it put.
    state.files['02-basics/_files/01-introduction.png'] = {
      canvas_file_id: 444,
    };
    state.files['00-01-introduction/_files/x.png'] = { canvas_file_id: 555 };

    renameFolder(state, '01-introduction', '03-introduction');

    assert.deepEqual(Object.keys(state.files), [
      '02-basics/_files/01-introduction.png',
      '00-01-introduction/_files/x.png',
    ]);
  });

  it('copes with a hand-trimmed file that has no files section', () => {
    const state = twoModules();
    delete state.files;

    assert.doesNotThrow(() =>
      renameFolder(state, '01-introduction', '03-introduction'),
    );
    assert.equal(state.files, undefined);
  });

  it('does nothing for a folder the state does not know', () => {
    const state = twoModules();
    const before = structuredClone(state);

    assert.equal(renameFolder(state, '09-missing', '09-renamed'), false);
    assert.deepEqual(state, before);
  });

  it('refuses to merge two modules into one', () => {
    const state = twoModules();
    const before = structuredClone(state);

    assert.throws(
      () => renameFolder(state, '01-introduction', '02-basics'),
      /already holds a module[\s\S]*unreachable/,
    );
    assert.deepEqual(state, before);
  });
});

describe('renamePaths', () => {
  /** A state with one module and the rows the tests move around. */
  function synced(items, files = {}) {
    return {
      schema_version: SCHEMA_VERSION,
      modules: {
        '01-mod': {
          canvas_module_id: 100,
          item_order: Object.keys(items),
          items,
        },
      },
      icons: {},
      files,
    };
  }

  /** A page row carrying everything a sync writes onto one. */
  function pageRow(canvasId, slug) {
    return {
      canvas_type: 'page',
      canvas_id: canvasId,
      page_url: slug,
      module_item_id: canvasId + 1000,
      local_hash: `local-${canvasId}`,
      canvas_hash: `canvas-${canvasId}`,
      canvas_updated_at: '2026-08-19T09:59:00.000Z',
      synced_at: '2026-08-19T10:00:00.000Z',
    };
  }

  it('carries the Canvas ids and both fingerprints to the new path', () => {
    const state = synced({ '01-mod/01-welcome.md': pageRow(1234, 'welcome') });

    assert.equal(
      renamePaths(state, [
        { from: '01-mod/01-welcome.md', to: '01-mod/03-welcome.md' },
      ]),
      1,
    );

    assert.deepEqual(
      state.modules['01-mod'].items['01-mod/03-welcome.md'],
      pageRow(1234, 'welcome'),
    );
    assert.equal(
      state.modules['01-mod'].items['01-mod/01-welcome.md'],
      undefined,
      'and nothing is left at the old path',
    );
  });

  it('keeps the renamed row in the slot it had in the base order', () => {
    const state = synced({
      '01-mod/01-a.md': pageRow(1, 'a'),
      '01-mod/02-b.md': pageRow(2, 'b'),
      '01-mod/03-c.md': pageRow(3, 'c'),
    });

    renamePaths(state, [{ from: '01-mod/02-b.md', to: '01-mod/02-bee.md' }]);

    assert.deepEqual(state.modules['01-mod'].item_order, [
      '01-mod/01-a.md',
      '01-mod/02-bee.md',
      '01-mod/03-c.md',
    ]);
  });

  it("renumbers several files into each other's slots with every row intact", () => {
    // What `renumber` does after a deletion: everything below the gap shifts
    // up one, so each move lands on a path its neighbour still holds.
    const state = synced({
      '01-mod/02-b.md': pageRow(2, 'b'),
      '01-mod/03-c.md': pageRow(3, 'c'),
      '01-mod/04-d.md': pageRow(4, 'd'),
    });

    const moved = renamePaths(state, [
      { from: '01-mod/02-b.md', to: '01-mod/01-b.md' },
      { from: '01-mod/03-c.md', to: '01-mod/02-c.md' },
      { from: '01-mod/04-d.md', to: '01-mod/03-d.md' },
    ]);

    assert.equal(moved, 3);
    assert.deepEqual(Object.keys(state.modules['01-mod'].items), [
      '01-mod/01-b.md',
      '01-mod/02-c.md',
      '01-mod/03-d.md',
    ]);
    assert.equal(state.modules['01-mod'].items['01-mod/01-b.md'].canvas_id, 2);
    assert.equal(state.modules['01-mod'].items['01-mod/02-c.md'].canvas_id, 3);
    assert.equal(state.modules['01-mod'].items['01-mod/03-d.md'].canvas_id, 4);
  });

  it('swaps two rows that trade filenames', () => {
    const state = synced({
      '01-mod/01-a.md': pageRow(1, 'a'),
      '01-mod/02-b.md': pageRow(2, 'b'),
    });

    renamePaths(state, [
      { from: '01-mod/01-a.md', to: '01-mod/02-b.md' },
      { from: '01-mod/02-b.md', to: '01-mod/01-a.md' },
    ]);

    assert.equal(state.modules['01-mod'].items['01-mod/02-b.md'].canvas_id, 1);
    assert.equal(state.modules['01-mod'].items['01-mod/01-a.md'].canvas_id, 2);
  });

  it('leaves a path the state never knew alone, without throwing', () => {
    const state = synced({ '01-mod/01-a.md': pageRow(1, 'a') });
    const before = JSON.parse(JSON.stringify(state));

    assert.equal(
      renamePaths(state, [
        { from: '01-mod/09-untracked.md', to: '01-mod/08-untracked.md' },
      ]),
      0,
    );
    assert.deepEqual(state, before);
  });

  it('ignores a move that goes nowhere', () => {
    const state = synced({ '01-mod/01-a.md': pageRow(1, 'a') });
    assert.equal(
      renamePaths(state, [{ from: '01-mod/01-a.md', to: '01-mod/01-a.md' }]),
      0,
    );
    assert.ok(state.modules['01-mod'].items['01-mod/01-a.md']);
  });

  it('moves everything under a subsection folder that was renamed', () => {
    const state = synced(
      {
        '01-mod/01-sub/01-a.md': pageRow(1, 'a'),
        '01-mod/01-sub/02-b.md': pageRow(2, 'b'),
        '01-mod/02-outside.md': pageRow(3, 'outside'),
      },
      { '01-mod/01-sub/_files/diagram.png': { canvas_file_id: 500 } },
    );

    renamePaths(state, [{ from: '01-mod/01-sub', to: '01-mod/03-renamed' }]);

    assert.deepEqual(Object.keys(state.modules['01-mod'].items).sort(), [
      '01-mod/02-outside.md',
      '01-mod/03-renamed/01-a.md',
      '01-mod/03-renamed/02-b.md',
    ]);
    assert.deepEqual(
      Object.keys(state.files),
      ['01-mod/03-renamed/_files/diagram.png'],
      'the binaries under a moved folder move with it',
    );
  });

  it('moves a row into another module and out of the one it left', () => {
    const state = synced({ '01-mod/01-a.md': pageRow(1, 'a') });
    state.modules['02-mod'] = {
      canvas_module_id: 200,
      item_order: [],
      items: {},
    };

    renamePaths(state, [{ from: '01-mod/01-a.md', to: '02-mod/01-a.md' }]);

    assert.deepEqual(state.modules['01-mod'].items, {});
    assert.deepEqual(state.modules['01-mod'].item_order, []);
    assert.equal(state.modules['02-mod'].items['02-mod/01-a.md'].canvas_id, 1);
    assert.deepEqual(state.modules['02-mod'].item_order, ['02-mod/01-a.md']);
  });

  it('opens a module the state has never seen so the row has somewhere to land', () => {
    // An item dragged into a folder that has not been pushed. The module is
    // recorded without a Canvas id; the next push creates it and fills that in.
    const state = synced({ '01-mod/01-a.md': pageRow(1, 'a') });

    assert.equal(
      renamePaths(state, [{ from: '01-mod/01-a.md', to: '09-new/01-a.md' }]),
      1,
    );

    assert.equal(state.modules['09-new'].canvas_module_id, undefined);
    assert.equal(state.modules['09-new'].items['09-new/01-a.md'].canvas_id, 1);
  });

  it('puts a row back rather than park it under a temporary key', () => {
    // Renaming onto a file that was already there, which the filesystem allows
    // and `renamePath` refuses. The row stays where it was; nothing in the
    // committed file is left addressing a name no author would recognise.
    const state = synced({
      '01-mod/01-a.md': pageRow(1, 'a'),
      '01-mod/02-b.md': pageRow(2, 'b'),
    });

    assert.equal(
      renamePaths(state, [{ from: '01-mod/01-a.md', to: '01-mod/02-b.md' }]),
      0,
    );

    assert.equal(state.modules['01-mod'].items['01-mod/01-a.md'].canvas_id, 1);
    assert.equal(state.modules['01-mod'].items['01-mod/02-b.md'].canvas_id, 2);
    assert.ok(
      !Object.keys(state.modules['01-mod'].items).some((p) =>
        p.includes('__ccb_rename_'),
      ),
    );
  });

  it('copes with an empty batch and a hand-trimmed files section', () => {
    const state = synced({ '01-mod/01-a.md': pageRow(1, 'a') });
    delete state.files;
    assert.equal(renamePaths(state, []), 0);
    assert.equal(renamePaths(state, undefined), 0);
  });
});

describe('renameFolders', () => {
  function twoModules() {
    return {
      schema_version: SCHEMA_VERSION,
      modules: {
        '01-intro': {
          canvas_module_id: 100,
          item_order: ['01-intro/01-a.md'],
          items: { '01-intro/01-a.md': { canvas_type: 'page', canvas_id: 1 } },
        },
        '02-setup': {
          canvas_module_id: 200,
          item_order: ['02-setup/01-b.md'],
          items: { '02-setup/01-b.md': { canvas_type: 'page', canvas_id: 2 } },
        },
      },
      icons: {},
      files: {
        '01-intro/_files/one.png': { canvas_file_id: 501 },
        '02-setup/_files/two.png': { canvas_file_id: 502 },
      },
    };
  }

  it("carries a module's items and its embedded files to the new folder", () => {
    const state = twoModules();

    assert.equal(
      renameFolders(state, [{ from: '01-intro', to: '01-introduction' }]),
      1,
    );

    assert.equal(state.modules['01-intro'], undefined);
    assert.equal(state.modules['01-introduction'].canvas_module_id, 100);
    assert.deepEqual(Object.keys(state.modules['01-introduction'].items), [
      '01-introduction/01-a.md',
    ]);
    assert.deepEqual(state.modules['01-introduction'].item_order, [
      '01-introduction/01-a.md',
    ]);
    assert.ok(state.files['01-introduction/_files/one.png']);
    assert.equal(state.files['01-intro/_files/one.png'], undefined);
    assert.ok(state.files['02-setup/_files/two.png'], 'others stay put');
  });

  it("renumbers modules into each other's slots without losing one", () => {
    const state = twoModules();

    assert.equal(
      renameFolders(state, [
        { from: '02-setup', to: '01-setup' },
        { from: '01-intro', to: '02-intro' },
      ]),
      2,
    );

    assert.equal(state.modules['01-setup'].canvas_module_id, 200);
    assert.equal(state.modules['02-intro'].canvas_module_id, 100);
    assert.ok(state.modules['01-setup'].items['01-setup/01-b.md']);
    assert.ok(state.modules['02-intro'].items['02-intro/01-a.md']);
    assert.ok(state.files['01-setup/_files/two.png']);
    assert.ok(state.files['02-intro/_files/one.png']);
  });

  it('leaves a folder the state never knew alone', () => {
    const state = twoModules();
    const before = JSON.parse(JSON.stringify(state));

    assert.equal(renameFolders(state, [{ from: '09-nope', to: '08-nope' }]), 0);
    assert.deepEqual(state, before);
  });

  it('puts a module back rather than merge it into an existing one', () => {
    const state = twoModules();

    assert.equal(
      renameFolders(state, [{ from: '01-intro', to: '02-setup' }]),
      0,
    );

    assert.equal(state.modules['01-intro'].canvas_module_id, 100);
    assert.equal(state.modules['02-setup'].canvas_module_id, 200);
  });
});

describe('allItems', () => {
  it('lists every row with the module that holds it', () => {
    const state = twoModules();
    setItem(
      state,
      '02-basics',
      '02-basics/01-loops.md',
      row({ canvas_id: 22 }),
    );

    assert.deepEqual(
      allItems(state).map((r) => [r.folder, r.itemPath]),
      [
        ['01-introduction', '01-introduction/01-welcome.md'],
        ['01-introduction', '01-introduction/02-setup.md'],
        ['02-basics', '02-basics/01-loops.md'],
      ],
    );
    assert.equal(allItems(state)[0].entry.canvas_id, 1234);
  });

  it('reports a row the base order forgot, after the ones it names', () => {
    const state = twoModules();
    // A hand-edited file, or a row written before item_order existed.
    getModule(state, '01-introduction').item_order = [
      '01-introduction/02-setup.md',
    ];

    assert.deepEqual(
      allItems(state).map((r) => r.itemPath),
      ['01-introduction/02-setup.md', '01-introduction/01-welcome.md'],
    );
  });

  it('returns an empty list for a fresh state', () => {
    assert.deepEqual(allItems(emptyState(ENV)), []);
  });
});
