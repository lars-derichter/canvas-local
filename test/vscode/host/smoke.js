const vscode = require('vscode');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

/**
 * The extension in a real VS Code, rather than in this project's model of one.
 *
 * Everything else that covers the extension reads its source as text
 * (`test/vscode/extension.test.js`) or executes it against a stub `vscode`
 * (`test/vscode/extension.live.test.js`, `test/vscode/tree.live.test.js`).
 * Both are worth having and neither can answer the question this file exists
 * for: where the stub and the host disagree, the stub wins and nobody finds
 * out. So this runs inside an extension host that `test/vscode/host/run.js`
 * boots, against the extension **installed from its own `.vsix`** — not the
 * repository folder — so the artifact under test is the one `vscode:install`
 * puts in a user's editor.
 *
 * Five things, and deliberately no more:
 *
 * 1. the extension activates, and activates lazily, the way the host would
 *    activate it for a course author who clicks something;
 * 2. every command the packaged manifest declares is registered in the host,
 *    and no `course.` command is registered that the manifest does not
 *    declare. `extension.live.test.js` already asserts that pairing, and
 *    catches all six `register*Commands` deletions on its own — this is not
 *    the gap WP18 left. What it reads is the *source* manifest against a
 *    *stub* registry; what this reads is the manifest the host parsed out of
 *    the installed `.vsix` against the host's own command registry, which is
 *    the pairing a course author's click actually depends on;
 * 3. the tree provider returns the tutorial module, built out of real
 *    `vscode.TreeItem`s rather than the stub's;
 * 4. the provider `activate()` built is bound to a tree view at all, and the
 *    contributed `courseTree` sidebar is the view it is bound to. Those are
 *    two cases rather than one because only the first can be proved without a
 *    drawn sidebar, and a Windows CI runner does not draw one — the second
 *    reports itself skipped there rather than passing quietly;
 * 5. the seven context-menu-only commands are gated out of the palette in the
 *    manifest the host loaded, and are still registered so the menus that do
 *    show them work.
 *
 * What it is not: an end-to-end test of the commands. Nothing here runs the
 * CLI, and nothing writes to Canvas or to `course/`. The workspace is this
 * repository, `.env` and all, so a case that executed a sync would sync a real
 * course. Keep it that way: `course.refreshTree` is the only command invoked,
 * because re-reading the `course/` folder is the only thing any of the
 * thirty-nine does that is safe to do unasked.
 */

/** The identifier the packaged extension installs under: publisher.name. */
const EXTENSION_ID = 'local.canvas-course-builder';

/** The module the welcome view, the README and `docs/first-course.md` point at. */
const TUTORIAL_MODULE = '01-getting-started';

/**
 * The commands that exist for the tree's context menus and must never appear
 * in the palette, where they have no item to act on.
 *
 * Written out rather than derived. Deriving them from the manifest would
 * compare the manifest against itself, and no rule in the manifest separates
 * these from `course.newItem`, which is in the same context menu and belongs
 * in the palette too. The intent is the pin, so the intent is written down.
 */
const PALETTE_HIDDEN = [
  'course.mergeSetSource',
  'course.mergeWithSource',
  'course.openInCanvas',
  'course.pullItem',
  'course.pushItem',
  'course.statusItem',
  'course.syncItem',
];

/** How long revealing the sidebar gets to reach the tree provider. */
const REVEAL_TIMEOUT_MS = 20000;

