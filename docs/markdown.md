# Markdown

Standard
[GitHub Flavoured Markdown](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax)
is supported.

## Internal Links

Use standard relative markdown links to reference other course pages:

```md
[Alerts](02-alerts.md)
[Folder Layout](../04-organising-your-course/01-folder-layout.md)
[Section heading](../02-other-module/01-page.md#section)
```

These links work across all three layers:

- **Docusaurus** — resolved natively as relative links.
- **Push to Canvas** — automatically converted to Canvas internal URLs (e.g.
  `/courses/ID/pages/alerts`). On the first push, pages are created first, then
  any items with forward references are updated in a second pass so all links
  resolve in one go.
- **Pull from Canvas** — Canvas internal URLs are converted back to relative
  markdown paths.

Only `.md` links are transformed. External URLs, fragment-only links
(`#heading`), and non-markdown file links are left unchanged.

## Images and Files

Store images and other embedded files in a `_files/` subdirectory within your
module folder:

```
course/
  01-getting-started/
    _files/
      diagram.png
      handout.pdf
    01-welcome.md
```

Reference them with standard markdown syntax:

```md
![Diagram](_files/diagram.png) [Download handout](_files/handout.pdf)
```

These references work across all three layers:

- **Docusaurus** — relative paths work natively.
- **Push to Canvas** — files are uploaded to Canvas file storage and paths are
  rewritten to Canvas file URLs. Files in `_files/` are NOT added as module
  items — they only appear inline.
- **Pull from Canvas** — Canvas file URLs are downloaded to `_files/` and
  converted back to relative paths. A download onto a path git reports as
  modified or untracked is refused instead, and refused whole: no sync-state row
  is written and the URL in the page is left as it is, so the page still renders
  Canvas's copy rather than pointing at a local file that was never fetched. See
  [`(git-dirty)` under Skipped](troubleshooting.md#git-dirty-under-skipped).

### Linking to `.html` Files

Inline links to `.html` files are a special case. Docusaurus treats `.html`
(like `.md`) as a page reference rather than a downloadable asset, so a plain
link such as `[example](_files/example.html)` would otherwise break in the
preview. The `remark-html-links` plugin fixes this: any relative link to an
existing local `.html` file opens that file in a new browser tab.

```md
Open the starter: [starter.html](_files/starter.html)
```

To force a download instead — the file saves under its original name rather than
rendering — set `download: true` in the page's frontmatter. The flag applies to
every `.html` link on that page:

```md
---
title: Templates
download: true
---

Download the starter: [starter.html](_files/starter.html)
```

You write a normal relative link — no special syntax — and it works in the
Docusaurus preview and on Canvas (uploaded file) alike. The `download` flag only
affects the preview; on Canvas the link always points to the Canvas file page.
Only `.html` and `.htm` are affected; `.md`/`.mdx` stay page links, and other
file types (`.pdf`, `.zip`, `.docx`, images) already worked. A link with an
anchor (`_files/example.html#top`) is left as navigation.

## Underscore Prefix Convention

Files and folders whose names start with `_` (underscore) are internal: the
course scanner never reads one as a module item, and Docusaurus skips them by
convention. That keeps them out of Canvas as items; it does not keep sync out of
them, because two of them are where a local write puts things. Examples:

- `_files/` — embedded assets (images, PDFs), and where sync and pull download
  the binaries a Canvas page embeds
- `_category_.json` — Docusaurus sidebar configuration, and where sync and pull
  write the Canvas module name
- `_draft-notes.md` — any file you want to keep local-only, which nothing here
  writes to

## Custom Alerts

Use GitHub-style blockquote alerts for callout boxes. These render with
appropriate styling in both the Docusaurus preview and Canvas.

```md
> [!NOTE]
>
> Informational note.

> [!TIP]
>
> Helpful tip.

> [!IMPORTANT]
>
> Important information.

> [!WARNING]
>
> Warning message.

> [!ATTENTION]
>
> Urgent: demands immediate attention.

> [!CHECK]
>
> Verification step or checklist item.
```

Each type displays with a distinct colour, icon, and title in Canvas. Titles
follow the course language set in `course.config.yml` (English: Note, Tip,
Important, Warning, Caution, Check; Dutch: Info, Tip, Belangrijk, Waarschuwing,
Opgelet, Check) and can be overridden per label; see the "Course language and
labels" section in the [user guide](user-guide.md).

One naming quirk to know: the alert you write as `[!ATTENTION]` is the one
GitHub calls `[!CAUTION]`, so its label key in `course.config.yml` is `caution`
and its default English title is "Caution". `[!CAUTION]` is accepted in your
markdown as a synonym.

Alert icons are automatically uploaded to Canvas on first push and tracked in
`.canvas-sync.json`.
