# Changelog

## Unreleased

- The tutorial module now starts from a computer with nothing installed. A
  **Setting Up** subsection covers VS Code, Node.js, git and a GitHub account,
  then **Use this template**, `git clone` and `npm install`, so a reader who
  lands on the module can follow it through instead of being sent to the
  documentation for the first half. The old **VS Code** page moves in as **The
  Course Manager** and keeps the extension install and the panel tour.
  `docs/first-course.md` is unchanged and remains the same path as one page,
  with the per-system detail the module links out to.

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

- A pull no longer writes markdown the preview cannot build. Text a Canvas page
  held as `&lt;tel nr&gt;` came back as a bare `<tel nr>`, which MDX reads as an
  unclosed tag, so `npm run build` failed on a page the author never wrote. The
  same escape fixes the push: unescaped, that text went back to Canvas as markup
  and the words disappeared from the page. A spaced comparison like `a < b` is
  left alone, since MDX only starts a tag on a non-space.

- `npm test` no longer fails in a course project that has synced with Canvas.
  One test of `merge-items` reached past its own fixture and loaded the
  project's real `.canvas-sync.json`, where the mismatch guard refused it for
  describing a different course than the test's fake credentials. The command
  itself was never affected; only the test read the wrong file.

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
