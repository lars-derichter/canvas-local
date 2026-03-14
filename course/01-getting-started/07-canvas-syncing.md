---
title: Canvas Syncing
canvas_type: page
---

# Canvas Syncing

Once your content is ready, you can push it to Canvas or pull existing Canvas content into your local project. The CLI handles all the API communication, content conversion, and state tracking for you.

## Initial Setup

Before syncing, you need to configure your Canvas credentials:

```bash
npx course init
```

This interactive command asks for your Canvas instance URL, an API access token, and the course ID. It stores these in a `.env` file.

> [!IMPORTANT]
> Keep your `.env` file secure. It contains your Canvas API token, which grants full access to your Canvas account. Never commit it to version control.

## Pushing to Canvas

```bash
npx course push
```

This converts all your markdown to HTML and uploads it to Canvas. Each module becomes a Canvas module, and each file becomes the appropriate item type (page, assignment, external link, or file upload).

After the first push, `canvas_id` is written back into each file's frontmatter so the CLI knows which Canvas object to update on subsequent pushes.

### Useful Flags

| Flag | What it does |
| --- | --- |
| `--dry-run` | Preview what would happen without making any changes on Canvas |
| `--module 01-getting-started` | Push only a single module instead of the entire course |
| `--prune` | Delete Canvas modules that no longer exist locally |

### Example Workflow

```bash
# Check what would change first
npx course push --dry-run

# Push only the module you are working on
npx course push --module 01-getting-started

# Push everything
npx course push
```

## Pulling from Canvas

```bash
npx course pull
```

This downloads your Canvas course and converts it into local markdown files. Useful for importing an existing Canvas course or syncing changes made directly on Canvas.

### Conflict Detection

Pull checks whether you have modified any local files since the last sync. If it finds changes, it skips those files to avoid overwriting your work. To force overwrite:

```bash
npx course pull --force
```

## Checking Status

```bash
npx course status
```

Compares your local files against the last known sync state. Add `--remote` to also fetch the current state from Canvas and compare:

```bash
npx course status --remote
```

## Global Flags

These flags work with any command:

| Flag | Effect |
| --- | --- |
| `--verbose` | Show detailed API request and response information |
| `--quiet` | Only show errors, suppress all other output |

## Error Handling

The sync process is designed to be resilient:

- **Automatic retries**: API calls retry up to 3 times on rate limits (429) and server errors (5xx) with increasing wait times.
- **Partial failures**: If one item fails, the rest of the module continues. A summary of errors is shown at the end.
- **Progress tracking**: You see progress counters like `Module 2/5` and `Item 3/12` so you know where the sync is.

> [!TIP]
> Use `--dry-run` before your first real push to make sure everything looks right. It is much easier to fix issues before they reach Canvas.
