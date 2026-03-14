# Sources

Reference materials, inspiration, and notes for course development. Files here are **never** served by Docusaurus or synced to Canvas — this is a private workspace for collecting ideas and references.

## Organization

Create subfolders as needed. Suggested structure:

```
sources/
  articles/        # Research papers, blog posts, bookmarks
  code-examples/   # Code snippets, demos, prototypes
  images/          # Diagrams, screenshots, figures
  ideas/           # Teaching ideas, rough notes, drafts
```

No folders are required — add what you need, when you need it.

## Conventions

- **Naming:** lowercase-hyphenated (e.g., `sorting-algorithms-overview.md`). Numeric prefixes are optional — use them only when ordering matters.
- **Any file type** is welcome: `.md`, `.pdf`, `.png`, `.js`, `.py`, etc.

## Optional frontmatter for markdown files

```yaml
---
title: "Name of source"
url: "https://example.com/original"
tags: [topic-a, topic-b]
---
```

All fields are optional. `url` is useful for bookmarking external articles or videos. `tags` help with searching across sources (e.g., `grep -r "tags:.*topic" sources/`).
