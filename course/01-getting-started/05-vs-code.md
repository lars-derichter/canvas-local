---
title: VS Code
canvas_type: page
---

# VS Code

Visual Studio Code (VS Code) is a free code editor that works beautifully with
this project. You do not need it (any text editor and a terminal will do), but
it makes the experience a lot smoother.

## Why VS Code?

VS Code is a great match for Canvas Course Builder because it brings together
everything you need in one window:

- **Markdown support**: syntax highlighting, live preview, and formatting
  shortcuts for the markdown files you write your course in
- **Built-in terminal**: run CLI commands like `npx course push` without leaving
  the editor
- **Git integration**: the Source Control panel lets you stage, commit, and push
  changes visually (see [Git Workflow](10-git-workflow.md) for a walkthrough)
- **Course Manager extension**: this project includes a custom VS Code extension
  that puts all course commands in the sidebar and command palette, so you can
  manage your course without typing commands at all

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
   Ctrl+O**) to open your `canvas-course-builder` project folder.

> [!TIP]
>
> If you installed VS Code with the PATH option (Windows) or ran **Shell
> Command: Install 'code' command in PATH** from the command palette (macOS),
> you can open your project from the terminal: `code canvas-course-builder`

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

The tree updates automatically whenever you add, rename, or delete files. There
is no need to refresh manually.

### Inline Actions

Hover over a module or item in the sidebar for quick-action buttons:

- **Push This Module to Canvas** (cloud icon): push just that module to Canvas.
  Module rows only, because a module is the smallest thing a push can send.
- **Open in Canvas** (link icon): open that module or item on Canvas in your
  browser. A module row lands on the course's modules page, scrolled to that
  module. An item you have not pushed yet has nothing to open, so the extension
  tells you that instead.

### Right-Click Menu

Right-click any module or item in the sidebar to see context actions:

- **New**, **Rename**, **Move**, **Delete**: the same management commands,
  without typing
- **Move Item to Module**: move an item to another module or one of its
  subsections; works for subsections too (they always land in the module root,
  because subsections are never nested)
- **Merge items**: first right-click an item and choose **Merge: Set as
  Source**, then right-click the target item and choose **Merge with Source**
- **Course: Export Item to PDF/DOCX...**: export the selected item or items
  (multi-select combines them into one document), or a whole module via
  **Course: Export Module to PDF/DOCX...**

**Split Item at Cursor** is not on this menu. It works on the file open in the
editor and the position of your cursor, neither of which a right-click on the
tree tells it, so it lives in the command palette only.

Names, positions, and confirmations are collected through normal VS Code
dialogs, and the command runs quietly in the background: no terminal pops up.
You get a notification when it is done, and the full output is available in the
**Canvas Course Builder** output channel (View > Output).

### Drag and Drop

The fastest way to reorganise is dragging things around the tree:

- **Reorder modules**: drag a module onto another module
- **Move items**: drag an item within its module to reorder it, or onto another
  module or subsection to move it there
- **Move subsections**: drag a subsection onto another module
- **Add files**: drag files straight from Finder or Explorer onto a module to
  add them as file items

Renumbering and Canvas sync state are handled automatically, exactly as if you
had run the CLI commands yourself.

## Title Bar Buttons

Four buttons sit at the top of the sidebar: **New Module** (create a module and
pick its position), **Search** (find a word or phrase across your course files),
**Preview** (starts the Docusaurus dev server if it is not already running and
opens the course in your browser), and **Refresh** for the tree. The dropdown
menu next to them gives quick access to sync and export commands:

- **Preview**: the same command as the button
- **Sync with Canvas**: sync both ways in one run
- **Push to Canvas**: push all modules
- **Pull from Canvas**: pull content from Canvas
- **Status**: see what a sync would do, without changing anything
- **Validate**: check your content for errors before pushing
- **Export**: export the full course, only flagged items, or a curated selection
  via a table of contents
- **Export via TOC**: appears once you have generated a table of contents and
  edited it down to what you want

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

A few tree actions (**Push This Module to Canvas**, **Open in Canvas**, and the
two halves of the merge) need a selected row to work on, so the palette does not
list them; use the hover buttons and the right-click menu for those.

## How It Works

Everything the extension does goes through the same `npx course` CLI you use in
the terminal, so renumbering and Canvas sync state behave exactly the same
either way. The long-running ones (setup, init, sync, push, pull, status,
validate, and the dry runs) run in a shared **Canvas Course Builder** terminal
so you can follow their output; management commands (new, rename, move, delete,
merge, split) run silently in the background and report back with a
notification.

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
