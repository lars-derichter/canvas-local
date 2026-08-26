const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const cp = require('child_process');
const http = require('http');
const { CourseTreeProvider } = require('./CourseTreeProvider');
const {
  canvasModuleUrl,
  cliChildEnv,
  courseLocation,
  displayTitle,
  getCanvasId,
  getModuleCanvasId,
  pickTerminal,
  promoteActive,
  readEnvConfig,
  readFrontmatter,
  seedsDestination,
  shellFlavour,
  shellQuote,
  terminalNumber,
} = require('./helpers');

// Long-running / streaming commands run in a shared terminal. Structural
// commands (new/rename/move/delete) run silently via runCli and report
// through notifications + the output channel.
//
// The last three are the advanced commands: reachable from the command palette
// and from nowhere else, with no view/title entry and no context menu, so a
// stray click in the tree can never start one. The two resets need the terminal
// for a second reason. It is where the CLI asks its own questions, and those
// questions are the gate: reset-canvas prints an inventory of everything it is
// about to delete and waits for y/N, reset-sync-state waits for y/N. An answer
// typed there is the answer a hand-run terminal would have given.
const commands = {
  'course.setup': 'npx course setup',
  'course.init': 'npx course init',
  'course.sync': 'npx course sync',
  'course.syncDryRun': 'npx course sync --dry-run',
  'course.push': 'npx course push',
  'course.pushDryRun': 'npx course push --dry-run',
  'course.pull': 'npx course pull',
  'course.pullDryRun': 'npx course pull --dry-run',
  'course.status': 'npx course status',
  'course.validate': 'npx course validate',
  'course.buildGlossary': 'npx course build-glossary',
  'course.resetSyncState': 'npx course reset-sync-state',
  'course.resetCanvas': 'npx course reset-canvas',
};

let outputChannel;
let workspaceRoot;
let courseTreeProvider;

