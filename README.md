# course-template

Course development system: write course materials as markdown, preview via Docusaurus, and sync with Canvas LMS.

## Setup

```bash
npm install
cp .env.example .env   # then fill in your Canvas credentials
```

Or use the interactive setup:

```bash
npm run canvas:init
```

## Development

```bash
npm start          # start Docusaurus dev server
npm run build      # production build
```

## Canvas Sync

```bash
npm run canvas:push              # push all modules to Canvas
npm run canvas:push -- --dry-run # preview without making changes
npm run canvas:push -- -m 01-intro  # push a single module
npm run canvas:pull              # import existing Canvas course
npm run canvas:status            # compare local vs Canvas state
```

## Managing Modules

```bash
npm run module:new     # create a new module (asks for name and position)
npm run module:move    # move a module to a different position
npm run module:rename  # rename a module
npm run module:delete  # delete a module and renumber remaining
```

All commands are interactive and handle renumbering automatically.

## Managing Items

```bash
npm run item:new           # create a page, assignment, url, subsection, or add a file
npm run item:move          # reorder an item within its module
npm run item:movetomodule  # move an item to a different module
npm run item:rename        # rename an item
npm run item:delete        # delete an item and renumber remaining
```

Item commands auto-detect the current module when run from inside a module folder. Items can be added to the module root or into subsections.

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
- Assignment frontmatter supports: `points_possible`, `submission_types`, `due_at`
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

## Environment Variables

| Variable | Description |
|---|---|
| `CANVAS_API_URL` | Canvas instance URL (e.g., `https://school.instructure.com`) |
| `CANVAS_API_TOKEN` | Canvas API access token |
| `CANVAS_COURSE_ID` | Target course ID |
