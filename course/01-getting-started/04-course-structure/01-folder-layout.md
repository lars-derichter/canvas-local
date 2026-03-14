---
title: Folder Layout
canvas_type: page
---

# Folder Layout

Course content lives in the `course/` directory. The folder structure directly maps to how content appears in both Docusaurus and Canvas.

## Module Folders

Each top-level folder in `course/` becomes a Canvas module:

```
course/
  01-getting-started/     -> Module: "Getting Started"
  02-html-css/            -> Module: "Html Css"
  03-javascript/          -> Module: "Javascript"
```

The two-digit prefix (`01`, `02`, ...) controls the order. It is stripped when generating the display title, so `01-getting-started` becomes "Getting Started".

## Items Inside a Module

Files inside a module folder become module items:

```
course/01-getting-started/
  _category_.json         -> Module metadata (label, position)
  01-introduction.md      -> Page: "Introduction"
  02-setup-guide.md       -> Page: "Setup Guide"
  03-first-project.md     -> Assignment: "First Project"
```

The same numbering convention applies: prefix controls order, and is stripped from the title.

## Subsections (Subfolders)

A subfolder inside a module becomes a **SubHeader** in Canvas, which groups related items under a heading:

```
course/01-getting-started/
  01-introduction.md
  02-core-concepts/           -> SubHeader: "Core Concepts"
    _category_.json
    01-variables.md           -> Indented page: "Variables"
    02-functions.md           -> Indented page: "Functions"
  03-summary.md
```

Items inside a subsection appear indented under the SubHeader in Canvas.

> [!TIP]
> Every subfolder needs a `_category_.json` file with at least a `label` and `position` field, just like module folders.

## The `_category_.json` File

This file controls how a folder appears in the Docusaurus sidebar:

```json
{
  "label": "Getting Started",
  "position": 1
}
```

- **label**: The display name in the sidebar
- **position**: Sort order (matches the numeric folder prefix)