function getWorkspaceRoot() {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

/**
 * The workspace root, or null when no folder is open at all — the one case in
 * which a command cannot run and the caller has to give up.
 *
 * A workspace without a course/ directory is not that case. It draws a warning
 * naming the command that sets a course up, and the root is returned anyway, so
 * Setup and the other commands that write course/ still run.
 */
function validateWorkspace() {
  const root = getWorkspaceRoot();
  if (!root) {
    vscode.window.showErrorMessage(
      'Canvas Course Builder: No workspace folder open.',
    );
    return null;
  }

  const courseDir = path.join(root, 'course');
  if (!fs.existsSync(courseDir)) {
    vscode.window.showWarningMessage(
      'Canvas Course Builder: No course/ directory found. Run "Course: Setup (First-Run Wizard)" to create one.',
    );
  }

  return root;
}

// --- Terminal runner (for streaming commands like push/pull) ---

const TERMINAL_BASE_NAME = 'Canvas Course Builder';

// The terminals this extension streams commands into, most recently used
// last. `busy` means a sendText now would land inside whatever runs there:
// while `npx course sync` waits at a conflict prompt, a second command line
// would be read as that prompt's answer. Shell integration events flip the
// flag precisely; a terminal without them counts as busy from the moment we
// send into it (`awaitingStart`), and rejoins the pool only when shell
// integration starts reporting in it mid-run, or by closing. When the sent
// command finishes before integration ever reports, the terminal stays busy
// until closed; the pickTerminal cap bounds how many such terminals can
// accumulate.
let terminalPool = [];

function terminalPoolEntry(terminal) {
  return terminalPool.find((entry) => entry.terminal === terminal);
}

/** The quoting rules for the shell a terminal opened right now would run. */
function currentFlavour() {
  return shellFlavour(vscode.env.shell, process.platform);
}

/**
 * Send a command line to a pooled terminal.
 *
 * `build` is handed the quoting function for the shell running in the terminal
 * that will actually receive the line, and returns the line:
 *
 *     runInTerminal((q) => `npx course push --module ${q(moduleName)}`);
 *
 * Building after the pick rather than before is the whole point. Every value
 * interpolated into a command line has to be quoted — a search term is whatever
 * the author typed, and a folder name is whatever the author (or a Canvas pull)
 * created, and `01-intro; rm -rf ~` is a legal directory name on macOS and
 * Linux — but quoted *for which shell* is only settled once the terminal is
 * known. The pool outlives a change of default profile, so a terminal started
 * under Command Prompt is still running cmd after the author switches the
 * profile to PowerShell, and PowerShell's single quotes mean nothing to cmd:
 * `'a & calc'` typed there splits on the `&`. Quoting for the current profile
 * and then typing into a pooled terminal reopens exactly the hole this quoting
 * exists to close. Hence the stamp, recorded when the terminal is created and
 * used when it is reused.
 *
 * A terminal adopted from before a window reload has no knowable shell, so its
 * stamp is null and the current profile is used as a guess. It is a guess: the
 * author could have changed the profile across the reload. The alternative is
 * refusing to reuse adopted terminals at all, which would strand them at the
 * cap and stack up new ones.
 *
 * A value the target shell cannot represent at all (see `shellQuote`) makes
 * `build` throw, and then nothing is created, shown or typed — the author gets
 * the reason instead of a mangled command line.
 */
function runInTerminal(build) {
  const choice = pickTerminal(terminalPool, TERMINAL_BASE_NAME);
  const reused = choice.action === 'reuse' ? terminalPool[choice.index] : null;
  const flavour = reused?.flavour ?? currentFlavour();

  let commandStr;
  try {
    commandStr = build((value) => shellQuote(value, flavour));
  } catch (error) {
    // The refusal names the shell, which is only a fact for a terminal this
    // extension opened. For an adopted one the flavour is the default profile
    // standing in for a shell nobody here knows, and the message has to say so
    // rather than assert it.
    const guessed =
      reused != null && reused.flavour == null
        ? ' (that terminal was open before this window, so its shell is a guess)'
        : '';
    vscode.window.showErrorMessage(
      `Canvas Course Builder: ${error.message}${guessed}. Nothing was run.`,
    );
    return;
  }

  let entry;
  if (reused) {
    entry = reused;
    terminalPool.splice(choice.index, 1);
    terminalPool.push(entry); // most recently used last
  } else {
    entry = {
      terminal: vscode.window.createTerminal({
        name: choice.name,
        cwd: workspaceRoot,
      }),
      name: choice.name,
      busy: false,
      awaitingStart: false,
      flavour,
    };
    terminalPool.push(entry);
  }
  entry.busy = true;
  entry.awaitingStart = true;
  entry.terminal.show();
  entry.terminal.sendText(commandStr);
}

// --- Silent CLI runner (for structural commands) ---

/**
 * How much output one run may produce, per stream: `execFile` applies the
 * figure to stdout and to stderr separately, so a run is bounded at twice
 * this.
 *
 * The default is a megabyte, and Node kills the child on the byte after it, so
 * a run past the limit reaches the author as a truncated buffer and an error,
 * over a command that had already renamed half a directory. No structural
 * command comes near a megabyte today, which makes this insurance rather than a
 * fix — but the premium is a number in an options object and the claim is a
 * half-finished renumber.
 */
const CLI_MAX_BUFFER = 32 * 1024 * 1024;

/**
 * Run `npx course <args>` without a terminal. Output goes to the
 * "Canvas Course Builder" output channel; failures surface as error notifications.
 * Returns a promise resolving to true on success.
 */
function runCli(args) {
  return new Promise((resolve) => {
    const cliPath = path.join(workspaceRoot, 'cli', 'index.js');
    const useNode = fs.existsSync(cliPath);
    const cmd = useNode ? process.execPath : 'npx';
    const cmdArgs = useNode ? [cliPath, ...args] : ['course', ...args];

    outputChannel.appendLine(`$ course ${args.join(' ')}`);
    const options = {
      cwd: workspaceRoot,
      env: cliChildEnv(process.env),
      maxBuffer: CLI_MAX_BUFFER,
    };
    cp.execFile(cmd, cmdArgs, options, (err, stdout, stderr) => {
      if (stdout) outputChannel.appendLine(stdout.trimEnd());
      if (stderr) outputChannel.appendLine(stderr.trimEnd());
      if (err) {
        const firstError = (stderr || stdout || err.message)
          .trim()
          .split('\n')[0];
        vscode.window
          .showErrorMessage(`Canvas Course Builder: ${firstError}`, 'Show Log')
          .then((choice) => {
            if (choice === 'Show Log') outputChannel.show();
          });
        resolve(false);
      } else {
        // A run that succeeded and still wrote to stderr has something the
        // author has to act on, and until this it was written where nobody
        // looks: the output channel is only revealed behind the Show Log
        // button on a failure, and the status bar below is built from stdout.
        // The case that matters today is a delete whose renumber forced a sync
        // row to be given up, which strands a Canvas object nothing in the
        // project can reach afterwards — the CLI names each one, and a
        // notification is what carries that across.
        const warning = (stderr || '').trim();
        if (warning) {
          vscode.window
            .showWarningMessage(
              `Canvas Course Builder: ${warning.split('\n')[0]}`,
              'Show Log',
            )
            .then((choice) => {
              if (choice === 'Show Log') outputChannel.show();
            });
        }
        const lastLine = stdout.trim().split('\n').filter(Boolean).pop();
        if (lastLine)
          vscode.window.setStatusBarMessage(
            `Canvas Course Builder: ${lastLine.replace(/^\[[^\]]+\]\s*/, '')}`,
            5000,
          );
        courseTreeProvider.refresh();
        resolve(true);
      }
    });
  });
}

// --- Pickers (used when a command runs from the palette without a tree item) ---

/**
 * Where the active editor's file sits inside course/, or null. This is the
 * seed for every palette picker below: the detected module (or file) moves to
 * the top of its quick pick, marked, so Enter confirms it. Detection only
 * reorders — no pick is skipped and no choice removed, and a flow answered by
 * a tree item never reaches a picker at all.
 */
function activeCourseLocation() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.scheme !== 'file') return null;
  return courseLocation(workspaceRoot, editor.document.uri.fsPath);
}

