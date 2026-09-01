# Ideas List

Possible future skills and features. These are ideas, not plans: nothing here is
scheduled, and none of it is a commitment from the maintainer. If one of them
would help you, there are two good routes:

- Build it and open a pull request; see [Contributing](contributing.md).
- Ask your AI assistant to build the skill for your own course. See
  [Writing your own skills](writing-skills.md). Most of the skill ideas below
  are within reach of a single AI-assisted session.

## Skill Ideas

All would follow the established pattern: read
[`course-context.md`](../context/course-context.md) and
[`writing-style.md`](../context/writing-style.md) first, design-then-write
phases, no auto-commits, and an `<object>-<verb>` name so the skill sorts with
its relatives (see [Writing your own skills](writing-skills.md)). The names
below are provisional; they firm up when someone builds one.

### Course Quality

- **`/accessibility-pass`**: alt-texts present and meaningful, heading
  hierarchy, contrast in embedded images, link texts that work for
  screenreaders. Canvas's own checker is weak; doing it at the markdown source
  is more durable.

### Teaching Cycle

- **`/semester-plan`**: map lessons onto the academic calendar (holidays, exam
  weeks), propose which lesson lands on which date, generate a schedule page.
  Re-run when a lesson is cancelled.
- **`/announcement-draft`**: draft the weekly "what changed / what's coming"
  student announcement from the git log and the calendar; push as a Canvas
  announcement (needs a small `lib/canvas/announcements.js`, the API is simple).

### Content Intake

- **`/slides-import`**: convert an existing slide deck or PDF (most courses
  start from a pile of these) into a draft module: one page per topic, images
  extracted, speaker notes as prose. Big adoption lever; hard to do well.
- **`/module-import`**: restructure a legacy course-page dump, for example
  content scraped from another LMS, into Coursewright conventions: numbering,
  frontmatter, link rewriting.

### Meta

- **`/academic-year-rollover`**: interactive wrapper around the
  [new academic year](new-academic-year.md) guide: archive the previous year's
  `evaluations/` folder, reset sync state, update dates in homework frontmatter,
  re-run `/course-context-init`.

## Feature Ideas

### Content Templates

Extend `npx course new-item` with template options: lab assignment, reading
assignment, lecture notes, quiz instructions, and so on. Templates would provide
pre-filled frontmatter and boilerplate markdown tailored to common course item
patterns.

### Handouts Published on the Website

The website and the export are built from the same tree and never meet: a
student gets the handout only when you send it. The deploy workflow could run
`npx course export` per module and place the PDFs in the built site, so every
module page links its own printable version and both stay current on every push.
The costs are real: pandoc and Typst installed in the workflow, a slower deploy,
and fonts. A CI runner has none of the machine-licensed typefaces the exporter
finds locally, so a style leaning on Office fonts falls back to what it bundles
(`thomas-more` to Nunito), and the published handout may not match the one
exported at home.

### EPUB Export

pandoc already writes EPUB, and the export pipeline is pandoc with a per-format
mapping in `filter.lua`: Typst calls for PDF, custom styles for DOCX. EPUB would
be a third branch: a stylesheet in place of a template, the theme's colours
injected as CSS custom properties the way Typst gets them as variables, and a
decision per div kind, where alerts and link cards map well and a page break
means nothing in reflowable text. The use case is course texts on phones and
e-readers, which neither PDF nor DOCX serves.

### One Export per Module in One Run

`npx course export` produces one document per run: an item, a module, the whole
course, or a curated selection, always combined. A `--split` flag would loop the
modules and write one file each, named the way a module export already is.
Mostly plumbing: the per-module path exists, and what is new is the loop, the
output naming, and one report over all of it. Pairs naturally with publishing
handouts on the website.

### A Frozen Site per Academic Year

The website shows the current state of the default branch, which is right during
the year and wrong the day you start rewriting for the next one: returning
students' links suddenly point at material they never had. A rollover step could
deploy the year's final build to a subpath (`/2526/`) and keep the root for the
current year. Docusaurus's own versioning is the heavy answer, a full copy of
the docs per version inside the repo; the light one is archiving built sites,
which costs the deploy workflow fetching each archived build and laying it under
the fresh one on every publish, plus the `baseUrl` juggling per subpath.

### Built-In Site Search

Docusaurus ships search only as Algolia, an external service with an application
process. `npx course search` covers the author; students on the website have
nothing. A local-search plugin (the `docusaurus-search-local` family) indexes at
build time and runs entirely in the browser, which is exactly what a GitHub
Pages site can host. The open questions are index size on a large course and
result quality per course language, which depends on the plugin's stemmer
support; the lunr family does carry a Dutch one.

