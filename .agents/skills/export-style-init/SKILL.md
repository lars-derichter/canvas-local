---
name: export-style-init
description: Derive a reusable PDF/DOCX export style from a reference (a Word document, a PDF, a website URL, or a CSS file) and write it to sources/export-style/ so course exports match that look. Phase A proposes a style spec and stops for approval; Phase B writes template.typ + reference.docx and regenerates the sample. Use for "initialize export style", "set up an export style", "match this Word template", "build a house style for the export", "exportstijl opzetten", "maak een huisstijl voor de export".
---

# Export Style Init

Turn a reference document, website, or stylesheet into a custom export style for
`npx course export`. The style lives in `sources/export-style/` (protected from
upstream updates) and overrides, per file, whichever style `export.style` in
`course.config.yml` selects from `export-styles/`.

Layout and colour are separate axes. This skill owns **layout**: `template.typ`
and `reference.docx`. **Colour** lives in the theme
(`src/css/themes/<name>.css`), shared with the preview site and Canvas, and
injected into `template.typ` at export time. A colour the reference calls for
belongs in a theme file, not hardcoded in the template. `reference.docx` is the
exception: Word styles cannot read the theme, so their colours are set directly.

## Input

`$ARGUMENTS` may hold a path to a `.docx` or `.pdf`, a website URL, or a `.css`
file. If empty, use the file open in the IDE when it is one of those; otherwise
ask which reference to derive the style from. Stop with one sentence if the
source is not a document, URL, or stylesheet.

## Steps

### Phase A: Inspect and Propose (Writes Nothing)

1. **Read first**: [`docs/export-styling.md`](../../../docs/export-styling.md),
   what `template.typ` (PDF via Typst) and `reference.docx` (DOCX via Word
   styles) each control, and how `--var` variables map into the template;
   [`export-styles/generic/template.typ`](../../../export-styles/generic/template.typ),
   the default you will fork; note the `conf(...)` signature (font, codefont,
   fontsize, margin, paper, logo), the `pick(...)` helper that reads theme
   colours, and the `alert-colors` map. Also read
   [`src/css/themes/github.css`](../../../src/css/themes/github.css) for the
   `--ccb-*` colour tokens. The custom paragraph styles inside the style's
   `reference.docx` (the twelve per-kind `AlertTitle<Kind>`/`AlertBody<Kind>`
   pairs (Note, Tip, Important, Warning, Caution, Check) plus `LinkCard`,
   `LinkCardTitle`, `Attachment`, and `SourceCode`) are mapped by the Lua filter
   and **must survive** any edit to the DOCX.

2. **Extract the visual decisions** from the reference:
   - `.docx`: unzip into a fresh directory in the session scratchpad; read
     `word/styles.xml` (font, size, colour of `Title`, `Heading1/2/3`,
     `Normal`), `word/theme/theme1.xml` (theme fonts, colours), and the
     `<w:sectPr>` in `word/document.xml` (margins).
   - `.pdf`: read it with the Read tool (it renders pages); judge fonts, heading
     treatment, body size, colours, and margins by eye.
   - Website URL: fetch the page and its stylesheet (your web-fetch tool, or
     `curl`); extract `font-family` for body and headings, base `font-size`,
     link and heading colours, content `max-width`/margins, accent colour.
   - `.css`: parse the same properties directly.

3. **Present the style spec** as a table, one row per decision with where it
   applies:

   | Decision           | Value | Where it goes                                | DOCX (reference.docx)             |
   | ------------------ | ----- | -------------------------------------------- | --------------------------------- |
   | Body font          | …     | `font:` in `conf()`                          | `Normal` + theme `<a:latin>`      |
   | Heading font       | …     | `show heading` rule                          | `Heading 1/2/3`                   |
   | Heading colour     | …     | `--ccb-heading` in the theme                 | `Heading 1/2/3` colour            |
   | Body size          | …     | `fontsize:` in `conf()`                      | `Normal` size                     |
   | Link/accent colour | …     | `--ccb-link` / `--ccb-accent` in the theme   | `Hyperlink` colour                |
   | Alert colours      | …     | `--ccb-alert-<kind>-fg` / `-bg` in the theme | per-kind `AlertTitle`/`AlertBody` |
   | Margins            | …     | `margin:` in `conf()`                        | `<w:pgMar>`                       |
   | Paper              | …     | `paper:` in `conf()`                         | `<w:pgSz>`                        |

   When the reference implies new colours, say which theme you will write them
   to: a copy of the active theme under `sources/` (then set `theme:` to that
   path in `course.config.yml`), or none if the colours already match.

   Say plainly what the reference asks for that the pipeline cannot do cleanly
   (per-heading background bands, running chapter headers, …).

   Stop. Wait for explicit approval before starting Phase B.

