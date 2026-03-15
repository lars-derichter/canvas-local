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

## Architecture

See [Architecture](architecture.md) for a technical overview of the three-layer
design, sync state format, push/pull algorithms, and link resolution.

## Tests

The project uses the built-in [Node.js test runner](https://nodejs.org/api/test.html)
(`node:test` + `node:assert`) — no extra dependencies required.

### Running tests

```bash
npm test
```

### Test structure

Tests live in `test/` and mirror the layout of `lib/`:

```
test/
├── canvas/
│   └── files.test.js          # MIME type detection
└── convert/
    ├── frontmatter.test.js    # YAML frontmatter parsing and serialization
    ├── markdown-to-html.test.js  # Markdown → Canvas HTML conversion and admonitions
    ├── html-to-markdown.test.js  # Canvas HTML → markdown conversion and admonitions
    ├── link-resolver.test.js     # Bidirectional link and file map resolution
    └── course-scanner.test.js    # Course directory scanning, position extraction, title derivation
```

Tests focus on the pure, deterministic functions in the conversion layer. The
Canvas API layer (`lib/canvas/`) is mostly thin HTTP wrappers, so only the
exported utility functions (like `detectContentType`) are unit-tested.
`course-scanner.test.js` creates a temporary directory with fixture files to
test the full directory scanning pipeline.

### Writing new tests

- Create a `*.test.js` file in the matching `test/` subdirectory.
- Use `describe`/`it` from `node:test` and assertions from `node:assert/strict`.
- The test runner discovers all `test/**/*.test.js` files automatically.

## Resilience & Conflict Detection

- **Retry logic**: API calls automatically retry on 429 (rate limit) and 5xx
  errors with exponential backoff (up to 3 attempts).
- **Error recovery**: If a single module or item fails during push/pull, the
  remaining items continue and a summary of errors is shown at the end.
- **Conflict detection**: `pull` checks if local files have been modified since
  the last sync and skips them to avoid overwriting your work. Use `--force` to
  override.
- **Stale ID recovery**: If a module, page, or assignment was deleted on Canvas
  but still has a stored ID locally, push detects the 404 and automatically
  creates a new resource.
- **Progress counters**: Push and pull show progress like `Module 2/5`,
  `Item 3/12`.

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
