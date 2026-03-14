# Development

Advanced commands and tooling for course developers.

## Development Commands

These commands modify sync state or Canvas content destructively. Only use them
if you know what you are doing.

### reset-sync-state

```bash
npx course reset-sync-state
```

Removes all instance-specific sync artifacts from the local codebase:

1. Walks every markdown file in `course/` and strips the `canvas_id` field from
   its frontmatter.
2. Deletes `.canvas-sync.json` (the file that tracks module IDs, item IDs, and
   uploaded icon IDs).

After running this command the project is back to a "never pushed" state — the
next `push` will create everything fresh on Canvas.

**When to use:**

- Switching to a different Canvas instance or course.
- Preparing the repo for sharing (strip instance-specific IDs).
- Testing the full sync flow from scratch.

**Note:** The command runs immediately with no confirmation prompt.

### reset-canvas

```bash
npx course reset-canvas
```

Deletes **all** content from the Canvas course configured in `.env`:

- All modules
- All pages
- All assignments
- All files

The command asks for interactive confirmation before making any changes:

```
Are you sure you want to delete all content on the Canvas course with id 123? (y/n)
```

If individual deletions fail the command continues with the remaining items and
reports a summary of errors at the end.

Use `--verbose` to see each deletion as it happens:

```bash
npx course --verbose reset-canvas
```

**Typical workflow:** Run `reset-canvas` followed by `reset-sync-state` to get
both Canvas and local state back to a clean slate, then `push` to re-create
everything.

## Claude Code

This project includes a [CLAUDE.md](../CLAUDE.md) file that gives
[Claude Code](https://claude.ai/code) full context about the project structure,
available commands, and coding conventions. Claude Code can help with writing
course content, managing modules and items, debugging sync issues, and more.

### The /commit skill

The project defines a custom `/commit` skill (in `.claude/skills/commit/`) that
makes committing safer and more consistent. When you type `/commit` in Claude
Code it will:

1. Review all staged and unstaged changes.
2. Filter out course files where `canvas_id` is the only change — these are
   instance-specific sync artifacts that should not be committed.
3. Stage the appropriate files and create a commit with a clear message.

#### Commit message conventions

- Imperative, present tense, verb-first (e.g. _Add_, _Fix_, _Update_, _Remove_,
  _Rename_).
- Single-line summary — no conventional-commit prefixes like `feat:` or `fix:`.
- Focus on _what_ changed and _why_, not implementation details.

Examples:

```
Add reset-canvas command to wipe all content from a Canvas course
Upload files to module-named Canvas folder instead of unfiled
Fix push failing to add pages/assignments to Canvas modules
```
