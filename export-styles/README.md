# Export Styles

An export style decides how `npx course export` lays out a PDF or a Word
document: typography, margins, the cover, and the fonts it ships. Colour is not
part of a style: that comes from the theme in
[`src/css/themes/`](../src/css/themes/), which the site, Canvas and the PDF all
read. See [docs/export-styling.md](../docs/export-styling.md) for the pipeline
and [docs/customisation.md](../docs/customisation.md) for making it yours.

## Choosing One

```yml
# course.config.yml
export:
  style: generic
```

The value is a folder name below, or a path to a folder of your own (for example
`sources/my-style`). For a single run, `npx course export --style thomas-more`
overrides it.

## What Ships

| Style         | Look                                                                                                                                                                                                                    |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `generic`     | The default. Helvetica/Arial, near-black headings, A4 with 2.5 cm margins, and a "Built with Coursewright" watermark on the cover. No bundled fonts.                                                                    |
| `thomas-more` | A worked example of full institutional branding: Century Gothic headings where the machine has that font, Nunito bundled as the fallback, orange and navy, and the Thomas More logo. Pair it with `theme: thomas-more`. |

The Thomas More logo belongs to its owner, and the bundled Nunito ships under
the SIL Open Font License. See [THIRD-PARTY.md](../THIRD-PARTY.md).

## What a Style Folder Holds

| File             | Used for                                                                                               | Required |
| ---------------- | ------------------------------------------------------------------------------------------------------ | -------- |
| `template.typ`   | PDF layout (Typst, rendered through pandoc)                                                            | yes      |
| `reference.docx` | Word styles for DOCX output                                                                            | yes      |
| `logo.png`       | Cover logo in the PDF. The filename is fixed.                                                          | no       |
| `fonts/`         | Fonts to embed in PDF exports, via `TYPST_FONT_PATHS`. Only fonts whose licence allows redistribution. | no       |

The three files at the root of this folder (`filter.lua`, `defaults.yml` and
`sample.md`) drive the pandoc pipeline rather than the look, so every style
shares one copy of each.

## Adding Your Own

Copy the closest style into `sources/` (which survives upstream updates) and
point `export.style` at it:

```bash
cp -r export-styles/generic sources/my-style
```

Then edit `sources/my-style/template.typ` and `reference.docx`, or let
`/export-style-init` derive a style from a Word template, a PDF, a website or a
CSS file, and `/export-style-update` make plain-language tweaks.

To change one file of a shipped style without forking the rest, drop it in
`sources/export-style/`: that path wins per file over whatever style is
selected.

Do not edit the folders here: they are shipped defaults and an upstream update
overwrites them.
