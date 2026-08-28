# Sources

Reference materials, inspiration, and notes for course development. Files here
are **never** published: not served by Docusaurus, not exported, not synced to
Canvas. This is a private workspace for collecting ideas and references.

## Organisation

Create subfolders as needed; the tree below is an example, not a contract:

```
sources/
  articles/             # Research papers, blog posts, bookmarks
  code-examples/        # Code snippets, demos, prototypes
  export-style/         # Per-file export style overrides (see export-styling.md)
  images/               # Diagrams, screenshots, figures
  ideas/                # Rough notes and drafts
  lessons/              # Full lesson plans (lesson-NN.md)
  lesson-plans/         # One-page class versions (lesson-plan-NN.md)
  reference-materials/  # Canonical course data, e.g. glossary.yml
  reports/              # Dated reports, e.g. from /coverage-map
  retros/               # Retro reports from /lesson-retro (<year>/lesson-NN.md)
  rubrics/              # Grading rubrics from /rubric-build
  issues.md             # Issue queue: /issue-report appends, /issue-fix resolves
```

No folders are required. Add what you need, when you need it. `issues.md` is
created by `/issue-report` on first use and is safe to hand-edit; its header
documents the entry format.

## Lesson Plans

Four of the suggested folders carry the [lesson workflow](lesson-workflow.md):

- **`lessons/`**: full lesson designs, one `lesson-NN.md` per lesson (two-digit
  number). Written for you and colleagues; `/lesson-design` drafts them and
  `/lesson-module-build` turns them into student modules under `course/`.
- **`lesson-plans/`**: one-page class versions, `lesson-plan-NN.md`, distilled
  from the matching lesson by `/lesson-summarize`.
- **`retros/`**: retro reports, one `lesson-NN.md` per lesson per academic year
  (`retros/2526/lesson-03.md`, the year in the same two-plus-two form as
  `evaluations/`). `/lesson-retro` appends a dated section per run, labelled by
  class group when the course is taught to parallel groups.
- **`reference-materials/`**: canonical course data. `glossary.yml` here feeds
  `npx course build-glossary`, which generates per-module glossary pages.

These conventions are defaults, not requirements: the skills follow whatever
[course-context.md](../context/course-context.md) says.

## Conventions

- **Naming:** lowercase-hyphenated (e.g. `sorting-algorithms-overview.md`).
  Numeric prefixes are optional: use them only when ordering matters.
- **Any file type** is welcome: `.md`, `.pdf`, `.png`, `.js`, `.py`, etc.

## Optional Frontmatter for Markdown Files

```yaml
---
title: "Name of Source"
url: "https://example.com/original"
tags: [topic-a, topic-b]
---
```

All fields are optional. `url` is useful for bookmarking external articles or
videos. `tags` help with searching across sources (e.g.
`grep -r "tags:.*topic" sources/`).
