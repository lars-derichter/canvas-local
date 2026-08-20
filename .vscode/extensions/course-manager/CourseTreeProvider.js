const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

// --- Utility functions (inlined from lib/convert/course-scanner.js and cli/) ---

function extractPosition(name) {
  const match = name.match(/^(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

function displayTitle(name) {
  const stripped = name.replace(/^\d+-/, '');
  const spaced = stripped.replace(/[-_]+/g, ' ').trim();
  return spaced.replace(/\b\w/g, (c) => c.toUpperCase());
}

function safeReadJSON(filePath, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

/**
 * Read frontmatter fields from a markdown file without a YAML dependency.
 * Returns { canvasType, title, externalUrl }. The Canvas id is deliberately
 * not among them: identity lives in `.canvas-sync.json`, keyed by path, and a
 * `canvas_id` left behind in an older file is the stale copy that made the two
 * disagree. `getCanvasId` reads the state instead.
 */
function readFrontmatter(filePath) {
  const result = {
    canvasType: 'page',
    title: null,
    externalUrl: null,
  };
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    if (!content.startsWith('---')) return result;
    const endIndex = content.indexOf('\n---', 3);
    if (endIndex === -1) return result;
    const frontmatter = content.substring(3, endIndex);

    const typeMatch = frontmatter.match(/^canvas_type:\s*(.+)$/m);
    if (typeMatch) result.canvasType = typeMatch[1].trim();

    const titleMatch = frontmatter.match(/^title:\s*(.+)$/m);
    if (titleMatch) {
      // Strip surrounding quotes gray-matter may have added
      result.title = titleMatch[1].trim().replace(/^["'](.*)["']$/, '$1');
    }

    const urlMatch = frontmatter.match(/^external_url:\s*(.+)$/m);
    if (urlMatch)
      result.externalUrl = urlMatch[1].trim().replace(/^["'](.*)["']$/, '$1');
  } catch {
    // Defaults
  }
  return result;
}

/**
 * The Canvas id recorded for a course file, or null.
 *
 * Read from `.canvas-sync.json` on every call rather than cached: a push or a
 * pull rewrites that file while the window stays open, and an id cached from
 * before it would send the author to the wrong object — or to none at all, for
 * an item that has only just been created.
 *
 * @param {string} workspaceRoot
 * @param {string} filePath - Absolute path to the course file.
 */
function getCanvasId(workspaceRoot, filePath) {
  if (!workspaceRoot) return null;
  const relative = path.relative(path.join(workspaceRoot, 'course'), filePath);
  if (!relative || relative.startsWith('..')) return null;
  const key = relative.split(path.sep).join('/');
  try {
    const state = JSON.parse(
      fs.readFileSync(path.join(workspaceRoot, '.canvas-sync.json'), 'utf8'),
    );
    for (const module of Object.values(state.modules || {})) {
      const row = (module.items || {})[key];
      if (row && row.canvas_id != null) return String(row.canvas_id);
    }
  } catch {
    // No state, unreadable or corrupt: the item has no id we can vouch for.
  }
  return null;
}

// --- Icon map ---

const ICON_MAP = {
  module: new vscode.ThemeIcon('folder'),
  subheader: new vscode.ThemeIcon('symbol-folder'),
  page: new vscode.ThemeIcon('file'),
  assignment: new vscode.ThemeIcon('checklist'),
  discussion: new vscode.ThemeIcon('comment-discussion'),
  quiz: new vscode.ThemeIcon('question'),
  external_url: new vscode.ThemeIcon('link-external'),
  external_tool: new vscode.ThemeIcon('plug'),
  file: new vscode.ThemeIcon('file-media'),
};

// --- Tree item classes ---

class CourseTreeItem extends vscode.TreeItem {
  constructor(label, collapsibleState, contextValue, opts = {}) {
    super(label, collapsibleState);
    this.contextValue = contextValue;
    this.iconPath = ICON_MAP[contextValue] || ICON_MAP.page;
    this.filePath = opts.filePath || null;
    this.moduleFolderName = opts.moduleFolderName || null;
    this.folderPath = opts.folderPath || null;
    this.externalUrl = opts.externalUrl || null;

    if (
      opts.filePath &&
      collapsibleState === vscode.TreeItemCollapsibleState.None
    ) {
      this.command = {
        command: 'vscode.open',
        arguments: [vscode.Uri.file(opts.filePath)],
        title: 'Open File',
      };
    }

    if (opts.tooltip) {
      this.tooltip = opts.tooltip;
    }
  }
}

// --- Tree data provider + drag-and-drop controller ---

const TREE_MIME = 'application/vnd.code.tree.coursetree';

class CourseTreeProvider {
  /**
   * @param {string} workspaceRoot
   * @param {object} [actions] - Callbacks for drag-and-drop operations.
   *   Each receives CLI-style arguments and is expected to run the
   *   corresponding `npx course` command (single source of truth for
   *   renumbering and sync-state handling).
   * @param {Function} [actions.runCli] - (argsArray) => Promise
   */
  constructor(workspaceRoot, actions = {}) {
    this._workspaceRoot = workspaceRoot;
    this._actions = actions;
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;

    // TreeDragAndDropController properties
    this.dropMimeTypes = [TREE_MIME, 'text/uri-list'];
    this.dragMimeTypes = [TREE_MIME];
  }

  refresh() {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element) {
    return element;
  }

  getChildren(element) {
    if (!this._workspaceRoot) return [];
    const courseDir = path.join(this._workspaceRoot, 'course');
    if (!fs.existsSync(courseDir)) return [];

    if (!element) return this._getModules(courseDir);
    if (element.contextValue === 'module') return this._getModuleItems(element);
    if (element.contextValue === 'subheader')
      return this._getSubfolderItems(element);
    return [];
  }

  _getModules(courseDir) {
    const entries = fs.readdirSync(courseDir, { withFileTypes: true });
    const modules = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('_')) continue;

      const folderPath = path.join(courseDir, entry.name);
      const cat = safeReadJSON(path.join(folderPath, '_category_.json'), null);
      const label = cat?.label || displayTitle(entry.name);
      const position = extractPosition(entry.name);

      const item = new CourseTreeItem(
        label,
        vscode.TreeItemCollapsibleState.Collapsed,
        'module',
        {
          folderPath,
          moduleFolderName: entry.name,
          tooltip: entry.name,
        },
      );
      item._position = position;
      item.description = String(position).padStart(2, '0');
      modules.push(item);
    }

    modules.sort((a, b) => a._position - b._position);
    return modules;
  }

  _getModuleItems(moduleNode) {
    const folderPath = moduleNode.folderPath;
    const entries = fs.readdirSync(folderPath, { withFileTypes: true });
    const items = [];

    for (const entry of entries) {
      if (entry.name.startsWith('_')) continue;
      const fullPath = path.join(folderPath, entry.name);

      if (entry.isDirectory()) {
        const cat = safeReadJSON(path.join(fullPath, '_category_.json'), null);
        const label = cat?.label || displayTitle(entry.name);
        const item = new CourseTreeItem(
          label,
          vscode.TreeItemCollapsibleState.Collapsed,
          'subheader',
          {
            folderPath: fullPath,
            moduleFolderName: moduleNode.moduleFolderName,
            tooltip: entry.name,
          },
        );
        item._position = extractPosition(entry.name);
        item._entryName = entry.name;
        items.push(item);
      } else if (entry.isFile()) {
        const treeItem = this._buildFileItem(
          fullPath,
          entry.name,
          moduleNode.moduleFolderName,
        );
        if (treeItem) items.push(treeItem);
      }
    }

    items.sort((a, b) => a._position - b._position);
    return items;
  }

  _getSubfolderItems(subheaderNode) {
    const folderPath = subheaderNode.folderPath;
    const entries = fs.readdirSync(folderPath, { withFileTypes: true });
    const items = [];

    for (const entry of entries) {
      if (entry.name.startsWith('_')) continue;
      if (!entry.isFile()) continue;

      const fullPath = path.join(folderPath, entry.name);
      const treeItem = this._buildFileItem(
        fullPath,
        entry.name,
        subheaderNode.moduleFolderName,
        subheaderNode,
      );
      if (treeItem) items.push(treeItem);
    }

    items.sort((a, b) => a._position - b._position);
    return items;
  }

  _buildFileItem(fullPath, fileName, moduleFolderName, subheaderNode) {
    const isMarkdown = fileName.endsWith('.md');
    const fm = isMarkdown ? readFrontmatter(fullPath) : null;
    const canvasType = fm ? fm.canvasType : 'file';
    const ext = path.extname(fileName);
    // Prefer the frontmatter title — it is what Canvas and Docusaurus show
    const title =
      (fm && fm.title) ||
      displayTitle(
        isMarkdown ? fileName.replace(/\.md$/, '') : fileName.replace(ext, ''),
      );

    const item = new CourseTreeItem(
      title,
      vscode.TreeItemCollapsibleState.None,
      canvasType,
      {
        filePath: fullPath,
        moduleFolderName,
        tooltip: fileName,
        externalUrl: fm ? fm.externalUrl : null,
      },
    );
    if (!isMarkdown) {
      item.description = ext;
    }
    item._position = extractPosition(fileName);
    item._entryName = fileName;
    item._subfolderName = subheaderNode ? subheaderNode._entryName : null;
    return item;
  }

  // --- Drag and drop ---
  //
  // Drops are translated into `npx course` commands (via this._actions.runCli)
  // so renumbering and Canvas sync state stay consistent with the CLI.

  handleDrag(source, dataTransfer, _token) {
    const data = source.map((item) => ({
      contextValue: item.contextValue,
      filePath: item.filePath,
      folderPath: item.folderPath,
      moduleFolderName: item.moduleFolderName,
      subfolderName: item._subfolderName,
      entryName: item._entryName,
      position: item._position,
    }));
    dataTransfer.set(TREE_MIME, new vscode.DataTransferItem(data));
  }

  async handleDrop(target, dataTransfer, _token) {
    const runCli = this._actions.runCli;
    if (!runCli) return;

    // External file drops (from OS Finder/Explorer or the VS Code explorer)
    const uriListData = dataTransfer.get('text/uri-list');
    const transferItem = dataTransfer.get(TREE_MIME);

    if (!transferItem && uriListData) {
      const uriString = await uriListData.asString();
      const uris = uriString
        .split(/\r?\n/)
        .map((u) => u.trim())
        .filter((u) => u.length > 0)
        .map((u) => vscode.Uri.parse(u));
      if (uris.length > 0) {
        await this._handleExternalFileDrop(target, uris, runCli);
      }
      return;
    }

    if (!transferItem) return;
    const draggedItems = transferItem.value;
    if (!draggedItems || draggedItems.length === 0) return;
    const dragged = draggedItems[0];

    if (dragged.contextValue === 'module') {
      if (target && target.contextValue !== 'module') return;
      await this._handleModuleDrop(dragged, target, runCli);
    } else if (dragged.contextValue === 'subheader') {
      if (!target) return;
      await this._handleSubsectionDrop(dragged, target, runCli);
    } else {
      if (!target) return;
      await this._handleItemDrop(dragged, target, runCli);
    }
  }

  async _handleModuleDrop(dragged, target, runCli) {
    const courseDir = path.join(this._workspaceRoot, 'course');
    const moduleCount = fs
      .readdirSync(courseDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('_')).length;
    const targetPosition = target ? target._position : moduleCount;
    if (targetPosition === dragged.position) return;

    await runCli([
      'move-module',
      '--module',
      dragged.moduleFolderName,
      '--position',
      String(targetPosition),
    ]);
  }

  async _handleItemDrop(dragged, target, runCli) {
    if (!dragged.filePath) return;
    const draggedDir = path.dirname(dragged.filePath);

    if (
      target.contextValue === 'module' ||
      target.contextValue === 'subheader'
    ) {
      // Dropping onto a module or subheader — move into that container
      if (draggedDir === target.folderPath) return; // already there

      const args = [
        'movetomodule-item',
        '--path',
        dragged.filePath,
        '--to-module',
        target.moduleFolderName,
      ];
      if (target.contextValue === 'subheader') {
        args.push('--to-subsection', target._entryName);
      }
      await runCli(args);
      return;
    }

    // Dropping onto another item
    const targetDir = path.dirname(target.filePath);
    if (draggedDir === targetDir) {
      // Same folder: reorder to the target's position
      if (dragged.position === target._position) return;
      await runCli([
        'move-item',
        '--path',
        dragged.filePath,
        '--position',
        String(target._position),
      ]);
    } else {
      // Different folder: move next to the target
      const args = [
        'movetomodule-item',
        '--path',
        dragged.filePath,
        '--to-module',
        target.moduleFolderName,
        '--position',
        String(target._position),
      ];
      if (target._subfolderName) {
        args.push('--to-subsection', target._subfolderName);
      }
      await runCli(args);
    }
  }

  async _handleSubsectionDrop(dragged, target, runCli) {
    // A subsection moves between module roots only — it can never be nested
    // inside another subsection.
    const sourcePath = dragged.folderPath;
    if (!sourcePath) return;
    const sourceModule = dragged.moduleFolderName;

    // Dropping onto a module — move to that module's root (append).
    if (target.contextValue === 'module') {
      if (target.moduleFolderName === sourceModule) return; // already there
      await runCli([
        'movetomodule-item',
        '--path',
        sourcePath,
        '--to-module',
        target.moduleFolderName,
      ]);
      return;
    }

    // Dropping onto an item that lives inside a subsection — no valid module-root
    // position, so ignore rather than move it somewhere surprising.
    if (target.contextValue !== 'subheader' && target._subfolderName) {
      vscode.window.showInformationMessage(
        'Canvas Course Builder: Drop a subsection onto a module or a top-level item.',
      );
      return;
    }

    // Dropping onto a sibling subsection or a top-level item — move to that
    // target's position within its module root.
    const targetModule = target.moduleFolderName;
    const targetPosition = target._position;
    if (targetModule === sourceModule) {
      if (dragged.position === targetPosition) return;
      await runCli([
        'move-item',
        '--path',
        sourcePath,
        '--position',
        String(targetPosition),
      ]);
    } else {
      await runCli([
        'movetomodule-item',
        '--path',
        sourcePath,
        '--to-module',
        targetModule,
        '--position',
        String(targetPosition),
      ]);
    }
  }

  async _handleExternalFileDrop(target, uris, runCli) {
    if (!target) {
      vscode.window.showWarningMessage(
        'Canvas Course Builder: Drop files onto a module or item.',
      );
      return;
    }

    let moduleFolderName;
    let subsection = null;
    if (target.contextValue === 'module') {
      moduleFolderName = target.moduleFolderName;
    } else if (target.contextValue === 'subheader') {
      moduleFolderName = target.moduleFolderName;
      subsection = target._entryName;
    } else if (target.filePath) {
      moduleFolderName = target.moduleFolderName;
      subsection = target._subfolderName;
    } else {
      vscode.window.showWarningMessage(
        'Canvas Course Builder: Drop files onto a module or item.',
      );
      return;
    }

    for (const uri of uris) {
      const sourcePath = uri.fsPath;
      if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile())
        continue;

      const args = [
        'new-item',
        '--module',
        moduleFolderName,
        '--type',
        'file',
        '--file',
        sourcePath,
      ];
      if (subsection) args.push('--subsection', subsection);
      await runCli(args);
    }
  }
}

module.exports = {
  CourseTreeProvider,
  getCanvasId,
  readFrontmatter,
  displayTitle,
  extractPosition,
};
