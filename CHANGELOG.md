# Changelog

## Unreleased

- **Discussions, quizzes and external tools sync.** Every type of item a Canvas
  module can hold now crosses in both directions, but not all of them the same
  way. A discussion is content like a page: the markdown body is the message,
  push writes it, pull reads it back, and a rollover into a fresh course
  recreates it from the repository. A quiz and an LTI link are references — the
  file says which Canvas object belongs at that position and holds nothing else,
  because a quiz's questions and submissions are not things this project could
  rebuild. Push never creates, updates or deletes either one. Which quiz an item
  means is resolved from `canvas_id` while the course still lists it and by
  title otherwise, writing the id it found back to the file, so the manual QTI
  import that a new academic year needs has to happen once and push picks it up
  from there. Two quizzes sharing a title is ambiguous and skipped rather than
  guessed.
- **`push` refuses to rebuild a module holding items it did not put there.** It
  compares what Canvas holds in a module against what `course/` accounts for,
  and when anything is unaccounted for it names those items with their Canvas
  links, leaves the module exactly as it is, carries on with the other modules
  and ends with a non-zero exit status. The claim in the README that a push
  silently drops hand-added items was accurate, and this is the fix for it
  rather than a note about it.
- **An external tool is checked before it is created.** Canvas resolves an LTI
  module item by its launch URL, and when no installed tool claims that URL it
  substitutes a placeholder with id 0, returns 200 and hands back an item that
  looks ordinary and fails only when a student clicks it. Push now probes the
  URL first, and on no match warns, names the tools that are installed, and
  creates the item anyway, because a broken item with an explanation beats
  content that disappears. A course-level LTI 1.1 install still cannot be
  rebuilt from the repository — Canvas never returns a tool's `shared_secret` —
  and the rollover guide now says so and points at the account-level install
  that does survive.
- **Quiz and external-tool items render as themselves.** Both have empty bodies
  and used to come out blank. The preview site and the PDF and DOCX exports now
  give each one a type card and a line saying the item is managed in Canvas, in
  whichever language `course.config.yml` sets.
- **Deleting an assignment no longer deletes a quiz.** A graded Classic Quiz is
  two objects in Canvas — the quiz that holds the questions, and an assignment
  that holds its gradebook column — and the second one is returned by the
  assignments API like any other assignment. `DELETE` on it deletes the quiz,
  its questions and every submission with it, verified against a live course. So
  `reset-canvas` was destroying every graded quiz it found while printing
  "Quizzes, discussions and announcements are left alone", and
  `push --prune-canvas` would do the same to any item whose local file said
  `canvas_type: assignment` for an id Canvas holds as a quiz. `reset-canvas` now
  skips those assignments, names them, and keeps them out of the count of what
  it is about to delete; `push --prune-canvas` refuses to delete one and reports
  the mismatch instead of resolving it with a delete. A check that cannot be
  made is a refusal too. The new `isQuizBackedAssignment` reads
  `is_quiz_assignment` and `quiz_id`; practice quizzes never appear among the
  assignments, and a New Quiz is genuinely an assignment, so neither is covered.
- **`reset-canvas` no longer claims that grades survive it.** Both the command's
  own warning and [`docs/advanced-commands.md`](docs/advanced-commands.md) said
  grades were left alone, while the command deletes every assignment in the
  course — which takes its gradebook column and the student submissions on it.
  Quizzes, discussions, announcements and rubrics do survive, and still say so.
- **A sync state describing another Canvas course is refused.** Nothing compared
  `.canvas-sync.json`'s `course_id` against `CANVAS_COURSE_ID`, so a sync file
  left over from a sandbox — or from a one-off run against a second course — was
  used silently against whichever course `.env` named. Most of the damage stayed
  inside the current course: every id is scoped to `/courses/:id/`, so an update
  404s and push's stale-id recovery recreates the content, duplicating the whole
  course. One id is not scoped, though. Canvas file ids are global, so
  `DELETE /api/v1/files/:id` reaches a file in whichever course owns it, and
  both `push --prune-canvas` and a renamed binary in `_files/` call it — a
  delete landing in a course the run was never pointed at. Every command that
  reads sync state now refuses while the two disagree, names both courses, and
  gives the two ways out; the check also covers `CANVAS_API_URL`, where a
  matching course id on a different instance is a different course. A file that
  claims no course contradicts nothing and is stamped from the environment
  instead. `init` is the exception that still reads such a file, because it is
  the repair: it drops the old course's module, file and icon ids rather than
  filing them under the new course id, which is what it used to do.
