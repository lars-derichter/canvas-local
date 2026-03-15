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

function pad(n) {
  return String(n).padStart(2, '0');
}

function safeReadJSON(filePath, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

/**
 * Extract canvas_type from markdown frontmatter without gray-matter dependency.
 */
function getCanvasType(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    if (!content.startsWith('---')) return 'page';
    const endIndex = content.indexOf('---', 3);
    if (endIndex === -1) return 'page';
    const frontmatter = content.substring(3, endIndex);
    const match = frontmatter.match(/^canvas_type:\s*(.+)$/m);
    return match ? match[1].trim() : 'page';
  } catch {
    return 'page';
  }
}

/**
 * Read canvas_id from markdown frontmatter.
 */
function getCanvasId(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    if (!content.startsWith('---')) return null;
    const endIndex = content.indexOf('---', 3);
    if (endIndex === -1) return null;
    const frontmatter = content.substring(3, endIndex);
    const match = frontmatter.match(/^canvas_id:\s*(.+)$/m);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

// --- Icon map ---

const ICON_MAP = {
  module: new vscode.ThemeIcon('folder'),
  subheader: new vscode.ThemeIcon('symbol-folder'),
  page: new vscode.ThemeIcon('file'),
  assignment: new vscode.ThemeIcon('checklist'),
  external_url: new vscode.ThemeIcon('link-external'),
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

    if (opts.filePath && collapsibleState === vscode.TreeItemCollapsibleState.None) {
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
  constructor(workspaceRoot) {
    this._workspaceRoot = workspaceRoot;
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
    if (element.contextValue === 'subheader') return this._getSubfolderItems(element);
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
        }
      );
      item._position = position;
      item.description = pad(position);
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
          }
        );
        item._position = extractPosition(entry.name);
        item._entryName = entry.name;
        items.push(item);
      } else if (entry.isFile()) {
        const treeItem = this._buildFileItem(fullPath, entry.name, moduleNode.moduleFolderName);
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
      const treeItem = this._buildFileItem(fullPath, entry.name, subheaderNode.moduleFolderName);
      if (treeItem) items.push(treeItem);
    }

    items.sort((a, b) => a._position - b._position);
    return items;
  }

  _buildFileItem(fullPath, fileName, moduleFolderName) {
    const isMarkdown = fileName.endsWith('.md');
    const canvasType = isMarkdown ? getCanvasType(fullPath) : 'file';
    const ext = path.extname(fileName);
    const title = isMarkdown
      ? displayTitle(fileName.replace(/\.md$/, ''))
      : displayTitle(fileName.replace(ext, ''));

    const item = new CourseTreeItem(
      title,
      vscode.TreeItemCollapsibleState.None,
      canvasType,
      {
        filePath: fullPath,
        moduleFolderName,
        tooltip: fileName,
      }
    );
    if (!isMarkdown) {
      item.description = ext;
    }
    item._position = extractPosition(fileName);
    item._entryName = fileName;
    return item;
  }

  // --- Drag and drop ---

  handleDrag(source, dataTransfer, _token) {
    const data = source.map((item) => ({
      contextValue: item.contextValue,
      filePath: item.filePath,
      folderPath: item.folderPath,
      moduleFolderName: item.moduleFolderName,
      entryName: item._entryName,
      position: item._position,
    }));
    dataTransfer.set(TREE_MIME, new vscode.DataTransferItem(data));
  }

  async handleDrop(target, dataTransfer, _token) {
    // Check for external file drops (from OS Finder/Explorer)
    const uriListData = dataTransfer.get('text/uri-list');
    if (uriListData) {
      const uriString = await uriListData.asString();
      const uris = uriString
        .split(/\r?\n/)
        .map((u) => u.trim())
        .filter((u) => u.length > 0)
        .map((u) => vscode.Uri.parse(u));
      if (uris.length > 0) {
        try {
          this._handleExternalFileDrop(target, uris);
        } catch (err) {
          vscode.window.showErrorMessage(`Failed to copy files: ${err.message}`);
        }
        this.refresh();
        return;
      }
    }

    // Internal tree reordering
    const transferItem = dataTransfer.get(TREE_MIME);
    if (!transferItem) return;

    const draggedItems = transferItem.value;
    if (!draggedItems || draggedItems.length === 0) return;

    const dragged = draggedItems[0];

    try {
      if (dragged.contextValue === 'module' && (!target || target.contextValue === 'module')) {
        this._handleModuleDrop(dragged, target);
      } else if (
        dragged.contextValue !== 'module' &&
        dragged.contextValue !== 'subheader' &&
        target
      ) {
        this._handleItemDrop(dragged, target);
      }
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to reorder: ${err.message}`);
    }

    this.refresh();
  }

  _handleModuleDrop(dragged, target) {
    const courseDir = path.join(this._workspaceRoot, 'course');
    const entries = this._getSortedEntries(courseDir, 'dirs');
    const targetPosition = target ? target._position : entries.length;

    this._reorder(courseDir, entries, dragged.position, targetPosition);
  }

  _handleItemDrop(dragged, target) {
    const draggedDir = path.dirname(dragged.filePath);

    if (target.contextValue === 'module' || target.contextValue === 'subheader') {
      // Dropping item onto a module or subheader — move into that container
      const targetDir = target.folderPath;

      if (draggedDir === targetDir) return; // already in same folder

      // Move file to target directory
      const destPath = path.join(targetDir, path.basename(dragged.filePath));
      fs.renameSync(dragged.filePath, destPath);

      // Renumber source directory
      const sourceEntries = this._getSortedEntries(draggedDir, 'all');
      this._renumberSequential(draggedDir, sourceEntries);

      // Renumber target directory
      const targetEntries = this._getSortedEntries(targetDir, 'all');
      this._renumberSequential(targetDir, targetEntries);
    } else {
      // Dropping item onto another item — reorder within the same container
      const targetDir = path.dirname(target.filePath);

      if (draggedDir === targetDir) {
        // Same folder: reorder
        const entries = this._getSortedEntries(targetDir, 'all');
        const targetPos = extractPosition(target._entryName || path.basename(target.filePath));
        this._reorder(targetDir, entries, dragged.position, targetPos);
      } else {
        // Different folder: move then renumber both
        const destName = path.basename(dragged.filePath);
        const destPath = path.join(targetDir, destName);
        fs.renameSync(dragged.filePath, destPath);

        const sourceEntries = this._getSortedEntries(draggedDir, 'all');
        this._renumberSequential(draggedDir, sourceEntries);

        const targetEntries = this._getSortedEntries(targetDir, 'all');
        this._renumberSequential(targetDir, targetEntries);
      }
    }
  }

  _handleExternalFileDrop(target, uris) {
    // Determine target directory
    let targetDir;
    if (!target) {
      vscode.window.showWarningMessage('Drop files onto a module or item.');
      return;
    }
    if (target.contextValue === 'module' || target.contextValue === 'subheader') {
      targetDir = target.folderPath;
    } else if (target.filePath) {
      targetDir = path.dirname(target.filePath);
    } else {
      vscode.window.showWarningMessage('Drop files onto a module or item.');
      return;
    }

    // Count existing entries to determine starting position
    const existing = this._getSortedEntries(targetDir, 'all');
    let nextPos = existing.length > 0 ? existing[existing.length - 1].prefix + 1 : 1;

    let copied = 0;
    for (const uri of uris) {
      const sourcePath = uri.fsPath;
      if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) continue;

      const basename = path.basename(sourcePath);
      const ext = path.extname(basename);
      const nameWithoutExt = basename.replace(ext, '');
      const slug = nameWithoutExt
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      const destName = `${pad(nextPos)}-${slug}${ext.toLowerCase()}`;
      const destPath = path.join(targetDir, destName);

      fs.copyFileSync(sourcePath, destPath);
      nextPos++;
      copied++;
    }

    if (copied > 0) {
      const folderName = path.basename(targetDir);
      vscode.window.showInformationMessage(
        `Canvas Local: Copied ${copied} file(s) to ${folderName}`
      );
    }
  }

  /**
   * Get sorted entries from a directory for renumbering.
   * @param {string} filter - 'all' (files + dirs), 'dirs' (directories only), 'files' (files only)
   */
  _getSortedEntries(dirPath, filter = 'all') {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const items = [];

    for (const entry of entries) {
      if (entry.name.startsWith('_')) continue;
      if (filter === 'dirs' && !entry.isDirectory()) continue;
      if (filter === 'files' && !entry.isFile()) continue;

      items.push({
        name: entry.name,
        prefix: extractPosition(entry.name),
        isDirectory: entry.isDirectory(),
      });
    }

    items.sort((a, b) => a.prefix - b.prefix);
    return items;
  }

  /**
   * Reorder entries by moving one to a new position (two-pass rename).
   * Mirrors cli/renumber.js reorder().
   */
  _reorder(dirPath, entries, sourcePrefix, targetPosition) {
    const source = entries.find((e) => e.prefix === sourcePrefix);
    if (!source) return;

    const remaining = entries.filter((e) => e.prefix !== sourcePrefix);
    remaining.splice(targetPosition - 1, 0, source);

    const tempPrefix = '__reorder_temp_';

    // First pass: rename all to temp names
    for (let i = 0; i < remaining.length; i++) {
      const entry = remaining[i];
      const nameWithoutPrefix = entry.name.replace(/^\d+-/, '');
      const tempName = `${tempPrefix}${pad(i + 1)}-${nameWithoutPrefix}`;
      fs.renameSync(path.join(dirPath, entry.name), path.join(dirPath, tempName));
      remaining[i] = { ...entry, _tempName: tempName };
    }

    // Second pass: rename from temp to final names
    for (let i = 0; i < remaining.length; i++) {
      const entry = remaining[i];
      const newPrefix = i + 1;
      const newName = entry.name.replace(/^\d+/, pad(newPrefix));
      fs.renameSync(path.join(dirPath, entry._tempName), path.join(dirPath, newName));

      if (entry.isDirectory) {
        this._updateCategoryPosition(dirPath, newName, newPrefix);
      }
    }
  }

  /**
   * Renumber all entries sequentially (two-pass rename).
   * Mirrors cli/renumber.js renumberSequential().
   */
  _renumberSequential(dirPath, items) {
    const tempPrefix = '__renumber_temp_';

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const tempName = `${tempPrefix}${pad(i + 1)}-${item.name.replace(/^\d+-/, '')}`;
      fs.renameSync(path.join(dirPath, item.name), path.join(dirPath, tempName));
      items[i] = { ...item, _tempName: tempName };
    }

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const newPrefix = i + 1;
      const newName = item.name.replace(/^\d+/, pad(newPrefix));
      fs.renameSync(path.join(dirPath, item._tempName), path.join(dirPath, newName));

      if (item.isDirectory) {
        this._updateCategoryPosition(dirPath, newName, newPrefix);
      }
    }
  }

  _updateCategoryPosition(dirPath, entryName, newPosition) {
    const catFile = path.join(dirPath, entryName, '_category_.json');
    if (!fs.existsSync(catFile)) return;
    const cat = safeReadJSON(catFile, null);
    if (!cat) return;
    cat.position = newPosition;
    fs.writeFileSync(catFile, JSON.stringify(cat, null, 2) + '\n', 'utf8');
  }
}

module.exports = { CourseTreeProvider, getCanvasId };
