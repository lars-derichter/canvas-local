# Exporting to PDF and DOCX

Turn course materials into a printable PDF or an editable Word document: a
handout for one lesson, a module as a chapter, or the whole course as a styled
course text with your institution's branding. Exports are generated from the
same markdown the website and Canvas read, so a handout never drifts from the
course it came from.

## What You Need

DOCX export needs [pandoc](https://pandoc.org/); PDF export also needs
[Typst](https://typst.app/). Both are free, and nothing else in Coursewright
needs either, so you can skip this until your first export.

```bash
# macOS (with Homebrew)
brew install pandoc typst
# Windows
winget install --id JohnMacFarlane.Pandoc --id Typst.Typst
```

On Linux, install pandoc with your package manager and download Typst from
[its releases page](https://github.com/typst/typst/releases).

## Exporting

Right-click an item and choose **Course: Export Item to PDF/DOCX...**, or a
module and choose **Course: Export Module to PDF/DOCX...**. Select several items
first (Ctrl/Cmd-click or Shift-click in the tree) and the item export combines
them into one document. Either way you then pick PDF or Word.

For the whole course, open the panel's `…` dropdown and choose **Course: Export
Course to PDF/DOCX...**. It offers three scopes: the full course, only the items
flagged `export: true`, or a curated table of contents. Choosing the
table-of-contents option writes `exports/toc.md` and opens it for editing;
delete the lines you do not want, and once the file exists, **Course: Export via
TOC...** appears in the `…` dropdown to render it.

The flagged scope, `--flagged` on the terminal, reads the `export: true`
frontmatter flag, so you can mark the exam-relevant items once and keep
exporting just those. See [Frontmatter](frontmatter.md#common-fields).

Output lands in `exports/` (gitignored). A whole-course export takes its title,
and its filename, from `title` in `course.config.yml`
(`exports/programming-fundamentals.pdf`); a module export is titled after the
module. Multiple items combine into one document with a title page, a generated
table of contents, and a page break between chapters. Non-markdown items keep
their place: an external URL becomes a link card, a file item an attachment
reference, and an image file item is embedded above its attachment line.

### From the Terminal

```bash
npx course export course/01-intro/03-alerts.md   # one item
npx course export -m 01-intro                    # a whole module
npx course export                                # the full course
npx course export -m 01-intro -f docx            # Word instead of PDF
npx course export --flagged                      # only items with export: true
npx course export-toc                            # writes exports/toc.md
npx course export --toc exports/toc.md           # render a curated selection
```

`-o`, `--title`, `--subtitle`, `--style` and `--var` are terminal-only: the
panel has no route to any of them. See [CLI reference](cli-reference.md#export)
for the full flag list.

## Changing the Look

`course.config.yml` picks the layout with `export.style` and the colours with
`theme`; `--style <name>` overrides the layout for one run, and the
`/export-style-init` and `/export-style-update` skills derive a house style from
a Word template, a PDF or a website. [Export styling](export-styling.md) has the
pipeline, the style files and every override;
[Customisation](customisation.md#branding) covers the colour side.

## When Something Fails

The failures worth knowing (a font Typst cannot find, a missing `rsvg-convert`
for SVG in Word, Word's table of contents showing empty) are covered in
[troubleshooting](troubleshooting.md#exports) and the
[DOCX degradations](export-styling.md#docx-degradations) list.
