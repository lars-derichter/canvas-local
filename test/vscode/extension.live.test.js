const {
  describe,
  it,
  before,
  after,
  beforeEach,
  afterEach,
} = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const path = require('path');
const fs = require('fs');
const os = require('os');
const cp = require('child_process');
const http = require('http');

/**
 * The extension, executed rather than read.
 *
 * `test/vscode/extension.test.js` matches patterns against the extension's
 * source as text, because it requires `vscode` and cannot be loaded outside the
 * host. That catches a line going missing and nothing else: changing
 * `if (!cliPath)` to `if (cliPath === undefined)` leaves every assertion there
 * green while sending `null` into execFile. This file loads the real
 * `extension.js` against a stub `vscode` and a stub `child_process`, calls
 * `activate`, and drives the runner and the command handlers end to end.
 *
 * It began as the silent runner's own test, and the name said so. It outgrew
 * that: `activate()` hands out its command handlers here, so the preview, the
 * new-item flow and the TOC export are driven through the same stub, and the
 * file is now the executed half of the extension's coverage rather than one
 * function's.
 *
 * What it is not: proof that the extension works in VS Code. The stub is this
 * project's model of the host, not the host, and a behaviour VS Code has that
 * the stub does not is invisible here — an extension-host smoke test
 * (`@vscode/test-electron`) is a different and still-open job. What it does
 * prove is that the extension's own logic runs: the queue, the refusal, the
 * spawn options, the reporting, what happens when reporting fails, and what
 * each driven handler actually asks for and sends.
 *
 * The stub covers what `activate()` touches today. When the extension starts
 * touching more of the API, this file fails with a TypeError naming the member
 * — loudly, in the suite, rather than in a course author's window.
 */

const EXT_DIR = path.join(
  __dirname,
  '..',
  '..',
  '.vscode',
  'extensions',
  'course-manager',
);

/** The manifest, which is what the palette offers and therefore what has to work. */
const packageJson = JSON.parse(
  fs.readFileSync(path.join(EXT_DIR, 'package.json'), 'utf8'),
);

/** Everything the extension told the host about, in order. */
let events = [];
let progressOpen = 0;
let progressPeak = 0;

/** Every execFile call the runner made, with the options it passed. */
let spawns = [];

/**
 * The command handlers `activate` registered, by id. The palette and the menus
 * are the only callers in the host; here they are what lets a test invoke one.
 */
let registered = {};

/**
 * What the viewer clicks. A stub that always answered `undefined` made
 * `if (choice === 'Show Log') outputChannel.show()` dead code: rewriting the
 * comparison to a string nothing matches passed the whole suite. Tests that
 * care set the answer for the kind of message they expect.
 *
 * `quickPick` is the same problem one step earlier: a command that gives up at
 * its first question never reaches the work it exists to do, so everything past
 * that question is unpinned. It is handed the items the command offered and
 * returns the one that was picked, or undefined to dismiss. `inputBox` does the
 * same for a typed answer, and is handed the options, `validateInput`
 * included — the host runs that function, so a test that wants to know whether
 * a box really validates has to run it too.
 */
let answers = {};

/** The workspace's settings, keyed `section.key`, as `getConfiguration` reads them. */
let settings = {};

/**
 * What the next child does: a test sets this to
 * `(args) => ({ delayMs, err, stdout, stderr })`, or takes over `cp.execFile`
 * outright for the shapes a plan cannot express.
 */
let plan = () => ({ stdout: 'ok\n' });

const disposable = () => ({ dispose() {} });

