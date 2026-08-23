---
title: Canvas Syncing
canvas_type: page
---

# Canvas Syncing

Once your content is ready, you can push it to Canvas or pull existing Canvas
content into your local project. The CLI handles all the API communication,
content conversion, and state tracking for you.

## Initial Setup

Before syncing, you need to configure your Canvas credentials:

```bash
npx course init
```

This interactive command asks for your Canvas instance URL, an API access token,
and the course ID. It stores these in a `.env` file. The Canvas setup guide
(`docs/canvas-setup.md` in your project folder, also readable on GitHub)
explains where to find these values.

> [!IMPORTANT]
>
> Keep your `.env` file secure. It contains your Canvas API token, which grants
> full access to your Canvas account. Never commit it to version control.

## Reviewing Changes Before You Push

Before pushing, it is a good idea to check what has changed:

```bash
npx course status
```

Status reads your files and your Canvas course, compares each of them against
the last sync, and prints what a sync would do: what changed here, what changed
there, and what changed on both sides. It writes nothing to either side.

Because it reads the live Canvas course, status needs your credentials and a
working connection. There is no offline version of it, because “what would a
sync do” cannot be answered from your own files alone.

Add `-m` to limit it to the modules you are working on:

```bash
npx course status -m 01-getting-started
```

## Validating Your Content

You can also check your content for common errors before pushing:

```bash
npx course validate
```

This catches issues like missing frontmatter fields, broken internal links, or
invalid assignment settings. That is much easier to fix locally than after
pushing to Canvas.

## Pushing to Canvas

```bash
npx course push
```

This converts all your markdown to HTML and uploads it to Canvas. Each module
becomes a Canvas module, and each file becomes the appropriate item type (page,
assignment, external link, or file upload).

Your markdown files carry no Canvas ids. The link between a file and the Canvas
object it became lives in `.canvas-sync.json`, in the root of your project, and
each row is keyed by the file’s path under `course/`.

That file belongs in git like any other. A push or a pull changes it, so you
normally have two things to commit afterwards: the content you wrote, and the
sync state that records where it landed.

> [!NOTE]
>
> Every push rebuilds the item list of the modules it manages. Your pages and
> assignments survive, but anything you added to one of those modules by hand in
> Canvas (a quiz, a discussion, an external tool) drops out of the module. See
> [Before You Publish](./01-before-you-publish.md).

### Useful Flags

| Flag                          | What it does                                                                                          |
| ----------------------------- | ----------------------------------------------------------------------------------------------------- |
| `--dry-run`                   | Preview what would happen without making any changes on Canvas                                        |
| `--module 01-getting-started` | Push only a single module instead of the entire course                                                |
| `--prune`                     | Delete Canvas modules and individual items that no longer exist locally. It lists them and asks first |

### Example Workflow

```bash
# Check what would change first
npx course push --dry-run

# Push only the module you are working on
npx course push --module 01-getting-started

# Push everything and clean up deleted items on Canvas
npx course push --prune
```

## Pulling From Canvas

```bash
npx course pull
```

This downloads your Canvas course and converts it into local markdown files.
Useful for importing an existing Canvas course or syncing changes made directly
on Canvas.

### Conflict Detection

Pull checks whether you have modified any local files since the last sync. If it
finds changes, it skips those files to avoid overwriting your work. To force
overwrite:

```bash
npx course pull --force
```

## Global Flags

These flags work with any command:

| Flag        | Effect                                             |
| ----------- | -------------------------------------------------- |
| `--verbose` | Show detailed API request and response information |
| `--quiet`   | Only show errors, suppress all other output        |

## Error Handling

The sync process is designed to be resilient:

- **Automatic retries**: API calls retry up to 3 times on rate limits (429) and
  server errors (5xx) with increasing wait times.
- **Partial failures**: If one item fails, the rest of the module continues. A
  summary of errors is shown at the end.
- **Progress tracking**: You see progress counters like `Module 2/5` and
  `Item 3/12` so you know where the sync is.

> [!TIP]
>
> Use `--dry-run` before your first real push to make sure everything looks
> right. It is much easier to fix issues before they reach Canvas.
