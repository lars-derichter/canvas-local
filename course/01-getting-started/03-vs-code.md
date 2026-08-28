---
title: VS Code
canvas_type: page
---

# VS Code

Visual Studio Code (VS Code) is a free code editor that works beautifully with
this project. You do not need it (any text editor and a terminal will do), but
it makes the experience a lot smoother.

## Why VS Code?

VS Code is a great match for Coursewright because it brings together everything
you need in one window:

- **Markdown support**: syntax highlighting, live preview, and formatting
  shortcuts for the markdown files you write your course in
- **Built-in terminal**: run CLI commands like `npx course push` without leaving
  the editor
- **Git integration**: the Source Control panel lets you stage, commit, and push
  changes visually (see [Git Workflow](07-git-workflow.md) for a walkthrough)
- **Course Manager extension**: this project includes a custom VS Code extension
  that puts the course commands in the command palette, and the everyday ones in
  a sidebar, so you can manage your course without typing commands at all

It is free, open-source, and runs on Windows, macOS, and Linux.

## Installing VS Code

1. Go to [code.visualstudio.com](https://code.visualstudio.com/) and download
   the installer for your operating system.

2. Install it:

   - **Windows**: run the downloaded installer and follow the prompts. Check the
     option to add VS Code to your PATH if offered.
   - **macOS**: open the downloaded `.zip` file and drag **Visual Studio Code**
     into your **Applications** folder.
   - **Linux**: follow the instructions on the download page for your
     distribution, or install the `.deb` or `.rpm` package directly.

3. Open VS Code and use **File > Open Folder** (or **Cmd+O** / **Ctrl+K
   Ctrl+O**) to open your `coursewright` project folder.

> [!TIP]
>
> If you installed VS Code with the PATH option (Windows) or ran **Shell
> Command: Install 'code' command in PATH** from the command palette (macOS),
> you can open your project from the terminal: `code coursewright`

## Installing the Course Manager Extension

From the project root, run:

```bash
npm run vscode:install
```

You only need to do this once (or again after the extension is updated).

## The Course Manager Sidebar

After installing the extension, you will see a **Course Manager** panel in the
VS Code activity bar (the book icon). It shows a tree view of all your modules
and items, complete with icons for each content type. Item labels come from the
frontmatter `title` (the same name Canvas and Docusaurus show), and clicking an
item opens the file in the editor.

The tree updates itself whenever you add, rename, or delete files, so you rarely
need to touch the refresh button in its title bar. It is there for the times a
change slips past the watcher. The title bar also carries a **Collapse All**
button for when the tree has grown long.

Before you have any modules, the panel shows a short welcome instead of an empty
box: a button that starts the setup wizard, and a link to this tutorial module.
With no folder open at all, it points you at **File > Open Folder** first.

### Inline Actions

Hover over a module or item in the sidebar for quick-action buttons:

- **Push This Module to Canvas** (cloud icon): push just that module to Canvas.
  Module rows only, because a module is the smallest thing a push can send.
- **Open in Canvas** (link icon): open that module or item on Canvas in your
  browser. A module row lands on the course's modules page, scrolled to that
  module. An item you have not pushed yet has nothing to open, so the extension
  tells you that instead.

### Right-Click Menu

Right-click a module or an item in the sidebar to see context actions:

- **Course: New Item**, **Course: Rename Item**, **Course: Move Item**,
  **Course: Delete Item**, and the same four for modules: the management
  commands, without typing
- **Course: Move Item to Module**: move an item to another module or one of its
  subsections; works for subsections too (they always land in the module root,
  because subsections are never nested)
- **Merge items**: on page and assignment rows only. Right-click one and choose
  **Merge: Set as Source**, then right-click the target and choose **Merge with
  Source**. A dialog names both files and reminds you that the source is
  deleted.
- **Course: Export Item to PDF/DOCX...**: export the selected item or items
  (multi-select combines them into one document), or a whole module via
  **Course: Export Module to PDF/DOCX...**
- **Sync This Module with Canvas**, **Push This Module to Canvas**, **Pull This
  Module from Canvas** and **Status of This Module**: run one of the four Canvas
  commands on the module you clicked instead of on the whole course. Module rows
  only. These open the shared terminal, so you can read the report and answer
  the questions the command asks there, such as which side wins when you and
  Canvas both reordered the same module.

**Course: Split Item at Cursor** is not on this menu. It works on the file open
in the editor and the position of your cursor, neither of which a right-click on
the tree tells it, so it lives in the editor's own right-click menu (on any
markdown file inside `course/`) and in the command palette.

For the management commands, names, positions, and confirmations are collected
through normal VS Code dialogs, and the command runs quietly in the background:
no terminal pops up. When it finishes, its last line of output appears in the
status bar for a few seconds and the tree refreshes itself. If something goes
wrong you get an error notification with a **Show Log** button, which opens the
full output in the **Coursewright** output channel (View > Output). A command
that worked but still has something to tell you (a delete that stranded
something on Canvas, say) shows a warning with the same button, so read those.

The export and Canvas actions do open a terminal, so you can watch the output
and answer whatever the CLI asks.

### Drag and Drop

The fastest way to reorganise is dragging things around the tree:

- **Reorder modules**: drag a module onto another module
- **Move items**: drag an item within its module to reorder it, or onto another
  module or subsection to move it there
- **Move subsections**: drag a subsection onto another module
- **Add files**: drag files straight from Finder or Explorer onto a module, a
  subsection, or an item to add them as file items. They land at the end of that
  module or subsection, not at the exact spot you dropped them, so move them
  afterwards if the order matters
- **Move a whole group**: select several rows (Ctrl/Cmd-click or Shift-click)
  and drag them together onto a module, a subsection, or an item

