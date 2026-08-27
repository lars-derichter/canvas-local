const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const path = require('path');
const fs = require('fs');
const os = require('os');

/**
 * The tree provider, executed rather than read.
 *
 * `CourseTreeProvider.js` requires `vscode`, so the assertions in
 * `extension.test.js` are patterns over its source. That catches a line going
 * missing; it cannot catch a directory listing that throws, because nothing
 * there ever calls one. This file points `require('vscode')` at a stub and
 * builds real folders on disk, so `getChildren` runs against real reads.
 *
 * The stub is deliberately the small one: what the provider itself touches, and
 * no more. `extension.live.test.js` carries the whole-extension stub, and the two
 * files run in separate processes, so neither has to make room for the other's
 * needs.
 */

const EXT_DIR = path.join(
  __dirname,
  '..',
  '..',
  '.vscode',
  'extensions',
  'course-manager',
);

/** Everything the provider told the host about, in order. */
let events = [];

const disposable = () => ({ dispose() {} });

const vscodeStub = {
  EventEmitter: class {
    constructor() {
      this._listeners = [];
      this.event = (fn) => {
        this._listeners.push(fn);
        return disposable();
      };
    }
    fire(value) {
      for (const fn of this._listeners) fn(value);
    }
    dispose() {}
  },
  Uri: { file: (s) => ({ fsPath: s }) },
  TreeItem: class {
    constructor(label, collapsibleState) {
      this.label = label;
      this.collapsibleState = collapsibleState;
    }
  },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  ThemeIcon: class {
    constructor(id) {
      this.id = id;
    }
  },
  DataTransferItem: class {
    constructor(value) {
      this.value = value;
    }
  },
  window: {
    showWarningMessage: (text) => {
      events.push({ kind: 'warning', text });
      return Promise.resolve(undefined);
    },
    showInformationMessage: (text) => {
      events.push({ kind: 'info', text });
      return Promise.resolve(undefined);
    },
  },
};

const of = (kind) => events.filter((event) => event.kind === kind);

/**
 * Wait out the window the provider collects read failures in, so whatever it
 * decided to say has been said. One notification per burst is the behaviour;
 * this is how a synchronous test sees the end of one.
 */
const burst = () => new Promise((resolve) => setTimeout(resolve, 80));