function listModuleFolders() {
  const courseDir = path.join(workspaceRoot, 'course');
  if (!fs.existsSync(courseDir)) return [];
  return fs
    .readdirSync(courseDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('_'))
    .map((e) => e.name)
    .sort();
}

async function pickModuleFolder(placeHolder, { preselect = true } = {}) {
  const folders = listModuleFolders();
  if (folders.length === 0) {
    vscode.window.showErrorMessage(
      'Canvas Course Builder: No modules found in course/.',
    );
    return null;
  }
  let items = folders.map((f) => {
    const label =
      readCategoryLabel(path.join(workspaceRoot, 'course', f)) ||
      displayTitle(f);
    return { label, description: f, folder: f };
  });
  const location = preselect ? activeCourseLocation() : null;
  if (location) {
    items = promoteActive(
      items,
      (item) => item.folder === location.moduleFolder,
      "current file's module",
    );
  }
  const picked = await vscode.window.showQuickPick(items, { placeHolder });
  return picked ? picked.folder : null;
}

function readCategoryLabel(folderPath) {
  try {
    const cat = JSON.parse(
      fs.readFileSync(path.join(folderPath, '_category_.json'), 'utf8'),
    );
    return typeof cat.label === 'string' && cat.label.length > 0
      ? cat.label
      : null;
  } catch {
    return null;
  }
}