/** Poll `condition` until it holds or `timeoutMs` runs out. Never throws. */
async function waitFor(condition, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (!condition() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

// --- A runner small enough to read ---
//
// `node --test` runs every other test in this project, and it is not what runs
// here. The host is Electron: on the version `engines.vscode` floors at it
// carries Node 20, which has no in-process `run()` (that arrives in 22.8), and
// the root-suite fallback reports failure by setting `process.exitCode`, which
// VS Code overwrites when it exits the test window itself. Mocha is the
// alternative and the VS Code default, and it would be the project's first
// test dependency. So: this, thirty lines, with `node:assert/strict` doing the
// actual asserting exactly as it does everywhere else.

const cases = [];

/** Register one case. They run in the order they are written. */
function check(name, fn) {
  cases.push({ name, fn });
}

/**
 * What a case throws when its environment cannot run it.
 *
 * Thrown rather than returned, so a case cannot end up skipped by falling off
 * the end of a function, and reported on its own line by the runner rather
 * than folded into the pass count — a guard that did not run has to look
 * different from one that ran and held.
 */
class Skipped extends Error {}

/** Give up on this case, visibly, for a reason worth printing. */
function skip(reason) {
  throw new Skipped(reason);
}

let extensionUnderTest;

/** The installed extension, asserted into existence once and reused. */
function extension() {
  assert.ok(
    extensionUnderTest,
    `${EXTENSION_ID} is not installed in this host — the .vsix did not install`,
  );
  return extensionUnderTest;
}

/**
 * One of the extension's own modules: the object the host loaded, not a second
 * copy of the same file.
 *
 * This is a cache lookup rather than a `require` of a path built from
 * `ext.extensionPath`, and the difference is the whole point. Two cases here
 * wrap a method on `CourseTreeProvider.prototype` to watch what the live
 * provider does; wrap a prototype on a *different* module object and the
 * wrapper sits there catching nothing.
 *
 * That is not hypothetical. `ext.extensionPath` is VS Code's spelling of the
 * path, out of a URI, and the require cache is keyed by Node's, out of module
 * resolution, and nothing guarantees the two agree. On macOS they disagree
 * already — `/var/folders/…` from VS Code against `/private/var/folders/…` in
 * the cache — and it works anyway, purely because Node resolves symlinks on
 * the way in, so both spellings land on one entry. Windows has two spelling
 * axes with no such reconciliation, drive-letter case (VS Code lower-cases it,
 * Node does not) and 8.3 short names (`os.tmpdir()` hands back `RUNNER~1` on a
 * GitHub runner), and there the path-built `require` produced a second module
 * object, a second prototype, and two cases that failed in 2ms saying they
 * could not reach the provider.
 *
 * Asking the cache what is already loaded sidesteps every spelling question:
 * whatever the host called it, that entry is the one the extension is using.
 * It also loads nothing, so it cannot add the second entry it is avoiding.
 */
function extensionModule(basename) {
  const ext = extension();
  const loaded = Object.values(require.cache || {}).filter(
    (entry) => entry && path.basename(entry.filename) === basename,
  );
  assert.ok(
    loaded.length > 0,
    `the host has not loaded ${basename}. The extension is ` +
      `${ext.isActive ? 'active' : 'NOT active'}, so either activation does ` +
      'not reach that module or this is being asked too early.',
  );

  // One is the ordinary answer and the answer this expects. More than one
  // means the same file has been loaded twice under two spellings — the
  // failure this function exists to prevent — so it says which, rather than
  // picking one and hoping.
  if (loaded.length > 1) {
    const folder = path.basename(ext.extensionPath).toLowerCase();
    const mine = loaded.filter((entry) =>
      entry.filename.toLowerCase().includes(folder),
    );
    assert.equal(
      mine.length,
      1,
      `${basename} is in the require cache ${loaded.length} times and ` +
        `${mine.length} of them are under the installed extension: ` +
        `${loaded.map((entry) => entry.filename).join(', ')}. Two spellings ` +
        'of one path are two module objects with two prototypes, and a ' +
        'wrapper on one of them watches the other do nothing.',
    );
    return mine[0].exports;
  }
  return loaded[0].exports;
}

check('the packaged extension is installed and its manifest parsed', () => {
  extensionUnderTest = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(
    extensionUnderTest,
    `${EXTENSION_ID} is not among the ${vscode.extensions.all.length} ` +
      'extensions this host loaded. Either the .vsix failed to install, or ' +
      'the publisher/name in the extension manifest changed.',
  );
  assert.equal(extensionUnderTest.packageJSON.main, './extension.js');
});

check('opens this repository, so the tree has a course to read', () => {
  const folders = vscode.workspace.workspaceFolders || [];
  assert.equal(folders.length, 1, 'the host should have opened one folder');
  const root = folders[0].uri.fsPath;
  assert.ok(
    fs.existsSync(path.join(root, 'course', TUTORIAL_MODULE)),
    `the opened folder ${root} has no course/${TUTORIAL_MODULE}`,
  );
});

check('activates when a command asks for it, and not before', async () => {
  const ext = extension();
  // The manifest lists no `activationEvents`. That is not "always active": VS
  // Code generates one per contributed command and one per contributed view,
  // and this is where that generation is either true or a course author's
  // first click does nothing. Nothing has been clicked yet, so it is asleep.
  assert.equal(
    ext.isActive,
    false,
    'something activated the extension before any command was invoked',
  );
  await vscode.commands.executeCommand('course.refreshTree');
  assert.equal(
    ext.isActive,
    true,
    'invoking a contributed command did not activate the extension',
  );
});

check(
  'registers exactly the commands the packaged manifest declares',
  async () => {
    const ext = extension();
    const declared = ext.packageJSON.contributes.commands.map((c) => c.command);
    const registered = new Set(await vscode.commands.getCommands(true));

    const missing = declared.filter((id) => !registered.has(id)).sort();
    // The offenders go in the message rather than being left to the diff: a
    // custom message replaces `deepEqual`'s output entirely, and a failure
    // that does not name the commands is a failure nobody can act on.
    assert.deepEqual(
      missing,
      [],
      `the manifest declares ${missing.length} commands the host has never ` +
        `heard of: ${missing.join(', ')}. Every one is a live "command not ` +
        'found" for whoever clicks it, and a whole group of them means a ' +
        'register*Commands call is missing from activate().',
    );

    // The other direction. `course.` is what every id in this extension is
    // spelled with, so a stray registration is caught by prefix; one registered
    // under a foreign prefix would not be, and nothing here pretends otherwise.
    const declaredSet = new Set(declared);
    const undeclared = [...registered]
      .filter((id) => id.startsWith('course.') && !declaredSet.has(id))
      .sort();
    assert.deepEqual(
      undeclared,
      [],
      `${undeclared.join(', ')} — registered in the host and declared ` +
        'nowhere, so nothing in the palette or the menus can reach them',
    );

    // A floor, for the same reason `cli-contract.test.js` has them: both
    // comparisons above are satisfied by two empty sets, so a manifest that lost
    // its `commands` array would pass a test that says nothing. Lower this in
    // the same commit as a genuine removal, and only then.
    assert.ok(
      declared.length >= 39,
      `the manifest declares ${declared.length} commands and this suite has ` +
        'held at least 39 since WP18. If commands were removed on purpose, ' +
        'lower the floor here in that commit.',
    );
  },
);

check('contributes the tree view and its container', async () => {
  const registered = new Set(await vscode.commands.getCommands(true));
  // VS Code generates these from `contributes.views` and
  // `contributes.viewsContainers`. Their absence means the sidebar the whole
  // extension is built around never appeared, whatever `activate()` did.
  assert.ok(
    registered.has('courseTree.focus'),
    'the courseTree view is not contributed to this host',
  );
  assert.ok(
    registered.has('workbench.view.extension.course-manager'),
    'the Course Manager activity-bar container is not contributed',
  );
});

check('the tree returns the tutorial module', async () => {
  // The extension's own module, so the provider built here is an instance of
  // the class the extension is using. What a second instance cannot borrow is
  // the view — that is the next two cases — but the items still come back as
  // the host's real TreeItem, ThemeIcon and Uri rather than the stub's.
  const { CourseTreeProvider } = extensionModule('CourseTreeProvider.js');
  const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
  const provider = new CourseTreeProvider(root, {});

  const modules = await provider.getChildren();
  const tutorial = modules.find((m) => m.moduleFolderName === TUTORIAL_MODULE);
  assert.ok(
    tutorial,
    `course/${TUTORIAL_MODULE} is not in the tree. Modules found: ` +
      JSON.stringify(modules.map((m) => m.moduleFolderName)),
  );

  const item = provider.getTreeItem(tutorial);
  assert.ok(
    item instanceof vscode.TreeItem,
    'the tree handed the host something that is not a TreeItem',
  );
  assert.equal(
    item.label,
    'Getting Started',
    'label comes from _category_.json',
  );
  assert.equal(item.contextValue, 'module');
  assert.equal(
    item.collapsibleState,
    vscode.TreeItemCollapsibleState.Collapsed,
  );
  assert.ok(
    item.iconPath instanceof vscode.ThemeIcon,
    'the module icon is not a real ThemeIcon',
  );

  const children = await provider.getChildren(tutorial);
  assert.ok(children.length > 0, 'the tutorial module came back empty');
});

/**
 * The provider `activate()` built, not one this file built for itself.
 *
 * There is no handle on it: it lives in a closure. But it is an instance of
 * the class in the installed extension's own module, and `course.refreshTree`
 * calls `refresh()` on it, so a wrapper on the prototype catches it by its
 * `this` the next time that command runs. Every case that wants the live
 * object goes through here.
 */
async function liveTreeProvider() {
  const { CourseTreeProvider } = extensionModule('CourseTreeProvider.js');
  const original = CourseTreeProvider.prototype.refresh;
  let instance;
  CourseTreeProvider.prototype.refresh = function refresh() {
    instance = this;
    return original.call(this);
  };
  try {
    await vscode.commands.executeCommand('course.refreshTree');
  } finally {
    CourseTreeProvider.prototype.refresh = original;
  }
  assert.ok(
    instance,
    'course.refreshTree ran without calling refresh() on a CourseTreeProvider, ' +
      'so this file cannot reach the provider the extension built',
  );
  return { instance, CourseTreeProvider };
}

check('binds the tree provider to a view, drawn or not', async () => {
  // Contributing the view and building the provider are two things, and the
  // line that joins them — `vscode.window.createTreeView('courseTree', …)` —
  // is one line in `activate()` with nothing else pinning it: delete it and
  // the sidebar is empty while all 2156 of `npm test` stay green.
  //
  // The next case proves that join the way a user sees it, by revealing the
  // view and catching the read. This one proves it without a pixel, because
  // the case that needs a rendered sidebar cannot run everywhere: on a Windows
  // CI runner the pane never became visible and that case waited its whole
  // bound for a read that never came, on a machine that had run the seven
  // others in 120ms.
  //
  // What is left when you take the rendering away: handing a provider to
  // `createTreeView` makes VS Code subscribe to its `onDidChangeTreeData`,
  // there and then, before anything is drawn. Nothing else in this extension
  // subscribes to that emitter. So a listener on it means the provider was
  // handed over, and no listener means it was not.
  const { instance } = await liveTreeProvider();
  const emitter = instance._onDidChangeTreeData;

  // `hasListeners()` is a real method on the object `new vscode.EventEmitter()`
  // returns, but it is not in `vscode.d.ts`. If a future VS Code drops it, this
  // says so instead of quietly deciding the answer is no.
  assert.equal(
    typeof emitter?.hasListeners,
    'function',
    'vscode.EventEmitter no longer offers hasListeners(), so this case cannot ' +
      'tell a bound provider from an unbound one and needs rewriting',
  );
  assert.ok(
    emitter.hasListeners(),
    "nothing is listening to the provider's onDidChangeTreeData, so it was " +
      'never handed to a tree view — `createTreeView` is missing from ' +
      'activate(), and the sidebar is empty',
  );
});

check('draws that tree in the sidebar the manifest contributes', async () => {
  const { CourseTreeProvider } = await liveTreeProvider();
  const original = CourseTreeProvider.prototype.getChildren;
  const asked = [];
  CourseTreeProvider.prototype.getChildren = function getChildren(element) {
    asked.push(element);
    return original.call(this, element);
  };
  try {
    await vscode.commands.executeCommand('courseTree.focus');
    // Rendering is asynchronous, so this waits for the read rather than
    // sleeping a guessed number of milliseconds.
    await waitFor(
      () => asked.some((element) => element === undefined),
      REVEAL_TIMEOUT_MS,
    );
  } finally {
    CourseTreeProvider.prototype.getChildren = original;
  }
  const read = asked.some((element) => element === undefined);

  // VS Code registers this when it renders a tree view pane, and it does so
  // whether or not any extension bound a provider to it — measured by deleting
  // `createTreeView` and watching the command turn up anyway. That makes it the
  // one thing here that separates "the sidebar never drew" from "the sidebar
  // drew and asked nobody", which are a skip and a failure respectively.
  const rendered = (await vscode.commands.getCommands(true)).includes(
    'workbench.actions.treeView.courseTree.collapseAll',
  );

  if (read) {
    // Pin the marker from the side that cannot rot. If VS Code ever renames
    // it, this fails here — on a machine where the sidebar demonstrably works
    // — rather than turning every later run into a silent skip.
    assert.ok(
      rendered,
      'the view rendered and read the provider, but the command this case ' +
        'uses to detect a rendered pane is missing. It has moved, and the ' +
        'skip below can no longer be trusted to mean what it says.',
    );
    return;
  }
  if (rendered) {
    assert.fail(
      `the courseTree pane rendered and did not ask the provider for its root ` +
        `within ${REVEAL_TIMEOUT_MS}ms, so the view the manifest contributes ` +
        'is not attached to the tree the extension builds',
    );
  }
  skip(
    `the courseTree pane never rendered within ${REVEAL_TIMEOUT_MS}ms on ` +
      `${process.platform}, so there was no read to catch. A window with no ` +
      'desktop to draw on does this: the Linux leg passes through xvfb, which ' +
      'gives it one. The binding itself is still covered by the case above, ' +
      'which needs no pixels; what is NOT covered here is that the provider ' +
      'is bound to this view id rather than some other.',
  );
});

check('keeps the context-menu-only commands out of the palette', async () => {
  const ext = extension();
  const palette = ext.packageJSON.contributes.menus.commandPalette || [];

  const gated = palette
    .filter((entry) => String(entry.when).trim() === 'false')
    .map((entry) => entry.command)
    .sort();
  assert.deepEqual(
    gated,
    PALETTE_HIDDEN,
    `gated out of the palette: ${gated.join(', ') || '(none)'}. Expected ` +
      `exactly ${PALETTE_HIDDEN.join(', ')}. A \`when\` that is no longer ` +
      '`false` puts a command that needs a tree item in front of someone who ' +
      'has not selected one.',
  );
  const listed = palette.map((entry) => entry.command).sort();
  assert.deepEqual(
    listed,
    PALETTE_HIDDEN,
    `the commandPalette menu lists ${listed.join(', ')}, which is not the ` +
      'seven gates, so it is doing something this test does not describe',
  );

  // Gating a command out of the palette is only safe while some other menu
  // still offers it. This is the rule the literal list above cannot express.
  const menus = ext.packageJSON.contributes.menus;
  const elsewhere = new Set(
    Object.entries(menus)
      .filter(([name]) => name !== 'commandPalette')
      .flatMap(([, entries]) => entries.map((entry) => entry.command)),
  );
  const unreachable = gated.filter((id) => !elsewhere.has(id)).sort();
  assert.deepEqual(
    unreachable,
    [],
    `${unreachable.join(', ')} — hidden from the palette and offered by no ` +
      'other menu, so nothing in the editor can run them',
  );

  // Hidden is not unregistered. A `when: false` command still has to answer
  // when the context menu calls it.
  const registered = new Set(await vscode.commands.getCommands(true));
  const missing = gated.filter((id) => !registered.has(id)).sort();
  assert.deepEqual(
    missing,
    [],
    `${missing.join(', ')} — hidden from the palette and not registered ` +
      'either, so the context menu offers a command that does not exist',
  );
});

/**
 * What VS Code calls. Runs every case in order, reports each one as it goes so
 * a hang names the case it hung in, and throws a summary if any failed.
 */
exports.run = async function run() {
  const failures = [];
  const skipped = [];
  console.log(`# extension-host smoke test, ${cases.length} cases`);
  // A run of nothing is a pass, which is the failure `check-test-glob.js`
  // exists to prevent for `npm test` and the failure case 4's own floor exists
  // to prevent for the command list. Neuter `check()` and every line below
  // still prints, ending in `# fail 0` and exit 0. So the case list has a
  // floor too, and it is asserted before the first case rather than after the
  // last, because a run that registered nothing has nothing to report.
  assert.ok(
    cases.length >= 9,
    `only ${cases.length} smoke cases registered, and this file has held at ` +
      'least 9 since it was written. If cases were removed on purpose, lower ' +
      'the floor here in that commit.',
  );
  for (const [index, testCase] of cases.entries()) {
    const number = index + 1;
    const elapsed = Date.now();
    try {
      await testCase.fn();
      console.log(
        `ok ${number} - ${testCase.name} (${Date.now() - elapsed}ms)`,
      );
    } catch (error) {
      const took = Date.now() - elapsed;
      // A skip is neither a pass nor a failure and is printed as neither, so
      // nobody reads a run with a guard switched off as a run with it on.
      const bucket = error instanceof Skipped ? skipped : failures;
      bucket.push({ name: testCase.name, error });
      const label = error instanceof Skipped ? 'skip' : 'not ok';
      console.log(`${label} ${number} - ${testCase.name} (${took}ms)`);
      const detail =
        error instanceof Skipped
          ? String(error.message)
          : String(error && error.stack ? error.stack : error);
      console.log(
        detail
          .split('\n')
          .map((line) => `  ${line}`)
          .join('\n'),
      );
    }
  }
  console.log(`# pass ${cases.length - failures.length - skipped.length}`);
  console.log(`# skip ${skipped.length}`);
  console.log(`# fail ${failures.length}`);
  for (const one of skipped) {
    console.log(`# NOT VERIFIED HERE: ${one.name}`);
  }
  if (failures.length > 0) {
    throw new Error(
      `${failures.length} of ${cases.length} host smoke cases failed: ` +
        failures.map((failure) => failure.name).join('; '),
    );
  }
};
