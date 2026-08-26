const vscode = require('vscode');
const fs = require('fs');
const { validateWorkspace } = require('../workspace');
const { runCli } = require('../runner');
const { runInTerminal } = require('../terminal');
const {
  pickFormat,
  resolveItemPath,
  resolveModuleFolder,
} = require('../pickers');
const { curatedTocPath } = require('../helpers');

/**
 * Exporting to PDF/DOCX, and the context key that decides whether the curated
 * table of contents can be exported at all. The key, its watcher and the
 * command that reads it are three halves of one mechanism, so they live
 * together.
 */
function registerExportCommands({ context, register, workspaceRoot }) {
  // --- The curated table of contents ---
  //
  // `course.tocReady` gates "Course: Export via TOC..." wherever it is offered.
  // The key says one thing: exports/toc.md is there to be exported. Nothing
  // else may write it, or the menu starts disagreeing with the disk.
  //
  // Context keys do not survive a window reload, which is what this restores:
  // the file sat there while the only command that consumes it had vanished
  // from the menu. The watcher is the other half — a TOC deleted by hand takes
  // the command away with it, rather than leaving an entry that fails in the
  // terminal. Neither is load-bearing on its own: `course.exportCourseToc`
  // checks the file itself, because a menu can always be one event behind.
  const setTocReady = (ready) =>
    vscode.commands.executeCommand('setContext', 'course.tocReady', ready);
  if (workspaceRoot) {
    setTocReady(fs.existsSync(curatedTocPath(workspaceRoot)));
    // Relative to the workspace root rather than to exports/, which may not
    // exist yet: a pattern rooted at a missing folder has nothing to watch,
    // and the file being created is exactly the event that matters.
    const tocWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(workspaceRoot, 'exports/toc.md'),
    );
    tocWatcher.onDidCreate(() => setTocReady(true));
    tocWatcher.onDidDelete(() => setTocReady(false));
    context.subscriptions.push(tocWatcher);
  }

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
      (q) =>
        `npx course export ${paths.map(q).join(' ')} --format ${q(format)}`,
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
      (q) => `npx course export --module ${q(folder)} --format ${q(format)}`,
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
      // Two-step flow: generate the TOC, open it for editing, then arm the key
      // that offers "Course: Export via TOC..." in the view menu.
      const ok = await runCli(['export-toc']);
      if (!ok) return;
      const tocPath = curatedTocPath(workspaceRoot);
      try {
        const doc = await vscode.workspace.openTextDocument(tocPath);
        await vscode.window.showTextDocument(doc);
      } catch {
        /* the file was written; opening is best-effort */
      }
      // The watcher would arm the key too, on its own schedule. This says so
      // now, so the entry is there by the time the author has finished editing.
      setTocReady(true);
      vscode.window.showInformationMessage(
        'Canvas Course Builder: Delete the item lines you do not want, then run "Course: Export via TOC..." from the view menu.',
      );
      return;
    }

    const format = await pickFormat();
    if (!format) return;
    // Two whole command lines rather than one with a fragment spliced in. The
    // rule this file follows is that every value a command line carries is
    // quoted, and `--flagged` is not a value: writing it as one would need an
    // exemption from the rule, and an exemption is something a reader has to
    // prove rather than read.
    if (scope.scope === 'flagged') {
      runInTerminal((q) => `npx course export --flagged --format ${q(format)}`);
    } else {
      runInTerminal((q) => `npx course export --format ${q(format)}`);
    }
  });

  register('course.exportCourseToc', async () => {
    if (!validateWorkspace()) return;
    // The menu entry can be one event behind the disk — a TOC deleted while
    // the window is open, or an `exports/` removed wholesale, which a watcher
    // reports as one folder event rather than as the file inside it. Checking
    // here turns that into a sentence instead of a CLI error in the terminal,
    // and puts the menu straight on the way past.
    if (!fs.existsSync(curatedTocPath(workspaceRoot))) {
      setTocReady(false);
      vscode.window.showErrorMessage(
        'Canvas Course Builder: There is no exports/toc.md to export. Run "Course: Export Course to PDF/DOCX..." and pick the table-of-contents option to make one.',
      );
      return;
    }
    const format = await pickFormat();
    if (!format) return;
    runInTerminal(
      (q) =>
        `npx course export --toc ${q('exports/toc.md')} --format ${q(format)}`,
    );
    // The key is not cleared here: the file is still on disk, and exporting the
    // same curated list to the other format as well is the ordinary next step.
  });
}

module.exports = { registerExportCommands };
