# Coursewright

Write your course in markdown, in your own editor, with git underneath. Publish
it as a website for your students, hand it out as a styled PDF or DOCX, or sync
it straight into Canvas LMS, whichever you need. Bundled AI skills pitch in on
lesson design, module building and proofreading when you ask. Both the AI and
Canvas are optional: your course is plain files, and it works without either.

The Canvas web editor is fine for a page or two. It gets painful when you
maintain a whole course: no history, no search and replace, no offline work, no
way to review changes before students see them. Coursewright moves the source of
truth to plain markdown files on your computer and makes Canvas one publishing
target among three.

The suggested workflow has a didactic backbone: backward design and constructive
alignment. Learning goals come first, then the assessment that evidences them,
then the lessons; the skills read that chain from one file, check your material
against it, and a retro folds what happened in class back into next year's plan.
It is a proven base, not a straitjacket: every structure is a default your own
conventions override. The reasoning is in
[didactic foundations](docs/didactics.md).

## What You Get

- **Your own tools.** Write in VS Code or any editor, keep everything in git,
  and review every change before it goes live.
- **Instant preview.** A local website ([Docusaurus](https://docusaurus.io/))
  shows your course as you write, in the same structure students will see.
- **One-command Canvas sync.** `npx course sync` reconciles modules, pages,
  assignments, discussions and files with
  [Canvas LMS](https://www.instructure.com/canvas) in both directions, and
  deletes nothing unless you ask. `push` and `pull` are the same run with the
  direction pinned, and `status` shows what a sync would do without doing it.
- **PDF and DOCX export.** Hand out a styled course text or a single chapter,
  with your institution's branding.
- **A VS Code extension.** The sidebar and command palette cover everything but
  the two destructive commands and the glossary builder, so daily work needs no
  terminal.
- **AI-assisted authoring.** Bundled skills help design lessons, build student
  modules, generate Canvas quizzes, proofread, and check course consistency,
  with any AI coding agent that reads `AGENTS.md`. The
  [lesson workflow](docs/lesson-workflow.md) shows how they chain from idea to
  published module.
- **A template that stays updatable.** Create your course from this template and
  keep pulling tooling improvements later; your course content is never
  overwritten.

## What It Does Not Do

Worth knowing before you commit a semester to it:

- **Not every type syncs as content.** Pages, assignments, discussions and files
  live in your markdown and are rebuilt from it. A quiz and an external tool
  (LTI) sync as references: the file says which Canvas object goes where in a
  module, and push never creates or changes the object itself.
- **Quiz questions never sync.** A bundled skill generates a QTI package you
  import into Canvas by hand, once, in one direction.
- **A push makes your markdown win.** It reconciles a module item by item, so
  anything you added by hand in Canvas stays where it is. But a Canvas object
  whose type and title match a local file is claimed by that file, and from then
  on the file decides what it holds.
- **The folder layout is a contract**: one folder per module, one level of
  nesting, numbered prefixes.
- **Nothing merges two versions of one item.** A sync decides which side wins
  and writes that copy whole; it never blends the two. Git is the undo, which is
  why a local file holding uncommitted work is never written over, and only
  `pull --force` overrides that.

The full list, with what to do instead, is in
[limitations](docs/limitations.md). Before pointing it at a course that already
has content, read [backups](docs/backups.md).

## Who It's For

Lecturers and teaching teams who maintain course material in Canvas and want the
comfort of files, folders and version control. You don't need to be technical:
the [user guide](docs/user-guide.md) starts from zero, and there is a
[git and GitHub guide](docs/git-and-github.md) for complete beginners.

## Quick Start

**New to this?** [Your first course, step by step](docs/first-course.md) goes
from a computer with nothing installed to a published Canvas module, assuming no
experience with VS Code, the terminal, or git.

The short version, if you have done this sort of thing before:

1. Click **Use this template** on GitHub and create your course repository.
2. Clone it, install Node.js 24+, run `npm install`, and preview the built-in
   getting-started course with `npm start`.
3. Make it your course with `npx course setup`: it asks for the language, the
   name and the look, and puts the matching templates in place (see
   [customisation](docs/customisation.md)).
4. Back up the Canvas course ([how](docs/backups.md)), connect it with
   `npx course init` (see the [Canvas setup guide](docs/canvas-setup.md)), and
   push your first module.

## Documentation

The [docs folder](docs/README.md) has the full map. Start with:

- [Your first course](docs/first-course.md): the complete beginner walkthrough
- [User guide](docs/user-guide.md): course structure and every daily command
- [Limitations](docs/limitations.md): what the tool does not do
- [Backups](docs/backups.md): protecting a Canvas course before you sync
- [Customisation](docs/customisation.md): README, language, branding, and
  licence
- [AI assistants](docs/ai-assistants.md): the bundled skills and how to add your
  own
- [Didactic foundations](docs/didactics.md): the course-design ideas the
  workflow is built on
- [Troubleshooting](docs/troubleshooting.md): common issues and fixes

## Licensing

- **Tooling** (CLI, libraries, site, VS Code extension): [MIT](LICENSE). Free to
  use, change and redistribute, as long as the copyright notice travels with it.
- **Course content** (`course/`): [CC BY-NC-SA 4.0](course/LICENSE.md) by
  default. Content you write in your own course is yours to license as you wish.
- **Borrowed assets** (the alert icons, the bundled Nunito typeface, and the
  example logo in `export-styles/thomas-more/`): each under its own licence, see
  [THIRD-PARTY.md](THIRD-PARTY.md).

## Contributing

Bug reports, ideas and pull requests are welcome: see the
[contributing guide](docs/contributing.md) and the
[ideas list](docs/roadmap.md). Taking part means following the
[code of conduct](CODE_OF_CONDUCT.md); security problems have their own
[private reporting route](SECURITY.md).
