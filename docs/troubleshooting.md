# Troubleshooting

Common issues and how to resolve them.

## Connection Errors

### "CANVAS_COURSE_ID is not set"

Run `npx course init` to configure your Canvas API credentials. This creates a
`.env` file with your API URL, token, and course ID.

### "fetch failed" or Network Timeout

- Verify your Canvas instance is reachable in a browser.
- Check that `CANVAS_API_URL` in `.env` is the bare domain (e.g.
  `https://your-school.instructure.com`), without `/api/v1` or any other path
  after it; the CLI appends `/api/v1` itself.
- If behind a VPN or firewall, ensure it allows outbound HTTPS to your Canvas
  instance.

### 401 Unauthorized

Your API token is invalid or expired. Generate a new token in Canvas under
**Account > Settings > New Access Token** and update `.env`.

### 403 Forbidden

Your token lacks permissions for the target course. Verify you have a Teacher or
Admin role in the Canvas course.

## Push Issues

### A Stale Id on the Sync Row (404 on Update)

If a page or assignment was deleted directly in Canvas, the id
`.canvas-sync.json` holds for that file goes stale. Push detects this
automatically via a 404 response on the update, creates the resource again, and
records the new id on the same row. No manual action needed.

### "Module not found in course/ directory"

Check the `--module` flag value matches a folder name in `course/` (e.g.
`--module 01-introduction`, not the display name).

### Unresolved Internal Links

When pushing a course for the first time, pages that reference each other can't
all resolve on the first pass. Push automatically runs a second pass to update
links to newly-created pages. Use `--verbose` to see which items needed
re-resolution.

In `--dry-run` mode, unresolved links are reported as warnings since the second
pass can't run without creating real pages.

### File Upload Failures

- Verify the file exists at the path shown in the error.
- Check that the file isn't too large (Canvas has per-file limits).
- Ensure the MIME type is supported — see `lib/canvas/files.js` for the full
  list.

## Pull Issues

### "SKIPPED (locally modified since last sync)"

Pull skips files whose modification time is later than the last sync, rather
than overwriting them. Use `--force` to overwrite anyway, or push your local
changes first.

A fresh `git clone` sets every file's timestamp to checkout time, so pull skips
everything on a newly cloned project. That is the check working as designed, not
a fault. See
[Push and pull are not a merge](limitations.md#push-and-pull-are-not-a-merge).

### "SKIPPED (no sync state, cannot tell if it was modified)"

There is no `.canvas-sync.json` to compare timestamps against — you ran
`reset-sync-state`, or the project has never synced — so pull cannot tell your
own writing from Canvas's output. It writes the files it is adding and leaves
every file that already exists alone.

Push first if the local version is the one you want to keep. If Canvas holds the
truth and the local files are expendable, `npx course pull --force` overwrites
them; it asks for confirmation first, because in this state it overwrites
everything rather than only what changed. Back the course up before answering:
see [Backing up a Canvas course](backups.md).

### Missing Content After Pull

- Every module item type comes down: pages, assignments, discussions, files,
  external URLs, quizzes, LTI links and text headers. A quiz and an LTI link
  arrive as a frontmatter-only reference file, because neither has a body this
  project could hold. A quiz's questions are not pulled and never will be. See
  [Limitations](limitations.md#which-canvas-types-sync-and-how-much-of-them).
- Announcements, rubrics, outcomes and the syllabus page are not module items,
  so pull does not see them at all.
- Empty pages on Canvas produce empty markdown files — this is normal.

## Sync State

### Corrupted .canvas-sync.json

The sync file is committed, so the first answer is git rather than the CLI. Take
the last good copy back:

```bash
git checkout -- .canvas-sync.json
```

That gives you the file as your last commit had it. Anything a push created
since that commit is missing from it, and the next push claims those objects
back by title.

If git has no good copy either, because the file was never committed or the
corruption was committed with it, delete it and run `npx course push` to
regenerate it. No markdown file names the Canvas object it became, so there is
nothing to match on file by file: push claims a Canvas object of the same type
and title in the module the file sits in, and writes the pair back into the
state.

A binary in `_files/` has no frontmatter to carry an id and needs none: push
uploads it again, and Canvas overwrites the file of the same name it already
holds. Nothing about a missing sync state makes push refuse the module. See
[push reconciles a module's item list](limitations.md#push-reconciles-a-modules-item-list).

### ".canvas-sync.json describes course N"

`.env` names one Canvas course and the sync state was built against another, so
every command stops until the two agree. The ids in that file only mean
something in the course they came from, and one of them is not scoped to a
course at all: a Canvas file id is global, so `push --prune-canvas` — or
renaming the binary behind a file item, which deletes the Canvas file it
replaces — would delete a file belonging to the other course.

Two ways out, and which one is right depends on what you meant:

- **You did not mean to switch.** Put the original course id back in `.env`.
  This is the usual case: a `CANVAS_COURSE_ID=` you edited to try something, a
  one-off override that wrote the sync file, or, now that the sync file is
  committed, a clone or a branch that arrived already describing another course.
- **You did mean to switch.** Run `npx course reset-sync-state`, then push. The
  new course gets everything fresh, so check that it does not already hold a
  copy — push cannot recognise content it has no ids for, and you would end up
  with two of each. If the new course was seeded with Canvas's own Course Copy,
  its ids are new too, so the reset is required either way.

`npx course init` also settles it, and it is the one command that reads the
mismatched file: point it at the new course and it drops the old course's
mappings rather than filing them under the new course id.

The same error names a base URL instead of a course when `CANVAS_API_URL` moved
to a different Canvas instance, where even a matching course id means a
different course.

### Starting Fresh, or Switching Canvas Courses

Both are covered by [Advanced commands](advanced-commands.md) and, for the
yearly move to a new course, [New academic year](new-academic-year.md). Back the
Canvas course up first: [Backups](backups.md).

## Docusaurus Issues

### Build Fails With Broken Links

Docusaurus is configured to throw on broken links. Check that all relative `.md`
links point to existing files. Run `npm run build` to see the exact error
location.

### Alerts Not Rendering

The custom remark plugin (`src/plugins/remark-gfm-alerts.js`) requires the exact
syntax `> [!TYPE]` on a new line inside a blockquote. Make sure there's no space
before the `[` and the type is one of: NOTE, TIP, IMPORTANT, WARNING, ATTENTION
(or its synonym CAUTION), CHECK.

## AI Assistant Issues

### Skills Not Found on Windows

`.claude/skills` is a git symlink, and git on Windows only creates real symlinks
when `core.symlinks` is `true`, which requires Developer Mode (or admin rights).
Without it, the checkout silently turns the symlink into a small text file, and
Claude Code finds no skills; no error is shown anywhere.

To fix:

1. Enable Developer Mode (Settings → System → For developers).
2. Run `git config core.symlinks true` in the repo.
3. Restore the checkout: `git checkout -- .claude` (or re-clone).

Working inside WSL2 avoids the problem entirely; symlinks always work there.
`AGENTS.md` and `CLAUDE.md` are plain files and are unaffected either way.
