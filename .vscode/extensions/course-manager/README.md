# Coursewright for VS Code

Sidebar and command-palette access to the Coursewright CLI: browse your modules
and items in a tree view, drag them into a new order or into another module,
drop files from Finder or Explorer straight into a module, push to and pull from
Canvas, create, move, rename and delete items, search course content, and export
to PDF or DOCX, all without leaving VS Code.

Most of the CLI is reachable from the palette. Several commands are there and
nowhere else, and for three of them that is deliberate: `build-glossary` and the
two destructive ones, `reset-sync-state` and `reset-canvas`, have no button,
menu entry or tree row, so no stray click can start one. Seven go the other way
and are missing from the palette instead, because each acts on the tree row you
invoked it from: the inline Open in Canvas button, the four Canvas actions on a
module row (push, sync, pull, status), and the two halves of the merge.

The extension is bundled with the
[Coursewright](https://github.com/lars-derichter/coursewright) template and runs
the project's own CLI, so it needs to be installed from a course project. From
the project root:

```bash
npm run vscode:install
```

See `docs/vscode.md` in your project for the full command reference.
