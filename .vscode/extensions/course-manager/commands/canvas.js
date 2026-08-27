const vscode = require('vscode');
const {
  canvasModuleUrl,
  getCanvasId,
  getModuleCanvasId,
  readEnvConfig,
  readFrontmatter,
} = require('../helpers');

/** Opening the Canvas object a tree row stands for, in a browser. */
function registerCanvasCommands({ register, workspaceRoot }) {
  // --- Open in Canvas ---
  register('course.openInCanvas', (treeItem) => {
    if (!workspaceRoot) return;
    const env = readEnvConfig(workspaceRoot);
    const apiUrl = env.CANVAS_API_URL;
    const courseId = env.CANVAS_COURSE_ID;

    if (!apiUrl || !courseId) {
      vscode.window.showWarningMessage(
        'Coursewright: No Canvas API configuration found. Run "Course: Init (Canvas Setup)" first.',
      );
      return;
    }

    // Strip /api/v1 suffix if present to get the base URL
    const baseUrl = apiUrl.replace(/\/api\/v1\/?$/, '');

    if (treeItem?.contextValue === 'module') {
      // A module is keyed in the sync state by its folder name, not by a path,
      // so its id comes from the module entry rather than from getCanvasId. A
      // module never pushed has none, and lands on the plain modules page.
      const moduleId = getModuleCanvasId(
        workspaceRoot,
        treeItem.moduleFolderName,
      );
      vscode.env.openExternal(
        vscode.Uri.parse(canvasModuleUrl(baseUrl, courseId, moduleId)),
      );
      return;
    }

    if (!treeItem?.filePath) return;

    // External URL items: open the URL itself
    if (treeItem.contextValue === 'external_url') {
      const fm = readFrontmatter(treeItem.filePath);
      if (fm.externalUrl) {
        vscode.env.openExternal(vscode.Uri.parse(fm.externalUrl));
        return;
      }
    }

    const canvasId = getCanvasId(workspaceRoot, treeItem.filePath);
    if (!canvasId) {
      vscode.window.showInformationMessage(
        'Coursewright: This item has not been pushed to Canvas yet.',
      );
      return;
    }

    const canvasType = treeItem.contextValue;
    let url;
    if (canvasType === 'assignment') {
      url = `${baseUrl}/courses/${courseId}/assignments/${canvasId}`;
    } else if (canvasType === 'discussion') {
      url = `${baseUrl}/courses/${courseId}/discussion_topics/${canvasId}`;
    } else if (canvasType === 'quiz') {
      url = `${baseUrl}/courses/${courseId}/quizzes/${canvasId}`;
    } else if (canvasType === 'file') {
      url = `${baseUrl}/courses/${courseId}/files/${canvasId}`;
    } else if (
      canvasType === 'external_url' ||
      canvasType === 'external_tool'
    ) {
      // A link and an LTI launch are nothing but a module item, so the item is
      // the thing to open. canvas_id holds that item's id for both types.
      url = `${baseUrl}/courses/${courseId}/modules/items/${canvasId}`;
    } else {
      // Pages — canvas_id is the page slug or numeric id; Canvas accepts both
      url = `${baseUrl}/courses/${courseId}/pages/${canvasId}`;
    }

    vscode.env.openExternal(vscode.Uri.parse(url));
  });
}

module.exports = { registerCanvasCommands };