function listEntries(dir, { filesOnly = false } = {}) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => !e.name.startsWith('_') && /^\d+/.test(e.name))
    .filter((e) => (filesOnly ? e.isFile() : true))
    .map((e) => ({ name: e.name, isDirectory: e.isDirectory() }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Quick-pick an item (file or subsection) inside a module, descending into
 * subsections. Returns an absolute path or null. Every step seeds from the
 * active editor: its module first, then the file itself (or the subsection
 * on its path), each marked and confirmed with a plain Enter.
 */
async function pickItemPath(placeHolder, { preselect = true } = {}) {
  const location = preselect ? activeCourseLocation() : null;
  const folder = await pickModuleFolder('Select module', { preselect });
  if (!folder) return null;
  const moduleDir = path.join(workspaceRoot, 'course', folder);
  // The picked module may not be the detected one; the item steps only seed
  // inside the module the active file actually lies in.
  const segments =
    location && location.moduleFolder === folder ? location.segments : [];
  // With the active file at module root, segments[0] is the file itself; any
  // deeper and it is the directory holding it, which only a subsection row
  // (never a same-named file) may match.
  const activeIsNested = segments.length > 1;

  const entries = listEntries(moduleDir);
  if (entries.length === 0) {
    vscode.window.showErrorMessage(
      'Canvas Course Builder: No items in this module.',
    );
    return null;
  }
  const items = promoteActive(
    entries.map((e) => ({
      label: e.name,
      description: e.isDirectory ? 'subsection' : '',
      entry: e,
    })),
    (item) =>
      item.entry.name === segments[0] &&
      item.entry.isDirectory === activeIsNested,
    activeIsNested ? "current file's subsection" : 'current file',
  );
  const picked = await vscode.window.showQuickPick(items, { placeHolder });
  if (!picked) return null;

  if (picked.entry.isDirectory) {
    const subDir = path.join(moduleDir, picked.entry.name);
    const subEntries = listEntries(subDir, { filesOnly: true });
    const subItems = promoteActive(
      [
        { label: `(the subsection ${picked.entry.name} itself)`, entry: null },
      ].concat(subEntries.map((e) => ({ label: e.name, entry: e }))),
      (item) =>
        segments.length === 2 &&
        segments[0] === picked.entry.name &&
        item.entry != null &&
        item.entry.name === segments[1],
      'current file',
    );
    const sub = await vscode.window.showQuickPick(subItems, { placeHolder });
    if (!sub) return null;
    return sub.entry ? path.join(subDir, sub.entry.name) : subDir;
  }
  return path.join(moduleDir, picked.entry.name);
}

/**
 * Confirm a merge, the way both delete commands confirm a delete.
 *
 * The CLI's own y/N question lives on its interactive path only; driven from
 * here it takes `--source`/`--target`, so this modal is the whole of what
 * stands between a click and the source file being deleted.
 */
async function confirmMerge(sourcePath, targetPath) {
  const source = path.basename(sourcePath);
  const target = path.basename(targetPath);
  const choice = await vscode.window.showWarningMessage(
    `Merge "${source}" into "${target}"? "${source}" will be deleted.`,
    { modal: true },
    'Merge',
  );
  return choice === 'Merge';
}

/**
 * Resolve the target path from a context-menu tree item, or fall back to a
 * quick pick when invoked from the command palette.
 */
async function resolveItemPath(treeItem, placeHolder) {
  if (treeItem && (treeItem.filePath || treeItem.folderPath)) {
    return treeItem.filePath || treeItem.folderPath;
  }
  return pickItemPath(placeHolder);
}

async function resolveModuleFolder(treeItem, placeHolder) {
  if (
    treeItem &&
    treeItem.contextValue === 'module' &&
    treeItem.moduleFolderName
  ) {
    return treeItem.moduleFolderName;
  }
  return pickModuleFolder(placeHolder);
}

/** Ask which output format to export to. Returns 'pdf', 'docx', or null. */
async function pickFormat() {
  const picked = await vscode.window.showQuickPick(
    [
      { label: 'PDF', format: 'pdf' },
      { label: 'Word (DOCX)', format: 'docx' },
    ],
    { placeHolder: 'Output format' },
  );
  return picked ? picked.format : null;
}

// --- Activation ---

function activate(context) {
  workspaceRoot = getWorkspaceRoot();
  outputChannel = vscode.window.createOutputChannel('Canvas Course Builder');
  context.subscriptions.push(outputChannel);

  // --- Tree view ---
  courseTreeProvider = new CourseTreeProvider(workspaceRoot, { runCli });
  const treeView = vscode.window.createTreeView('courseTree', {
    treeDataProvider: courseTreeProvider,
    dragAndDropController: courseTreeProvider,
    showCollapseAll: true,
    canSelectMany: true,
  });
  context.subscriptions.push(treeView);

  const register = (id, handler) => {
    context.subscriptions.push(vscode.commands.registerCommand(id, handler));
  };

  register('course.refreshTree', () => courseTreeProvider.refresh());

  // File watcher for auto-refresh
  if (workspaceRoot) {
    const coursePattern = new vscode.RelativePattern(
      path.join(workspaceRoot, 'course'),
      '**/*',
    );
    const watcher = vscode.workspace.createFileSystemWatcher(coursePattern);
    let refreshTimer;
    const debouncedRefresh = () => {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => courseTreeProvider.refresh(), 500);
    };
    watcher.onDidCreate(debouncedRefresh);
    watcher.onDidDelete(debouncedRefresh);
    watcher.onDidChange(debouncedRefresh);
    context.subscriptions.push(watcher);
  }

  // --- Terminal pool bookkeeping ---

  // Adopt pool-named terminals that survived a window reload, so a fresh
  // window does not stack a second "Canvas Course Builder" beside the old
  // one. Their state is unknowable, and unknowable means busy: each rejoins
  // the pool when shell integration activates in it, when it reports a
  // command ending, or by closing. Which shell they run is unknowable too, so
  // the flavour stamp stays null and a line for one of them is quoted for the
  // current default profile — a guess, and `runInTerminal` says why it is the
  // one taken.
  for (const terminal of vscode.window.terminals) {
    if (terminalNumber(terminal.name, TERMINAL_BASE_NAME) !== null) {
      terminalPool.push({
        terminal,
        name: terminal.name,
        busy: true,
        awaitingStart: false,
        flavour: null,
      });
    }
  }

  context.subscriptions.push(
    vscode.window.onDidCloseTerminal((terminal) => {
      terminalPool = terminalPool.filter((e) => e.terminal !== terminal);
    }),
  );

  // Shell integration is the precise busy signal. Its events need VS Code >=
  // 1.93 (package.json requires that much), but the typeof checks keep an
  // older host on the sendText-marks-busy fallback instead of crashing here.
  if (
    typeof vscode.window.onDidStartTerminalShellExecution === 'function' &&
    typeof vscode.window.onDidEndTerminalShellExecution === 'function'
  ) {
    context.subscriptions.push(
      vscode.window.onDidStartTerminalShellExecution((event) => {
        const entry = terminalPoolEntry(event.terminal);
        if (entry) {
          entry.busy = true;
          entry.awaitingStart = false;
        }
      }),
      vscode.window.onDidEndTerminalShellExecution((event) => {
        const entry = terminalPoolEntry(event.terminal);
        if (entry) {
          entry.busy = false;
          entry.awaitingStart = false;
        }
      }),
    );
  }
  if (typeof vscode.window.onDidChangeTerminalShellIntegration === 'function') {
    context.subscriptions.push(
      vscode.window.onDidChangeTerminalShellIntegration((event) => {
        const entry = terminalPoolEntry(event.terminal);
        // Integration activates at a shell prompt, so nothing is running
        // there — unless it is a command we just sent that integration has
        // not reported started yet.
        if (entry && !entry.awaitingStart) entry.busy = false;
      }),
    );
  }

  // --- Terminal-based commands (streaming output) ---
  // The four exempt from the course/-missing warning are the four that do not
  // read course/: Setup writes it, Init writes .env and the sync state, and
  // both resets operate on that state and on Canvas. Setup is also the command
  // the warning now points at, so leaving it in would have interrupted the run
  // that was about to answer it. Reset Sync State is precisely what you reach
  // for when the project is in a state you cannot sync out of, so warning that
  // it looks unfinished would be advice pointing the wrong way.
  const noValidationCommands = new Set([
    'course.setup',
    'course.init',
    'course.resetSyncState',
    'course.resetCanvas',
  ]);
  for (const [id, cmd] of Object.entries(commands)) {
    register(id, () => {
      if (!noValidationCommands.has(id) && !validateWorkspace()) return;
      runInTerminal(() => cmd);
    });
  }

  // The sync family, scoped to the module row it was clicked on: the inline
  // push button and the three context-menu entries beside it. Each reads that
  // row and does nothing without one, so none of them is offered in the
  // palette, which carries the whole-course Sync, Push, Pull and Status
  // instead, and a Push Module that asks which module to send.
  //
  // All four stream into the terminal rather than through the silent runner.
  // What they produce is a report to read as it arrives, and two of them stop
  // for an answer even on this flag set, where the silent runner would hang at
  // a prompt nobody can see. Sync asks twice over: which side wins when both
  // sides reordered the module (the CLI's `--order` default is `ask`, no flag
  // involved), and whether a path that vanished and a new one with the same
  // title in the same folder are one item renamed. Push asks before the first
  // push to a Canvas course that already holds content and that this project
  // has never pushed to, which `--module` does not suppress. Pull and status
  // ask nothing here, and follow the other two so the group behaves one way.
  register('course.pushItem', (treeItem) => {
    const moduleName = treeItem?.moduleFolderName;
    if (!moduleName) return;
    if (!validateWorkspace()) return;
    runInTerminal((q) => `npx course push --module ${q(moduleName)}`);
  });

  register('course.syncItem', (treeItem) => {
    const moduleName = treeItem?.moduleFolderName;
    if (!moduleName) return;
    if (!validateWorkspace()) return;
    runInTerminal((q) => `npx course sync --module ${q(moduleName)}`);
  });

  register('course.pullItem', (treeItem) => {
    const moduleName = treeItem?.moduleFolderName;
    if (!moduleName) return;
    if (!validateWorkspace()) return;
    runInTerminal((q) => `npx course pull --module ${q(moduleName)}`);
  });

  register('course.statusItem', (treeItem) => {
    const moduleName = treeItem?.moduleFolderName;
    if (!moduleName) return;
    if (!validateWorkspace()) return;
    runInTerminal((q) => `npx course status --module ${q(moduleName)}`);
  });

  register('course.pushModule', async () => {
    if (!validateWorkspace()) return;
    const picked = await pickModuleFolder('Select module to push');
    if (picked) {
      runInTerminal((q) => `npx course push --module ${q(picked)}`);
    }
  });

  register('course.search', async () => {
    if (!validateWorkspace()) return;
    const keyword = await vscode.window.showInputBox({
      prompt: 'Search course content for a word or phrase',
      placeHolder: 'e.g. flexbox',
      validateInput: (v) => (v.trim() ? null : 'Enter a search term'),
    });
    if (!keyword) return;
    runInTerminal((q) => `npx course search ${q(keyword.trim())}`);
  });

  // --- Module commands (context-aware) ---

  register('course.newModule', async () => {
    if (!validateWorkspace()) return;
    const name = await vscode.window.showInputBox({
      prompt: 'Name for the new module',
      validateInput: (v) => (v.trim() ? null : 'Name is required'),
    });
    if (!name) return;
    await runCli(['new-module', '--name', name.trim()]);
  });

  register('course.renameModule', async (treeItem) => {
    if (!validateWorkspace()) return;
    const folder = await resolveModuleFolder(
      treeItem,
      'Select module to rename',
    );
    if (!folder) return;
    const currentLabel =
      readCategoryLabel(path.join(workspaceRoot, 'course', folder)) ||
      displayTitle(folder);
    const name = await vscode.window.showInputBox({
      prompt: `New name for "${currentLabel}"`,
      value: currentLabel,
      validateInput: (v) => (v.trim() ? null : 'Name is required'),
    });
    if (!name) return;
    await runCli(['rename-module', '--module', folder, '--name', name.trim()]);
  });

  register('course.moveModule', async (treeItem) => {
    if (!validateWorkspace()) return;
    const folder = await resolveModuleFolder(treeItem, 'Select module to move');
    if (!folder) return;
    const count = listModuleFolders().length;
    const positions = Array.from({ length: count }, (_, i) => String(i + 1));
    const position = await vscode.window.showQuickPick(positions, {
      placeHolder: `New position for ${folder} (1-${count})`,
    });
    if (!position) return;
    await runCli(['move-module', '--module', folder, '--position', position]);
  });

  register('course.deleteModule', async (treeItem) => {
    if (!validateWorkspace()) return;
    const folder = await resolveModuleFolder(
      treeItem,
      'Select module to delete',
    );
    if (!folder) return;
    const choice = await vscode.window.showWarningMessage(
      `Delete module "${folder}" and all its contents?`,
      { modal: true },
      'Delete',
    );
    if (choice !== 'Delete') return;
    await runCli(['delete-module', '--module', folder, '--yes']);
  });

  // --- Item commands (context-aware) ---

  register('course.newItem', async (treeItem) => {
    if (!validateWorkspace()) return;

    let moduleFolder = treeItem?.moduleFolderName;
    let subsection =
      treeItem?.contextValue === 'subheader'
        ? path.basename(treeItem.folderPath)
        : null;
    if (!moduleFolder) {
      moduleFolder = await pickModuleFolder('Select module for the new item');
      if (!moduleFolder) return;
    }

    const type = await vscode.window.showQuickPick(
      [
        { label: 'Page', type: 'page' },
        { label: 'Assignment', type: 'assignment' },
        { label: 'External URL', type: 'url' },
        {
          label: 'Subsection',
          type: 'subsection',
          description: 'module root only',
        },
        { label: 'File', type: 'file' },
      ],
      { placeHolder: 'Type of the new item' },
    );
    if (!type) return;

    if (type.type === 'subsection' && subsection) {
      vscode.window.showErrorMessage(
        'Canvas Course Builder: Subsections can only be created at module root level.',
      );
      return;
    }

    const args = ['new-item', '--module', moduleFolder, '--type', type.type];
    if (subsection) args.push('--subsection', subsection);

    if (type.type === 'file') {
      const picked = await vscode.window.showOpenDialog({
        canSelectMany: false,
        openLabel: 'Add file',
      });
      if (!picked || picked.length === 0) return;
      args.push('--file', picked[0].fsPath);
    } else {
      const name = await vscode.window.showInputBox({
        prompt: `Name for the new ${type.label.toLowerCase()}`,
        validateInput: (v) => (v.trim() ? null : 'Name is required'),
      });
      if (!name) return;
      args.push('--name', name.trim());

      if (type.type === 'url') {
        const url = await vscode.window.showInputBox({
          prompt: 'URL',
          validateInput: (v) => {
            try {
              new URL(v);
              return null;
            } catch {
              return 'Enter a valid URL';
            }
          },
        });
        if (!url) return;
        args.push('--url', url);
      } else if (type.type === 'assignment') {
        const points = await vscode.window.showInputBox({
          prompt: 'Points possible',
          value: '100',
        });
        if (points === undefined) return;
        args.push('--points', points || '100');
      }
    }

    await runCli(args);
  });

  register('course.renameItem', async (treeItem) => {
    if (!validateWorkspace()) return;
    const itemPath = await resolveItemPath(treeItem, 'Select item to rename');
    if (!itemPath) return;
    const currentLabel =
      typeof treeItem?.label === 'string'
        ? treeItem.label
        : path.basename(itemPath);
    const name = await vscode.window.showInputBox({
      prompt: `New name for "${currentLabel}"`,
      value: currentLabel,
      validateInput: (v) => (v.trim() ? null : 'Name is required'),
    });
    if (!name) return;
    await runCli(['rename-item', '--path', itemPath, '--name', name.trim()]);
  });

  register('course.moveItem', async (treeItem) => {
    if (!validateWorkspace()) return;
    const itemPath = await resolveItemPath(treeItem, 'Select item to move');
    if (!itemPath) return;
    const count = listEntries(path.dirname(itemPath)).length;
    const positions = Array.from({ length: count }, (_, i) => String(i + 1));
    const position = await vscode.window.showQuickPick(positions, {
      placeHolder: `New position for ${path.basename(itemPath)} (1-${count})`,
    });
    if (!position) return;
    await runCli(['move-item', '--path', itemPath, '--position', position]);
  });

  register('course.moveItemToModule', async (treeItem) => {
    if (!validateWorkspace()) return;
    const itemPath = await resolveItemPath(treeItem, 'Select item to move');
    if (!itemPath) return;
    // Seed the destination with the active file's module only for an item
    // from elsewhere. For an item already in that module, Enter would run
    // movetomodule-item onto its own module, which appends and gap-closes:
    // a silent move to the end, not a no-op.
    const preselect = seedsDestination(
      courseLocation(workspaceRoot, itemPath),
      activeCourseLocation(),
    );
    const destModule = await pickModuleFolder('Move to which module?', {
      preselect,
    });
    if (!destModule) return;

    const args = [
      'movetomodule-item',
      '--path',
      itemPath,
      '--to-module',
      destModule,
    ];

    // A subsection can't be nested inside another subsection — move it to the
    // module root and skip the sub-section prompt.
    const isSubsection =
      fs.existsSync(itemPath) && fs.statSync(itemPath).isDirectory();

    // Offer subsections of the destination module, when there are any
    const destDir = path.join(workspaceRoot, 'course', destModule);
    const subsections = isSubsection
      ? []
      : listEntries(destDir).filter((e) => e.isDirectory);
    if (subsections.length > 0) {
      const sub = await vscode.window.showQuickPick(
        [{ label: '(module root)', name: null }].concat(
          subsections.map((s) => ({ label: s.name, name: s.name })),
        ),
        { placeHolder: 'Where in the module?' },
      );
      if (!sub) return;
      if (sub.name) args.push('--to-subsection', sub.name);
    }

    await runCli(args);
  });

  register('course.deleteItem', async (treeItem) => {
    if (!validateWorkspace()) return;
    const itemPath = await resolveItemPath(treeItem, 'Select item to delete');
    if (!itemPath) return;
    const isDir =
      fs.existsSync(itemPath) && fs.statSync(itemPath).isDirectory();
    const label =
      path.basename(itemPath) + (isDir ? '/ and all its contents' : '');
    const choice = await vscode.window.showWarningMessage(
      `Delete ${label}?`,
      { modal: true },
      'Delete',
    );
    if (choice !== 'Delete') return;
    await runCli(['delete-item', '--path', itemPath, '--yes']);
  });

  // --- Merge (two-step context menu) ---
  let mergeSource = null;

  register('course.mergeSetSource', (treeItem) => {
    if (!treeItem?.filePath) return;
    mergeSource = treeItem;
    vscode.commands.executeCommand('setContext', 'course.mergeSourceSet', true);
    vscode.window.showInformationMessage(
      `Canvas Course Builder: Merge source set to "${path.basename(treeItem.filePath)}". Now right-click the target item.`,
    );
  });

  register('course.mergeWithSource', async (treeItem) => {
    if (!mergeSource?.filePath || !treeItem?.filePath) return;
    if (!validateWorkspace()) return;

    const sourcePath = mergeSource.filePath;
    const targetPath = treeItem.filePath;

    // Before the source is dropped: a cancelled merge leaves it armed, so the
    // author can go straight to another target instead of setting it again.
    if (!(await confirmMerge(sourcePath, targetPath))) return;

    mergeSource = null;
    vscode.commands.executeCommand(
      'setContext',
      'course.mergeSourceSet',
      false,
    );

    await runCli([
      'merge-items',
      '--source',
      sourcePath,
      '--target',
      targetPath,
      '--yes',
    ]);
  });

  register('course.mergeItems', async () => {
    if (!validateWorkspace()) return;
    const sourcePath = await pickItemPath(
      'Source item (appended, then deleted)',
    );
    if (!sourcePath) return;
    // No seed for the target: the active file is the natural source, and
    // offering it first here would point Enter at merging it into itself.
    const targetPath = await pickItemPath(
      'Target item (keeps frontmatter, receives content)',
      { preselect: false },
    );
    if (!targetPath) return;
    if (!(await confirmMerge(sourcePath, targetPath))) return;
    await runCli([
      'merge-items',
      '--source',
      sourcePath,
      '--target',
      targetPath,
      '--yes',
    ]);
  });

  // --- Split at cursor ---
  register('course.splitItem', async () => {
    if (!validateWorkspace()) return;
    const editor = vscode.window.activeTextEditor;
    if (!editor || !editor.document.fileName.endsWith('.md')) {
      vscode.window.showErrorMessage(
        'Canvas Course Builder: Open a markdown file and place the cursor on the split line.',
      );
      return;
    }
    if (editor.document.isDirty) {
      await editor.document.save();
    }
    const filePath = editor.document.uri.fsPath;
    const line = editor.selection.active.line + 1; // VS Code is 0-based
    await runCli(['split-item', '--file', filePath, '--line', String(line)]);
  });

  // --- Export to PDF/DOCX (pandoc + typst) ---
  // Output streams in the shared terminal, where pandoc/preflight messages
  // belong. Item export supports multi-select: the second handler argument is
  // the full tree selection when several items are highlighted.
  //
  // Paths and folder names are quoted; `--format` is not, because `pickFormat`
  // can only return the literal 'pdf' or 'docx'. Quoting it would suggest the
  // value comes from somewhere it does not.
  register('course.exportItem', async (item, selected) => {
    if (!validateWorkspace()) return;
    const chosen =
      Array.isArray(selected) && selected.length
        ? selected
        : item
          ? [item]
          : [];
    let paths = [
      ...new Set(chosen.map((t) => t && t.filePath).filter(Boolean)),
    ];
    if (paths.length === 0) {
      const single = await resolveItemPath(item, 'Select item to export');
      if (!single) return;
      paths = [single];
    }
    const format = await pickFormat();
    if (!format) return;
    runInTerminal(
      (q) => `npx course export ${paths.map(q).join(' ')} --format ${format}`,
    );
  });

  register('course.exportModule', async (treeItem) => {
    if (!validateWorkspace()) return;
    const folder = await resolveModuleFolder(
      treeItem,
      'Select module to export',
    );
    if (!folder) return;
    const format = await pickFormat();
    if (!format) return;
    runInTerminal(
      (q) => `npx course export --module ${q(folder)} --format ${format}`,
    );
  });

  register('course.exportCourse', async () => {
    if (!validateWorkspace()) return;
    const scope = await vscode.window.showQuickPick(
      [
        { label: 'Full course', scope: 'full' },
        {
          label: 'Only flagged items',
          description: 'frontmatter export: true',
          scope: 'flagged',
        },
        {
          label: 'Via table of contents…',
          description: 'curate a list first',
          scope: 'toc',
        },
      ],
      { placeHolder: 'What to export' },
    );
    if (!scope) return;

    if (scope.scope === 'toc') {
      // Two-step flow: generate the TOC, open it for editing, then gate the
      // "Export via TOC" action (view menu) behind a context key.
      const ok = await runCli(['export-toc']);
      if (!ok) return;
      const tocPath = path.join(workspaceRoot, 'exports', 'toc.md');
      try {
        const doc = await vscode.workspace.openTextDocument(tocPath);
        await vscode.window.showTextDocument(doc);
      } catch {
        /* the file was written; opening is best-effort */
      }
      vscode.commands.executeCommand('setContext', 'course.tocReady', true);
      vscode.window.showInformationMessage(
        'Canvas Course Builder: Delete the item lines you do not want, then run "Course: Export via TOC" from the view menu.',
      );
      return;
    }

    const format = await pickFormat();
    if (!format) return;
    const flag = scope.scope === 'flagged' ? ' --flagged' : '';
    runInTerminal(() => `npx course export${flag} --format ${format}`);
  });

  register('course.exportCourseToc', async () => {
    if (!validateWorkspace()) return;
    const format = await pickFormat();
    if (!format) return;
    runInTerminal(
      (q) =>
        `npx course export --toc ${q('exports/toc.md')} --format ${format}`,
    );
    vscode.commands.executeCommand('setContext', 'course.tocReady', false);
  });

  // --- Open in Canvas ---
  register('course.openInCanvas', (treeItem) => {
    if (!workspaceRoot) return;
    const env = readEnvConfig(workspaceRoot);
    const apiUrl = env.CANVAS_API_URL;
    const courseId = env.CANVAS_COURSE_ID;

    if (!apiUrl || !courseId) {
      vscode.window.showWarningMessage(
        'Canvas Course Builder: No Canvas API configuration found. Run "Course: Init" first.',
      );
      return;
    }

    // Strip /api/v1 suffix if present to get the base URL
    const baseUrl = apiUrl.replace(/\/api\/v1\/?$/, '');

    if (treeItem?.contextValue === 'module') {
      // A module is keyed in the sync state by its folder name, not by a path,
      // so its id comes from the module entry rather than from getCanvasId. A
      // module never pushed has none, and lands on the plain modules page.
      const moduleId = getModuleCanvasId(
        workspaceRoot,
        treeItem.moduleFolderName,
      );
      vscode.env.openExternal(
        vscode.Uri.parse(canvasModuleUrl(baseUrl, courseId, moduleId)),
      );
      return;
    }

    if (!treeItem?.filePath) return;

    // External URL items: open the URL itself
    if (treeItem.contextValue === 'external_url') {
      const fm = readFrontmatter(treeItem.filePath);
      if (fm.externalUrl) {
        vscode.env.openExternal(vscode.Uri.parse(fm.externalUrl));
        return;
      }
    }

    const canvasId = getCanvasId(workspaceRoot, treeItem.filePath);
    if (!canvasId) {
      vscode.window.showInformationMessage(
        'Canvas Course Builder: This item has not been pushed to Canvas yet.',
      );
      return;
    }

    const canvasType = treeItem.contextValue;
    let url;
    if (canvasType === 'assignment') {
      url = `${baseUrl}/courses/${courseId}/assignments/${canvasId}`;
    } else if (canvasType === 'discussion') {
      url = `${baseUrl}/courses/${courseId}/discussion_topics/${canvasId}`;
    } else if (canvasType === 'quiz') {
      url = `${baseUrl}/courses/${courseId}/quizzes/${canvasId}`;
    } else if (canvasType === 'file') {
      url = `${baseUrl}/courses/${courseId}/files/${canvasId}`;
    } else if (
      canvasType === 'external_url' ||
      canvasType === 'external_tool'
    ) {
      // A link and an LTI launch are nothing but a module item, so the item is
      // the thing to open. canvas_id holds that item's id for both types.
      url = `${baseUrl}/courses/${courseId}/modules/items/${canvasId}`;
    } else {
      // Pages — canvas_id is the page slug or numeric id; Canvas accepts both
      url = `${baseUrl}/courses/${courseId}/pages/${canvasId}`;
    }

    vscode.env.openExternal(vscode.Uri.parse(url));
  });

  // --- Preview (Docusaurus dev server) ---
  register('course.preview', async () => {
    if (!validateWorkspace()) return;

    const url = 'http://localhost:3000';
    if (await isServerUp(url)) {
      vscode.env.openExternal(vscode.Uri.parse(url));
      return;
    }

    let previewTerminal = vscode.window.terminals.find(
      (t) => t.name === 'Canvas Course Builder: Preview',
    );
    if (!previewTerminal) {
      previewTerminal = vscode.window.createTerminal({
        name: 'Canvas Course Builder: Preview',
        cwd: workspaceRoot,
      });
    }
    previewTerminal.show();
    previewTerminal.sendText('npm start');

    // Poll until the dev server answers (cold starts take a while), then open
    vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Window,
        title: 'Canvas Course Builder: starting preview…',
      },
      async () => {
        for (let i = 0; i < 60; i++) {
          await new Promise((r) => setTimeout(r, 2000));
          if (await isServerUp(url)) {
            vscode.env.openExternal(vscode.Uri.parse(url));
            return;
          }
        }
        vscode.window.showWarningMessage(
          'Canvas Course Builder: Preview server did not start within 2 minutes. Check the Preview terminal.',
        );
      },
    );
  });
}

function isServerUp(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function deactivate() {}

module.exports = { activate, deactivate };
