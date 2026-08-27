const vscode = require('vscode');
const path = require('path');
const fs = require('fs');

/**
 * Is there a folder open at all, and does it look like a course project?
 *
 * Both questions are asked here rather than in each of the thirty command
 * handlers, and the answers travel differently: no folder is a refusal, no
 * course/ is a warning the command runs past.
 */

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
    vscode.window.showErrorMessage('Coursewright: No workspace folder open.');
    return null;
  }

  const courseDir = path.join(root, 'course');
  if (!fs.existsSync(courseDir)) {
    vscode.window.showWarningMessage(
      'Coursewright: No course/ directory found. Run "Course: Setup (First-Run Wizard)" to create one.',
    );
  }

  return root;
}

module.exports = { getWorkspaceRoot, validateWorkspace };
