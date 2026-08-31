# Changelog

## Unreleased

- The emoji legend in the writing-style guides gains `🔑` for a solution page,
  in all four language variants. Courses that publish worked solutions were
  already using it and each picked their own marker.

- The tooling's own test workflow no longer runs in course projects. Every
  project created from the template inherited `.github/workflows/test.yml`, and
  it ran the template-only suite: the checks that read the README, the course
  home page and the two guides in `context/`, every one of which a course author
  is told to replace. The result was failure mail about a workflow the author
  never wrote. Both of its jobs are now guarded on the repository name, so a
  fork of the tooling keeps its CI while a course skips it.

- Generated folder and file names are capped at 60 characters, cut on a word
  boundary. A Canvas title can be a whole sentence — a text header telling the
  author what to put in the module is a real example — and uncapped it became a
  folder name of nearly 200 characters. Two of those nested under `course/`
  carried a course past Windows' 260-character path limit, where `git clone`
  fails outright and the repository cannot be checked out on Windows at all.
  Only newly generated names are affected; nothing already on disk is renamed.

- A `Course checks` workflow takes its place in a course project, running
  `npx course validate` and `npm run build` on every push. It reports on the
  material rather than on the tooling, and unlike the Pages deploy it runs on
  every branch and without Pages being switched on, so a page that cannot
  compile is caught where it was written rather than at a deploy the project may
  not reach for months.

## 1.0.0 (2026-08-30)

First public release. Write your course as markdown, preview it as a Docusaurus
site, sync it two ways with Canvas LMS, export it to PDF and Word, and pull
later improvements to the tooling into your project without touching a line of
your course. Ships with a VS Code extension, a set of AI skills for lesson
design and quality checks, and a tutorial module that doubles as the demo site
at [coursewright.md](https://coursewright.md/).
