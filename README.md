# Canvas Local

- **Write in markdown** — use familiar tools (VS Code, Git) instead of the
  Canvas web editor
- **Version control** — full Git history for all course materials
- **Local preview** — Docusaurus dev server for instant feedback before
  publishing
- **Batch sync** — push/pull entire courses or individual modules in one command
- **Portable content** — markdown files work independently of Canvas

Write course materials as markdown, preview via
[Docusaurus](https://docusaurus.io/), and sync with
[Canvas LMS](https://www.instructure.com/canvas).

## Getting Started

1. **Fork this repository** — forking gives you full git versioning for your
   course content while letting you pull upstream tooling updates.

2. **Install Node.js 20+** — download the LTS version from
   [nodejs.org](https://nodejs.org/).

3. **Install dependencies**

   ```bash
   npm install
   ```

4. **Connect to Canvas** — run the interactive setup to configure your Canvas
   API credentials:

   ```bash
   npx course init
   ```

   Or copy `.env.example` to `.env` and fill in the values manually. See the
   [Canvas Setup Guide](docs/canvas-setup.md) for detailed instructions on
   obtaining your API URL, token, and course ID.

   | Variable           | Description                                                  |
   | ------------------ | ------------------------------------------------------------ |
   | `CANVAS_API_URL`   | Canvas instance URL (e.g., `https://school.instructure.com`) |
   | `CANVAS_API_TOKEN` | Canvas API access token                                      |
   | `CANVAS_COURSE_ID` | Target course ID                                             |

5. **Start writing** — delete the example content in `course/`, create your
   first module, and preview it locally:

   ```bash
   npx course new-module    # create a module (asks for name and position)
   npm start                # start the Docusaurus dev server
   ```

## Course Structure

### Course Modules (sync with Canvas / preview locally with Docusaurus)

```
course/
  01-module-name/
    _category_.json          # Docusaurus sidebar label/order
    _files/                  # Embedded assets (images, PDFs)
      diagram.png
    01-page-name.md          # Canvas Page
    02-assignment-name.md    # Canvas Assignment
    03-link-name.md          # Canvas ExternalUrl
    subfolder-name/          # Canvas Text Header
      01-nested-page.md      # Indented module item
```

- Filenames are lowercase, hyphenated, prefixed with 00-99 for ordering
- Files and folders prefixed with `_` are internal and excluded from Canvas
  syncing (e.g. `_files/`, `_category_.json`)
- Canvas item type is set via `canvas_type` in frontmatter (default: `page`)
- Assignment frontmatter supports: `points_possible`, `submission_types`,
  `due_at`
- External URL frontmatter requires: `external_url`
- Images and files in `_files/` are referenced from markdown
  (`![Alt](./_files/image.png)`) and automatically uploaded to Canvas during
  push — they are embedded in page content, not added as module items
- Non-markdown files outside `_files/` are synced as Canvas File items

### Evaluations (private)

```
evaluations/
  2526/                      # academic year
    exam-name/
      instructions.md
      start/                 # starter code for students
      solution/              # example solution
```

### Sources (private)

Reference materials, inspiration, and notes. Not served by Docusaurus or synced
to Canvas. See [Sources Guide](docs/sources.md) for conventions.

## Markdown

See [Markdown Guide](docs/markdown.md) for supported syntax and custom
alerts/admonitions.

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
```

Item commands auto-detect the current module when run from inside a module
folder. Items can be added to the module root or into subsections.

### Docusaurus preview

```bash
npm start          # start Docusaurus dev server
npm run build      # production build
```

### Canvas Sync

```bash
npx course push                  # push all modules to Canvas
npx course push --dry-run        # preview without making changes
npx course push -m 01-intro      # push a single module
npx course push --prune          # also delete Canvas modules removed locally
npx course pull                  # import existing Canvas course
npx course pull --force           # overwrite locally modified files
npx course status                # compare local vs Canvas state
npx course status --remote       # also fetch and compare against Canvas
```

#### New Academic Year

See the [New Academic Year Guide](docs/new-academic-year.md) for switching your
materials to a new Canvas course at the start of a new academic year.

#### Global flags

```bash
npx course --verbose <command>   # show API request details
npx course --quiet <command>     # only show errors
```

## VS Code Integration

All course commands are available in the VS Code command palette. See the
[VS Code Guide](docs/vscode.md) for setup and the full command list.

## Theme

The Docusaurus preview uses Thomas More-inspired styling (orange `#fa6432`
accent, Nunito font, light weights). Customise in `src/css/custom.css`.

## Development & Tooling

See [Development Guide](docs/development.md) for advanced commands
(`reset-sync-state`, `reset-canvas`) and Claude Code integration.
