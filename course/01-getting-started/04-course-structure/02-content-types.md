---
title: Content Types
canvas_type: page
---

# Content Types

Every item in a module has a type that determines how it appears in Canvas. The type is set via the `canvas_type` field in the markdown frontmatter.

## Page (default)

The most common type. Rendered as a Canvas wiki page.

```yaml
---
title: My Page
canvas_type: page
---
```

If you omit `canvas_type`, the item defaults to `page`.

## Assignment

Creates a Canvas assignment with grading support.

```yaml
---
title: Homework 1
canvas_type: assignment
points_possible: 100
submission_types:
  - online_upload
  - online_text_entry
due_at: "2026-03-20T23:59:00Z"
---
```

Supported fields:

| Field              | Description                              |
| ------------------ | ---------------------------------------- |
| `points_possible`  | Maximum score                            |
| `submission_types` | How students submit (upload, text, url)  |
| `due_at`           | Deadline in ISO 8601 format              |

## External URL

Links to an external website. No content body is synced, just the link.

```yaml
---
title: MDN Web Docs
canvas_type: external_url
external_url: https://developer.mozilla.org
---
```

The link opens in a new tab by default.

## File

Any non-markdown file (images, PDFs, ZIPs, etc.) is automatically treated as a file item. No frontmatter is needed. Just place the file in the module folder:

```
course/01-module/
  05-diagram.svg        -> File: "Diagram"
  06-dataset.csv        -> File: "Dataset"
```

> [!NOTE]
> Over 35 file types are supported, including PDF, PNG, JPG, SVG, MP4, DOCX, and many more.
