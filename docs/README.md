# Documentation

All guides for Coursewright. New here? Start with
[your first course](first-course.md): it walks the whole path from an empty
computer to a published course, installing the Course Manager panel along the
way, and the
[built-in tutorial module](https://coursewright.md/getting-started/how-this-works/)
you preview there is a guided walk through the sidebar and the three publish
routes, and a working example of every content type (source:
[`course/01-getting-started/`](../course/01-getting-started/)).

## Getting Started

- [Your first course, step by step](first-course.md): the beginner tutorial,
  assuming no VS Code, terminal, or git experience
- [VS Code extension](vscode.md): the Course Manager panel and command palette
  reference
- [The built-in tutorial module](https://coursewright.md/getting-started/how-this-works/):
  the tool's own course, walking the whole workflow from the sidebar
- [User guide](user-guide.md): course structure and every daily command
- [Git and GitHub basics](git-and-github.md): what they are and the commands you
  need
- [Troubleshooting](troubleshooting.md): common errors and their fixes

## Writing Your Course

- [Markdown guide](markdown.md): supported syntax, links, and alerts
- [Frontmatter reference](frontmatter.md): every metadata field a course file
  can carry, for Canvas types, dates, and exports
- [Lesson workflow](lesson-workflow.md): from lesson plan to student module with
  the bundled skills
- [Didactic foundations](didactics.md): backward design, constructive alignment
  and the improvement loop behind that workflow, and how far they reach
- [The sources folder](sources.md): where lesson plans, notes, and issues live

## Publishing Your Course

- [Hosting](hosting.md): the course website, published with one GitHub Pages
  setting
- [Exporting](exporting.md): PDF, DOCX and markdown handouts, chapters, and
  course texts
- [Canvas setup](canvas-setup.md): API URL, access token, and course ID
- [Canvas sync](user-guide.md#canvas-sync): `sync`, `push`, `pull` and `status`,
  the flags each one takes, and what deleting with a prune flag reaches
- [Backups](backups.md): back the Canvas course up before your first push
- [Limitations](limitations.md): what the tool does not do, and what to do
  instead

## Your Course's Own Files

These two are not documentation and do not live in `docs/`. They sit in
[`context/`](../context/), they are yours to edit, they are protected during
[upstream updates](updating-your-project.md), and AI assistants read them before
drafting anything.

- [Writing style guide](../context/writing-style.md): the per-course style rules
  AI assistants follow (ships as the English baseline; make it yours with
  `/writing-style-init`, or swap in another language from
  [`templates/`](../templates/))
- [Course context](../context/course-context.md): the per-course design template
  the lesson skills rely on

## Tools

- [CLI reference](cli-reference.md): every `npx course` command and flag, and
  the npm scripts
- [AI assistants](ai-assistants.md): assistant setup and the bundled skills
- [Writing your own skills](writing-skills.md): the file layout, template, and
  naming conventions
- [Export styling](export-styling.md): the PDF/DOCX pipeline, and how the export
  style and theme resolve

## Making It Yours

- [Customisation](customisation.md): README, language, colours and fonts,
  branding, and licence
- [Updating your project](updating-your-project.md): pulling tooling
  improvements from upstream
- [New academic year](new-academic-year.md): pointing your course at a fresh
  Canvas course

## Under the Hood and the Project

- [Advanced commands](advanced-commands.md): destructive operations, use with
  care
- [Architecture](architecture.md): the reconcile engine, state, and internals
- [Tests](tests.md): test layout and conventions
- [Contributing](contributing.md): issues, pull requests, and etiquette
- [Ideas list](roadmap.md): possible future features
