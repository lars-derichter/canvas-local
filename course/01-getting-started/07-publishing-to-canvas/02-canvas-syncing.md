---
title: Canvas Syncing
canvas_type: page
---

# Canvas Syncing

Once your content is ready, you can push it to Canvas, pull existing Canvas
content into your local project, or do both in one run with `npx course sync`.
The CLI handles all the API communication, content conversion, and state
tracking for you.

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

This catches broken internal links, images and downloads that are not where a
page says they are, frontmatter that will not parse, and items missing a field
their type needs. That is much easier to fix locally than after pushing to
Canvas.

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

That file belongs in git like any other. A push, a pull or a sync changes it, so
you normally have two things to commit afterwards: the content you wrote, and
the sync state that records where it landed.

> [!NOTE]
>
> Push does not rebuild a module from scratch. An item you added in Canvas by
> hand is matched to a local file of the same type and title, and left where it
> is when nothing matches. See [Before You Publish](./01-before-you-publish.md).

### Useful Flags

| Flag                          | What it does                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------ |
| `--dry-run`                   | Preview what would happen without making any changes on Canvas                             |
| `--module 01-getting-started` | Push only a single module instead of the entire course                                     |
| `--prune-canvas`              | Delete Canvas items and modules whose local file you deleted. It lists them and asks first |

### Example Workflow

```bash
# Check what would change first
npx course push --dry-run

# Push only the module you are working on
npx course push --module 01-getting-started

# Push everything and clean up deleted items on Canvas
npx course push --prune-canvas
```

## Pulling From Canvas

```bash
npx course pull
```

This downloads your Canvas course and converts it into local markdown files.
Useful for importing an existing Canvas course or syncing changes made directly
on Canvas.

### What Pull Will Not Overwrite

Pull asks git. Any file `git status` reports as modified or untracked is left
exactly as it is, listed at the end with the reason, and the rest of the run
carries on. Untracked counts, and that is the case worth knowing: git holds no
copy at all of a file it has never seen.

The rule that follows is worth reading twice, because it is the opposite of what
you might expect. **Committed work is not protected — uncommitted work is.** A
change you have committed is safe in git whether or not pull writes over it, so
pull goes ahead. A change you have not committed exists nowhere else, so pull
refuses to touch it.

So commit before you pull. Not to protect the file from pull, but because that
is what makes the change recoverable at all.

If Canvas really does hold the version you want, `--force` switches the guard
off. It asks first, naming how many files it is about to write over:

```bash
npx course pull --force
```

## Syncing Both Ways

Push and pull each pin a direction. `npx course sync` is the same run with
nothing pinned: it reads both sides, works out what changed where since the last
sync, and writes each item in whichever direction it actually moved.

```bash
npx course sync
```

| What changed since the last sync | What sync does                                    |
| -------------------------------- | ------------------------------------------------- |
| Only your file                   | writes it to Canvas                               |
| Only the Canvas copy             | writes it into your file                          |
| Both, on the same item           | the newest change wins, and the report says which |
| Neither                          | nothing                                           |

Running a push and then a pull does not get you there. Where both sides changed
the same item, push hands it to your file and leaves Canvas matching, so the
Canvas edit is gone before the pull ever looks at it. Sync sees that item as a
conflict, settles it on its own terms, and names it in the report.

Deleting is not something sync does on its own, any more than push or pull do,
bar the one small exception [Before You Publish](./01-before-you-publish.md)
names. It takes a flag: `--prune-canvas` removes the Canvas items whose local
file you deleted, `--prune-local` removes the local files Canvas no longer has,
and `--prune` does both. Each of them lists what it is about to remove and asks
first. The rest of the flags will look familiar:

```bash
npx course sync --dry-run              # report the run instead of making it
npx course sync -m 01-getting-started  # only these modules; repeatable
npx course sync --conflict local       # your file wins every disputed item
```

### The Questions Sync Asks

A content conflict is settled without asking: the newest change wins, and the
report names the item with both timestamps. Two things sync will not decide on
its own, because it has nothing to decide them with:

- **A module both sides reordered.** An order carries no timestamp, so “newest”
  means nothing here. Sync prints both orders and asks which one wins.
- **A file that disappeared while a new one turned up** in the same folder, with
  the same title. Sync asks whether that is the same item renamed. Say no and
  they count as two unrelated items: the new file is created on Canvas, and the
  old Canvas object sits there until you prune it.

Add `--conflict ask` if you want the content question put to you as well.

### Your First Run Should Be a Push

Sync leans on `.canvas-sync.json` to tell a changed item from a new one. Before
your first push that file links nothing, so a module holding items on both sides
looks brand new on both sides, and syncing it would drop a second copy of
everything into Canvas. Sync refuses that module and points you at push or pull
instead.

Pinning a direction is the answer it is asking for. Push and pull pair each of
your files with the Canvas object of the same type and title, and tie the two
together from then on. That is how the tool takes over a course it did not
create, and after that first run sync has what it needs.

## Global Flags

These flags work with any command:

| Flag        | Effect                                             |
| ----------- | -------------------------------------------------- |
| `--verbose` | Show detailed API request and response information |
| `--quiet`   | Only show errors, suppress all other output        |

## Error Handling

The sync process is designed to be resilient:

- **Automatic retries**: a call that comes back rate-limited (429) or with a
  server error (5xx) is retried up to 3 times on top of the first attempt, with
  a longer wait each time, so a failing request is made 4 times before it gives
  up.
- **Partial failures**: If one item fails, the rest of the module continues. A
  summary of errors is shown at the end.

> [!TIP]
>
> Use `--dry-run` before your first real push to make sure everything looks
> right. It is much easier to fix issues before they reach Canvas.
