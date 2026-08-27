const vscode = require('vscode');
const path = require('path');
const { CourseTreeProvider } = require('./CourseTreeProvider');
const { getWorkspaceRoot } = require('./workspace');
const { initTerminals } = require('./terminal');
const { initRunner, runCli } = require('./runner');
const { initPickers } = require('./pickers');
const { registerStreamingCommands } = require('./commands/streaming');
const { registerModuleCommands } = require('./commands/modules');
const { registerItemCommands } = require('./commands/items');
const { registerExportCommands } = require('./commands/export');
const { registerCanvasCommands } = require('./commands/canvas');
const { registerPreviewCommands } = require('./commands/preview');

// --- Activation ---
//
// Wiring, and nothing else. Every handler lives in `commands/`, and the three
// things they all reach for — the shared terminals, the silent CLI runner and
// the palette pickers — each own a file of their own. What is left here is the
// order those are put together in, and the two views the extension contributes.

function activate(context) {
  const workspaceRoot = getWorkspaceRoot();
  const outputChannel = vscode.window.createOutputChannel('Coursewright');
  context.subscriptions.push(outputChannel);

  // --- Tree view ---
  const courseTreeProvider = new CourseTreeProvider(workspaceRoot, { runCli });
  const treeView = vscode.window.createTreeView('courseTree', {
    treeDataProvider: courseTreeProvider,
    dragAndDropController: courseTreeProvider,
    showCollapseAll: true,
    canSelectMany: true,
  });
  context.subscriptions.push(treeView);

  initPickers({ workspaceRoot });
  initTerminals({ context, workspaceRoot });
  initRunner({ workspaceRoot, outputChannel, courseTreeProvider });

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

  const wiring = { context, register, workspaceRoot };
  registerStreamingCommands(wiring);
  registerModuleCommands(wiring);
  registerItemCommands(wiring);
  registerExportCommands(wiring);
  registerCanvasCommands(wiring);
  registerPreviewCommands(wiring);
}

function deactivate() {}

module.exports = { activate, deactivate };
