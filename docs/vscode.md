# VS Code Integration

All course commands are available in the VS Code command palette (Cmd+Shift+P /
Ctrl+Shift+P). Type "Course:" to filter the list.

## Installation

```bash
npm run vscode:install
```

This packages the extension with `@vscode/vsce` and installs it into VS Code.
Requires the `code` CLI to be available on your PATH.

## Sidebar

The extension adds a **Course Manager** panel to the VS Code activity bar (book
icon on the left). It shows a tree view of all modules and items in the
`course/` directory.

### Tree Structure

- **Modules** — shown as folders, labelled from `_category_.json` or derived
  from the folder name. The numeric prefix is shown as a description.
- **Subheaders** — subfolders within a module, shown as collapsible groups.
- **Items** — course pages, assignments, discussions, quizzes, external URLs,
  LTI links, and files. Pages, assignments, external URLs and files each have a
  distinct icon; the newer types fall back to the page icon for now. Labels come
  from the frontmatter `title` (the same name Canvas and Docusaurus show); the
  filename is shown in the tooltip. Clicking an item opens the file in the
  editor.

### Inline Actions

Hover over a tree item to see inline action buttons:

| Button        | Action                            |
| ------------- | --------------------------------- |
| Cloud upload  | Push the item's module to Canvas  |
| External link | Open the item in Canvas (browser) |

"Open in Canvas" requires the item to have been pushed at least once. It looks
the id up in `.canvas-sync.json` by the file's path, and takes the Canvas URL
from `.env`. Pages, assignments, discussions and quizzes open their own Canvas
page, file items open the Canvas file view, and external URL items open the URL
itself. An LTI link has no page of its own, so it opens as the module item it
is. An item with no row yet is reported as not pushed rather than guessed at.

The sidebar's **New Item** creates pages, assignments, external URLs,
subsections and file items. A discussion, a quiz or an LTI link is a file you
write yourself: see [Frontmatter](frontmatter.md).

### Context Menu

Right-click a module or item to access management commands. The command acts on
the element you clicked — names, positions, and confirmation are collected
through native VS Code dialogs, and the operation runs the CLI in the background
(no terminal pops up):

- **New Item / New Module** — create items or modules
- **Rename / Move** — rename or reorder items and modules (rename pre-fills the
  current title)
- **Move Item to Module** — move an item to a different module (or one of its
  subsections). Subsections themselves can also be moved, but always to a module
  root — they cannot be nested inside another subsection.
- **Delete** — delete an item or module, after a modal confirmation
- **Merge: Set as Source / Merge with Source** — two-step merge: right-click the
  source item first, then right-click the target item to merge them
- **Export to PDF/DOCX** — export the item (or module). Select several items
  first — Ctrl/Cmd-click or Shift-click in the tree — to export them together as
  one combined document. You then pick PDF or Word.

The same commands also work from the command palette; you then pick the module
or item from a quick-pick list instead. Either way the actual work is done by
the `npx course` CLI with non-interactive flags, so renumbering and Canvas sync
state behave exactly like the terminal commands. Full output is available in the
**Canvas Course Builder** output channel (View → Output).

### Drag and Drop

Drag tree items to reorder them:

- **Modules** — drag a module onto another module to change its position. All
  modules are renumbered sequentially.
- **Items** — drag an item within the same module to reorder, or drag it onto a
  different module or subheader to move it there. Both source and target
  directories are renumbered automatically.
- **Subsections** — drag a subheader onto another module to move it there, or
  onto a sibling subheader / top-level item to reorder it within the module
  root. Subsections are never nested, so dropping one onto an item that lives
  inside a subsection is ignored.
- **External files** — drag files from Finder or Explorer onto a module,
  subheader, or item to add them as file items at that location.

Drops are translated into the corresponding CLI commands (`move-module`,
`move-item`, `movetomodule-item`, `new-item --type file`), so Canvas sync state
stays correct and the next push picks the changes up cleanly.

### Auto-Refresh

The tree refreshes automatically when files in `course/` are created, deleted,
or modified. Use the refresh button in the view title bar to manually refresh.