- **`pull` no longer overwrites files it cannot judge.** With no
  `.canvas-sync.json` to compare timestamps against — right after
  `reset-sync-state`, or on a clone that has never synced — every local file
  counted as unmodified, so the guard meant to protect your writing never fired
  and the first pull behaved exactly like `--force`, with no prompt and no
  warning. "Cannot tell" is now its own answer: such a file is skipped, with the
  reason printed, and only `--force` overrides it. Pull also prints the backup
  hint before it writes, and asks first when `--force` meets a `course/` tree
  that already holds markdown with no sync state to judge it by.
- **Deleting an assignment now says that it deletes the grades too.**
  `push --prune-canvas` and `reset-canvas` both call `DELETE` on the assignment
  object, which takes its gradebook column and every submission on it, and the
  prune listing showed a semester of graded work as an ordinary filename. Both
  now read `has_submitted_submissions`, flag the assignments that hold student
  work, and name those grades in the confirmation question itself. A check that
  fails reports "could not determine" and never passes for "no submissions".
- **Deleting a discussion now says what goes with it.** Discussions became a
  synced type in this release, and prune treated one as content with nothing
  behind it. Canvas grades a discussion by putting an Assignment behind the
  topic and keeping the grades there, so `push --prune-canvas` was deleting a
  gradebook column, every grade in it and every reply in the topic while the
  listing showed the file as an ordinary path. Prune now resolves the assignment
  behind each doomed topic, flags the item, counts it in the warning above the
  confirmation, and — because deleting a topic deletes the replies whatever its
  grading — names the reply count of an ungraded topic as well, saying outright
  that no grades are at stake in that one. A topic it cannot read counts as
  unknown rather than safe, and so does one that says it is graded but whose
  assignment Canvas does not list. The whole check still costs one submission
  lookup per run, and none at all when every doomed discussion turns out
  ungraded. The summary line counts "items" once a discussion is in it, because
  it is no longer counting assignments.
- **`reset-canvas` names the New Quizzes it deletes.** A New Quiz is an
  LTI-backed assignment with no separate quiz object behind it, so the guard
  that spares a Classic quiz's shadow assignment does not catch it — and should
  not, because this project manages a New Quiz as the assignment it is. It is
  deleted with the rest, which takes its questions and every submission on it,
  and nothing in the repository could rebuild the questions, while the line
  above the count promised that quizzes are left alone. Nothing changes about
  what gets deleted: the summary now names each New Quiz and says which kind of
  quiz that promise covers. `push --prune-canvas` still lists one as the
  ordinary assignment it is, which is written down in
  [`docs/roadmap.md`](docs/roadmap.md).
- **`push` now warns when it changes a field that moves grades already given.**
  `points_possible` leaves the raw scores untouched, so a new denominator shifts
  every percentage in the column; `due_at` re-runs the late policy over graded
  submissions; and `submission_types` is ignored outright once anyone has
  submitted, while the push still reports success. Canvas's web editor warns
  about all three, its API does not. Each warning names the assignment and both
  values, and `--dry-run` gets it too — the only moment the warning arrives
  before the change instead of with it. Nothing is blocked: only the author
  knows whether a re-weighting is deliberate.
- **A second push no longer cancels a Pages deployment that is halfway through
  publishing.** The deploy workflow shared GitHub's `pages` concurrency group
  but set `cancel-in-progress: true`, so two pushes in quick succession could
  kill a publish mid-flight and leave the site unpublished — after which every
  later run went green while the address served GitHub's "Site not found" page.
  [`docs/hosting.md`](docs/hosting.md) now covers that symptom too: how to read
  the deployment's own status, and the off-and-on-again that clears it when a
  publish hangs on GitHub's side.
- **The documentation now says what the tool does not do, and how to back up a
  Canvas course before finding out.** The only statement of unsupported Canvas
  types anywhere in the project used to be one line inside a pull FAQ, and a
  search of the whole repository for "backup" returned a single hit, about
  GitHub. [`docs/limitations.md`](docs/limitations.md) is the honest list — the
  four types that sync, quizzes being import-only through a QTI package, the
  one-level nesting limit that drops a sub-subfolder without a warning, the
  reasons push and pull are not a merge — and
  [`docs/backups.md`](docs/backups.md) has the three ways to protect a course
  first. Three statements that were simply wrong are corrected: pull does not
  preserve extra frontmatter (now it does, see below), `reset-sync-state` does
  prompt, and `lock_at`/`unlock_at` never reached Canvas (now they do).
