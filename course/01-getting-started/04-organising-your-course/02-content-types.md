---
title: Content Types
canvas_type: page
---

# Content Types

Every item in a module has a type that determines how it appears on Canvas. You
set the type by adding a `canvas_type` field at the top of your markdown file
(in the frontmatter). There are seven of them.

Four hold their content here. A page, an assignment and a discussion are written
in the markdown body, and a file item wraps a binary you keep in the module. The
other three point at something else: an external URL is a link, and a quiz and
an external tool are references to an object that lives in Canvas and stays
there.

## Page (Default)

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

| Field              | Description                                         |
| ------------------ | --------------------------------------------------- |
| `points_possible`  | Maximum score                                       |
| `submission_types` | How students submit (upload, text, url)             |
| `due_at`           | Deadline in ISO 8601 format                         |
| `unlock_at`        | Date when the assignment becomes available          |
| `lock_at`          | Date after which submissions are no longer accepted |
| `published`        | Whether the assignment is visible to students       |

## Discussion

Creates a Canvas discussion topic. The markdown body is the opening message, the
same way a page’s body is the page.

```yaml
---
title: Week 3 Reading
canvas_type: discussion
discussion_type: threaded
require_initial_post: true
---
```

Supported fields:

| Field                  | Description                                               |
| ---------------------- | --------------------------------------------------------- |
| `discussion_type`      | `threaded`, `not_threaded`, or `side_comment`             |
| `require_initial_post` | Students must post before they can read the other replies |
| `delayed_post_at`      | Date the topic becomes visible                            |
| `lock_at`              | Date the topic closes for new posts                       |
| `published`            | Whether the topic is visible to students                  |

Replies stay in Canvas and never come back into your files. That does not put
them out of reach: delete the local file and run `push --prune-canvas`, and the
topic goes with every reply in it.

> [!WARNING]
>
> A **graded** discussion keeps its grading in Canvas. Points, due date and
> grading type belong to the assignment Canvas puts behind the topic, and this
> tool never touches that assignment, so setting those fields here does nothing.

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

Uploads a binary file (PDF, SVG, ZIP, etc.) to Canvas as a module item. The
actual file lives in `_files/` and the markdown wrapper points to it with
`file_ref`.

```yaml
---
title: Workflow Diagram
canvas_type: file
file_ref: _files/workflow-diagram.svg
---
```

Place the binary in the module’s `_files/` directory and create a `.md` wrapper
next to your other items:

```
course/01-module/
  _files/
    workflow-diagram.svg
  05-workflow-diagram.md   -> File: "Workflow Diagram"
```

There is a shorter way, and the tooling uses it itself. Drop the binary straight
into the module or subsection folder with a numeric prefix in front of its name,
no wrapper and no `_files/`, and it is a file item as it stands. That is what
`npx course new-item --type file` does, and what happens when you drag a file
from Finder or Explorer onto the VS Code tree.

Canvas and the PDF or Word export take both shapes. The preview website only
shows the wrapper, because it builds its pages from `.md` files, and a bare
binary has nowhere to carry a `title:` or an `export: true`. Use the wrapper
when the file has to appear on the website, and the bare file when it does not.
The
[frontmatter reference](https://github.com/lars-derichter/coursewright/blob/main/docs/frontmatter.md#file-item)
covers both.

This module contains three live examples: the
[Workflow Diagram](../02-workflow-diagram.md) (SVG), the
[Example PDF](../09-example-pdf.md), and the
[HTML Starter](../13-html-starter.md). Open the Workflow Diagram and you'll see
the image itself above the download card: image, video and audio files show
their content right on the page.

> [!NOTE]
>
> Over 35 file types are supported, including PDF, PNG, JPG, SVG, MP4, DOCX, and
> many more. When you pull a course from Canvas, file items are automatically
> converted to this wrapper format.

## Quiz

A reference, not content. The file says which quiz belongs at this spot in the
module. The questions live in Canvas and never cross in either direction.

```yaml
---
title: "Test 1: Loops and Conditions"
canvas_type: quiz
quiz_ref: evaluations/2526/test-1/test-1.zip
---
```

Push matches the title against the quizzes your Canvas course already has,
places the module item, and leaves the quiz itself alone: it never creates,
updates or deletes one. So build the quiz in Canvas first, or import it there
from a QTI package, and give the file the same title.

`quiz_ref` is optional. It points at the QTI `.zip` the quiz was built from, as
a path from the project root, and it is there so next year’s course can be
rebuilt from the same package rather than from memory.

## External Tool (LTI)

Puts a link to an LTI tool in the module: a coding platform, a video service, a
plagiarism checker. Like an external URL it is a module item and nothing else,
with no body of its own.

```yaml
---
title: Coding Exercises
canvas_type: external_tool
external_url: https://tool.example.com/lti/launch
---
```

`external_url` is the tool’s launch URL, and that URL is what Canvas resolves
the tool from. The tool has to be installed in Canvas already, by you or by an
administrator. Nothing here installs one.

> [!NOTE]
>
> A discussion, a quiz and an external tool are the three types
> `npx course new-item` does not create. Write the file yourself with the
> frontmatter above, or copy an existing item and change the `canvas_type`.
