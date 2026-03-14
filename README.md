# Canvas Local

Write course materials as markdown, preview via
[Docusaurus](https://docusaurus.io/), and sync with
[Canvas LMS](https://www.instructure.com/canvas).

## Course Structure

### Course Modules (sync with Canvas / preview locally with Docusaurus)

```
course/
  01-module-name/
    _category_.json          # Docusaurus sidebar label/order
    01-page-name.md          # Canvas Page
    02-assignment-name.md    # Canvas Assignment
    03-link-name.md          # Canvas ExternalUrl
    subfolder-name/          # Canvas Text Header
      01-nested-page.md      # Indented module item
```

- Filenames are lowercase, hyphenated, prefixed with 00-99 for ordering
- Canvas item type is set via `canvas_type` in frontmatter (default: `page`)
- Assignment frontmatter supports: `points_possible`, `submission_types`,
  `due_at`
- External URL frontmatter requires: `external_url`
- Non-markdown files (images, PDFs, etc.) are synced as Canvas File items

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

Standard
[GitHub Flavoured Markdown](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax)
is supported.

### Custom Alerts / Callouts / Admonitions

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

## Development and Syncing

### Setup

Requires Node.js 18+ (uses native fetch).

```bash
npm install
cp .env.example .env   # then fill in your Canvas credentials
```

Or use the interactive setup:

```bash
npm install
npx course init
```

#### Environment Variables

| Variable           | Description                                                  |
| ------------------ | ------------------------------------------------------------ |
| `CANVAS_API_URL`   | Canvas instance URL (e.g., `https://school.instructure.com`) |
| `CANVAS_API_TOKEN` | Canvas API access token                                      |
| `CANVAS_COURSE_ID` | Target course ID                                             |

See [Canvas Setup Guide](docs/canvas-setup.md) for detailed instructions on
obtaining these credentials.

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

#### Global flags

```bash
npx course --verbose <command>   # show API request details
npx course --quiet <command>     # only show errors
```

### Development Commands

Only use these commands if you really know what you are doing!

```bash
npx course reset-sync-state   # remove all canvas_id fields and delete .canvas-sync.json
npx course reset-canvas        # delete all modules, pages, assignments, and files from Canvas
```

### Resilience & Conflict Detection

- **Retry logic**: API calls automatically retry on 429 (rate limit) and 5xx
  errors with exponential backoff (up to 3 attempts).
- **Error recovery**: If a single module or item fails during push/pull, the
  remaining items continue and a summary of errors is shown at the end.
- **Conflict detection**: `pull` checks if local files have been modified since
  the last sync and skips them to avoid overwriting your work. Use `--force` to
  override.
- **Stale ID recovery**: If a module, page, or assignment was deleted on Canvas
  but still has a stored ID locally, push detects the 404 and automatically
  creates a new resource.
- **Progress counters**: Push and pull show progress like `Module 2/5`,
  `Item 3/12`.

## VS Code Integration

All course commands are available in the VS Code command palette. The extension
validates that a `course/` directory exists before running commands and shows
notification messages when commands start. To install:

```bash
npm run vscode:install
```

Then open the command palette (Cmd+Shift+P) and type "Canvas Local:" to see all
available commands.

## Theme

The Docusaurus preview uses Thomas More-inspired styling (orange `#fa6432`
accent, Nunito font, light weights). Customise in `src/css/custom.css`.