### Phase B: Write and Regenerate (Only After Approval)

4. **Fork the selected style** into `sources/export-style/` (create the folder
   if absent). Resolve the style from `export.style` in `course.config.yml`,
   defaulting to `generic`:
   `cp export-styles/generic/template.typ export-styles/generic/reference.docx sources/export-style/`

   If the spec includes colours, also copy the active theme:
   `cp src/css/themes/github.css sources/theme.css`, set
   `theme: sources/theme.css` in `course.config.yml`, and edit the `--ccb-*`
   tokens there.

5. **Edit `sources/export-style/template.typ`** (PDF): change the `conf()`
   defaults to the spec and add `show` rules for what the signature does not
   cover:

   ```typst
   show heading: set text(font: ("Your Heading Font",))
   ```

   Keep the `alert(...)`, `linkcard(...)`, `attachment(...)` helpers and the
   `alert-colors` map: the Lua filter calls them by name. Keep the
   `pick("$ccb-…$", "#fallback")` calls too: they are how theme colours reach
   the PDF. Change a colour by editing the theme and, if you want the standalone
   fallback to match, the literal second argument.

6. **Edit `sources/export-style/reference.docx`** by editing its XML, never in
   Word (Word drops the custom styles):

   ```bash
   D=<fresh dir in the session scratchpad>
   unzip -oq sources/export-style/reference.docx -d "$D"
   # Edit word/styles.xml and/or word/theme/theme1.xml, then:
   ( cd "$D" && zip -Xrq "<absolute repo path>/sources/export-style/reference.docx" . )
   ```

   In `word/styles.xml`: `Normal`, `Heading1/2/3`, `Hyperlink`. Font via
   `<w:rFonts>`, size via `<w:sz>` in half-points (`28` = 14pt), colour via
   `<w:color w:val="RRGGBB">` (no `#`); theme fonts via `<a:latin typeface>` in
   `word/theme/theme1.xml`. Leave the per-kind `AlertTitle*`/`AlertBody*` pairs,
   `LinkCard`, `LinkCardTitle`, `Attachment`, and `SourceCode` untouched (unless
   the new style redefines the alert palette, then keep the style _names_ and
   change only their colours).

7. **Regenerate and show the sample**: `npx course export --sample -f pdf` and
   `-f docx`. Surface `exports/style-sample.pdf` (and the DOCX), point out any
   DOCX degradation that applies (see `docs/export-styling.md`), and iterate on
   request. Small later tweaks are the job of
   [`export-style-update`](../export-style-update/SKILL.md).

## Rules

- Write only under `sources/`: `sources/export-style/` for the style files, and
  a theme copied to `sources/` for colours. Never edit `export-styles/` or
  `src/css/themes/` (shipped defaults, overwritten on upstream updates).
- Keep PDF and DOCX in sync: apply each format-agnostic decision (fonts,
  colours, margins) to both files.
- If the reference uses a licensed font the system lacks, say so. Typst uses
  installed system fonts plus the style's `fonts/` directory (the exporter
  passes `sources/export-style/fonts/`, or the selected style's `fonts/`, to
  Typst via `TYPST_FONT_PATHS`); suggest `typst fonts` to list installed ones,
  dropping font files in `sources/export-style/fonts/`, or a close free
  alternative.
- **Never copy a font file into the repository unless its licence permits
  redistribution.** Retail and corporate fonts almost never do, and a course
  repository is often public. Name it first in the font list so machines that
  have it use it, bundle a free lookalike behind it, and record whatever you do
  bundle in `THIRD-PARTY.md` with its licence file alongside it. On macOS the
  exporter already finds Microsoft Office's own fonts inside the Office
  application bundles, so an Office typeface needs no bundling at all.
- A `sources/export-style/logo.png` overrides the selected style's cover logo;
  with neither present the cover simply has no logo.
- Colours in `reference.docx` cannot read the theme. When you change a theme
  colour, change the matching Word style too, or the DOCX drifts from the PDF.

$ARGUMENTS
