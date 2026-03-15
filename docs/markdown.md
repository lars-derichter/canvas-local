# Markdown

Standard
[GitHub Flavoured Markdown](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax)
is supported.

## Internal Links

Use standard relative markdown links to reference other course pages:

```md
[Admonitions](./03-admonitions.md)
[Folder Layout](./04-course-structure/01-folder-layout.md)
[Section heading](../02-other-module/01-page.md#section)
```

These links work across all three layers:

- **Docusaurus** — resolved natively as relative links.
- **Push to Canvas** — automatically converted to Canvas internal URLs
  (e.g. `/courses/ID/pages/admonitions`). On the first push, pages are
  created first, then any items with forward references are updated in a
  second pass so all links resolve in one go.
- **Pull from Canvas** — Canvas internal URLs are converted back to
  relative markdown paths.

Only `.md` links are transformed. External URLs, fragment-only links
(`#heading`), and non-markdown file links are left unchanged.

## Images and Files

Store images and other embedded files in a `_files/` subdirectory within
your module folder:

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
![Diagram](./_files/diagram.png)
[Download handout](./_files/handout.pdf)
```

These references work across all three layers:

- **Docusaurus** — relative paths work natively.
- **Push to Canvas** — files are uploaded to Canvas file storage and
  paths are rewritten to Canvas file URLs. Files in `_files/` are NOT
  added as module items — they only appear inline.
- **Pull from Canvas** — Canvas file URLs are downloaded to `_files/`
  and converted back to relative paths.

## Underscore Prefix Convention

Files and folders whose names start with `_` (underscore) are treated as
internal and are excluded from Canvas syncing. Docusaurus also skips them
by convention. Examples:

- `_files/` — embedded assets (images, PDFs)
- `_category_.json` — Docusaurus sidebar configuration
- `_draft-notes.md` — any file you want to keep local-only

## Custom Alerts / Callouts / Admonitions

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
> Urgent — demands immediate attention.

> [!CHECK]
>
> Verification step or checklist item.
```

Each type displays with a distinct colour, icon, and Dutch title in Canvas
(Info, Tip, Belangrijk, Waarschuwing, Opgelet, Check). Admonition icons are
automatically uploaded to Canvas on first push and tracked in
`.canvas-sync.json`.