describe('VS Code extension: the tree, read', () => {
  let workspace;
  let CourseTreeProvider;
  let realResolve;
  let realReaddirSync;

  before(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ccb-tree-'));

    realResolve = Module._resolveFilename;
    Module._resolveFilename = function (request, ...rest) {
      if (request === 'vscode') return 'vscode-stub';
      return realResolve.call(this, request, ...rest);
    };
    require.cache['vscode-stub'] = {
      id: 'vscode-stub',
      filename: 'vscode-stub',
      loaded: true,
      exports: vscodeStub,
    };

    ({ CourseTreeProvider } = require(
      path.join(EXT_DIR, 'CourseTreeProvider.js'),
    ));
    realReaddirSync = fs.readdirSync;
  });

  after(() => {
    fs.readdirSync = realReaddirSync;
    Module._resolveFilename = realResolve;
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  beforeEach(() => {
    events = [];
    fs.readdirSync = realReaddirSync;
    fs.rmSync(path.join(workspace, 'course'), {
      recursive: true,
      force: true,
    });
    fs.mkdirSync(path.join(workspace, 'course'));
  });

  /** A module folder holding one page, plus a subsection holding another. */
  function seedModule(name) {
    const moduleDir = path.join(workspace, 'course', name);
    fs.mkdirSync(path.join(moduleDir, '02-exercises'), { recursive: true });
    fs.writeFileSync(path.join(moduleDir, '01-intro.md'), '# Intro\n');
    fs.writeFileSync(
      path.join(moduleDir, '02-exercises', '01-first.md'),
      '# First\n',
    );
    return moduleDir;
  }

  it('draws the modules, the items and the subsection items', () => {
    seedModule('01-week-one');
    const tree = new CourseTreeProvider(workspace);

    const [module] = tree.getChildren();
    assert.equal(module.moduleFolderName, '01-week-one');
    const items = tree.getChildren(module);
    assert.deepEqual(
      items.map((item) => item.contextValue),
      ['page', 'subheader'],
    );
    const [subheader] = items.filter((i) => i.contextValue === 'subheader');
    assert.equal(tree.getChildren(subheader).length, 1);
    assert.deepEqual(of('warning'), []);
  });

  it('labels a row from _category_.json, and only from a real name', () => {
    // The tree and the module picker read this file two different ways, and
    // this is where they disagreed: the tree took any truthy label, so a
    // `_category_.json` holding a number drew a row reading "42" while the
    // picker, which demanded a string, offered "Week two". Both go through
    // `readCategoryLabel` now, and a label that is not a name is no label.
    const label = (name, category) => {
      const dir = seedModule(name);
      fs.writeFileSync(path.join(dir, '_category_.json'), category, 'utf8');
      const rows = new CourseTreeProvider(workspace).getChildren();
      return rows.find((row) => row.moduleFolderName === name).label;
    };

    assert.equal(
      label('01-week-one', '{"label": "Opening Week"}'),
      'Opening Week',
    );
    assert.equal(label('02-week-two', '{"label": 42}'), 'Week two');
    assert.equal(
      label('03-week-three', '{"label": {"value": "x"}}'),
      'Week three',
    );
    assert.equal(label('04-week-four', '{oops'), 'Week four');
  });

  it('survives a module folder that vanishes between two reads', () => {
    // The real race: the row was drawn from a listing taken before the CLI's
    // renumber renamed the folder, and expanding it reads a path that is gone.
    const moduleDir = seedModule('01-week-one');
    const tree = new CourseTreeProvider(workspace);
    const [module] = tree.getChildren();

    fs.rmSync(moduleDir, { recursive: true, force: true });
    assert.deepEqual(tree.getChildren(module), []);
    assert.deepEqual(
      of('warning'),
      [],
      'a folder that is gone needs no notification: the refresh draws it',
    );
  });

  it('survives a subsection folder that vanishes between two reads', () => {
    // The third listing, and the one a renumber is likeliest to rename: a
    // subsection is an entry of its module root like any other.
    const moduleDir = seedModule('01-week-one');
    const tree = new CourseTreeProvider(workspace);
    const [module] = tree.getChildren();
    const [subheader] = tree
      .getChildren(module)
      .filter((item) => item.contextValue === 'subheader');

    fs.rmSync(path.join(moduleDir, '02-exercises'), {
      recursive: true,
      force: true,
    });
    assert.deepEqual(tree.getChildren(subheader), []);
    assert.deepEqual(of('warning'), []);
  });

  it('survives course/ itself vanishing, and keeps the view', () => {
    seedModule('01-week-one');
    const tree = new CourseTreeProvider(workspace);
    // Past the existsSync guard in getChildren, which is what makes this a
    // race rather than a check: the read is what fails.
    const courseDir = path.join(workspace, 'course');
    fs.readdirSync = (dir, options) => {
      if (dir === courseDir) {
        throw Object.assign(new Error('ENOENT: readdir'), { code: 'ENOENT' });
      }
      return realReaddirSync(dir, options);
    };

    assert.deepEqual(tree.getChildren(), []);
    assert.deepEqual(of('warning'), []);
  });

  it('says so when a folder is there and cannot be read', async () => {
    // An empty module is a plausible answer to a deleted folder and a lie
    // about an unreadable one, so this one gets a notification.
    const moduleDir = seedModule('01-week-one');
    const tree = new CourseTreeProvider(workspace);
    const [module] = tree.getChildren();

    fs.readdirSync = (dir, options) => {
      if (dir === moduleDir) {
        throw Object.assign(new Error('EACCES: permission denied'), {
          code: 'EACCES',
        });
      }
      return realReaddirSync(dir, options);
    };

    assert.deepEqual(tree.getChildren(module), []);
    await burst();
    assert.equal(of('warning').length, 1);
    assert.match(of('warning')[0].text, /Coursewright: /);
    assert.match(of('warning')[0].text, /01-week-one/);
    assert.match(of('warning')[0].text, /EACCES/);
  });

  it('says it once, however many times the tree redraws', async () => {
    // The tree redraws on every file change in course/ and after every CLI
    // run. One notification per refresh would be worse than the silence.
    const moduleDir = seedModule('01-week-one');
    const tree = new CourseTreeProvider(workspace);
    const [module] = tree.getChildren();

    fs.readdirSync = (dir, options) => {
      if (dir === moduleDir) {
        throw Object.assign(new Error('EACCES: permission denied'), {
          code: 'EACCES',
        });
      }
      return realReaddirSync(dir, options);
    };

    for (let i = 0; i < 5; i++) tree.getChildren(module);
    await burst();
    for (let i = 0; i < 5; i++) tree.getChildren(module);
    await burst();
    assert.equal(of('warning').length, 1);
  });

  it('says one thing about a burst that takes out every folder', async () => {
    // EMFILE is the host running out of descriptors, and it is one of the two
    // codes the reader of this code is told to expect. It does not arrive one
    // folder at a time: every listing in the refresh fails at once, and one
    // notification per folder is the noise the dedup exists to prevent, moved
    // rather than removed.
    for (const name of ['01-one', '02-two', '03-three', '04-four']) {
      seedModule(name);
    }
    const tree = new CourseTreeProvider(workspace);
    const modules = tree.getChildren();
    assert.equal(modules.length, 4);

    fs.readdirSync = (dir, options) => {
      if (dir !== path.join(workspace, 'course')) {
        throw Object.assign(new Error('EMFILE: too many open files'), {
          code: 'EMFILE',
        });
      }
      return realReaddirSync(dir, options);
    };

    for (const module of modules) tree.getChildren(module);
    await burst();

    assert.equal(of('warning').length, 1, 'one refresh, one notification');
    assert.match(of('warning')[0].text, /EMFILE/);
    assert.match(
      of('warning')[0].text,
      /3 other folders could not be read either/,
      'and it has to say how much else went with it',
    );
  });

  it('says it again when the reason changes', async () => {
    // Keyed by directory alone, the first report silenced the folder for the
    // session: a later, different failure drew an empty module and said
    // nothing, which is the exact thing this code exists to prevent.
    const moduleDir = seedModule('01-week-one');
    const tree = new CourseTreeProvider(workspace);
    const [module] = tree.getChildren();

    let code = 'EACCES';
    fs.readdirSync = (dir, options) => {
      if (dir === moduleDir) {
        throw Object.assign(new Error(`${code}: readdir`), { code });
      }
      return realReaddirSync(dir, options);
    };

    tree.getChildren(module);
    tree.getChildren(module);
    await burst();
    assert.equal(of('warning').length, 1);

    code = 'EIO';
    tree.getChildren(module);
    tree.getChildren(module);
    await burst();
    assert.equal(of('warning').length, 2, 'a different failure is news');
    assert.match(of('warning')[1].text, /EIO/);
  });

  it('is not fooled by a message that varies', async () => {
    // The dedup is keyed by the error code, not by the sentence built from it.
    // Keyed by the sentence, an error whose message carried a timestamp or a
    // descriptor number reported once per refresh, for ever.
    const moduleDir = seedModule('01-week-one');
    const tree = new CourseTreeProvider(workspace);
    const [module] = tree.getChildren();

    let n = 0;
    fs.readdirSync = (dir, options) => {
      if (dir === moduleDir) {
        throw Object.assign(new Error(`EIO: read failed at offset ${n++}`), {
          code: 'EIO',
        });
      }
      return realReaddirSync(dir, options);
    };

    for (let i = 0; i < 5; i++) {
      tree.getChildren(module);
      await burst();
    }
    assert.equal(of('warning').length, 1);
  });

  it('says it again once the folder has read in between', async () => {
    // Permissions come back, and then go again. The second time is as worth
    // knowing as the first.
    const moduleDir = seedModule('01-week-one');
    const tree = new CourseTreeProvider(workspace);
    const [module] = tree.getChildren();

    let broken = true;
    fs.readdirSync = (dir, options) => {
      if (dir === moduleDir && broken) {
        throw Object.assign(new Error('EACCES: permission denied'), {
          code: 'EACCES',
        });
      }
      return realReaddirSync(dir, options);
    };

    tree.getChildren(module);
    await burst();
    assert.equal(of('warning').length, 1);

    broken = false;
    assert.equal(tree.getChildren(module).length, 2, 'the folder reads again');

    broken = true;
    tree.getChildren(module);
    await burst();
    assert.equal(of('warning').length, 2, 'the second outage is news too');
  });

  it('keeps a batch drop moving when a container is unreadable', async () => {
    // The other reader of the same listing. It answered [] silently before,
    // which reaches the author as "not where the batch expected it" — true of
    // a renamed folder, and misleading about one it may not open.
    const moduleDir = seedModule('01-week-one');
    const tree = new CourseTreeProvider(workspace);

    fs.readdirSync = (dir, options) => {
      if (dir === moduleDir) {
        throw Object.assign(new Error('EACCES: permission denied'), {
          code: 'EACCES',
        });
      }
      return realReaddirSync(dir, options);
    };

    assert.deepEqual(tree._readDirEntries(moduleDir), []);
    await burst();
    assert.equal(of('warning').length, 1);
  });
});
