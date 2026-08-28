# Exporting to PDF and DOCX

Turn course materials into a printable PDF or an editable Word document: a
handout for one lesson, a module as a chapter, or the whole course as a styled
course text with your institution's branding. Exports are generated from the
same markdown the website and Canvas read, so a handout never drifts from the
course it came from.

## What You Need

DOCX export needs only [pandoc](https://pandoc.org/); PDF export also needs
[Typst](https://typst.app/). Both are free, and nothing else in Coursewright
needs either, so you can skip this until your first export.

Pandoc ships a real installer on every platform, downloaded from
[pandoc.org/installing.html](https://pandoc.org/installing.html):

- **macOS:** a `.pkg`. Two are offered, and the choice matters: `arm64` for
  Apple Silicon (M1 and later), `x86_64` for an Intel Mac; there is no universal
  package. Apple menu > About This Mac names which: "Apple M…" is Apple Silicon,
  "Intel" is Intel.
- **Windows:** a `.msi`, which installs pandoc and adds it to the PATH.
- **Linux:** a `.deb` for Debian and Ubuntu (amd64 and arm64), opened by the
  graphical app installer on double-click. There is no `.rpm`; on Fedora the
  package is `pandoc-cli`.

Typst ships no installer, on any platform: every release is an archive, never a
`.pkg`, `.msi` or `.deb`. It has to come from a package manager instead:

- **macOS:** `brew install typst`, via [Homebrew](https://brew.sh), the standard
  package manager for developer tools on a Mac. It is not installed by default.
- **Windows:** `winget install --id Typst.Typst`. Winget ships with Windows 11
  and current Windows 10 as part of "App Installer", so it is usually already
  present; a terminal is still needed to run it.
- **Linux:** `sudo snap install typst`, an official snap published by Typst
  GmbH, or install "Typst" from the Ubuntu App Center with no terminal at all.

Neither `apt install typst` nor `dnf install typst` exists: Typst is in neither
Debian/Ubuntu's nor Fedora's repositories.

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
