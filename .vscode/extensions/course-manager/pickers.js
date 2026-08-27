const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const {
  courseLocation,
  displayTitle,
  promoteActive,
  readCategoryLabel,
} = require('./helpers');

/**
 * The quick picks a command falls back on when it was run from the palette
 * rather than from a tree row, and the two confirmations that stand in front of
 * a delete.
 */

/** The workspace the picks are drawn from. Set once, at activation. */
let workspaceRoot;

function initPickers({ workspaceRoot: root }) {
  workspaceRoot = root;
}

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
      'Coursewright: No modules found in course/.',
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
    vscode.window.showErrorMessage('Coursewright: No items in this module.');
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

module.exports = {
  initPickers,
  activeCourseLocation,
  listModuleFolders,
  listEntries,
  pickModuleFolder,
  pickItemPath,
  confirmMerge,
  resolveItemPath,
  resolveModuleFolder,
  pickFormat,
};