- **A plain `push` rebuilds the item list of every module it manages, and that
  is now written down.** The pages and assignments survive, but the module item
  ids change on every push, so a direct link to one goes stale. Also new: `push`
  warns and asks before its first push to a Canvas course that already holds
  content, `reset-canvas` lists what the course contains before asking rather
  than prompting blind and gained a `--dry-run`, and the `--prune-canvas` prompt
  points at the backup guide.
- **Assignment `lock_at` and `unlock_at` are pushed.** Both were documented in
  three places and written back by `pull`, but neither string appeared in the
  push path, so the dates round-tripped locally and never reached Canvas.
- **`pull` no longer drops frontmatter keys it does not recognise.** It rebuilt
  each file's frontmatter from the Canvas response, so `export: true`, a
  `lesson:` number, or anything else you had added disappeared the moment pull
  rewrote the file. Canvas stays authoritative for the fields it owns —
  including clearing a due date you cleared in Canvas — and every other key is
  carried over.
- **`docs/first-course.md` starts from a computer with nothing installed.** The
  stated audience is colleagues who have never opened VS Code or a terminal, but
  nothing linked to code.visualstudio.com, `docs/vscode.md` opened on a command
  that needs the `code` CLI on `PATH` without saying how to get it, and Node.js
  got one sentence. The new walkthrough runs from installing the three programs
  to a published module, entirely inside VS Code's built-in terminal.
  `git-and-github.md` is now the concept explainer it was always trying to be,
  and the triplicated "Use this template" steps are gone.
- **The getting-started module is rebuilt around what you are doing rather than
  what the tool can do.** Understand, write, organise, work in VS Code, publish,
  export, save, automate, practise — with a new page on backing Canvas up before
  the page that shows you how to push. It also exercises more of the pipeline
  than before, since it doubles as the end-to-end sync test: three text headers
  instead of one, an assignment carrying all three date fields, a page carrying
  a live `export: true`, and pages that link to pages.
- **`course/index.md` is the project's landing page upstream, and a course home
  everywhere else.** This repository publishes its own `course/` to GitHub
  Pages, so that file is what a stranger sees first; it now says what Canvas
  Course Builder is and why it is worth a semester. Because the same file ships
  to every course built from the template, `npx course setup` now offers the
  language-matched `templates/course-index-*.md` alongside the README and
  course-context templates (`--course-home copy|keep`), so no course
  accidentally publishes a pitch for the tooling to its own students.
- **The lesson workflow points at the design chain it was always built on.**
  `course-context.md` has run goals, assessment, pedagogy from the start, and
  `/evaluation-design` already refused to test what no lesson practised — but
  `docs/lesson-workflow.md` diagrammed idea → plan → module → push and put
  assessment structurally last, below the retro. Assessment moves up, the page
  opens on the chain, and both sources are cited. `/lesson-module-build` and
  `/quiz-build` contained the word "goal" zero times; both now close Phase A by
  reporting the work against the goals it serves. Nothing is enforced: a course
  with no goals still runs the whole pipeline, and is offered
  `/course-context-init` once.
- **`docs/`, `README.md` and `AGENTS.md` finally have a register.**
  `writing-style.md` assigned registers by path and covered `course/`,
  `evaluations/` and `sources/`, which left the project's own documentation
  governed by nothing — which is why drift went unnoticed and why `/proofread`
  could not pick a register for a file under `docs/` without asking. All four
  style baselines now say those files belong to the tooling project and are not
  the course author's to restyle. Separately, the skill-authoring reference
  moved out of `ai-assistants.md` into
  [`docs/writing-skills.md`](docs/writing-skills.md): the page switched from
  addressing a course author to addressing a skill author halfway down, without
  signposting it.

