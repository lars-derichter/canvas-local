# Exporting to PDF and DOCX

`npx course export` turns course materials into a printable PDF or an editable
Word document: a handout for one lesson, a module as a chapter, or the whole
course as a styled course text with your institution's branding. Exports are
generated from the same markdown the website and Canvas read, so a handout never
drifts from the course it came from.

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

```bash
npx course export course/01-intro/03-alerts.md   # one item
npx course export -m 01-intro                    # a whole module
npx course export                                # the full course
npx course export -m 01-intro -f docx            # Word instead of PDF
npx course export --flagged                      # only items with export: true
```

Multiple items combine into one document with a title page, a generated table of
contents, and a page break between chapters. Non-markdown items keep their
place: an external URL becomes a link card, a file item an attachment reference,
and an image file item is embedded above its attachment line.

Output lands in `exports/` (gitignored). A whole-course export takes its title,
and its filename, from `title` in `course.config.yml`
(`exports/programming-fundamentals.pdf`); a module export is titled after the
module. `--title` and `--subtitle` override the cover text, and `-o` the output
path.

`--flagged` reads the `export: true` frontmatter flag, so you can mark the
exam-relevant items once and keep exporting just those. See
[Frontmatter](frontmatter.md#common-fields).

## A Curated Selection

For hand-picked content, generate a table of contents, delete the lines you do
not want, then export what remains:

```bash
npx course export-toc                    # writes exports/toc.md
# …edit exports/toc.md, delete unwanted lines…
npx course export --toc exports/toc.md
```

## From VS Code

The [VS Code extension](vscode.md) carries the same commands: export an item, a
module or the course from the tree or the palette, and multi-select several
items in the tree to combine them into one document.

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
