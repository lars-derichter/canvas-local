const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const { CourseTreeProvider, getCanvasId } = require('./CourseTreeProvider');

const commands = {
  'course.init': 'npx course init',
  'course.push': 'npx course push',
  'course.pushDryRun': 'npx course push --dry-run',
  'course.pull': 'npx course pull',
  'course.status': 'npx course status',
  'course.newModule': 'npx course new-module',
  'course.moveModule': 'npx course move-module',
  'course.renameModule': 'npx course rename-module',
  'course.deleteModule': 'npx course delete-module',
  'course.newItem': 'npx course new-item',
  'course.moveItem': 'npx course move-item',
  'course.moveItemToModule': 'npx course movetomodule-item',
  'course.renameItem': 'npx course rename-item',
  'course.deleteItem': 'npx course delete-item',
  'course.diff': 'npx course diff',
  'course.validate': 'npx course validate',
};

function getWorkingDir() {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const activeFile = vscode.window.activeTextEditor?.document.uri.fsPath;
  if (activeFile && workspaceRoot) {
    const dir = path.dirname(activeFile);
    if (dir.startsWith(path.join(workspaceRoot, 'course'))) {
      return dir;
    }
  }
  return workspaceRoot;
}

/**
 * Check if the workspace has a course/ directory.
 * Shows an error message if not found.
 */
function validateWorkspace() {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    vscode.window.showErrorMessage('Canvas Local: No workspace folder open.');
    return null;
  }

  const courseDir = path.join(workspaceRoot, 'course');
  if (!fs.existsSync(courseDir)) {
    vscode.window.showWarningMessage(
      'Canvas Local: No course/ directory found. Run "Canvas Local: Init" first.'
    );
  }

  return workspaceRoot;
}

function runInTerminal(commandStr, cwd) {
  const terminal = vscode.window.createTerminal({
    name: 'Canvas Local',
    cwd: cwd || getWorkingDir(),
  });
  terminal.show();
  terminal.sendText(commandStr);
  vscode.window.showInformationMessage(`Canvas Local: Running "${commandStr.replace('npx course ', '')}"`);
}

/**
 * Read .env file and return CANVAS_API_URL and CANVAS_COURSE_ID.
 */
function readEnvConfig(workspaceRoot) {
  const envPath = path.join(workspaceRoot, '.env');
  try {
    const content = fs.readFileSync(envPath, 'utf8');
    const vars = {};
    for (const line of content.split('\n')) {
      const match = line.match(/^(\w+)\s*=\s*(.+)$/);
      if (match) vars[match[1]] = match[2].trim();
    }
    return vars;
  } catch {
    return {};
  }
}

function activate(context) {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  // --- Tree view ---
  const courseTreeProvider = new CourseTreeProvider(workspaceRoot);
  const treeView = vscode.window.createTreeView('courseTree', {
    treeDataProvider: courseTreeProvider,
    dragAndDropController: courseTreeProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);

  // Refresh command
  context.subscriptions.push(
    vscode.commands.registerCommand('course.refreshTree', () => {
      courseTreeProvider.refresh();
    })
  );

  // File watcher for auto-refresh
  if (workspaceRoot) {
    const coursePattern = new vscode.RelativePattern(
      path.join(workspaceRoot, 'course'),
      '**/*'
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

  // Push item (pushes the whole module)
  context.subscriptions.push(
    vscode.commands.registerCommand('course.pushItem', (treeItem) => {
      const moduleName = treeItem?.moduleFolderName;
      if (!moduleName) return;
      if (!validateWorkspace()) return;
      runInTerminal(`npx course push --module ${moduleName}`, workspaceRoot);
    })
  );

  // Open in Canvas
  context.subscriptions.push(
    vscode.commands.registerCommand('course.openInCanvas', (treeItem) => {
      if (!workspaceRoot) return;
      const env = readEnvConfig(workspaceRoot);
      const apiUrl = env.CANVAS_API_URL;
      const courseId = env.CANVAS_COURSE_ID;

      if (!apiUrl || !courseId) {
        vscode.window.showWarningMessage(
          'Canvas Local: No Canvas API configuration found. Run "Course: Init" first.'
        );
        return;
      }

      // Strip /api/v1 suffix if present to get the base URL
      const baseUrl = apiUrl.replace(/\/api\/v1\/?$/, '');

      if (treeItem?.contextValue === 'module') {
        vscode.env.openExternal(
          vscode.Uri.parse(`${baseUrl}/courses/${courseId}/modules`)
        );
        return;
      }

      if (!treeItem?.filePath) return;

      const canvasId = getCanvasId(treeItem.filePath);
      if (!canvasId) {
        vscode.window.showInformationMessage(
          'Canvas Local: This item has not been pushed to Canvas yet.'
        );
        return;
      }

      const canvasType = treeItem.contextValue;
      let url;
      if (canvasType === 'assignment') {
        url = `${baseUrl}/courses/${courseId}/assignments/${canvasId}`;
      } else {
        // Pages and other types — canvas_id is the page slug for pages
        url = `${baseUrl}/courses/${courseId}/pages/${canvasId}`;
      }

      vscode.env.openExternal(vscode.Uri.parse(url));
    })
  );

  // --- Standard CLI commands ---
  const noValidationCommands = new Set(['course.init']);

  for (const [id, cmd] of Object.entries(commands)) {
    context.subscriptions.push(
      vscode.commands.registerCommand(id, () => {
        if (!noValidationCommands.has(id)) {
          if (!validateWorkspace()) return;
        }
        runInTerminal(cmd);
      })
    );
  }

  // Push module (with quick-pick)
  context.subscriptions.push(
    vscode.commands.registerCommand('course.pushModule', async () => {
      const wsRoot = validateWorkspace();
      if (!wsRoot) return;

      const courseDir = path.join(wsRoot, 'course');
      if (!fs.existsSync(courseDir)) {
        vscode.window.showErrorMessage('No course/ directory found.');
        return;
      }

      const entries = fs.readdirSync(courseDir, { withFileTypes: true });
      const folders = entries
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort();

      if (folders.length === 0) {
        vscode.window.showErrorMessage('No modules found in course/.');
        return;
      }

      const picked = await vscode.window.showQuickPick(folders, {
        placeHolder: 'Select module to push',
      });
      if (picked) {
        runInTerminal(`npx course push --module ${picked}`, wsRoot);
      }
    })
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
