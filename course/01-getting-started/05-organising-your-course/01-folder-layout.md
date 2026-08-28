---
title: Folder Layout
canvas_type: page
---

# Folder Layout

All your course content lives in the `course/` folder. The way you organise
files and folders here directly controls how content appears in both the local
preview and on Canvas, with no configuration needed.

## Module Folders

Each top-level folder in `course/` becomes a Canvas module:

```
course/
  01-getting-started/     -> Module: "Getting started"
  02-html-css/            -> Module: "Html css"
  03-javascript/          -> Module: "Javascript"
```

The two-digit prefix (`01`, `02`, …) controls the order. It is stripped when
generating the display title, hyphens become spaces, and only the first word is
capitalised, so `01-getting-started` becomes “Getting started”. Give the folder
a `_category_.json` label when you want the module to read differently.

## Items Inside a Module

Files inside a module folder become module items:

```
course/01-getting-started/
  _category_.json         -> Module metadata (label, position)
  01-introduction.md      -> Page: "Introduction"
  02-setup-guide.md       -> Page: "Setup guide"
  03-first-project.md     -> Assignment: "First project"
```

The same numbering convention applies: prefix controls order, and is stripped
from the title. A `title:` field in the file's frontmatter overrides the derived
one.

## Subsections (Subfolders)

A subfolder inside a module becomes a **SubHeader** in Canvas, which groups
related items under a heading:

```
course/01-getting-started/
  01-introduction.md
  02-core-concepts/           -> SubHeader: "Core concepts"
    _category_.json
    01-variables.md           -> Indented page: "Variables"
    02-functions.md           -> Indented page: "Functions"
  03-summary.md
```

Items inside a subsection appear indented under the SubHeader in Canvas.

> [!TIP]
>
> A subfolder can carry a `_category_.json` file too, exactly like a module
> folder. It is optional in both places.

## The `_category_.json` File

You only need this file when the folder name is not the title you want. Without
one, the title comes from the folder name, with the number stripped and the
hyphens turned into spaces.

```json
{
  "label": "Getting Started",
  "position": 1
}
```

- **label**: the title of the module or subsection, on Canvas, in the preview
  and in an export
- **position**: sort order in the preview website, which is the only place that
  reads it. Canvas and the PDF or Word export take their order from the numeric
  prefix.

The preview prefers `position` over the prefix, so the two have to agree. The
CLI keeps them in step for you: `new-module` writes the position it just used,
and every command that renumbers folders updates it as well. If you edit the
file by hand, change the number to match the new prefix, or your preview will
list things in one order and Canvas and your export in another.
