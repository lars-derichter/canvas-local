const vscode = require('vscode');
const {
  pickTerminal,
  shellFlavour,
  shellQuote,
  terminalNumber,
} = require('./helpers');

/**
 * The shared terminals the streaming commands type into, and the quoting that
 * makes a command line safe to type into one of them.
 *
 * Every value a command line carries is quoted, by the `q` `runInTerminal`
 * hands the builder, and `quoterFor` is the only place `shellQuote` is called
 * from — so no handler anywhere can quote for a shell of its own choosing.
 */

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

/** The workspace a new terminal opens in. Set once, at activation. */
let workspaceRoot;

function terminalPoolEntry(terminal) {
  return terminalPool.find((entry) => entry.terminal === terminal);
}

/** The quoting rules for the shell a terminal opened right now would run. */
function currentFlavour() {
  return shellFlavour(vscode.env.shell, process.platform);
}

/**
 * The `q` a command line is built with: quoting for the shell running in the
 * terminal that is about to receive the line.
 *
 * The single call site of `shellQuote` in this file, so that no handler can
 * quote for a shell of its own choosing. A null stamp means the terminal's
 * shell is not knowable — one adopted from before a window reload — and the
 * current default profile stands in for it, which `runInTerminal` explains and
 * says out loud when it costs anything.
 */
function quoterFor(flavour) {
  return (value) => shellQuote(value, flavour ?? currentFlavour());
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
    commandStr = build(quoterFor(flavour));
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

/**
 * Wire the pool up to the window: adopt what survived a reload, and follow the
 * shell-integration events that say whether a terminal is free.
 */
function initTerminals({ context, workspaceRoot: root }) {
  workspaceRoot = root;

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
}

module.exports = {
  initTerminals,
  runInTerminal,
  currentFlavour,
  quoterFor,
};
