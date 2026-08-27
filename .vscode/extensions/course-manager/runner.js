const vscode = require('vscode');
const cp = require('child_process');
const {
  cliChildEnv,
  cliEntryPoint,
  createProgressGate,
  createSerialQueue,
} = require('./helpers');

/**
 * The silent CLI runner, for the structural commands (new/rename/move/delete).
 *
 * They produce no report worth watching arrive, so they run without a terminal:
 * output goes to the output channel, failures to a notification, and the tree
 * is refreshed when one succeeds. Nothing on this path reaches a shell — every
 * value the author typed is one argv entry — which is why `execFile` is handed
 * no `shell` option and must never be.
 */

/** The workspace the CLI runs in, and where the reports go. Set at activation. */
let workspaceRoot;
let outputChannel;
let courseTreeProvider;

function initRunner({
  workspaceRoot: root,
  outputChannel: channel,
  courseTreeProvider: provider,
}) {
  workspaceRoot = root;
  outputChannel = channel;
  courseTreeProvider = provider;
}

/**
 * How much output one run may produce, per stream: `execFile` applies the
 * figure to stdout and to stderr separately, so a run is bounded at twice this,
 * and the queue below bounds it to one run at a time.
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
 * How long a run may take before Node kills it.
 *
 * Nothing on this path waits for a network. Eleven of the twelve subcommands
 * the silent runner invokes do load the Canvas HTTP layer, because the CLI
 * entry point pulls it in, but none of them ever calls into it: a request trap
 * around a `rename-item` run counts zero. So a run is local file work plus
 * node's own startup, and the heaviest of them — `export-toc`, which walks the
 * whole tree — takes 0.27s wall here over three runs, most of it node starting.
 * Five minutes is a thousand times that, and well past copying a large asset
 * onto a slow disk, so a legitimate run cannot reach it.
 *
 * What can reach it is a child that never exits: a CLI that grew a prompt
 * nobody can answer, or a loop. Without this, the command waits on it forever,
 * silently. A killed run can leave a half-finished renumber, which is why the
 * number is high enough that only a broken run sees it.
 *
 * What it does *not* promise: `execFile` kills with SIGTERM and never
 * escalates. That is enough for the child this runs — the CLI installs no
 * signal handler, so the default disposition applies — but a process wedged in
 * uninterruptible I/O ignores SIGKILL as readily, so escalating would buy
 * nothing here. A child that cannot be killed is beyond this, and the run
 * behind it stays outstanding.
 */
const CLI_TIMEOUT_MS = 5 * 60 * 1000;

/** How long a run may take before it says so. */
const PROGRESS_AFTER_MS = 750;

/** Structural commands run one at a time. See `createSerialQueue`. */
const cliQueue = createSerialQueue();

/**
 * Feedback for runs slow enough to look like nothing happening. Queueing makes
 * that likelier, not rarer: a command waiting its turn has not started at all.
 *
 * The window location keeps it to a spinner in the status bar, where the result
 * line lands afterwards; a notification per rename would be a nuisance, and so
 * would ten spinners for a ten-row drop, which is why the gate shares one. The
 * promise handed to withProgress is resolved by the gate when the last
 * outstanding run settles, and never rejected: a failed run has to take the
 * spinner down, not carry its failure into the host.
 */
const trackProgress = createProgressGate(
  (announce) => {
    const timer = setTimeout(announce, PROGRESS_AFTER_MS);
    return () => clearTimeout(timer);
  },
  (title) => {
    let finish;
    const held = new Promise((resolve) => {
      finish = resolve;
    });
    vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title },
      () => held,
    );
    return finish;
  },
);

/**
 * Run `npx course <args>` without a terminal. Output goes to the
 * "Coursewright" output channel; failures surface as error notifications.
 * Returns a promise resolving to true on success.
 *
 * The run waits its turn: see `createSerialQueue` for why two of these must
 * never overlap.
 */
function runCli(args) {
  const run = cliQueue(() => execCli(args));
  trackProgress(run, `Coursewright: course ${args[0]}`);
  return run;
}

/** One run of the CLI, once the queue has given it its turn. */
function execCli(args) {
  return new Promise((resolve) => {
    const cliPath = cliEntryPoint(workspaceRoot);
    if (!cliPath) {
      vscode.window.showErrorMessage(
        'Coursewright: No cli/index.js in this workspace, so there is no course CLI to run. Open the course project folder itself.',
      );
      resolve(false);
      return;
    }

    outputChannel.appendLine(`$ course ${args.join(' ')}`);
    const options = {
      cwd: workspaceRoot,
      env: cliChildEnv(process.env),
      maxBuffer: CLI_MAX_BUFFER,
      timeout: CLI_TIMEOUT_MS,
    };
    cp.execFile(
      process.execPath,
      [cliPath, ...args],
      options,
      (err, stdout, stderr) => {
        try {
          settle(err, stdout, stderr);
        } catch (error) {
          // Reporting a run must not be able to leave the run unfinished. Every
          // line below the try is a call into the host — a channel that was
          // disposed, a stdout that is not the string it is read as — and a
          // throw here skips `resolve` on a promise nothing else will settle.
          // The command would then hang with no error, and once these runs are
          // queued the ones behind it hang too, for the rest of the session.
          //
          // False rather than true: the run may well have done its work and
          // only the reporting failed, but a caller that branches on this
          // (`if (!ok) return`) should stop rather than build on a result
          // nobody could read.
          try {
            vscode.window.showErrorMessage(`Coursewright: ${error.message}`);
          } catch {
            /* the host itself is unreachable; settling is what is left */
          }
          // That inner catch is defence in depth and nothing tests it: to
          // reach it, showErrorMessage has to throw while the host is still
          // running this extension. It is here so that `resolve` below cannot
          // be skipped by the reporting of a failure to report.
          resolve(false);
        }
      },
    );

    /** Report one finished run and settle it. Throws only into the catch above. */
    function settle(err, stdout, stderr) {
      if (stdout) outputChannel.appendLine(stdout.trimEnd());
      if (stderr) outputChannel.appendLine(stderr.trimEnd());
      if (err) {
        const firstError = (stderr || stdout || err.message)
          .trim()
          .split('\n')[0];
        vscode.window
          .showErrorMessage(`Coursewright: ${firstError}`, 'Show Log')
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
              `Coursewright: ${warning.split('\n')[0]}`,
              'Show Log',
            )
            .then((choice) => {
              if (choice === 'Show Log') outputChannel.show();
            });
        }
        const lastLine = stdout.trim().split('\n').filter(Boolean).pop();
        if (lastLine)
          vscode.window.setStatusBarMessage(
            `Coursewright: ${lastLine.replace(/^\[[^\]]+\]\s*/, '')}`,
            5000,
          );
        courseTreeProvider.refresh();
        resolve(true);
      }
    }
  });
}

module.exports = { initRunner, runCli };
