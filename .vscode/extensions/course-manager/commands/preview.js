const vscode = require('vscode');
const http = require('http');
const { validateWorkspace } = require('../workspace');
const { currentFlavour, quoterFor } = require('../terminal');
const { previewPort, previewTerminalEntry } = require('../helpers');

/**
 * The Docusaurus dev server: start it in a terminal of its own, poll until it
 * answers, then open it.
 */

/** The name the preview terminal is opened and found under. */
const PREVIEW_TERMINAL_NAME = 'Coursewright: Preview';

/**
 * The preview terminal and the shell it is running: `{ terminal, flavour }`.
 *
 * The preview keeps a terminal of its own, outside the pool: it is named, it
 * holds one long-running command, and nothing else may be typed into it. It
 * still needs its shell known for the same reason the pool entries do — the
 * command line typed into it carries a value — so it carries the same kind of
 * stamp, bound to the terminal object rather than to the name. See
 * `previewTerminalEntry` for what happens when the name belongs to somebody
 * else's terminal.
 */
let previewEntry = null;

function registerPreviewCommands({ register, workspaceRoot }) {
  // --- Preview (Docusaurus dev server) ---
  register('course.preview', async () => {
    if (!validateWorkspace()) return;

    // Read here rather than at activation: a setting changed to get out of a
    // port clash has to work on the next preview, not after a reload.
    const { port, rejected } = previewPort(
      vscode.workspace.getConfiguration('courseManager').get('previewPort'),
    );
    if (rejected !== null) {
      // A number is shown as itself: JSON renders NaN and Infinity as `null`,
      // which reads as though nothing had been set at all.
      const shown =
        typeof rejected === 'number'
          ? String(rejected)
          : JSON.stringify(rejected);
      vscode.window.showWarningMessage(
        `Coursewright: courseManager.previewPort is ${shown}, which is not a port number. Using ${port}.`,
      );
    }

    const url = `http://localhost:${port}`;
    if (await isServerUp(url)) {
      vscode.env.openExternal(vscode.Uri.parse(url));
      return;
    }

    previewEntry = previewTerminalEntry(
      vscode.window.terminals,
      PREVIEW_TERMINAL_NAME,
      previewEntry,
    );
    if (!previewEntry) {
      previewEntry = {
        terminal: vscode.window.createTerminal({
          name: PREVIEW_TERMINAL_NAME,
          cwd: workspaceRoot,
        }),
        flavour: currentFlavour(),
      };
    }
    const previewTerminal = previewEntry.terminal;
    previewTerminal.show();
    // The preview terminal is not in the pool, so it carries a stamp of its
    // own: this extension knows the shell of a terminal it created, and knows
    // nothing about one that outlived a window reload, where the current
    // default profile stands in as a guess (see `runInTerminal`). The port is
    // quoted like any other value a command line carries, so that nothing here
    // depends on what `previewPort` happens to return.
    const q = quoterFor(previewEntry.flavour);
    previewTerminal.sendText(`npm start -- --port ${q(port)}`);

    // Poll until the dev server answers (cold starts take a while), then open
    vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Window,
        title: 'Coursewright: starting preview…',
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
          'Coursewright: Preview server did not start within 2 minutes. Check the Preview terminal.',
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

module.exports = { registerPreviewCommands };