### Title Bar Menu

The title bar carries four buttons, in this order: **New Module**, which creates
a module and asks for its name and position; **Search**, which asks for a word
or phrase and shows all matches (with context) in the terminal; **Preview**,
which starts the Docusaurus dev server (if not already running) and opens the
course in the browser; and **Refresh**, above. The dropdown repeats **Preview**
and adds **Sync with Canvas**, **Push to Canvas**, **Pull from Canvas**,
**Status** and **Validate** for quick access to sync commands, plus **Export**,
a quick pick to export the full course, only flagged items, or a curated
selection via a table of contents. Choosing the TOC option opens the generated
list for editing and reveals an **Export via TOC** action once it is ready.

## Commands

### Setup

| Command                          | Description                                    |
| -------------------------------- | ---------------------------------------------- |
| Course: Setup (First-Run Wizard) | Course name, language, templates, look, Canvas |
| Course: Init (Canvas Setup)      | Interactive Canvas API setup                   |

### Sync

| Command                            | Description                                |
| ---------------------------------- | ------------------------------------------ |
| Course: Sync with Canvas           | Two-way sync: newest wins, nothing deleted |
| Course: Sync with Canvas (Dry Run) | Preview a sync without writing anything    |
| Course: Push to Canvas             | Push all modules to Canvas                 |
| Course: Push to Canvas (Dry Run)   | Preview push without making changes        |
| Course: Push Module to Canvas...   | Pick a module from a list and push it      |
| Course: Pull from Canvas           | Pull Canvas course into local markdown     |
| Course: Status                     | Compare local vs Canvas state              |
| Course: Validate                   | Check course content for errors            |

### Module Management

| Command               | Description                                      |
| --------------------- | ------------------------------------------------ |
| Course: New Module    | Create a new module (asks for name and position) |
| Course: Move Module   | Move a module to a different position            |
| Course: Rename Module | Rename a module                                  |
| Course: Delete Module | Delete a module and renumber remaining           |

### Item Management

| Command                      | Description                                               |
| ---------------------------- | --------------------------------------------------------- |
| Course: New Item             | Create a page, assignment, url, subsection, or add a file |
| Course: Move Item            | Reorder an item within its module                         |
| Course: Move Item to Module  | Move an item to a different module                        |
| Course: Rename Item          | Rename an item                                            |
| Course: Delete Item          | Delete an item and renumber remaining                     |
| Course: Merge Items          | Merge two items into one                                  |
| Course: Split Item at Cursor | Split the active file at the cursor into two files        |

### Search

| Command           | Description                               |
| ----------------- | ----------------------------------------- |
| Course: Search... | Find a word or phrase across course files |

### Export

| Command                       | Description                                              |
| ----------------------------- | -------------------------------------------------------- |
| Export to PDF/DOCX...         | Export the selected item(s) — multi-select combines them |
| Export Module to PDF/DOCX...  | Export a whole module                                    |
| Course: Export to PDF/DOCX... | Export the full course, only flagged items, or via a TOC |
| Course: Export via TOC...     | Render the curated `exports/toc.md` after editing it     |

See [export styling](export-styling.md) for customising fonts, colours, and
margins.

## How It Works

- Long-running commands run in a single shared **Canvas Course Builder**
  terminal so you can follow their output: Setup, Init, Sync, Push, Pull,
  Status, Validate, and the two dry runs.
- Structural commands (new/rename/move/delete, merge, split) run the CLI
  silently in the background; results appear as notifications and in the
  **Canvas Course Builder** output channel, and the tree refreshes
  automatically.
- The workspace check blocks on one thing. `validateWorkspace` stops a command
  when no workspace folder is open at all; a workspace with no `course/`
  directory only draws a warning pointing at Init, and the command runs
  regardless. That is what lets Setup and New Module run in a project that has
  no `course/` yet. Init is exempt from the check altogether.
- **Push Module** presents a quick-pick list of all module folders so you can
  select which one to push.
- **Preview** checks whether the Docusaurus dev server is already running. If
  not, it starts `npm start` in a Preview terminal and opens the browser as soon
  as the server responds.
