const vscode = require('vscode');
const path = require('path');
const { validateWorkspace } = require('../workspace');
const { runCli } = require('../runner');
const { listModuleFolders, resolveModuleFolder } = require('../pickers');
const { displayTitle, readCategoryLabel } = require('../helpers');

/** Making, renaming, reordering and deleting a module folder. */
function registerModuleCommands({ register, workspaceRoot }) {
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
}

module.exports = { registerModuleCommands };