const vscodeStub = {
  ProgressLocation: { SourceControl: 1, Window: 10, Notification: 15 },
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
  Uri: { parse: (s) => ({ fsPath: s }), file: (s) => ({ fsPath: s }) },
  RelativePattern: class {
    constructor(base, pattern) {
      this.base = base;
      this.pattern = pattern;
    }
  },
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
    createOutputChannel: () => ({
      appendLine: (line) => events.push({ kind: 'log', text: String(line) }),
      show: () => events.push({ kind: 'channel.show' }),
      dispose() {},
    }),
    createTreeView: () => ({ dispose() {} }),
    createTerminal: (options = {}) => {
      // `cwd` is recorded, not just the name: it is the only observable the
      // workspace root reaches from the terminal module, so it is what says
      // whether that module was handed a root at all.
      events.push({
        kind: 'terminal.create',
        name: options.name,
        cwd: options.cwd,
      });
      return {
        name: options.name,
        show: () => events.push({ kind: 'terminal.show', name: options.name }),
        sendText: (text) =>
          events.push({ kind: 'terminal.send', name: options.name, text }),
        dispose() {},
      };
    },
    terminals: [],
    showErrorMessage: (text, ...items) => {
      events.push({ kind: 'error', text, items });
      return Promise.resolve(answers.error);
    },
    showWarningMessage: (text, ...items) => {
      events.push({ kind: 'warning', text, items });
      return Promise.resolve(answers.warning);
    },
    showInformationMessage: (text, ...items) => {
      events.push({ kind: 'info', text, items });
      return Promise.resolve(answers.info);
    },
    setStatusBarMessage: (text) => {
      events.push({ kind: 'status', text });
      return disposable();
    },
    withProgress: (options, task) => {
      progressOpen++;
      progressPeak = Math.max(progressPeak, progressOpen);
      // Recorded before the task runs, so the order of the events is the order
      // they happened in; `done` is attached after, for the callers that fire
      // one of these and do not await it.
      const event = { kind: 'progress', ...options };
      events.push(event);
      event.done = Promise.resolve(task({ report() {} })).then(
        (value) => {
          progressOpen--;
          return value;
        },
        (error) => {
          progressOpen--;
          throw error;
        },
      );
      return event.done;
    },
    showQuickPick: (items, options) => {
      events.push({ kind: 'quickpick', items, options });
      return Promise.resolve(
        answers.quickPick ? answers.quickPick(items, options) : undefined,
      );
    },
    showInputBox: (options) => {
      events.push({ kind: 'inputbox', options });
      return Promise.resolve(
        answers.inputBox ? answers.inputBox(options) : undefined,
      );
    },
    activeTextEditor: undefined,
    onDidCloseTerminal: () => disposable(),
    onDidStartTerminalShellExecution: () => disposable(),
    onDidEndTerminalShellExecution: () => disposable(),
    onDidChangeTerminalShellIntegration: () => disposable(),
  },
  workspace: {
    workspaceFolders: undefined, // set in `before`, once the temp root exists
    getConfiguration: (section) => ({
      get: (key, fallback) => {
        const value = settings[`${section}.${key}`];
        return value === undefined ? fallback : value;
      },
    }),
    createFileSystemWatcher: () => ({
      onDidCreate: () => disposable(),
      onDidDelete: () => disposable(),
      onDidChange: () => disposable(),
      dispose() {},
    }),
    openTextDocument: () => Promise.resolve({}),
  },
  commands: {
    registerCommand: (id, handler) => {
      registered[id] = handler;
      return disposable();
    },
    executeCommand: (...args) => {
      events.push({ kind: 'command', args });
      return Promise.resolve();
    },
  },
  env: {
    shell: '/bin/bash',
    openExternal: (uri) => {
      events.push({ kind: 'open', uri });
      return Promise.resolve(true);
    },
  },
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const of = (kind) => events.filter((event) => event.kind === kind);

/**
 * The child every test starts from: it does what `plan` says. Reinstalled
 * before each test, because a test that needs a shape `plan` cannot express
 * replaces `cp.execFile` outright, and the next test must not inherit it.
 */
function installExecFileStub() {
  cp.execFile = (file, args, options, callback) => {
    spawns.push({ file, args, options });
    const scripted = plan(args, options);
    setTimeout(
      () =>
        callback(
          scripted.err || null,
          scripted.stdout === undefined ? '' : scripted.stdout,
          scripted.stderr || '',
        ),
      scripted.delayMs || 0,
    );
    return { pid: 1 };
  };
}

