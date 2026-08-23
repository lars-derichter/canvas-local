# Architecture

Technical overview of how the sync system works.

## Three Layers

```
course/  (markdown)
   |
   +--> Docusaurus (local preview)
   |
   +--> Canvas API (push/pull)
```

1. **Markdown source** — `course/` contains numbered folders (modules) with
   numbered markdown files (items). Frontmatter defines the Canvas type and
   metadata.

2. **Docusaurus** — serves the same `course/` directory as a static site. No
   transformation needed — relative links and images work natively.

3. **Canvas sync** — the CLI converts markdown to HTML (push) or HTML to
   markdown (pull) and communicates with the Canvas REST API.

All three layers read `course.config.yml` at the project root through
`lib/config/course-config.js`: it resolves the course title and tagline, and the
course language plus optional per-label overrides against the built-in label
sets in `lib/config/labels.js` (English fallback when the file is missing; an
unset title falls back to that language's `export.course_title` label). The CLI
loads it for push (alert titles), pull (untitled fallback), export (metadata
labels, document language, default titles), and the glossary builder;
`docusaurus.config.js` loads it for the site title and navbar, the tagline, the
site locale and the remark plugin labels.

## Sync State

`.canvas-sync.json` is where a local file's Canvas identity lives. It is
committed rather than gitignored, and since schema v4 no markdown file carries a
`canvas_id` at all, so a push or a pull leaves a change here to commit alongside
the content that caused it.

```json
{
  "schema_version": 4,
  "canvas_base_url": "https://school.instructure.com",
  "course_id": 12345,
  "last_sync": "2026-08-19T10:00:00.000Z",
  "modules": {
    "01-introduction": {
      "canvas_module_id": 67890,
      "name": "Introduction",
      "position": 1,
      "item_order": [
        "01-introduction/01-welcome.md",
        "01-introduction/02-link.md"
      ],
      "items": {
        "01-introduction/01-welcome.md": {
          "canvas_type": "page",
          "canvas_id": 1234,
          "page_url": "welcome",
          "module_item_id": 5678,
          "title": "Welcome",
          "indent": 0,
          "local_hash": "sha256...",
          "canvas_hash": "sha256...",
          "canvas_updated_at": "2026-08-19T09:59:00.000Z",
          "synced_at": "2026-08-19T10:00:00.000Z"
        },
        "01-introduction/02-link.md": {
          "canvas_type": "external_url",
          "canvas_id": 555,
          "module_item_id": 555,
          "external_url": "https://example.com",
          "title": "Example",
          "indent": 0,
          "local_hash": "sha256...",
          "canvas_hash": "sha256...",
          "canvas_updated_at": null,
          "synced_at": "2026-08-19T10:00:00.000Z"
        }
      }
    }
  },
  "icons": {
    "note": {
      "canvas_file_id": 111,
      "preview_url": "https://school.instructure.com/courses/12345/files/111/preview",
      "theme": "sha256..."
    }
  },
  "files": {
    "01-introduction/_files/diagram.png": {
      "canvas_file_id": 222,
      "canvas_url": "/courses/12345/files/222/preview",
      "sha256": "9f2c..."
    }
  }
}
```

Key properties:

- **canvas_base_url** — the Canvas host, with no `/api/v1` suffix and no
  trailing slash. `normaliseBaseUrl` in `lib/sync/state.js` puts both this value
  and the one in `.env` into that shape, so the two can differ by punctuation
  and still agree.
- **modules** — keyed by the local folder name; the Canvas module id is a value
  under it. `item_order` is the order the module's items were in at the last
  sync, and it is the base leg of the three-way ordering comparison, so a
  renamed item keeps its slot instead of moving to the end, where it would read
  as a reorder nobody made.
- **items** — keyed by the item's path under `course/`, with forward slashes on
  every platform and always beginning with its module's folder name. Path as
  key, Canvas ids as values: the exact inverse of v3, which keyed every item by
  its Canvas identity. Keying on the path is what makes a committed file legible
  to the person who owns it — you can open it, recognise your own course in it,
  and repair a row by hand. A key written with the `course/` prefix matches
  nothing and fails silently. Renames do not orphan a row: every command that
  renames re-keys as it goes, and one made by hand is picked up by
  `lib/sync/rename-detect.js`.
- **local_hash / canvas_hash** — what each side looked like at the last sync.
  They are never compared to each other, only each against its own stored value,
  which is how the engine tells "changed here" from "changed there".
- **icons** — one entry per alert type: the Canvas file id, the preview URL the
  HTML converter embeds, and a fingerprint of the theme the SVG was painted in,
  so a theme change re-uploads the icons and an unchanged theme does not.
- **files** — embedded file (images, PDFs) Canvas URLs and IDs, plus a SHA-256
  content hash used to re-upload files when their content changes.
- **last_sync** — stamped at the end of a run that wrote something. Nothing
  reads it, and no decision depends on it. The only timestamps a decision reads
  are the file's mtime and Canvas's `updated_at`, and only to break a tie when
  both sides of an item changed.
- **schema_version** — the loader reads version 4 only. A file written by any
  other version is refused with an error rather than guessed at, because
  misreading the mapping would create duplicates on Canvas. There is
  deliberately no migration from v3, since the two schemas key items
  differently; rebuild with [`reset-sync-state`](advanced-commands.md) and push
  again.

### Prune Semantics

`push --prune-canvas` deletes a Canvas resource only when no local file _claims_
its identity: a markdown file claims `canvas_id` (and `external_url`) via its
frontmatter, a module folder claims its id via `_category_.json`. Identity
claims are collected over the whole course, so items moved to another module —
even one outside a `--module` filter — are never mistaken for deletions.

Before it asks for confirmation, prune checks whether the assignments on its
list already hold student submissions, because deleting an assignment takes its
gradebook column and every grade in it. The doomed items come from sync state,
so all prune has is Canvas ids: it reads `has_submitted_submissions` off a
single `listAssignments` call for the course rather than fetching each
assignment, and skips the call entirely when no assignment is being deleted. An
assignment with submissions is flagged in the listing and named in the
confirmation question; a lookup that fails is reported as "could not determine",
never as "no submissions".

## Content Types

`canvas_type` in a file's frontmatter decides which of two contracts the file is
under. `VALID_CANVAS_TYPES` in `cli/validate.js` is the authoritative set.

**Authored content**: `page`, `assignment`, `discussion`, `file`. The local file
is the source of truth. Push creates or updates the Canvas object and overwrites
what it held; prune deletes the object. The three markdown types share one code
path (`pushContentItem`) parameterised by a strategy object (`pageStrategy`,
`assignmentStrategy`, `discussionStrategy` in `cli/push.js`), which supplies the
create and update calls, the fields to send, and how to read the id back out of
the response.

**References**: `quiz`, `external_tool`, and `external_url`. The file records
which Canvas object belongs at this position; the object itself is out of scope.
Push creates the module item and nothing else. Prune and `reset-canvas` remove
the module item and never the object behind it.

- `quiz` resolves through `canvas_id` first, falling back to an exact title
  match against `listQuizzes` and writing the found id back to frontmatter. A
  quiz that matches nothing is skipped with the QTI import procedure printed;
  two quizzes under one title are skipped as ambiguous. `lib/canvas/quizzes.js`
  deliberately exposes a read call only, so no code path can write to a quiz.
- `external_tool` is identified by its launch URL, not by `content_id`. Canvas
  resolves the tool through `Lti::ToolFinder.from_url` on every launch, and
  substitutes a dummy tool with `id = 0` when nothing matches, saving the item
  with a 200 and no error. `findToolForUrl` in `lib/canvas/external-tools.js`
  runs the same finder ahead of time through the sessionless-launch endpoint,
  and reports `resolves`, `no-match`, or `unknown`. A failed probe is never read
  as a match or as a miss.
- `external_url` is a plain link, matched on the URL for the same reason: a
  module item's id is reissued on every push.

Pull writes both kinds. For authored content it converts the Canvas HTML body;
for a reference it writes frontmatter only, with no API fetch at all.
`CANVAS_OWNED_KEYS` in `lib/convert/html-to-markdown.js` lists, per type, the
keys Canvas is authoritative for: those are taken from the Canvas item every
time, including when Canvas has no value (so a cleared due date clears locally),
while every other key in the local file is preserved verbatim. `quiz_ref` is the
clearest case: Canvas has never heard of the QTI package, so the key belongs to
the author and has to survive every pull.

## Push Algorithm

```
1. Scan course/ directory (course-scanner.js)
2. Ensure alert icons are uploaded (icons.js)
3. Build link map from sync state (link-resolver.js)
4. For each module:
   a. Read what Canvas holds in the module, and skip the module when any
      of it has no local counterpart
   b. Create or update the Canvas module
   c. Clear existing module items (prevents duplicates on re-push;
      module items are links — deleting them keeps the content)
   d. Upload embedded files from _files/ directories
   e. For each item, by canvas_type:
      - page / assignment / discussion (authored content):
        · Convert markdown to HTML (markdown-to-html.js)
        · Resolve internal .md links to Canvas URLs
        · Resolve file references to Canvas file URLs
        · Create or update the Canvas object, then add the module item
        · Write canvas_id back to frontmatter
        · Track items with unresolved links
      - file: upload the binary, then add the module item
      - external_url: add the module item (the link is the whole item)
      - external_tool: probe sessionless_launch for the launch URL,
        warn when no installed tool claims it, add the item either way
      - quiz (reference only, never created or updated):
        · Resolve the quiz from canvas_id, else by exact title match
        · Write the id found back to frontmatter
        · Skip with the QTI import procedure when nothing matches,
          or with an ambiguity warning when two quizzes share the title
   f. Save sync state after each module
5. Second pass: re-push items with unresolved links
   (now resolvable because referenced pages exist)
6. Prune: delete Canvas modules and items removed locally (if --prune-canvas)
7. Update last_sync timestamp
```

The two-pass approach handles circular or forward references. On the first pass,
links to not-yet-created pages are left unresolved. After all pages exist, a
second pass updates their HTML with correct links.

### The Canvas-Only Guard

Step 4a is what keeps the rebuild from eating content. It reuses the identity
claims prune works from (`collectLocalClaims`, `isItemClaimed`), which are
type-scoped: an `assignment:12` claim never answers for a `Quiz` item on id 12.
Claims are gathered over the whole course, so an item moved to another module —
even one outside a `--module` filter — is still local. Four types need more than
an id comparison:

- **Pages.** A module item names its page by slug, while the local file holds
  the numeric `page_id`, so the slug is resolved through the course's page list
  (`buildPageUrlToPageId` in `cli/sync-utils.js`, shared with pull's rename
  detection). One request answers it for the whole run; a run with no pages to
  resolve makes none. When the lookup fails, the module is refused rather than
  guessed at.
- **External URLs and LTI links.** These exist only as a module item, whose id
  Canvas reissues on every push, so the launch URL is the identity. The stored
  id is still tried: Canvas never reuses one, so a match can only be the first
  push's own item.
- **Files.** A raw binary carries no frontmatter, so its claim comes from the
  sync entry push wrote for it, counted only while the local path still exists.
- **Text headers.** Regenerated from the folder structure on every push, so they
  are skipped entirely — otherwise every module with a subfolder would refuse
  forever.

A refusal records an error like any other push failure: the run continues with
the remaining modules and ends with a non-zero exit status.

## Pull Algorithm

```
1. Fetch modules and items from Canvas API
2. Build reverse link map (Canvas URLs -> relative paths)
3. Build reverse file map (Canvas file URLs -> local paths)
4. For each module:
   a. Detect module folder renames (position/name changed on Canvas)
      - Match by canvas_module_id in sync state
      - Rename old folder, migrate sync state keys
   b. Create local folder if it doesn't exist
   c. Phase 1 — Compute target state:
      - Walk Canvas items to assign local positions
        (separate counters for module-level and subfolder items)
      - Determine target filenames/folders for each item
        (every module item type: pages, assignments, discussions,
         quizzes, external URLs, external tools, files)
      - File items preserve their original extension
   d. Phase 2 — Reconcile existing files:
      - Clean up leftover temp files from previous failed runs
      - Match Canvas items to existing local files via sync state
        (page_url for pages, content_id for assignments/files,
         external_url for links, canvas_id as fallback)
      - Rename files/folders whose positions changed
        (two-pass via temp names to avoid collisions,
         with try/catch recovery on failure)
      - Update sync state keys to reflect new paths
   e. Phase 3 — Write content:
      - Skip existing files that may hold local work
        (mtime > last_sync, or no last_sync to compare against)
      - Pages/assignments/discussions: fetch HTML (body, description,
        message), convert to markdown, resolve Canvas URLs back to
        relative paths, download embedded files to _files/
      - External URLs, external tools, quizzes: write frontmatter-only
        markdown, with no API fetch at all (nothing to fetch: a link
        carries its own URL, a quiz's questions are not ours to hold)
      - File items: download binary file from Canvas
      - SubHeaders: create subfolder with _category_.json
   f. Save sync state after each module
5. Update last_sync timestamp
```

## Link Resolution

Bidirectional link resolution happens in `link-resolver.js`:

**Push (relative -> Canvas URL):**

- Input: `../02-setup/01-install.md#requirements`
- Resolves via: sync state maps relative path to canvas_id
- Output: `/courses/12345/pages/install#requirements`

**Pull (Canvas URL -> relative):**

- Input: `/courses/12345/pages/install#requirements`
- Resolves via: reverse map from canvas_id to relative path
- Output: `../02-setup/01-install.md#requirements`

Fragment identifiers (`#section`) are preserved in both directions. External
URLs, fragment-only links, and non-`.md` links pass through unchanged.

## Content Conversion

**Markdown to HTML** (`markdown-to-html.js`):

- Strips YAML frontmatter
- Uses `marked` with GFM extensions
- `marked-alert` handles `> [!NOTE]` etc.
- Custom renderer produces inline-styled alert HTML with Canvas-hosted SVG icons
- Custom link/image renderers resolve internal references

**HTML to Markdown** (`html-to-markdown.js`):

- Uses `turndown` with atx headings and fenced code blocks
- Custom rules convert alert divs back to GFM alert syntax
- Custom rules resolve Canvas internal links and file URLs
- Strips `&nbsp;` spacer paragraphs after alerts

## Docusaurus Content Filtering

Not all Canvas content types map naturally to Docusaurus pages. Two mechanisms
handle the mismatches:

**External URL items** — Markdown files with `canvas_type: external_url` have no
meaningful body content (they just point to an external URL). The
`remark-external-url` plugin (`src/plugins/remark-external-url.js`) intercepts
these during rendering and replaces the entire document body with a styled link
card showing the URL. The page still appears in the autogenerated sidebar, but
visitors see only the link — not the raw frontmatter or an empty page.

**File items** — Files synced from Canvas as binary items (`.svg`, `.pdf`, etc.)
are stored as markdown wrappers with `canvas_type: file` frontmatter and a
`file_ref` field pointing to the actual binary in `_files/`. The
`remark-file-item` plugin (`src/plugins/remark-file-item.js`) intercepts these
during rendering and replaces the document body with a styled file card showing
a download link. This way file items appear in the Docusaurus sidebar at the
correct position, matching the Canvas module structure.

**Inline `.html` links** — Docusaurus's built-in `transformLinks` remark plugin
deliberately skips relative links ending in `.md`, `.mdx`, or `.html`, assuming
they are page references rather than assets. For `.md`/`.mdx` that is correct,
but it leaves inline `.html` links (e.g. `[starter](_files/starter.html)` on a
normal page) broken. The `remark-html-links` plugin
(`src/plugins/remark-html-links.js`) runs before the default plugins and
rewrites such links — relative, to an existing local `.html`/`.htm` file — into
an `<a href={require(...)}>` anchor. Webpack then bundles the file. By default
the anchor gets `target="_blank"`, so the browser renders the file in a new tab;
with `download: true` in the page's frontmatter it gets a `download` attribute
instead and the browser saves the file under its original name. External,
absolute, `@site/`, anchor-only (`.html#…`), and non-existent targets are left
untouched, as is the Canvas sync path (the source markdown keeps its plain
relative link).

## Error Recovery

- **Retry**: API calls retry 3 times on 429 (rate limit) and 5xx with
  exponential backoff.
- **Rate limiting**: pauses 1 second when `x-rate-limit-remaining` drops
  below 50.
- **Stale IDs**: 404 responses on update trigger automatic re-creation of the
  resource.
- **Incremental save**: sync state is saved after each module, so a crash
  mid-push doesn't lose all progress.
- **Atomic writes**: sync file uses write-to-tmp-then-rename to prevent
  corruption.
