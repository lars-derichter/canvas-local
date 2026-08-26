const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const {
  directoryReadError,
  displayTitle,
  safeReadJSON,
  readFrontmatter,
  extractPosition,
  cliSiblings,
  reorderPosition,
  crossContainerPosition,
  nameSuffix,
  matchBySuffix,
  appendPosition,
  batchPositions,
  sortByVisualOrder,
  validateBatchDrop,
} = require('./helpers');

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

/**
 * How long unreadable-directory reports are held so one burst becomes one
 * notification.
 *
 * Short on purpose. It has to cover one refresh, whose listings land within
 * milliseconds of each other, and it must not reach as far as the next thing
 * the author does: two folders that fail because two separate actions broke
 * them are two pieces of news.
 */
const UNREADABLE_BURST_MS = 50;

/** Tell the author why a drop could not be handed to the CLI. */
function refuseDrop(message) {
  vscode.window.showInformationMessage(`Canvas Course Builder: ${message}`);
}

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

    // Which failures each directory has already been reported for, by error
    // code. The tree redraws on every file change in course/ and after every
    // CLI run, so reporting every time would fire a notification per refresh
    // for the rest of the session — but remembering the directory alone
    // silences it for good, including a different failure later, and one that
    // comes back after the folder had recovered. The code is part of the key,
    // and a successful read clears the entry. Keyed by code rather than by the
    // message: a message carries the directory and the code and nothing else
    // today, but a message that varied would defeat the whole thing.
    this._reportedUnreadable = new Map();

    // Failures waiting to be reported together. One notification per burst,
    // because the codes worth reporting arrive in bursts: EMFILE is the host
    // running out of descriptors, and every directory in the refresh fails at
    // once. Thirteen notifications for one event is the noise this exists to
    // prevent, moved rather than removed.
    this._pendingUnreadable = [];
    this._unreadableTimer = null;

    // TreeDragAndDropController properties
    this.dropMimeTypes = [TREE_MIME, 'text/uri-list'];
    this.dragMimeTypes = [TREE_MIME];
  }

  refresh() {
    this._onDidChangeTreeData.fire();
  }

  /**
   * One directory listing, for a tree that has to keep drawing either way.
   *
   * Every read here races the author and the CLI (see `directoryReadError`),
   * and a throw out of `getChildren` is not a missing row: the root listing
   * takes the whole view with it, and a module listing takes the module. So a
   * failed read is an empty listing, and the one failure an empty listing would
   * misrepresent — the folder is there and unreadable — says so out loud, once
   * per code, and again once the folder has read in between.
   */
  _listDir(dir) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      // A directory that reads has nothing outstanding against it any more, so
      // whatever happens to it next is news again.
      this._reportedUnreadable.delete(dir);
      return entries;
    } catch (error) {
      const message = directoryReadError(dir, error);
      if (message) {
        this._reportUnreadable(
          dir,
          (error && error.code) || 'unknown',
          message,
        );
      }
      return [];
    }
  }

  /**
   * Queue one unreadable directory for reporting: at most once per code while
   * it stays unreadable, and at most one notification per burst.
   */
  _reportUnreadable(dir, code, message) {
    const reported = this._reportedUnreadable.get(dir) ?? new Set();
    if (reported.has(code)) return;
    reported.add(code);
    this._reportedUnreadable.set(dir, reported);

    this._pendingUnreadable.push({ dir, message });
    if (this._unreadableTimer) return;
    this._unreadableTimer = setTimeout(() => {
      const pending = this._pendingUnreadable;
      this._pendingUnreadable = [];
      this._unreadableTimer = null;

      const [first] = pending;
      const others = new Set(pending.map((entry) => entry.dir));
      others.delete(first.dir);
      const rest =
        others.size === 0
          ? ''
          : ` ${others.size} other folder${others.size === 1 ? '' : 's'} could not be read either.`;
      vscode.window.showWarningMessage(
        `Canvas Course Builder: ${first.message}${rest}`,
      );
    }, UNREADABLE_BURST_MS);
    // A pending notification is not a reason to keep the host alive, and in a
    // test run it is not a reason to keep the process alive either.
    this._unreadableTimer.unref?.();
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
    const entries = this._listDir(courseDir);
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
    const entries = this._listDir(folderPath);
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
    const entries = this._listDir(folderPath);
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
  //
  // A drop the CLI cannot express is refused out loud via `refuseDrop` rather
  // than silently ignored; only genuine no-ops (an entry dropped onto itself
  // or onto its own slot) return without a word.

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

    const moduleCount = draggedItems.filter(
      (d) => d.contextValue === 'module',
    ).length;
    if (moduleCount > 0 && moduleCount < draggedItems.length) {
      refuseDrop(
        'A drop mixing modules with items cannot be expressed as one move. Drag the modules and the items separately.',
      );
      return;
    }
    if (moduleCount > 1) {
      refuseDrop(
        'Modules only reorder within the course, and a multi-module drop cannot say which one takes the target slot. Move one module at a time.',
      );
      return;
    }

    if (draggedItems.length > 1) {
      if (!target) return;
      await this._handleBatchEntryDrop(draggedItems, target, runCli);
      return;
    }

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
    // `move-module --position` is a 1-based ordinal into the CLI's sorted
    // module list, not a folder prefix — with gapped numbering the two
    // disagree, and the CLI range-checks the ordinal.
    const courseDir = path.join(this._workspaceRoot, 'course');
    const names = fs
      .readdirSync(courseDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    const targetPosition = target
      ? reorderPosition(names, target.moduleFolderName)
      : cliSiblings(names).length;
    const draggedPosition = reorderPosition(names, dragged.moduleFolderName);
    if (draggedPosition === null) {
      refuseDrop(
        `"${dragged.moduleFolderName}" has no numeric prefix, so the CLI cannot move it.`,
      );
      return;
    }
    if (targetPosition === null) {
      refuseDrop(
        `"${target.moduleFolderName}" has no numeric prefix, so the CLI cannot place anything at its position.`,
      );
      return;
    }
    if (targetPosition === draggedPosition) return;

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
      // Same folder: reorder so the dragged item takes the target's slot.
      // `move-item --position` is an ordinal, not the target's prefix.
      if (dragged.entryName === target._entryName) return;
      const position = reorderPosition(
        fs.readdirSync(targetDir),
        target._entryName,
      );
      if (position === null) {
        refuseDrop(
          `"${target._entryName}" has no numeric prefix, so the CLI cannot place anything at its position.`,
        );
        return;
      }
      await runCli([
        'move-item',
        '--path',
        dragged.filePath,
        '--position',
        String(position),
      ]);
    } else {
      // Different folder: take the target's slot in its container.
      // `movetomodule-item --position` is a prefix, so this stays the
      // target's own prefix.
      const position = crossContainerPosition(target._entryName);
      if (position === null) {
        refuseDrop(
          `"${target._entryName}" has no numeric prefix, so the CLI cannot place anything at its position.`,
        );
        return;
      }
      if (position === 0) {
        refuseDrop(
          `"${target._entryName}" is numbered 00, and the CLI cannot place an item before a 00-numbered entry.`,
        );
        return;
      }
      const args = [
        'movetomodule-item',
        '--path',
        dragged.filePath,
        '--to-module',
        target.moduleFolderName,
        '--position',
        String(position),
      ];
      if (target._subfolderName) {
        args.push('--to-subsection', target._subfolderName);
      }
      await runCli(args);
    }
  }

  // A batch drop calls the CLI once per dragged entry, and every call may
  // rename entries the batch still has to touch: the CLI renumbers the source
  // directory to close the gap the move leaves, and a landing shifts
  // destination prefixes upward — either can rewrite a path serialised at
  // drag time. The invariant the batch leans on: no renumbering pass touches
  // a module folder or an entry's prefix-stripped suffix (they all rename via
  // name.replace(/^\d+/, newPrefix)). So each entry — and each subsection
  // directory on its path — is re-resolved by suffix in its freshly listed
  // container right before its own move, and `validateBatchDrop` refuses any
  // batch in which a suffix lookup could ever become ambiguous.
  //
  // Placement is load-bearing: extension.test.js asserts over the source
  // slice between _handleSubsectionDrop and _handleExternalFileDrop, so this
  // handler must stay above _handleSubsectionDrop or its --to-subsection
  // args would falsely fail the no-nesting assertion there.
  async _handleBatchEntryDrop(draggedItems, target, runCli) {
    // Destination container and base position mirror the single-item
    // handlers: a module or subheader target means append, an item target
    // means the batch takes that item's slot.
    const destModule = target.moduleFolderName;
    let destDir;
    let destSubfolder = null;
    let basePosition;
    if (target.contextValue === 'module') {
      destDir = target.folderPath;
    } else if (target.contextValue === 'subheader') {
      destDir = target.folderPath;
      destSubfolder = target._entryName;
    } else {
      destDir = path.dirname(target.filePath);
      destSubfolder = target._subfolderName;
      basePosition = crossContainerPosition(target._entryName);
      if (basePosition === null) {
        refuseDrop(
          `"${target._entryName}" has no numeric prefix, so the CLI cannot place anything at its position.`,
        );
        return;
      }
      if (basePosition === 0) {
        refuseDrop(
          `"${target._entryName}" is numbered 00, and the CLI cannot place an item before a 00-numbered entry.`,
        );
        return;
      }
    }
    if (basePosition === undefined) {
      basePosition = appendPosition(fs.readdirSync(destDir));
    }

    const rows = sortByVisualOrder(draggedItems);
    const error = validateBatchDrop(
      rows,
      { dir: destDir, subfolderName: destSubfolder },
      (dir) => this._readDirEntries(dir),
    );
    if (error) {
      refuseDrop(error);
      return;
    }

    const positions = batchPositions(basePosition, rows.length);
    if (positions === null) {
      refuseDrop(
        `Dropping ${rows.length} items at position ${basePosition} would run past 99, the highest prefix the CLI accepts.`,
      );
      return;
    }

    const destModuleDir = path.join(this._workspaceRoot, 'course', destModule);
    for (let i = 0; i < rows.length; i++) {
      const resolved = this._resolveRowPath(rows[i]);
      if (resolved.error) {
        refuseDrop(resolved.error);
        this.refresh();
        return;
      }
      const args = [
        'movetomodule-item',
        '--path',
        resolved.path,
        '--to-module',
        destModule,
        '--position',
        String(positions[i]),
      ];
      if (destSubfolder) {
        // The destination subsection is an entry of its module root, so a
        // source gap-close in that root can renumber it mid-batch too.
        const sub = this._resolveDirBySuffix(destModuleDir, destSubfolder);
        if (sub.error) {
          refuseDrop(sub.error);
          this.refresh();
          return;
        }
        args.push('--to-subsection', sub.name);
      }
      const ok = await runCli(args);
      if (!ok) {
        // runCli has surfaced the CLI's own error; show the true state of
        // what did and did not land.
        this.refresh();
        return;
      }
    }
  }

  /**
   * The current absolute path of a dragged row, re-derived from the directory
   * listing by suffix (see the batch invariant above). Module folders are
   * never renamed by item moves, so the walk restarts from one.
   * Returns { path } or { error }.
   */
  _resolveRowPath(row) {
    const moduleDir = path.join(
      this._workspaceRoot,
      'course',
      row.moduleFolderName,
    );
    let containerDir = moduleDir;
    if (row.subfolderName) {
      const sub = this._resolveDirBySuffix(moduleDir, row.subfolderName);
      if (sub.error) return sub;
      containerDir = path.join(moduleDir, sub.name);
    }
    const names = this._readDirEntries(containerDir).map((e) => e.name);
    const matches = matchBySuffix(names, nameSuffix(row.entryName));
    if (matches.length !== 1) {
      return { error: this._staleRowError(row.entryName) };
    }
    return { path: path.join(containerDir, matches[0]) };
  }

  /** The unique numbered directory in `dir` sharing `originalName`'s suffix. */
  _resolveDirBySuffix(dir, originalName) {
    const names = this._readDirEntries(dir)
      .filter((e) => e.isDirectory)
      .map((e) => e.name);
    const matches = matchBySuffix(names, nameSuffix(originalName));
    if (matches.length !== 1) {
      return { error: this._staleRowError(originalName) };
    }
    return { name: matches[0] };
  }

  _staleRowError(entryName) {
    return `"${entryName}" was not where the batch expected it any more, so the batch stopped. The tree shows what did move.`;
  }

  _readDirEntries(dir) {
    return this._listDir(dir).map((e) => ({
      name: e.name,
      isDirectory: e.isDirectory(),
    }));
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

    // Dropping onto a sibling subsection or a top-level item — take that
    // target's slot within its module root. Same-module drops go through
    // `move-item`, whose --position is an ordinal; cross-module drops go
    // through `movetomodule-item`, whose --position is a prefix.
    const targetModule = target.moduleFolderName;
    if (targetModule === sourceModule) {
      if (dragged.entryName === target._entryName) return;
      const position = reorderPosition(
        fs.readdirSync(path.dirname(sourcePath)),
        target._entryName,
      );
      if (position === null) {
        refuseDrop(
          `"${target._entryName}" has no numeric prefix, so the CLI cannot place anything at its position.`,
        );
        return;
      }
      await runCli([
        'move-item',
        '--path',
        sourcePath,
        '--position',
        String(position),
      ]);
    } else {
      const position = crossContainerPosition(target._entryName);
      if (position === null) {
        refuseDrop(
          `"${target._entryName}" has no numeric prefix, so the CLI cannot place anything at its position.`,
        );
        return;
      }
      if (position === 0) {
        refuseDrop(
          `"${target._entryName}" is numbered 00, and the CLI cannot place an item before a 00-numbered entry.`,
        );
        return;
      }
      await runCli([
        'movetomodule-item',
        '--path',
        sourcePath,
        '--to-module',
        targetModule,
        '--position',
        String(position),
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
};
