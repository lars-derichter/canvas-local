# Troubleshooting

Common issues and how to resolve them.

## Connection Errors

### "CANVAS_COURSE_ID is not set"

Run `npx course init` to configure your Canvas API credentials. This
creates a `.env` file with your API URL, token, and course ID.

### "fetch failed" or network timeout

- Verify your Canvas instance is reachable in a browser.
- Check that `CANVAS_API_URL` in `.env` points to the correct URL
  (e.g. `https://your-school.instructure.com/api/v1`).
- If behind a VPN or firewall, ensure it allows outbound HTTPS to
  your Canvas instance.

### 401 Unauthorized

Your API token is invalid or expired. Generate a new token in Canvas
under **Account > Settings > New Access Token** and update `.env`.

### 403 Forbidden

Your token lacks permissions for the target course. Verify you have a
Teacher or Admin role in the Canvas course.

## Push Issues

### Stale canvas_id (404 on update)

If a page or assignment was deleted directly in Canvas, the local
`canvas_id` becomes stale. Push detects this automatically via a 404
response and re-creates the resource. No manual action needed.

### "Module not found in course/ directory"

Check the `--module` flag value matches a folder name in `course/`
(e.g. `--module 01-introduction`, not the display name).

### Unresolved internal links

When pushing a course for the first time, pages that reference each
other can't all resolve on the first pass. Push automatically runs a
second pass to update links to newly-created pages. Use `--verbose`
to see which items needed re-resolution.

In `--dry-run` mode, unresolved links are reported as warnings since
the second pass can't run without creating real pages.

### File upload failures

- Verify the file exists at the path shown in the error.
- Check that the file isn't too large (Canvas has per-file limits).
- Ensure the MIME type is supported — see `lib/canvas/files.js` for
  the full list.

## Pull Issues

### "SKIPPED (locally modified since last sync)"

Pull detects files changed after the last sync and skips them to
avoid overwriting your work. Use `--force` to overwrite anyway, or
push your local changes first.

### Missing content after pull

- Items of type Discussion, Quiz, or ExternalTool are not supported
  by pull and are skipped with a warning.
- Empty pages on Canvas produce empty markdown files — this is normal.

## Sync State

### Corrupted .canvas-sync.json

If the sync file becomes corrupted (e.g. partial write during a
crash), delete it and run `npx course push` to regenerate it. Items
with `canvas_id` in their frontmatter will be matched to existing
Canvas resources.

### Starting fresh

Run `npx course reset-sync-state` to remove all sync artifacts. The
next push creates everything from scratch on Canvas.

### Switching Canvas courses

See [New Academic Year](new-academic-year.md) for the full workflow.
In short: run `npx course reset-sync-state`, update `.env` with the
new course ID, then `npx course push`.

## Docusaurus Issues

### Build fails with broken links

Docusaurus is configured to throw on broken links. Check that all
relative `.md` links point to existing files. Run `npm run build` to
see the exact error location.

### Alerts not rendering

The custom remark plugin (`src/plugins/remark-gfm-alerts.js`)
requires the exact syntax `> [!TYPE]` on a new line inside a
blockquote. Make sure there's no space before the `[` and the type
is one of: NOTE, TIP, IMPORTANT, WARNING, ATTENTION, CHECK.
