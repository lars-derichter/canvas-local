const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const path = require('path');
const fs = require('fs');
const os = require('os');
const cp = require('child_process');

/**
 * The silent CLI runner, executed rather than read.
 *
 * `test/vscode/extension.test.js` matches patterns against `extension.js` as
 * text, because the file requires `vscode` and cannot be loaded outside the
 * host. That catches a line going missing and nothing else: changing
 * `if (!cliPath)` to `if (cliPath === undefined)` leaves every assertion there
 * green while sending `null` into execFile. This file loads the real
 * `extension.js` against a stub `vscode` and a stub `child_process`, calls
 * `activate`, and drives `runCli` end to end.
 *
 * What it is not: proof that the extension works in VS Code. The stub is this
 * project's model of the host, not the host, and a behaviour VS Code has that
 * the stub does not is invisible here — an extension-host smoke test
 * (`@vscode/test-electron`) is a different and still-open job. What it does
 * prove is that the runner's own logic runs: the queue, the refusal, the
 * spawn options, the reporting, and what happens when reporting fails.
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
 * returns the one that was picked, or undefined to dismiss.
 */
let answers = {};

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
      events.push({ kind: 'terminal.create', name: options.name });
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
      events.push({ kind: 'progress', ...options });
      return Promise.resolve(task({ report() {} })).then(
        (value) => {
          progressOpen--;
          return value;
        },
        (error) => {
          progressOpen--;
          throw error;
        },
      );
    },
    showQuickPick: (items, options) => {
      events.push({ kind: 'quickpick', items, options });
      return Promise.resolve(
        answers.quickPick ? answers.quickPick(items, options) : undefined,
      );
    },
    showInputBox: () => Promise.resolve(undefined),
    activeTextEditor: undefined,
    onDidCloseTerminal: () => disposable(),
    onDidStartTerminalShellExecution: () => disposable(),
    onDidEndTerminalShellExecution: () => disposable(),
    onDidChangeTerminalShellIntegration: () => disposable(),
  },
  workspace: {
    workspaceFolders: undefined, // set in `before`, once the temp root exists
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
  env: { shell: '/bin/bash', openExternal: () => Promise.resolve(true) },
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

describe('VS Code extension: the silent runner, run', () => {
  let workspace;
  let extension;
  let runCli;
  let realExecFile;
  let realResolve;
  let unhandled;
  let collectUnhandled;

  before(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ccb-runner-'));
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
    unhandled.length = 0;
    installExecFileStub();
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
    process.env.CCB_LIVE_PROBE = 'probe value';
    const before = { ...process.env };
    plan = () => ({ stdout: 'ok\n' });
    try {
      await runCli(['rename-item', '--path', 'x']);
    } finally {
      delete process.env.CCB_LIVE_PROBE;
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
    assert.equal(spawn.options.env.CCB_LIVE_PROBE, 'probe value');
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
      { ...process.env, CCB_LIVE_PROBE: 'probe value' },
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
    const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'ccb-toc-'));
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
    assert.match(sent[0].text, /^npx course export --toc .*--format pdf$/);
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
