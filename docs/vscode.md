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
