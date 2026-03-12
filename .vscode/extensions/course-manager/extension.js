const vscode = require('vscode');
const path = require('path');
const fs = require('fs');

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

function activate(context) {
  // Commands that don't need workspace validation (init creates the workspace)
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

  context.subscriptions.push(
    vscode.commands.registerCommand('course.pushModule', async () => {
      const workspaceRoot = validateWorkspace();
      if (!workspaceRoot) return;

      const courseDir = path.join(workspaceRoot, 'course');
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
        runInTerminal(`npx course push --module ${picked}`, workspaceRoot);
      }
    })
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
