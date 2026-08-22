# User Guide

Canvas Course Builder lets you write course materials as markdown files on your
own computer, preview them on a local website
([Docusaurus](https://docusaurus.io/)), and sync them with
[Canvas LMS](https://www.instructure.com/canvas) in one command. This guide
covers the course structure and the daily workflow; the [docs index](README.md)
lists every other guide. If anything fails along the way, check
[Troubleshooting](troubleshooting.md).

## Getting Started

[Your first course, step by step](first-course.md) is the full walkthrough:
installing VS Code, Node.js and git, creating the project from the template,
cloning it, and publishing a first module. It assumes no prior experience.

The short version, for the impatient:

```bash
git clone https://github.com/YOUR-USERNAME/your-project-name.git
cd your-project-name
npm install
npm start          # preview at localhost:3000
npx course setup   # name, language, look, templates
npx course init    # Canvas credentials
```

Node.js 24+ is the only requirement. `npx` runs the `course` tool that ships
with the project, so there is nothing else to install.

> [!WARNING]
>
> If you plan to store evaluation materials (exams, tests) in the `evaluations/`
> folder, make sure your project is **private** — otherwise students can find
> your materials on GitHub. See
> [Keeping your project private](git-and-github.md#keeping-your-project-private)
> for how to change this setting.

`course/01-getting-started/` is a real module, so it would be published to your
students along with your own. The setup wizard offers to remove it; see
[the built-in tutorial module](customization.md#the-built-in-tutorial-module)
for how to keep it locally without publishing it.

### Optional: pandoc and Typst

Only needed to export course materials to PDF or Word. DOCX export needs pandoc;
PDF export also needs Typst.

```bash
# macOS
brew install pandoc typst
# Windows
winget install --id JohnMacFarlane.Pandoc --id Typst.Typst
# Linux: use your package manager for pandoc; see the Typst releases page
```

See [Exporting to PDF or DOCX](#exporting-to-pdf-or-docx) below.

## Course Structure

### Course Modules (Sync With Canvas / Preview Locally With Docusaurus)

```
course/
  01-module-name/
    _category_.json          # Docusaurus sidebar label/order
    _files/                  # Embedded assets and file item binaries
      diagram.png
      report.pdf
    01-page-name.md          # Canvas Page
    02-assignment-name.md    # Canvas Assignment
    03-discussion-name.md    # Canvas Discussion
    04-link-name.md          # Canvas ExternalUrl
    05-test-1.md             # Canvas Quiz (reference to a quiz in Canvas)
    06-report.md             # Canvas File (wrapper, points to _files/)
    07-subfolder-name/       # Canvas Text Header
      01-nested-page.md      # Indented module item
```

- Filenames are lowercase, hyphenated, prefixed with 00-99 for ordering
- Files and folders prefixed with `_` are internal and excluded from Canvas
  syncing (e.g. `_files/`, `_category_.json`)
- Canvas item type is set via `canvas_type` in frontmatter (default: `page`)
- Assignment frontmatter supports: `points_possible`, `submission_types`,
  `due_at`
- Discussion frontmatter supports: `discussion_type`, `require_initial_post`,
  `delayed_post_at`, `lock_at`, `published`. The markdown body is the opening
  message
- External URL frontmatter requires: `external_url`; an LTI item
  (`canvas_type: external_tool`) uses the same field for the tool's launch URL
- Quiz frontmatter is a reference, not content: the file names a quiz that
  already exists in Canvas, and `quiz_ref` points at the QTI zip it was imported
  from (path from the repository root). The questions never sync
- File item frontmatter requires: `file_ref` pointing to the binary in `_files/`
  (e.g. `file_ref: _files/report.pdf`). The binary is uploaded to Canvas as a
  module item. In Docusaurus, a styled file card with a download link is shown
- Images and files in `_files/` can also be referenced from markdown content
  (`![Alt](_files/image.png)`) — these are embedded in page content, not added
  as separate module items

### Evaluations (Private)

```
evaluations/
  2526/                      # academic year
    exam-name/
      instructions.md
      start/                 # starter code for students
      solution/              # example solution
```

### Sources (Private)

Reference materials, inspiration, and notes. Not served by Docusaurus or synced
to Canvas. See the [sources guide](sources.md) for conventions.

## Course Name, Language and Labels

`course.config.yml` at the project root names the course and sets the language
of every generated, student-facing label in one place: alert titles (Canvas
HTML, Docusaurus preview, and PDF/DOCX exports), the "External link" and "File"
cards in the preview, the attachment and online-footnote labels in exports,
default export titles and filenames, the fallback title for unnamed pulled
items, and the generated glossary page. It also sets the Docusaurus site locale,
so the site chrome ("On this page", "Next", …) follows along.

```yaml
title: Programming Fundamentals # names the site, navbar and export covers
tagline: Bachelor 1, semester 2 # optional, subtitles those covers

language: en # built-in label sets: en, nl (shipped default: en)

labels: # optional per-label overrides on top of the set
  alerts:
    caution: Watch out
  cards:
    file: Download
```

Without a `title`, the site and a full-course export fall back to the generic
label for the course language ("Course", "Cursus"). Set it — it is the one place
that names the course, and unlike `docusaurus.config.js` it survives an upstream
update.

Override groups and keys: `alerts` (`note`, `tip`, `important`, `warning`,
`caution`, `check`), `cards` (`external_url`, `file`), `export` (`attachment`,
`online`, `course_title`, `selection_title`), `pull` (`untitled`), and
`glossary` (`title`, `intro`, `operators`, `terms`). When the file or a key is
missing, English is used.

After changing the language or a label, re-push modules whose pages contain
alerts (`npx course push`) and regenerate glossary pages
(`npx course build-glossary`) so Canvas picks up the new labels. The file is
listed in `protected_files`, so upstream updates never overwrite your choice.

## Markdown Files

Markdown is a simple way to format text using plain characters — for example,
`**bold**` for **bold** and `# Heading` for a heading. Your course materials are
written as markdown files, which are just regular text files that end in `.md`.

See the [markdown guide](markdown.md) for supported syntax and custom alerts,
and the [frontmatter guide](frontmatter.md) for the metadata fields.

### Keeping Your Course Files Tidy

`npm run format` runs Prettier over your markdown. It rewraps prose at 80
characters and normalises list markers, emphasis, table alignment and
frontmatter. Nothing about the rendered page changes — this is source formatting
only, and your fenced code blocks are left exactly as you wrote them.

It is worth running, for three reasons:

- **Consistency without policing it.** Course material accumulates from many
  places: a page drafted by an AI skill, a paragraph pasted out of Word or a
  slide deck, something typed in a hurry the night before class. Each arrives
  with its own wrapping and list markers. One command makes the whole course
  look like it was written in one sitting.
- **Readable diffs across an academic year.** This is the practical win. With
  prose wrapped at 80 characters, fixing one sentence shows up in `git diff` as
  one or two changed lines. With a paragraph sitting on a single long line, the
  same fix reports the entire paragraph as changed and you cannot see what you
  actually altered.
- **It catches markdown that renders wrong silently.** A missing blank line
  before a list, a misaligned table, stray trailing whitespace — Prettier
  normalises all of it, so a page behaves the same in the preview and after
  `npx course push`.

Run it whenever suits you: before a commit, or after a long writing session. It
is never required. Nothing checks your course, and `npx course push` does not
care either way.

If you would rather Prettier left your writing alone, add the content
directories to `.prettierignore`:

```
course/
evaluations/
sources/
```

## Managing Course Materials

### Managing Modules

```bash
npx course new-module     # create a new module (asks for name and position)
npx course move-module    # move a module to a different position
npx course rename-module  # rename a module
npx course delete-module  # delete a module and renumber remaining
```

All commands are interactive and handle renumbering automatically.

### Managing Items

```bash
npx course new-item           # create a page, assignment, url, subsection, or add a file
npx course move-item          # reorder an item within its module
npx course movetomodule-item  # move an item to a different module
npx course rename-item        # rename an item
npx course delete-item        # delete an item and renumber remaining
npx course merge-items        # merge two items into one
npx course split-item         # split an item into two files at a given line
```

Item commands auto-detect the current module when run from inside a module
folder. Items can be added to the module root or into subsections.

### Generated Glossary Pages

```bash
npx course build-glossary          # regenerate module glossary pages from the canonical glossary
npx course build-glossary --check  # verify pages are up to date (CI / pre-push)
```

If your course keeps a canonical glossary in
`sources/reference-materials/glossary.yml`, this command renders a cumulative
glossary page per module. See the [lesson workflow](lesson-workflow.md) for the
file format and how it fits the authoring flow.

### Searching Course Content

```bash
npx course search "flexbox"                          # find a word or phrase in course/
npx course search "flexbox" -C 4                     # show more context around matches
npx course search "flexbox" --evaluations --sources  # also search those folders
npx course search "Flexbox" --case-sensitive         # match upper/lower case exactly
```

Results are grouped per file with the module and item they belong to, line
numbers, and a few lines of context around each match. By default only `course/`
is searched; `--evaluations` and `--sources` widen the scope.

### Docusaurus Preview

```bash
npm start          # start Docusaurus dev server
npm run build      # production build
```

You can also publish the preview as a free public website on GitHub Pages — a
handy fallback when Canvas is unavailable. See the [hosting guide](hosting.md).

### Canvas Sync

> [!WARNING]
>
> Before your first push to a Canvas course that already has content, back it
> up: see [Backing up a Canvas course](backups.md). Push takes over the modules
> it manages, `--prune-canvas` deletes what you removed locally, and Canvas has
> no undo. Pull runs the same risk in the other direction: `--force` replaces
> your local markdown with the Canvas version, so commit before you use it.
> [Limitations](limitations.md) sets out exactly what each command touches.

```bash
npx course push                  # push all modules to Canvas
npx course push --dry-run        # preview without making changes
npx course push -m 01-intro      # push a single module
npx course push --prune-canvas   # also delete Canvas modules and items removed locally
npx course pull                  # import existing Canvas course
npx course pull --force          # overwrite local files pull would otherwise skip
npx course status                # compare local vs Canvas state
npx course validate              # check course content for errors before pushing
```

#### Global Flags

```bash
npx course --verbose <command>   # show API request details
npx course --quiet <command>     # only show errors
```

#### New Academic Year

See the [new academic year guide](new-academic-year.md) for switching your
materials to a new Canvas course at the start of a new academic year.

## Exporting to PDF or DOCX

Turn course materials into printable PDFs or editable Word documents — handy for
exams, handouts, and offline review. This needs pandoc (and Typst for PDF); see
the [optional install step](#getting-started) above.

```bash
npx course export course/01-intro/03-alerts.md   # one item
npx course export -m 01-intro                     # a whole module
npx course export                                 # the full course
npx course export -m 01-intro -f docx             # Word instead of PDF
npx course export --flagged                       # only items with export: true
```

Multiple items combine into one document with a title page, a generated table of
contents, and a page break between chapters. Output lands in `exports/`
(gitignored). Non-markdown items become link cards (external URLs) or attachment
references (files) in the combined document.

A whole-course export takes its title, and its filename, from `title` in
`course.config.yml` — `exports/programming-fundamentals.pdf`. A module export is
titled after the module. `--title "Something else"` overrides both.

For a curated selection, use the two-step **table of contents** flow: generate a
list, delete the lines you do not want, then export what remains.

```bash
npx course export-toc                    # writes exports/toc.md
# …edit exports/toc.md, delete unwanted lines…
npx course export --toc exports/toc.md
```

All of this is also available from the VS Code sidebar, including multi-select
export of highlighted items.

To change how exports look, `course.config.yml` picks the layout with
`export.style` and the colours with `theme`; `--style <name>` overrides the
layout for one run. See [export styling](export-styling.md) for the pipeline,
[Customization](customization.md#branding) for the colour tokens, and the
`/export-style-init` and `/export-style-update` skills for deriving a house
style from a Word template.

## Advanced Commands

```bash
npx course reset-sync-state      # remove canvas_id fields and delete .canvas-sync.json
npx course reset-canvas          # delete all modules, pages, assignments, and files from Canvas
```

See [advanced commands](advanced-commands.md) for details on these destructive
operations.

## Further Guides

The [docs index](README.md) lists every guide, grouped by what you are trying to
do.
