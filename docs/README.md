# Documentation

All guides for Coursewright. New here? Start with
[your first course](first-course.md), which walks the whole path from an empty
computer to a published Canvas module.

## Getting Started

- [Your first course, step by step](first-course.md): the beginner walkthrough,
  assuming no VS Code, terminal, or git experience
- [User guide](user-guide.md): course structure and every daily command
- [Canvas sync](user-guide.md#canvas-sync): `sync`, `push`, `pull` and `status`,
  the flags each one takes, and what a prune deletes
- [Git and GitHub basics](git-and-github.md): what they are and the commands you
  need
- [Canvas setup](canvas-setup.md): API URL, access token, and course ID
- [Backups](backups.md): back the Canvas course up before your first push
- [Limitations](limitations.md): what the tool does not do, and what to do
  instead
- [Troubleshooting](troubleshooting.md): common errors and their fixes

## Writing Your Course

- [Markdown guide](markdown.md): supported syntax, links, and alerts
- [Frontmatter reference](frontmatter.md): the metadata for every Canvas type,
  from pages and assignments to discussions, quizzes and LTI links
- [Lesson workflow](lesson-workflow.md): from lesson plan to student module with
  the bundled skills
- [Didactic foundations](didactics.md): backward design, constructive alignment
  and the improvement loop behind that workflow, and how far they reach
- [The sources folder](sources.md): where lesson plans, notes, and issues live

## Your Course's Own Files

These two are not documentation and do not live in `docs/`. They sit in
[`context/`](../context/), they are yours to edit, they are protected during
upstream updates, and AI assistants read them before drafting anything.

- [Writing style guide](../context/writing-style.md): the per-course style rules
  AI assistants follow (ships as the English baseline; make it yours with
  `/writing-style-init`, or swap in another language from
  [`templates/`](../templates/))
- [Course context](../context/course-context.md): the per-course design template
  the lesson skills rely on

## Tools

- [VS Code extension](vscode.md): sidebar and command-palette reference
- [AI assistants](ai-assistants.md): assistant setup and the bundled skills
- [Writing your own skills](writing-skills.md): the file layout, template, and
  naming conventions
- [Export styling](export-styling.md): the PDF/DOCX pipeline, and how the export
  style and theme resolve
- [Hosting](hosting.md): publishing the preview site to GitHub Pages

## Making It Yours

- [Customization](customization.md): README, language, colours and fonts,
  branding, and licence
- [Updating your project](updating-your-project.md): pulling tooling
  improvements from upstream
- [New academic year](new-academic-year.md): pointing your course at a fresh
  Canvas course

## Advanced and Project

- [Advanced commands](advanced-commands.md): destructive operations, use with
  care
- [Architecture](architecture.md): sync algorithms, state, and internals
- [Tests](tests.md): test layout and conventions
- [Contributing](contributing.md): issues, pull requests, and etiquette
- [Ideas list](roadmap.md): possible future features
