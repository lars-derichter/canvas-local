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

1. **Markdown source** — `course/` contains numbered folders (modules)
   with numbered markdown files (items). Frontmatter defines the Canvas
   type and metadata.

2. **Docusaurus** — serves the same `course/` directory as a static
   site. No transformation needed — relative links and images work
   natively.

3. **Canvas sync** — the CLI converts markdown to HTML (push) or HTML
   to markdown (pull) and communicates with the Canvas REST API.

## Sync State

`.canvas-sync.json` tracks the mapping between local files and Canvas
resources:

```json
{
  "schema_version": 2,
  "canvas_base_url": "https://school.instructure.com/api/v1",
  "course_id": 12345,
  "modules": {
    "01-introduction": {
      "canvas_module_id": 67890,
      "items": {
        "01-introduction/01-welcome.md": {
          "canvas_id": "welcome",
          "canvas_type": "page",
          "page_url": "welcome"
        }
      }
    }
  },
  "icons": { "note": 111, "tip": 112 },
  "files": {
    "01-introduction/_files/diagram.png": {
      "canvas_file_id": 222,
      "canvas_url": "/courses/12345/files/222/preview"
    }
  },
  "last_sync": "2026-03-15T10:00:00.000Z"
}
```

Key properties:
- **modules** — keyed by folder name, contains `canvas_module_id` and
  per-item sync data.
- **icons** — admonition SVG icon file IDs on Canvas.
- **files** — embedded file (images, PDFs) Canvas URLs and IDs.
- **last_sync** — timestamp of last push or pull. Used to detect
  locally modified files.

## Push Algorithm

```
1. Scan course/ directory (course-scanner.js)
2. Ensure admonition icons are uploaded (icons.js)
3. Build link map from sync state (link-resolver.js)
4. For each module:
   a. Create or update the Canvas module
   b. Upload embedded files from _files/ directories
   c. For each item:
      - Convert markdown to HTML (markdown-to-html.js)
      - Resolve internal .md links to Canvas URLs
      - Resolve file references to Canvas file URLs
      - Create or update the Canvas page/assignment
      - Write canvas_id back to frontmatter
      - Track items with unresolved links
   d. Save sync state after each module
5. Second pass: re-push items with unresolved links
   (now resolvable because referenced pages exist)
6. Prune: delete Canvas modules removed locally (if --prune)
7. Update last_sync timestamp
```

The two-pass approach handles circular or forward references. On the
first pass, links to not-yet-created pages are left unresolved. After
all pages exist, a second pass updates their HTML with correct links.

## Pull Algorithm

```
1. Fetch modules and items from Canvas API
2. Build reverse link map (Canvas URLs -> relative paths)
3. Build reverse file map (Canvas file URLs -> local paths)
4. For each module:
   a. Create local folder if it doesn't exist
   b. For each item:
      - Skip locally modified files (mtime > last_sync)
      - Fetch page/assignment content from Canvas
      - Convert HTML to markdown (html-to-markdown.js)
      - Resolve Canvas URLs back to relative paths
      - Download embedded files to _files/
      - Write markdown file with frontmatter
   c. Save sync state after each module
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

Fragment identifiers (`#section`) are preserved in both directions.
External URLs, fragment-only links, and non-`.md` links pass through
unchanged.

## Content Conversion

**Markdown to HTML** (`markdown-to-html.js`):
- Strips YAML frontmatter
- Uses `marked` with GFM extensions
- `marked-alert` handles `> [!NOTE]` etc.
- Custom renderer produces inline-styled admonition HTML with
  Canvas-hosted SVG icons
- Custom link/image renderers resolve internal references

**HTML to Markdown** (`html-to-markdown.js`):
- Uses `turndown` with atx headings and fenced code blocks
- Custom rules convert admonition divs back to GFM alert syntax
- Custom rules resolve Canvas internal links and file URLs
- Strips `&nbsp;` spacer paragraphs after admonitions

## Error Recovery

- **Retry**: API calls retry 3 times on 429 (rate limit) and 5xx
  with exponential backoff.
- **Rate limiting**: pauses 1 second when `x-rate-limit-remaining`
  drops below 50.
- **Stale IDs**: 404 responses on update trigger automatic re-creation
  of the resource.
- **Incremental save**: sync state is saved after each module, so a
  crash mid-push doesn't lose all progress.
- **Atomic writes**: sync file uses write-to-tmp-then-rename to
  prevent corruption.