### Relinking Existing Canvas Objects

An `npx course relink` command would pair local files with the Canvas objects
that already exist and record the links, rewriting no file bodies at all. `push`
and `pull` already do most of that on their own: an item with no row in
`.canvas-sync.json` is paired with the Canvas object of the same type and title
in the same module, for every type, and the pair goes into the sync state
(`planAdoptions` in `lib/sync/plan.js`). A command would close three gaps.
Adoption matches within one module, so an object sitting in no module at all is
invisible to it. It matches on an exact title, so a page renamed on one side
only is created a second time rather than claimed. And it refuses an ambiguous
pair rather than asking, which leaves a hand-edited row in `.canvas-sync.json`
as the only way through (see
[Frontmatter](frontmatter.md#adopting-an-item-you-made-by-hand-in-canvas)).
Adoption also happens inside a run that is already writing; a command would let
you see the pairs and settle them before anything is sent.

The rollover in [New academic year](new-academic-year.md) wipes the new Canvas
course and rebuilds it from local markdown, which carries pages, assignments,
discussions and files but not a quiz's questions and not an LTI installation.
Canvas's own Course Copy carries both, and it is the only way to carry a
course-level LTI 1.1 installation across at all, because the Canvas API never
returns `shared_secret`. Adoption saves Course Copy followed by `push` from
duplicating everything, since it claims what it can pair, but the discussions
the copy leaves behind are exactly what adoption cannot reach: `reset-canvas`
spares them and no module item points at them. Course Copy followed by `pull`
still overwrites the local markdown. `relink` is the missing third option that
would make Course Copy a first-class rollover path.

### More Item Types for `new-item`

`VALID_TYPES` in `cli/new-item.js` lists the six things the command can
scaffold: `page`, `assignment`, `discussion`, `url`, `subsection` and `file`.
That list is the single place deciding what `new-item` creates, and it is two
types behind what push and pull handle: a `quiz` reference and an
`external_tool` have to be written by hand today. Both are references to a
Canvas object rather than content, so scaffolding one means asking for the thing
it points at, `quiz_ref` or a launch URL, and neither is much use until the
object exists in Canvas. One inconsistency belongs in the same change:
`new-item -t file` copies a raw binary into the module folder rather than
generating the markdown wrapper with `file_ref` that pull writes, so the wrapper
form is currently pull-only or hand-written.

### Automated QTI Import

Canvas accepts a QTI zip through `POST /api/v1/courses/:id/content_migrations`
with `migration_type=qti_converter`, and `settings[insert_into_module_id]` and
`settings[insert_into_module_position]` place the result directly in a module.
`settings[overwrite_quizzes]` addresses the duplicate-on-reimport problem that
the [`/quiz-build`](ai-assistants.md) skill warns about. The cost is real: it
needs a `progress_url` polling loop, and nothing in `lib/canvas/` polls anything
today (`sleep()` in `lib/canvas/client.js` is not even exported), plus the
`pre_attachment` upload handshake, and the migration does not hand back the new
quiz id.

### Bundling dotenv into the Extension

The extension parses `.env` itself, in `helpers.js`, while every CLI command
reads that same file through `dotenv`. Shipping a copy of dotenv inside the
`.vsix` would delete the second reader: `readEnvConfig` collapses to a wrapper
around `dotenv.parse`, and the corpus that currently proves the two agree stops
being necessary, because there would only be one of them. The runtime is about
16KB with targeted `.vscodeignore` negations, against a 50KB package.

It was considered and declined, on two counts. A missing dependency at
activation is not a degraded feature, it is the whole sidebar failing to load.
And `node --test` cannot see that coming: it resolves `dotenv` against the
repository's own `node_modules`, so a packaging mistake passes the full suite,
both CI platforms and lint, then throws once installed. The
[extension-host smoke test](tests.md#the-extension-host-smoke-test) has since
closed that hole: `npm run test:vscode` installs the packaged `.vsix` outside
the repository, so a dependency missing from the package fails visibly. That
answers the second objection and leaves size as the remaining cost.

What would still tip the decision: a `.env` shape the hand-rolled reader
deliberately omits (its docstring lists them) turning up in a real course, since
extending the reader then costs more than the dependency does.

Copying dotenv's `parse` into `helpers.js` instead, with attribution, is a third
option and a worse one: exact parity with no packaging step, but a fork with no
update path, so the maintenance moves rather than goes away.