- **Publishing to GitHub Pages is now a repository setting, and
  `npx course setup-pages` is gone.** That command wrote your site's public
  address into `docusaurus.config.js`, a file no upstream update protects, so a
  published course could lose its `url` and `baseUrl` at a conflict prompt and
  redeploy every page under the wrong path, with nothing failing to say so.
  GitHub Pages already knows the address of the repository a build runs in, so
  the deploy workflow reads it from there and hands it to the build, and
  `.github/workflows/deploy.yml` ships with the project rather than being
  generated per course. Nothing in your repository names your site any more. Set
  **Settings > Pages** to "GitHub Actions" and push; a custom domain works the
  same way, entered on that page and read back at build time. Until you switch
  Pages on, the workflow starts on each push and skips, so a course that never
  publishes collects skipped runs rather than failed ones. If you already
  publish, follow
  [Publishing moved out of `docusaurus.config.js`](docs/updating-your-project.md#publishing-moved-out-of-docusaurusconfigjs-one-off)
  and take upstream's version of both files.
- **`/translate` puts a document or a passage into another language.** A source
  note in one language, a page a colleague needs in another, a fragment pasted
  mid-conversation: the request came up often enough, and every time the answer
  was improvised, which is how a translation ends up sounding like one. The
  skill infers the source language, proposes the course language as the target
  when the source is not already in it, and takes its register from the source
  rather than from a fixed rule — `writing-style.md` governs when the target is
  the course language, ordinary usage of the target language when it is not.
  Code, identifiers, links, and alert markers come through the pass untouched,
  while headings, link text, alt text, and captions are translated. Before it
  reports anything it checks the result against the original claim by claim, so
  no fact, number, or hedge is added or lost, then reads the translation on its
  own for the calques and the borrowed sentence rhythm that give a translation
  away. Fragments come back in chat; for a file it asks where to write, and it
  says so when a translated copy under `course/` would reach Canvas as a second
  page.
- **The export-style skills are now `/export-style-init` and
  `/export-style-update`.** Every skill that configures a single artefact now
  answers to the same two verbs: `init` builds the thing from scratch, `update`
  changes what is already there. `writing-style-*` and `course-context-*`
  already worked that way; `/export-style-create` and `/export-style-edit` were
  the last pair with a vocabulary of their own, so reaching for them meant
  remembering which verb their author had picked. Nothing else changed — same
  phases, same files, same plain-language triggers — and an upstream update
  removes the old folders, so you are not left with two skills answering the
  same request.
- **`/course-context-update` folds a session's decisions into the course
  context.** The style guide had `/writing-style-update` to catch corrections
  you made while working; the course context had only `/course-context-init`, so
  a learning-goal notation or a scope boundary you settled mid-session had
  nowhere durable to land and the next skill run asked about it again. The new
  skill sweeps the conversation, clusters what it finds against the document's
  own headings — whatever language they are in — and either fills a section
  still on `TODO` or replaces a fact the conversation overtook. It proposes
  every edit before applying it, never reorders the backward-design sections,
  and hands writing-style corrections to `/writing-style-update` rather than
  writing them itself. `/issue-fix` and `/lesson-retro` now route to it too.
- **The course context explains itself in a tip.** The three paragraphs of
  meta-explanation that opened `context/course-context.md` — what the file is,
  how to fill it in, why it belongs in `protected_files` — now sit in a `[!TIP]`
  at the top, like the README template and the style guide. The document itself
  starts at its first real section.
- **Course-context templates, in English and Dutch.**
  `templates/course-context-en.md` and `templates/course-context-nl.md` give the
  course-context document the same shape as the README and the style guides:
  language variants in `templates/`, the English one pre-installed as
  `context/course-context.md`. A Dutch-language course no longer starts by
  translating the scaffold before it can fill it in.
- **The course context follows backward design.** `context/course-context.md`
  gained a Learning goals section and an Assessment section, and its sections
  now run in the order a course is actually designed: what students should be
  able to do, how you will know they can, then how they get there. Learning
  goals used to be one clause inside the Pedagogy comment, and assessment was
  nowhere, which is why `/evaluation-design` asked you for exam format,
  weighting and allowed aids on every single run. Both new sections ship as
  `TODO` like the rest, so nothing breaks if you leave them empty, and
  `/course-context-init` now interviews you about them.
- **Courses name themselves.** `course.config.yml` gains `title` and `tagline`.
  The title heads the preview site and its navbar, and titles any PDF or DOCX
  export covering the whole course, filename included
  (`exports/programming-fundamentals.pdf` rather than `exports/course.pdf`); a
  module export now prints the course name under the module's title on the
  cover. The tagline subtitles those same covers. The point is where the setting
  lives: `docusaurus.config.js` belongs to the tooling project and is
  overwritten on update, `course.config.yml` is protected. Existing projects
  need two small steps — see
  [The course title moved](docs/updating-your-project.md#the-course-title-moved-into-courseconfigyml-one-off).
- **The style guide and course context moved to `context/`.** `docs/style.md`
  and `docs/course-context.md` are not documentation: they are per-course files
  you own and AI assistants read, and everything else in `docs/` belongs to the
  tooling project and gets overwritten on update. They now live in `context/`,
  which makes that split visible in the file tree, and the style guide is called
  `context/writing-style.md` so that nothing mistakes it for an export style.
  Existing projects need a one-off manual move, because a protected file that
  changes location is the one case the update script cannot prune safely — see
  [Moving to `context/`](docs/updating-your-project.md#moving-to-context-one-off).
- **A Dutch course README template.** `templates/README-course-nl.md` joins the
  English one, so a Dutch-language course no longer starts by translating its
  own README. The English template moved to `templates/README-course-en.md` to
  match the language suffix every other per-language template carries; the old
  path is pruned automatically on your next update.
- **A US-English style baseline.** `templates/writing-style-en-us.md` joins the
  three existing baselines. The English one prescribes UK spelling, which meant
  a US instructor had to edit the guide before it was usable and any AI
  assistant reading it kept writing "colour". The new file is the same guide
  with US spelling, the serial comma mandated rather than left to the author,
  and a US grade level in place of CEFR B2. Nothing changes for existing
  projects: the shipped `context/writing-style.md` is still the UK-spelling
  baseline, and the two files point at each other.
- **Issue forms, a pull-request template, a security policy and a code of
  conduct.** Reporting a bug on the upstream project now walks you through the
  fields that make a report useful, and security problems have a private channel
  instead of a public issue. Because GitHub copies the whole template, these
  files also land in your course repository; each says which project it applies
  to, and
  [Files that belong to the tooling project](docs/customization.md#files-that-belong-to-the-tooling-project)
  explains how to drop them if you would rather not carry them.
- **Prettier and ESLint.** `npm run format` formats the repo and `npm run lint`
  reports defects; both are checked in CI. Formatting now includes markdown, so
  `npm run format` will also rewrap your own course prose at 80 characters — see
  [Keeping your course files tidy](docs/user-guide.md#keeping-your-course-files-tidy)
  for why that is usually what you want, and how to opt out if it is not.
- **The tooling moved from the Unlicense to the MIT licence.** Course content
  keeps its own licence in `course/LICENSE.md`. MIT asks that the copyright
  notice stays with the code, so leave `LICENSE` in place if you publish your
  course repository.
- **No more bundled Century Gothic.** The `thomas-more` style still asks for it
  first, but the font files are gone: on Windows, Office already installs the
  typeface where Typst finds it, and on macOS the exporter now looks inside the
  Office application bundles, which is where Office hides its fonts. Where
  Office is absent, headings fall back to Nunito, which ships with the style
  under the SIL Open Font License and matches the `thomas-more` theme on the
  web.
- **Attribution for the alert icons.** They are GitHub Octicons (MIT) and one
  Google Material Symbol (Apache 2.0); both licences now ship in
  `src/svg-icons/` and are recorded in `THIRD-PARTY.md`.
- **Neutral defaults for the look.** A new `generic` export style
  (Helvetica/Arial, GitHub's alert palette, a "Built with Canvas Course Builder"
  watermark) and a `github` theme are now the shipped defaults. The Thomas More
  style and colours remain as `thomas-more`, selectable but no longer default.
- **`theme` and `export.style` in `course.config.yml`.** Colour and PDF/DOCX
  layout became two independently selectable axes; `--style` on
  `npx course export` overrides the layout for one run.
- **One source of truth for colour.** A theme file in `src/css/themes/` now
  feeds the preview site, Canvas HTML, the alert icons, and PDF exports. DOCX
  still carries its colours in `reference.docx`.
- **`templates/export/` moved to `export-styles/`**, split into one folder per
  style plus the shared pandoc pipeline files. Overrides in
  `sources/export-style/` keep working unchanged.

## 1.0.0 — 2026-08-10

Initial public release: markdown course authoring with Docusaurus preview,
Canvas LMS push/pull/status sync, PDF and DOCX export with customizable styling,
a VS Code extension, bundled AI skills for lesson design and quality checks, and
a template-update mechanism that protects your course content.
