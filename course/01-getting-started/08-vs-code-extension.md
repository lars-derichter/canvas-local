---
title: VS Code Extension
canvas_type: page
---

# VS Code Extension

If you use Visual Studio Code, you can run all course commands directly from the editor without switching to a terminal. The project includes a local VS Code extension that adds every CLI command to the command palette.

## Installation

From the project root, run:

```bash
npm run vscode:install
```

This installs the extension locally for your VS Code instance. You only need to do this once (or again after the extension is updated).

## Using the Extension

Open the command palette with **Cmd+Shift+P** (macOS) or **Ctrl+Shift+P** (Windows/Linux) and type **"Course:"** to see all available commands:

| Command | What it does |
| --- | --- |
| Course: Init (Canvas Setup) | Configure Canvas API credentials |
| Course: Push to Canvas | Push all modules |
| Course: Push to Canvas (Dry Run) | Preview push without making changes |
| Course: Push Module to Canvas... | Push a single module |
| Course: Pull from Canvas | Pull content from Canvas |
| Course: Status | Compare local vs sync state |
| Course: New Module | Create a new module |
| Course: Move Module | Reorder a module |
| Course: Rename Module | Rename a module |
| Course: Delete Module | Delete a module |
| Course: New Item | Create a new item |
| Course: Move Item | Reorder an item |
| Course: Move Item to Module | Move an item to another module |
| Course: Rename Item | Rename an item |
| Course: Delete Item | Delete an item |

## How It Works

The extension is a thin wrapper around the CLI. When you run a command from the palette, it opens a terminal in VS Code and executes the corresponding `npx course` command. This means you get the same interactive prompts as you would in a regular terminal.

Before running any command, the extension checks that your workspace contains a `course/` directory. If it does not, you will see a notification asking you to open the correct project.

> [!NOTE]
> The extension runs commands in the VS Code integrated terminal, so you can see all output, answer prompts, and review results without leaving the editor.

## Updating

If the extension is updated (for example, after pulling new changes), reinstall it:

```bash
npm run vscode:install
```

Then reload VS Code (or run **Developer: Reload Window** from the command palette) to pick up the new version.
