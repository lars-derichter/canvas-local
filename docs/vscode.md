# VS Code Integration

All course commands are available in the VS Code command palette (Cmd+Shift+P /
Ctrl+Shift+P). Type "Course:" to filter the list.

## Installation

```bash
npm run vscode:install
```

This packages the extension with `@vscode/vsce` and installs it into VS Code.
Requires the `code` CLI to be available on your PATH.

## Commands

### Setup

| Command      | Description                  |
| ------------ | ---------------------------- |
| Course: Init | Interactive Canvas API setup |

### Sync

| Command                          | Description                            |
| -------------------------------- | -------------------------------------- |
| Course: Push to Canvas           | Push all modules to Canvas             |
| Course: Push to Canvas (Dry Run) | Preview push without making changes    |
| Course: Push Module to Canvas    | Pick a module from a list and push it  |
| Course: Pull from Canvas         | Pull Canvas course into local markdown |
| Course: Status                   | Compare local vs Canvas state          |

### Module Management

| Command               | Description                                      |
| --------------------- | ------------------------------------------------ |
| Course: New Module    | Create a new module (asks for name and position) |
| Course: Move Module   | Move a module to a different position            |
| Course: Rename Module | Rename a module                                  |
| Course: Delete Module | Delete a module and renumber remaining           |

### Item Management

| Command                     | Description                                               |
| --------------------------- | --------------------------------------------------------- |
| Course: New Item            | Create a page, assignment, url, subsection, or add a file |
| Course: Move Item           | Reorder an item within its module                         |
| Course: Move Item to Module | Move an item to a different module                        |
| Course: Rename Item         | Rename an item                                            |
| Course: Delete Item         | Delete an item and renumber remaining                     |

## Sidebar

The extension adds a **Course Manager** panel to the VS Code activity bar
(book icon on the left). It shows a tree view of all modules and items in the
`course/` directory.

### Tree structure

- **Modules** — shown as folders, labeled from `_category_.json` or derived
  from the folder name. The numeric prefix is shown as a description.
- **Subheaders** — subfolders within a module, shown as collapsible groups.
- **Items** — course pages, assignments, external URLs, and files. Each type
  has a distinct icon. Clicking an item opens the file in the editor.

### Inline actions

Hover over a tree item to see inline action buttons:

| Button | Action |
| ------ | ------ |
| Cloud upload | Push the item's module to Canvas |
| External link | Open the item in Canvas (browser) |

"Open in Canvas" requires the item to have been pushed at least once. It reads
the `canvas_id` from the file's frontmatter and the Canvas URL from `.env`.

### Context menu

Right-click a module or item to access management commands:

- **New Item / New Module** — create items or modules
- **Rename / Move** — rename or reorder items and modules
- **Move Item to Module** — move an item to a different module
- **Delete** — delete an item or module

These commands run the same CLI operations as the command palette equivalents.

### Drag and drop

Drag tree items to reorder them:

- **Modules** — drag a module onto another module to change its position.
  All modules are renumbered sequentially.
- **Items** — drag an item within the same module to reorder, or drag it
  onto a different module or subheader to move it there. Both source and
  target directories are renumbered automatically.
- **External files** — drag files from Finder or Explorer onto a module or
  item to copy them into the course structure. Files are automatically
  numbered and renamed to match the naming convention (lowercase, hyphenated).

### Auto-refresh

The tree refreshes automatically when files in `course/` are created, deleted,
or modified. Use the refresh button in the view title bar to manually refresh.

### Title bar menu

The view title bar dropdown includes **Push to Canvas**, **Pull from Canvas**,
and **Status** for quick access to sync commands.

## How It Works

- Commands run in a dedicated **Canvas Local** terminal inside VS Code.
- A notification message is shown when a command starts.
- Most commands validate that a `course/` directory exists in the workspace
  before running. The Init command is exempt from this check.
- When you have a file open inside `course/`, commands use that file's directory
  as the working directory. This lets item commands auto-detect which module you
  are working in.
- **Push Module** presents a quick-pick list of all module folders so you can
  select which one to push.
