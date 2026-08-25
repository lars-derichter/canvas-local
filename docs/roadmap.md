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

- **/accessibility-pass**: alt-texts present and meaningful, heading hierarchy,
  contrast in embedded images, link texts that work for screenreaders. Canvas's
  own checker is weak; doing it at the markdown source is more durable.

### Teaching Cycle

- **/semester-plan**: map lessons onto the academic calendar (holidays, exam
  weeks), propose which lesson lands on which date, generate a schedule page.
  Re-run when a lesson is cancelled.
- **/announcement-draft**: draft the weekly "what changed / what's coming"
  student announcement from the git log and the calendar; push as a Canvas
  announcement (needs a small `lib/canvas/announcements.js`, the API is simple).

### Content Intake

- **/slides-import**: convert an existing slide deck or PDF (most courses start
  from a pile of these) into a draft module: one page per topic, images
  extracted, speaker notes as prose. Big adoption lever; hard to do well.
- **/module-import**: restructure a legacy course-page dump, for example content
  scraped from another LMS, into Canvas Course Builder conventions: numbering,
  frontmatter, link rewriting.

### Meta

- **/academic-year-rollover**: interactive wrapper around the
  [new academic year](new-academic-year.md) guide: archive the previous year's
  `evaluations/` folder, reset sync state, update dates in homework frontmatter,
  re-run `/course-context-init`.

## Feature Ideas

### Content Templates

Extend `npx course new-item` with template options: lab assignment, reading
assignment, lecture notes, quiz instructions, and so on. Templates would provide
pre-filled frontmatter and boilerplate markdown tailored to common course item
patterns.

### Relinking Existing Canvas Objects

An `npx course relink` command would pair local files with the Canvas objects
that already exist and record the links, rewriting no file bodies at all. `push`
and `pull` now do most of that on their own: an item with no row in
`.canvas-sync.json` is paired with the Canvas object of the same type and title
in the same module, for every type, and the pair goes into the sync state
(`planAdoptions` in `lib/sync/plan.js`). Three gaps are what a command would be
for. Adoption matches within one module, so an object sitting in no module at
all is invisible to it. It matches on an exact title, so a page renamed on one
side only is created a second time rather than claimed. And it refuses an
ambiguous pair rather than asking, which leaves a hand-edited row in
`.canvas-sync.json` as the only way through (see
[Frontmatter](frontmatter.md#adopting-an-item-you-made-by-hand-in-canvas)).
Adoption also happens inside a run that is already writing; a command would let
you see the pairs and settle them before anything is sent.

The rollover in [New academic year](new-academic-year.md) wipes the new Canvas
course and rebuilds it from local markdown, which carries pages, assignments,
discussions and files but not a quiz's questions and not an LTI installation.
Canvas's own Course Copy carries both, and it is the only way to carry a
course-level LTI 1.1 installation across at all, because the Canvas API never
returns `shared_secret`. Course Copy followed by `push` is no longer the
duplicate-everything trap it was, since adoption claims what it can pair, but
the discussions the copy leaves behind are exactly what adoption cannot reach:
`reset-canvas` spares them and no module item points at them. Course Copy
followed by `pull` still overwrites the local markdown. `relink` is the missing
third option that would make Course Copy a first-class rollover path.

### More Item Types for `new-item`

`VALID_TYPES` in `cli/new-item.js` lists the five things the command can
scaffold: `page`, `assignment`, `url`, `subsection` and `file`. That list is the
single place deciding what `new-item` creates, and it is three types behind what
push and pull handle: a `discussion`, a `quiz` reference and an `external_tool`
have to be written by hand today. One inconsistency belongs in the same change:
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

### Flagging a New Quiz in a Prune

`reset-canvas` names every New Quiz it is about to delete, because that deletion
takes questions nothing in this repository could rebuild. A prune deletes one
just as thoroughly and says nothing: an item tracked as
`canvas_type: assignment` that Canvas holds as a New Quiz is listed as an
ordinary assignment, under `push --prune-canvas` and `sync --prune-canvas`
alike. The guard is not what is missing: `refuseQuizBackedDelete` in
`lib/sync/canvas-write.js` deliberately lets a New Quiz through, and rightly,
because it really is an assignment and this project manages it as one. The
sentence is what is missing.

`getSubmissionStates` in `lib/canvas/assignments.js` already fetches whole
Assignment objects, so `is_quiz_lti_assignment` is there for nothing; the map it
returns keeps only a boolean per id, so `annotateSubmissions` in
`cli/prune-warning.js` would need that map to carry the object, or a second map
beside it. `isNewQuizAssignment` and the wording in `newQuizNotice` are already
there to reuse.

### Bundling dotenv Into the Extension

The extension parses `.env` itself, in `helpers.js`, while every CLI command
reads that same file through `dotenv`. Shipping a copy of dotenv inside the
`.vsix` would delete the second reader: `readEnvConfig` collapses to a wrapper
around `dotenv.parse`, and the corpus that currently proves the two agree stops
being necessary, because there would only be one of them. The runtime is about
16KB with targeted `.vscodeignore` negations, against a 50KB package.

It was considered during the extension review and declined for now, on two
counts. A missing dependency at activation is not a degraded feature, it is the
whole sidebar failing to load. And no test can see that coming: `node --test`
resolves `dotenv` against the repository's own `node_modules`, so a packaging
mistake passes the full suite, both CI platforms and lint, then throws once
installed. Proving it works needs a check at the packaging level, which does not
exist today.

Two things would reopen it. A `.env` shape the hand-rolled reader deliberately
omits (its docstring lists them) turning up in a real course, since extending
the reader then costs more than the dependency does. Or a smoke test that
actually launches the packaged extension, which would make the activation
failure visible and leave size as the only remaining cost.

Copying dotenv's `parse` into `helpers.js` instead, with attribution, is a third
option and a worse one: exact parity with no packaging step, but a fork with no
update path, so the maintenance moves rather than goes away.