describe('VS Code extension: activated, and run', () => {
  let workspace;
  let extension;
  let runCli;
  let realExecFile;
  let realHttpGet;
  let realResolve;
  let unhandled;
  let collectUnhandled;

  before(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-runner-'));
    fs.mkdirSync(path.join(workspace, 'cli'));
    fs.mkdirSync(path.join(workspace, 'course'));
    fs.writeFileSync(path.join(workspace, 'cli', 'index.js'), '', 'utf8');
    vscodeStub.workspace.workspaceFolders = [{ uri: { fsPath: workspace } }];

    // `require('vscode')` has nothing to resolve to outside the host, so it is
    // pointed at the stub before anything that requires it is loaded.
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

    realExecFile = cp.execFile;
    realHttpGet = http.get;
    installExecFileStub();

    // The extension hands runCli to the tree provider; that is the only place
    // it leaves the module, so it is where the tests pick it up.
    const providerModule = require(path.join(EXT_DIR, 'CourseTreeProvider.js'));
    const RealProvider = providerModule.CourseTreeProvider;
    providerModule.CourseTreeProvider = class extends RealProvider {
      constructor(root, actions) {
        super(root, actions);
        runCli = actions.runCli;
      }
    };

    extension = require(path.join(EXT_DIR, 'extension.js'));
    extension.activate({ subscriptions: [] });
    assert.ok(runCli, 'activate() must hand runCli to the tree provider');

    // Deliberate, and it has a cost worth naming: while this listener is
    // installed, node --test no longer fails the process on an unhandled
    // rejection anywhere in this file. The tests that care assert `unhandled`
    // themselves, and `after` puts the default behaviour back.
    unhandled = [];
    collectUnhandled = (reason) => unhandled.push(reason);
    process.on('unhandledRejection', collectUnhandled);
  });

  after(() => {
    process.off('unhandledRejection', collectUnhandled);
    cp.execFile = realExecFile;
    http.get = realHttpGet;
    Module._resolveFilename = realResolve;
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  beforeEach(() => {
    events = [];
    spawns = [];
    progressOpen = 0;
    progressPeak = 0;
    plan = () => ({ stdout: 'ok\n' });
    answers = {};
    settings = {};
    unhandled.length = 0;
    http.get = realHttpGet;
    installExecFileStub();
  });

  // The preview polls for two minutes before it gives up, and it is fired
  // without being awaited. A test that starts one and then fails an assertion
  // would leave that loop running long after the suite has finished — a
  // regression would look like a hung suite instead of a red one. Answering
  // whatever it polls ends the loop at its next tick, whatever the test did.
  afterEach(async () => {
    const outstanding = of('progress').map((event) => event.done);
    if (outstanding.length === 0) return;
    http.get = (url, callback) => {
      callback({ resume() {} });
      return { on() {}, setTimeout() {}, destroy() {} };
    };
    await Promise.all(outstanding.map((done) => done.catch(() => {})));
  });

  it('registers exactly the commands the manifest declares', () => {
    // `activate()` is a list of `register*(wiring)` calls, and a list is a
    // thing that silently loses an entry. Dropping `registerStreamingCommands`
    // takes nineteen of these out of the palette — setup, init, all four sync
    // directions, validate, search, the four module-scoped Canvas actions,
    // build-glossary and both resets — and every source-text check still
    // passes, because the handlers are still written down in
    // `commands/streaming.js`. They are just never registered, and each one is
    // a live "command not found" for whoever clicks it.
    //
    // Before the split that list was `activate()`'s own body, so a scan for
    // `register('id'` in the source meant what it looked like. It does not any
    // more, and this is what replaces it: what the host was actually told,
    // after activation, against what the manifest promises.
    const declared = packageJson.contributes.commands
      .map((command) => command.command)
      .sort();
    assert.deepEqual(
      Object.keys(registered).sort(),
      declared,
      'every declared command has to be registered, and nothing else',
    );
  });

  it('hands the workspace root to the pickers and to the terminals', async () => {
    // The three `init*` lines are the same kind of list, one level down, and
    // each drops a different thing on the floor. Without the root the pickers
    // throw ERR_INVALID_ARG_TYPE out of `path.join` at the first quick pick,
    // and the terminal module opens its terminals in the host's cwd instead of
    // in the project. `initRunner` is pinned by the spawn-options test below.
    //
    // Driven rather than read: asserting that the three calls appear in the
    // source is the same text scan that let a missing registration through.
    // Push This Module goes through both — a module quick pick, then a line
    // typed into a pooled terminal — so one flow answers for two of them.
    const moduleDir = path.join(workspace, 'course', '01-seeded');
    fs.mkdirSync(moduleDir, { recursive: true });
    try {
      answers.quickPick = (items) => items[0];
      await registered['course.pushModule']();
    } finally {
      fs.rmSync(moduleDir, { recursive: true, force: true });
    }

    const offered = of('quickpick');
    assert.equal(offered.length, 1, 'the module pick has to have happened');
    assert.deepEqual(
      offered[0].items.map((item) => item.folder),
      ['01-seeded'],
      'the pickers read course/ under the root they were handed',
    );

    const created = of('terminal.create');
    assert.ok(
      created.length > 0,
      'no pooled terminal was created, so nothing here saw a cwd. The pool is ' +
        'module state shared by this whole file, and at the pickTerminal cap a ' +
        'run reuses rather than creates',
    );
    for (const create of created) {
      assert.equal(
        create.cwd,
        workspace,
        'a pooled terminal has to open in the workspace',
      );
    }
    assert.deepEqual(
      of('terminal.send').map((event) => event.text),
      ["npx course push --module '01-seeded'"],
    );
  });

  it('runs one command at a time', async () => {
    // Two structural commands that overlap both renumber a directory and both
    // rewrite .canvas-sync.json.
    let live = 0;
    let peak = 0;
    const order = [];
    cp.execFile = (file, args, options, callback) => {
      spawns.push({ file, args, options });
      live++;
      peak = Math.max(peak, live);
      order.push(`start:${args[2]}`);
      setTimeout(() => {
        live--;
        order.push(`end:${args[2]}`);
        callback(null, 'done\n', '');
      }, 40);
      return { pid: 1 };
    };

    await Promise.all([
      runCli(['rename-item', 'first']),
      runCli(['rename-item', 'second']),
    ]);

    assert.equal(peak, 1, 'two CLI children were alive at once');
    assert.deepEqual(order, [
      'start:first',
      'end:first',
      'start:second',
      'end:second',
    ]);
  });

  it('queues a run that an earlier run only seeded', async () => {
    // The escape hatch that keeps a nested call from deadlocking must not
    // outlive the run that opened it. A timer registered inside a run — the
    // shape of a button handler on the runner's own notifications — fires long
    // afterwards, and must take its turn like anything else.
    let seeded;
    const order = [];
    cp.execFile = (file, args, options, callback) => {
      const tag = args[2];
      order.push(`start:${tag}`);
      setTimeout(
        () => {
          order.push(`end:${tag}`);
          callback(null, 'done\n', '');
          if (tag === 'seeder') {
            setTimeout(() => {
              seeded = runCli(['rename-item', 'seeded']);
            }, 0);
          }
        },
        tag === 'held' ? 120 : 10,
      );
      return { pid: 1 };
    };

    await runCli(['rename-item', 'seeder']);
    const held = runCli(['rename-item', 'held']);
    await sleep(40); // the seeded call has been made by now
    assert.deepEqual(
      order,
      ['start:seeder', 'end:seeder', 'start:held'],
      'the seeded run started beside the held one instead of queueing',
    );

    await held;
    await seeded;
    assert.deepEqual(order, [
      'start:seeder',
      'end:seeder',
      'start:held',
      'end:held',
      'start:seeded',
      'end:seeded',
    ]);
  });

  it('spawns node on the workspace CLI with the options it means to', async () => {
    process.env.CW_LIVE_PROBE = 'probe value';
    const before = { ...process.env };
    plan = () => ({ stdout: 'ok\n' });
    try {
      await runCli(['rename-item', '--path', 'x']);
    } finally {
      delete process.env.CW_LIVE_PROBE;
    }

    assert.equal(spawns.length, 1);
    const [spawn] = spawns;
    assert.equal(spawn.file, process.execPath);
    assert.equal(spawn.args[0], path.join(workspace, 'cli', 'index.js'));
    assert.deepEqual(spawn.args.slice(1), ['rename-item', '--path', 'x']);
    assert.equal(spawn.options.cwd, workspace);
    assert.equal(spawn.options.env.ELECTRON_RUN_AS_NODE, '1');
    // The rest of the environment reaches the child. Not asserted through
    // `PATH`: Windows spells that key `Path`, and a plain object keeps whatever
    // casing it was given, while `process.env` answers either — so the obvious
    // assertion passes here and fails the Windows leg. The probe is a variable
    // this test controls, and the key lookup below is done the way a program
    // reading the child block has to do it.
    assert.equal(spawn.options.env.CW_LIVE_PROBE, 'probe value');
    const pathKey = Object.keys(spawn.options.env).find(
      (key) => key.toLowerCase() === 'path',
    );
    assert.ok(pathKey, 'the child needs a PATH under some casing');
    assert.equal(
      spawn.options.env[pathKey],
      process.env[pathKey],
      'the child needs the environment a hand-run command would have had',
    );
    assert.deepEqual(
      { ...process.env, CW_LIVE_PROBE: 'probe value' },
      before,
      'building the child environment must not edit this process',
    );
    assert.ok(
      spawn.options.maxBuffer > 1024 * 1024,
      'the child needs more room than the one-megabyte default',
    );
    assert.ok(
      spawn.options.timeout >= 60 * 1000,
      'a run that hangs has to be killed, and not before a real one finishes',
    );
  });

  it('says nothing while a quick run is quick', async () => {
    plan = () => ({ delayMs: 10, stdout: '[done] renamed\n' });
    await runCli(['rename-item', '--path', 'x']);
    await sleep(900); // past the progress delay, had it not been cleared

    assert.equal(progressPeak, 0, 'a fast rename flashed a spinner');
    assert.equal(
      of('status').length,
      1,
      'the result belongs in the status bar',
    );
    assert.match(of('status')[0].text, /renamed/);
  });

  it('shows one status-bar progress for a slow run, and takes it down', async () => {
    plan = () => ({ delayMs: 900, stdout: 'done\n' });
    const run = runCli(['export-toc']);
    await sleep(800);
    assert.equal(progressOpen, 1, 'a slow run has to say it is running');

    await run;
    await sleep(20);
    assert.equal(progressPeak, 1, 'one indicator, not one per settle path');
    assert.equal(progressOpen, 0, 'the indicator has to come down');
    const [progress] = of('progress');
    assert.equal(progress.location, vscodeStub.ProgressLocation.Window);
    assert.match(progress.title, /export-toc/);
  });

  it('shows one spinner for a batch, not one per row', async () => {
    // Six rows dropped on a module are six runs, and the ones still queued at
    // the delay are precisely the ones nobody has been told about. Arming per
    // run and showing per run are different things: before the gate, this
    // opened one indicator for every row still waiting, and unwound them one
    // at a time.
    plan = () => ({ delayMs: 200, stdout: 'ok\n' });
    await Promise.all(
      ['a', 'b', 'c', 'd', 'e', 'f'].map((row) =>
        runCli(['movetomodule-item', '--path', row]),
      ),
    );
    await sleep(20);

    assert.equal(progressPeak, 1, 'one spinner for the batch, not one per row');
    assert.equal(of('progress').length, 1, 'and it is opened once');
    assert.equal(progressOpen, 0, 'and released when the last row settles');
  });

  it('releases the spinner when a run behind a slow one rejects', async () => {
    // Queueing is what makes this reachable: a spawn that throws takes its
    // turn after a run slower than the delay, so it rejects with the spinner
    // already up. Counting only fulfilment would leave it turning with nothing
    // behind it for the rest of the session.
    cp.execFile = (file, args, options, callback) => {
      if (args[1] === 'move-item') {
        throw new TypeError('The "args" argument must be of type string');
      }
      spawns.push({ file, args, options });
      setTimeout(() => callback(null, 'ok\n', ''), 900);
      return { pid: 1 };
    };
    const slow = runCli(['export-toc']);
    const rejecting = runCli(['move-item', '--position', '2']);

    await assert.rejects(rejecting, /must be of type string/);
    await slow;
    await sleep(20);
    assert.equal(progressPeak, 1, 'the slow run had to raise a spinner');
    assert.equal(progressOpen, 0, 'and the rejected run had to release it');
    assert.deepEqual(unhandled, []);
  });

  it('opens the log when the author takes the Show Log button', async () => {
    // The handler behind that button is real code, and a stub that always
    // answers `undefined` never runs it: rewriting the comparison to a string
    // nothing matches used to pass the entire suite.
    answers.warning = 'Show Log';
    plan = () => ({ stdout: 'ok\n', stderr: 'gave up the sync row\n' });
    await runCli(['delete-item', '--path', 'x', '--yes']);
    await sleep(5);
    assert.equal(of('channel.show').length, 1, 'the warning button shows it');

    events = [];
    answers.error = 'Show Log';
    plan = () => ({
      err: Object.assign(new Error('Command failed'), { code: 1 }),
      stderr: 'nope\n',
    });
    await runCli(['move-item', '--position', '9']);
    await sleep(5);
    assert.equal(of('channel.show').length, 1, 'and so does the error button');
  });

  it('leaves the log alone when the notification is dismissed', async () => {
    // The other half of the comparison: no button taken, no channel revealed.
    answers.warning = undefined;
    plan = () => ({ stdout: 'ok\n', stderr: 'gave up the sync row\n' });
    await runCli(['delete-item', '--path', 'x', '--yes']);
    await sleep(5);
    assert.equal(of('warning').length, 1);
    assert.deepEqual(of('channel.show'), []);
  });

  it('takes the progress down when the run fails, quietly', async () => {
    plan = () => ({
      delayMs: 900,
      err: Object.assign(new Error('Command failed'), { code: 1 }),
      stderr: 'Position must be between 1 and 4\n',
    });
    const failed = await runCli(['move-item', '--position', '9']);
    await sleep(20);

    assert.equal(failed, false, 'a failed run has to report false');
    assert.equal(
      progressOpen,
      0,
      'the indicator has to come down on a failure',
    );
    assert.equal(of('error').length, 1);
    assert.match(of('error')[0].text, /Position must be between 1 and 4/);
    assert.deepEqual(of('error')[0].items, ['Show Log']);
    assert.deepEqual(
      unhandled,
      [],
      'a failed run must not reach the host as an unhandled rejection',
    );
  });

  it('surfaces the stderr of a run that succeeded, with the log behind it', async () => {
    // Where delete-item names the Canvas objects a renumber collision put out
    // of reach: the one warning in this tool that cannot be undone.
    plan = () => ({
      stdout: '[ok] deleted 03-old-page\n',
      stderr: 'Gave up the sync row for 03-old-page (Canvas page 91234)\n',
    });
    assert.equal(await runCli(['delete-item', '--path', 'x', '--yes']), true);

    assert.equal(of('warning').length, 1);
    assert.match(of('warning')[0].text, /Canvas page 91234/);
    assert.deepEqual(
      of('warning')[0].items,
      ['Show Log'],
      'the warning has to offer the channel: the CLI lists one object per line',
    );
  });

  it('refuses a workspace with no CLI in it, and runs nothing', async () => {
    fs.rmSync(path.join(workspace, 'cli'), { recursive: true, force: true });
    try {
      const refused = await runCli(['new-module', '--name', 'x']);
      assert.equal(refused, false);
      assert.deepEqual(spawns, [], 'nothing may be spawned without a CLI path');
      assert.equal(of('error').length, 1);
      assert.match(of('error')[0].text, /cli\/index\.js/);
    } finally {
      fs.mkdirSync(path.join(workspace, 'cli'));
      fs.writeFileSync(path.join(workspace, 'cli', 'index.js'), '', 'utf8');
    }

    // And the refusal settles, so the queue behind it still moves.
    assert.equal(await runCli(['validate']), true);
  });

  it('keeps the queue moving when the spawn itself throws', async () => {
    // execFile validates its arguments synchronously, so a bad argv throws
    // where the run is started rather than where it ends. That rejection
    // belongs to the caller — but it must not leave the turn open, or every
    // command after it waits on a run that already ended.
    cp.execFile = () => {
      throw new TypeError('The "args" argument must be of type string');
    };
    await assert.rejects(
      runCli(['rename-item', '--path', 'x']),
      /must be of type string/,
    );

    installExecFileStub();
    assert.equal(
      await Promise.race([
        runCli(['validate']),
        sleep(1000).then(() => 'HUNG'),
      ]),
      true,
      'the command behind a thrown spawn must still run',
    );
    assert.deepEqual(unhandled, [], 'and nothing may reach the host unhandled');
  });

  // --- Preview ---
  //
  // The port decides two things at once: which address is polled to see whether
  // a server is already running, and which one the browser is sent to. A
  // hardcoded 3000 with Docusaurus on 3001 opened whatever else answered on
  // 3000, or waited two minutes for a preview that had been up the whole time.

  /**
   * Bind a server, resolving when it is up and REJECTING when it cannot be.
   * A `listen` with only a success callback never settles when the bind fails,
   * and `node --test` has no default timeout, so a port taken from under the
   * test would hang the suite instead of failing it.
   */
  function listen(server, options) {
    return new Promise((resolve, reject) => {
      const failed = (error) => reject(error);
      server.once('error', failed);
      server.listen(options, () => {
        server.removeListener('error', failed);
        resolve();
      });
    });
  }

  /**
   * An http server on a free port, and the port it got.
   *
   * Bound on every localhost address rather than on 127.0.0.1, because the
   * extension polls the NAME `localhost`, which resolves to ::1 first on a
   * dual-stack host. Node's Happy Eyeballs papers over the mismatch today; the
   * dual bind means the test does not depend on it.
   *
   * The fallback is not an IPv4 bind by request: `listen({ port: 0 })` asks for
   * the wildcard, which is `::` wherever IPv6 exists and 0.0.0.0 where it does
   * not. It is there for the host that refuses `::` outright, and on that host
   * 0.0.0.0 is what `localhost` resolves to anyway.
   */
  async function serverOnAFreePort() {
    const server = http.createServer((req, res) => {
      res.end('preview');
    });
    await listen(server, { port: 0, host: '::', ipv6Only: false }).catch(() =>
      listen(server, { port: 0 }),
    );
    return { server, port: server.address().port };
  }

  it('opens the port the setting names, and re-reads it every time', async () => {
    const first = await serverOnAFreePort();
    const second = await serverOnAFreePort();
    try {
      settings['courseManager.previewPort'] = first.port;
      await registered['course.preview']();
      assert.deepEqual(
        of('open').map((event) => event.uri.fsPath),
        [`http://localhost:${first.port}`],
      );
      assert.deepEqual(
        of('terminal.create'),
        [],
        'a server that is already up needs no terminal',
      );

      // Changed while the window stays open, which is the whole point of a
      // setting read at use time.
      events = [];
      settings['courseManager.previewPort'] = second.port;
      await registered['course.preview']();
      assert.deepEqual(
        of('open').map((event) => event.uri.fsPath),
        [`http://localhost:${second.port}`],
      );
    } finally {
      first.server.close();
      second.server.close();
    }
  });

  it('starts the dev server on the configured port', async () => {
    const { server, port } = await serverOnAFreePort();
    // Free again, so the command finds nothing there and starts one.
    await new Promise((resolve) => server.close(resolve));

    settings['courseManager.previewPort'] = port;
    await registered['course.preview']();

    assert.deepEqual(
      of('terminal.send').map((event) => event.text),
      [`npm start -- --port '${port}'`],
    );
    assert.deepEqual(of('open'), [], 'nothing to open until it answers');

    // Now let it answer, and let the poll behind the progress indicator find
    // it, so the test does not leave a two-minute timer running. Answered
    // rather than bound: re-taking the port the command was told about is a
    // race with whatever else is on this machine, and losing it would hang the
    // suite rather than fail it.
    http.get = (url, callback) => {
      events.push({ kind: 'http.get', url });
      callback({ resume() {} });
      return { on() {}, setTimeout() {}, destroy() {} };
    };
    await of('progress')[0].done;
    assert.deepEqual(
      of('http.get').map((event) => event.url),
      [`http://localhost:${port}`],
      'and it polls the port it started, not another',
    );
    assert.deepEqual(
      of('open').map((event) => event.uri.fsPath),
      [`http://localhost:${port}`],
    );
  });

  it('says so when the configured port is not one, and uses the default', async () => {
    settings['courseManager.previewPort'] = 70000;
    // Answer whatever it polls. The point here is the fallback and the
    // sentence about it, and a real 3000 is neither this test's to bind nor
    // its to leave polling for two minutes.
    http.get = (url, callback) => {
      events.push({ kind: 'http.get', url });
      callback({ resume() {} });
      return { on() {}, setTimeout() {}, destroy() {} };
    };
    await registered['course.preview']();

    assert.equal(of('warning').length, 1);
    assert.match(of('warning')[0].text, /previewPort/);
    assert.match(of('warning')[0].text, /70000/);
    assert.ok(
      !of('warning')[0].text.includes('null'),
      'the value has to be shown as itself: JSON renders NaN and Infinity as ' +
        'null, which reads as though nothing had been set',
    );
    assert.deepEqual(
      of('http.get').map((event) => event.url),
      ['http://localhost:3000'],
      'the refused value must not reach the address it polls',
    );
    assert.deepEqual(
      of('open').map((event) => event.uri.fsPath),
      ['http://localhost:3000'],
    );
  });

  it('shows a value JSON cannot render, rather than showing null', async () => {
    // A settings file cannot hold NaN, but `"previewPort": 3e999` parses to
    // Infinity, and JSON.stringify turns both into `null` — a sentence saying
    // the setting is `null` reads as though nothing had been set at all.
    settings['courseManager.previewPort'] = Infinity;
    http.get = (url, callback) => {
      events.push({ kind: 'http.get', url });
      callback({ resume() {} });
      return { on() {}, setTimeout() {}, destroy() {} };
    };
    await registered['course.preview']();

    assert.equal(of('warning').length, 1);
    assert.match(of('warning')[0].text, /is Infinity, which is not a port/);
  });

  // --- New item ---

  it('does not offer a subsection where one cannot go', async () => {
    // Invoked from a subheader row. The pick used to carry Subsection, and
    // picking it produced an error notification and nothing else.
    await registered['course.newItem']({
      contextValue: 'subheader',
      moduleFolderName: '01-intro',
      folderPath: path.join(workspace, 'course', '01-intro', '02-exercises'),
    });

    assert.equal(of('quickpick').length, 1, 'the type pick is the first ask');
    assert.deepEqual(
      of('quickpick')[0].items.map((item) => item.type),
      ['page', 'assignment', 'url', 'file'],
    );
    assert.deepEqual(of('error'), [], 'nothing to refuse afterwards');
  });

  it('offers it at module root, where it can', async () => {
    await registered['course.newItem']({
      contextValue: 'module',
      moduleFolderName: '01-intro',
    });

    assert.deepEqual(
      of('quickpick')[0].items.map((item) => item.type),
      ['page', 'assignment', 'url', 'subsection', 'file'],
    );
  });

  it('puts a validator on the points box, and passes what it took', async () => {
    // The host is what enforces validateInput, so this drives both halves: the
    // function the box was given, and the value that reaches the command line.
    answers.quickPick = (items) =>
      items.find((item) => item.type === 'assignment');
    answers.inputBox = (options) =>
      options.prompt.startsWith('Points') ? ' 40 ' : 'Week one';

    await registered['course.newItem']({
      contextValue: 'module',
      moduleFolderName: '01-intro',
    });

    const points = of('inputbox').find((box) =>
      box.options.prompt.startsWith('Points'),
    );
    assert.ok(points, 'an assignment has to ask for its points');
    assert.equal(
      typeof points.options.validateInput,
      'function',
      'and the box has to be able to refuse an answer',
    );
    assert.equal(points.options.validateInput('.5') === null, false);
    assert.equal(points.options.validateInput('abc') === null, false);
    assert.equal(points.options.validateInput('40'), null);
    // A fraction is a number of points like any other, here as at the flag.
    assert.equal(points.options.validateInput('2.5'), null);

    assert.equal(spawns.length, 1);
    const args = spawns[0].args.slice(1);
    assert.deepEqual(
      args.slice(args.indexOf('--points')),
      ['--points', '40'],
      'the value goes out trimmed',
    );
  });

  it('reads a cleared points box as the default, not as nothing', async () => {
    answers.quickPick = (items) =>
      items.find((item) => item.type === 'assignment');
    answers.inputBox = (options) =>
      options.prompt.startsWith('Points') ? '' : 'Week two';

    await registered['course.newItem']({
      contextValue: 'module',
      moduleFolderName: '01-intro',
    });

    const args = spawns[0].args.slice(1);
    assert.deepEqual(args.slice(args.indexOf('--points')), ['--points', '100']);
  });

  // --- The curated table of contents ---
  //
  // `course.tocReady` is what puts "Export via TOC" in the view menu and the
  // palette, and a context key dies with the window while exports/toc.md does
  // not. These drive `activate` itself, because that is where the key is
  // restored, and the command, because the menu can be one event behind.

  /** Every setContext this run made for the TOC key, newest last. */
  const tocKeyWrites = () =>
    events
      .filter(
        (event) =>
          event.kind === 'command' &&
          event.args[0] === 'setContext' &&
          event.args[1] === 'course.tocReady',
      )
      .map((event) => event.args[2]);

  it('restores the TOC-ready state from the file, on activation', () => {
    const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-toc-'));
    fs.mkdirSync(path.join(fresh, 'course'));
    const original = vscodeStub.workspace.workspaceFolders;
    try {
      vscodeStub.workspace.workspaceFolders = [{ uri: { fsPath: fresh } }];

      events = [];
      extension.activate({ subscriptions: [] });
      assert.deepEqual(
        tocKeyWrites(),
        [false],
        'with no exports/toc.md the key must not be armed',
      );

      fs.mkdirSync(path.join(fresh, 'exports'));
      fs.writeFileSync(path.join(fresh, 'exports', 'toc.md'), '- one\n');
      events = [];
      extension.activate({ subscriptions: [] });
      assert.deepEqual(
        tocKeyWrites(),
        [true],
        'a curated TOC on disk has to survive the reload that forgot the key',
      );
    } finally {
      // Put the module back on the workspace the rest of this file runs in.
      vscodeStub.workspace.workspaceFolders = original;
      extension.activate({ subscriptions: [] });
      fs.rmSync(fresh, { recursive: true, force: true });
    }
  });

  it('refuses the TOC export when the file is gone, and un-arms the menu', async () => {
    // The shape a watcher misses: `exports/` removed wholesale is one folder
    // event, not a delete of the file inside it. Without this the command
    // asked for a format and then failed in the terminal.
    await registered['course.exportCourseToc']();

    assert.equal(of('error').length, 1);
    assert.match(of('error')[0].text, /exports\/toc\.md/);
    assert.deepEqual(of('quickpick'), [], 'and it asks for nothing first');
    assert.deepEqual(tocKeyWrites(), [false]);
  });

  it('exports the curated list, and leaves the key as it found it', async () => {
    // Run all the way through, format and all. Stopping at the format pick
    // would leave everything past it unpinned — including the disarm this
    // command used to do, whose absence is the point of the test.
    answers.quickPick = (items) => items.find((item) => item.format === 'pdf');
    const exportsDir = path.join(workspace, 'exports');
    fs.mkdirSync(exportsDir, { recursive: true });
    fs.writeFileSync(path.join(exportsDir, 'toc.md'), '- one\n');
    try {
      await registered['course.exportCourseToc']();
    } finally {
      fs.rmSync(exportsDir, { recursive: true, force: true });
    }

    assert.deepEqual(of('error'), [], 'the file is there: nothing to refuse');
    assert.equal(of('quickpick').length, 1, 'it asks for a format, once');
    const sent = of('terminal.send');
    assert.equal(sent.length, 1, 'and streams the export into a terminal');
    // Quoted, because it is a value: the `q` the builder is handed is the
    // quoting function of the terminal that receives the line, and the stub
    // shell here is bash.
    assert.equal(
      sent[0].text,
      "npx course export --toc 'exports/toc.md' --format 'pdf'",
    );
    assert.deepEqual(
      tocKeyWrites(),
      [],
      'exporting the list does not remove it: the key has to stay armed, or ' +
        'the same list cannot be exported to the other format as well',
    );
  });

  it('settles a run whose reporting throws, and keeps the queue moving', async () => {
    // A disposed output channel, a stdout that is not the string it is read
    // as: anything in the completion callback can throw, and a throw that
    // skipped resolve() would hold the queue for the rest of the session.
    cp.execFile = (file, args, options, callback) => {
      spawns.push({ file, args, options });
      setTimeout(() => {
        callback(null, {
          trimEnd() {
            throw new Error('channel closed');
          },
        });
      }, 5);
      return { pid: 1 };
    };
    const wedger = runCli(['rename-item', '--path', 'x']);
    // Long enough for that callback to have run and thrown. Swapping the stub
    // any sooner would hand the good one to the run itself, which the queue
    // starts a microtask later.
    await sleep(60);

    cp.execFile = (file, args, options, callback) => {
      spawns.push({ file, args, options });
      setTimeout(() => callback(null, 'after\n', ''), 5);
      return { pid: 1 };
    };
    const after = runCli(['validate']);

    assert.equal(
      await Promise.race([wedger, sleep(1000).then(() => 'HUNG')]),
      false,
      'the run that could not be reported has to settle, as a failure',
    );
    assert.equal(
      await Promise.race([after, sleep(1000).then(() => 'HUNG')]),
      true,
      'the command behind it must still run',
    );
    assert.equal(of('error').length, 1);
    assert.match(of('error')[0].text, /channel closed/);
  });
});
