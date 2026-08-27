---
title: Exporting to PDF or Word
canvas_type: page
export: true
---

# Exporting to PDF or Word

Sometimes you need your course materials on paper or as a file you can hand out:
an exam, a handout, or something to read offline. Coursewright can turn any
page, a whole module, or your entire course into a polished PDF or an editable
Word document.

This is optional. If you only ever publish to Canvas, you can skip it.

> [!NOTE]
>
> This page carries `export: true` in its frontmatter, which is why
> `npx course export --flagged` picks it up. It is a way to mark the handful of
> pages that belong in a printed handout without listing them every time.

## What You Need

Export relies on two free, open-source tools:

- **pandoc**: does the markdown conversion
- **Typst**: turns the result into a PDF (only needed for PDF, not for Word)

Install both:

- **macOS**: `brew install pandoc typst`
- **Windows**: `winget install --id JohnMacFarlane.Pandoc --id Typst.Typst`
- **Linux**: install pandoc with your package manager, and download Typst from
  its [releases page](https://github.com/typst/typst/releases)

> [!TIP]
>
> Word export needs only pandoc. Typst is what produces the PDF.

## Exporting From the Terminal

The `export` command takes whatever you point it at and writes a document to the
`exports/` folder:

```bash
npx course export course/01-getting-started/05-vs-code.md  # one page
npx course export -m 01-getting-started                    # a whole module
npx course export                                          # the full course
npx course export -m 01-getting-started -f docx            # Word instead of PDF
```

When you export more than one page, they are combined into a single document
with a title page, a table of contents, and a page break between chapters. Items
that are not markdown become link cards (external URLs) or short “attachment”
references (files).

To export only a chosen set of pages, mark them with `export: true` in their
frontmatter:

```yaml
---
title: Exam Review
export: true
---
```

Then export just the flagged pages:

```bash
npx course export --flagged
```

## Exporting a Custom Selection

Want a specific set of pages, in a specific order, without flagging each one?
Use the two-step table-of-contents flow.

1. Generate a list of everything:

   ```bash
   npx course export-toc
   ```

   This writes `exports/toc.md`.

2. Open `exports/toc.md` and delete the lines you do not want. Each page is one
   line; the headings and comments are only there to help you find your way.

3. Export what is left:

   ```bash
   npx course export --toc exports/toc.md
   ```

## Exporting From VS Code

With the Course Manager sidebar you do not have to type anything:

- **Right-click a page or module** and choose **Course: Export Item to
  PDF/DOCX...** or **Course: Export Module to PDF/DOCX...**.
- **Select several pages first** (Ctrl-click or Shift-click in the tree), then
  right-click and export. They combine into one document.
- **The title bar dropdown** has **Course: Export Course to PDF/DOCX...** for
  the whole course: everything, only the flagged pages, or a curated table of
  contents.

You choose PDF or Word each time. Export runs in the Coursewright terminal so
you can follow its progress.

## Where Your Files Go

Exports land in the `exports/` folder in your project. That folder is ignored by
git, so your documents never end up in your repository or on Canvas.

Export the whole course and the document is titled after your course, filename
included: `programming-fundamentals.pdf`. That name comes from `title` in
`course.config.yml`. Export a single module and the module’s own name is used
instead, with the course name printed under it on the PDF cover.

## Changing How Exports Look

Out of the box, exports use a clean, neutral style. Two settings in
`course.config.yml` decide the look:

- **`export.style`** picks the layout: fonts, margins, and the cover. There is a
  second style, `thomas-more`, that shows what full institutional branding looks
  like.
- **`theme`** picks the colours, and it does so everywhere at once: the preview
  site, your Canvas pages, and the PDF.

Two ready-made skills do the work for you:

- **`/export-style-init`** builds a style from a reference: a Word document, a
  PDF, a website, or a CSS file
- **`/export-style-update`** makes a plain-language tweak, like “headings dark
  blue” or “bigger margins”

To try another style for a single export, add `--style`:

```bash
npx course export --sample --style thomas-more
```

> [!NOTE]
>
> For the full picture of how styling works (what each template file controls
> and how to tweak the PDF with `--var`), see the export styling guide
> (`docs/export-styling.md` in your project folder, also readable on GitHub),
> and `docs/customisation.md` for the colour tokens and your own branding.
