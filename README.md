# Canvas Local

Write course materials as markdown, preview via Docusaurus, and sync with
Canvas LMS.

## Setup

```bash
npm install
cp .env.example .env   # then fill in your Canvas credentials
```

Or use the interactive setup:

```bash
npm install
npx course init
```

## Development

```bash
npm start          # start Docusaurus dev server
npm run build      # production build
```

## Canvas Sync

```bash
npx course push              # push all modules to Canvas
npx course push --dry-run   # preview without making changes
npx course push -m 01-intro # push a single module
npx course pull              # import existing Canvas course
npx course status            # compare local vs Canvas state
```

## Managing Modules

```bash
npx course new-module     # create a new module (asks for name and position)
npx course move-module    # move a module to a different position
npx course rename-module  # rename a module
npx course delete-module  # delete a module and renumber remaining
```

All commands are interactive and handle renumbering automatically.

## Managing Items

```bash
npx course new-item           # create a page, assignment, url, subsection, or add a file
npx course move-item          # reorder an item within its module
npx course movetomodule-item  # move an item to a different module
npx course rename-item        # rename an item
npx course delete-item        # delete an item and renumber remaining
```

Item commands auto-detect the current module when run from inside a module
folder. Items can be added to the module root or into subsections.

## Course Structure

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

## Evaluations

```
evaluations/
  2526/                      # academic year
    exam-name/
      instructions.md
      start/                 # starter code for students
      solution/              # example solution
```

## VS Code Integration

All course commands are available in the VS Code command palette. To install:

```bash
npm run vscode:install
```

Then open the command palette (Cmd+Shift+P) and type "Course:" to see all available commands.

## Environment Variables

| Variable           | Description                                                  |
| ------------------ | ------------------------------------------------------------ |
| `CANVAS_API_URL`   | Canvas instance URL (e.g., `https://school.instructure.com`) |
| `CANVAS_API_TOKEN` | Canvas API access token                                      |
| `CANVAS_COURSE_ID` | Target course ID                                             |

## Theme

Thomas More-inspired styling (orange `#fa6432` accent, Nunito font, light weights). Customise in `src/css/custom.css`.