Renumbering and Canvas sync state are handled automatically, exactly as if you
had run the CLI commands yourself. A drag the CLI cannot express, such as
modules and items mixed in one selection, is refused with a message that says
why, rather than half-done.

## Title Bar Buttons

Four buttons sit at the top of the sidebar: **Course: New Module** (asks for a
name and adds the module at the end), **Course: Search...** (find a word or
phrase across your course files), **Course: Preview** (starts the Docusaurus dev
server if it is not already running and opens the course in your browser), and
**Course: Refresh Tree**. The dropdown menu next to them gives quick access to
sync and export commands:

- **Course: Preview**: the same command as the button
- **Course: Sync with Canvas**: sync both ways in one run
- **Course: Push to Canvas**: push all modules
- **Course: Pull from Canvas**: pull content from Canvas
- **Course: Status**: see what a sync would do, without changing anything
- **Course: Validate**: check your content for errors before pushing
- **Course: Export Course to PDF/DOCX...**: export the full course, only flagged
  items, or a curated selection via a table of contents
- **Course: Export via TOC...**: appears once you have generated a table of
  contents and edited it down to what you want

> [!TIP]
>
> The preview runs on port 3000. If something else on your machine already uses
> that port, set **Course Manager: Preview Port** in VS Code's settings (search
> for `courseManager.previewPort`). The next preview picks it up.

## Command Palette

Open the command palette with **Cmd+Shift+P** (macOS) or **Ctrl+Shift+P**
(Windows/Linux) and type **“Course:”** to filter it down to the course commands:

| Command                              | What it does                                           |
| ------------------------------------ | ------------------------------------------------------ |
| Course: Setup (First-Run Wizard)     | Name, language, look, templates, Canvas                |
| Course: Init (Canvas Setup)          | Configure Canvas API credentials                       |
| Course: Sync with Canvas             | Sync both ways in one run                              |
| Course: Sync with Canvas (Dry Run)   | Preview a sync without writing anything                |
| Course: Push to Canvas               | Push all modules                                       |
| Course: Push to Canvas (Dry Run)     | Preview push without making changes                    |
| Course: Push Module to Canvas...     | Push a single module                                   |
| Course: Pull from Canvas             | Pull content from Canvas                               |
| Course: Pull from Canvas (Dry Run)   | Preview a pull without changing your files             |
| Course: Status                       | Show what a sync would do, without writing anything    |
| Course: Validate                     | Check content for errors                               |
| Course: Search...                    | Find a word or phrase across files                     |
| Course: New Module                   | Create a new module                                    |
| Course: Move Module                  | Reorder a module                                       |
| Course: Rename Module                | Rename a module                                        |
| Course: Delete Module                | Delete a module                                        |
| Course: New Item                     | Create a new item                                      |
| Course: Move Item                    | Reorder an item                                        |
| Course: Move Item to Module          | Move an item to another module                         |
| Course: Rename Item                  | Rename an item                                         |
| Course: Delete Item                  | Delete an item                                         |
| Course: Merge Items                  | Combine two items into one                             |
| Course: Split Item at Cursor         | Split the active file at the cursor                    |
| Course: Export Item to PDF/DOCX...   | Export one item, or several combined into one document |
| Course: Export Module to PDF/DOCX... | Export a whole module                                  |
| Course: Export Course to PDF/DOCX... | Export the course, flagged items, or a TOC selection   |
| Course: Export via TOC...            | Render the curated `exports/toc.md`                    |
| Course: Preview                      | Start the dev server and open the course               |
| Course: Refresh Tree                 | Rebuild the sidebar tree by hand                       |

> [!WARNING]
>
> Three more commands live in the palette and nowhere else: **Course: Build
> Glossary**, **Course: Reset Sync State (Destructive)** and **Course: Reset
> Canvas (Deletes ALL Canvas Content)**. They are deliberately kept out of the
> sidebar, so that no stray click can start one. Both resets ask you to confirm
> in the terminal first, and Reset Canvas empties your Canvas course. Read
> `docs/backups.md` and `docs/advanced-commands.md` (in your project folder,
> also readable on GitHub) before you use them.

Some tree actions need a selected row to work on, so the palette does not list
them: **Push This Module to Canvas**, **Open in Canvas**, **Sync This Module
with Canvas**, **Pull This Module from Canvas**, **Status of This Module**, and
the two halves of the merge. Use the hover buttons and the right-click menu for
those.

## How It Works

Everything the extension does goes through the same `npx course` CLI you use in
the terminal, so renumbering and Canvas sync state behave exactly the same
either way. The commands whose output is a report to read run in a shared
**Coursewright** terminal: setup, init, sync, push, pull, status, validate, the
dry runs, search, push module, the four Canvas actions on a module row, and
every export. The one exception is the table-of-contents option in **Course:
Export Course to PDF/DOCX...**: it writes the list quietly and opens it for you
to edit, and the export itself runs in the terminal once you choose **Course:
Export via TOC...**. Management commands (new, rename, move, delete, merge,
split) run silently in the background instead, and report through the status
bar, a notification when there is something you have to act on, and the output
channel.

If you start a second background command while one is still running, it waits
its turn: they run one at a time, so two of them can never renumber the same
folder at once. A single spinner in the status bar shows when something is
running or queued.

> [!TIP]
>
> If you have a file open inside a module folder, the palette commands already
> know where you are: whenever one asks for a module or an item, that file's
> module (or the file itself) sits at the top of the list, marked as current.
> Press Enter to confirm it, or pick any other entry as usual.

## Updating

If the extension is updated (for example, after pulling new changes), reinstall
it:

```bash
npm run vscode:install
```

Then reload VS Code (or run **Developer: Reload Window** from the command
palette) to pick up the new version.
