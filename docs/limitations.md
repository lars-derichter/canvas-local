# What Canvas Course Builder Does Not Do

Canvas Course Builder is opinionated. It expects one folder layout, treats your
markdown as the source of truth, and holds the full content of only some of the
things a Canvas module can hold. That is what makes it small enough to trust,
but it also makes it a poor fit for some courses, and you should find that out
now rather than in week six.

Read this before you commit a semester to it. Everything below is a description
of how the tool works today, not a list of bugs.

## Which Canvas Types Sync, and How Much of Them

Every type of item a Canvas module can hold now crosses in both directions. What
differs is how much of it crosses.

| Canvas type               | Push | Pull | What crosses                                    |
| ------------------------- | ---- | ---- | ----------------------------------------------- |
| Page                      | yes  | yes  | the whole thing: title and body                 |
| Assignment                | yes  | yes  | title, body, and the fields listed below        |
| Discussion                | yes  | yes  | title, message body, and its posting settings   |
| File                      | yes  | yes  | the binary itself                               |
| External URL              | yes  | yes  | the link and its place in the module            |
| Quiz                      | yes  | yes  | a reference: which quiz sits where in a module  |
| External tool (LTI)       | yes  | yes  | a reference: the launch URL and its place       |
| Text header (`SubHeader`) | yes  | yes  | the heading, generated from your subfolder name |

Two of those rows are the ones to read twice. **A quiz and an LTI link are
references, not content.** The markdown file says which Canvas object goes where
in a module; it does not hold the object. Push never creates, updates or deletes
a quiz or an LTI tool, and pull writes a frontmatter-only file for either. A
page, an assignment and a discussion are the opposite: the markdown file _is_
the content, and pushing it rewrites what Canvas holds.

Push skips an unknown `canvas_type` with a warning; `npx course validate`
rejects one before you get that far.

Announcements, rubrics, outcomes, groups, the syllabus page and course settings
are outside the tool entirely: none of them is a module item, and modules are
what this tool reads and writes.

## Quiz Questions Never Sync

The quiz's place in a module syncs. Its questions do not, in either direction.

Nothing here writes to a quiz: no create, no update, no delete. Push reads the
course's quiz list to find the one a module item points at, places the item, and
stops. The [`/quiz-build`](ai-assistants.md) skill generates a QTI 1.2 `.zip`
that you import through the Canvas web interface by hand, and Canvas has no API
for that import, which is why it stays a manual step.

How push decides which quiz an item means:

1. The `canvas_id` in the frontmatter, if that quiz is still in the course.
2. Otherwise a quiz in the course whose **title** matches the item's title. Push
   writes the id it found back to the frontmatter, so it only has to look once.
3. Otherwise the item is skipped, and push prints the QTI import procedure,
   naming the `.zip` in `quiz_ref`.

Two quizzes sharing a title is ambiguous: push warns, names both ids, and skips
the item rather than guess which one your students should get.

What that leaves you with:

- **Import is manual and one-way.** Nothing pulls a quiz back into markdown. A
  quiz pulled from Canvas becomes a reference file with no `quiz_ref`, and
  `validate` warns about exactly that, because a quiz with no local package is
  the one a rollover cannot rebuild.
- **Re-importing duplicates.** A second import creates a second quiz; delete the
  old one yourself, or push cannot tell them apart by title.
- **Six question types.** Multiple choice, multiple answers, true/false, short
  answer, numerical, and essay. Matching, ordering and hotspot questions have to
  be rephrased or downgraded.
- **QTI carries no dates or time limit.** Set availability and the time limit in
  Canvas after importing.

If your course leans heavily on Canvas quizzes, this tool carries their place in
the course and nothing else.

## An LTI Install Cannot Be Rebuilt From This Repository

An `external_tool` item is a launch URL in a module. Canvas resolves which
installed tool answers that URL every time a student clicks it, which is why the
item survives a rollover while a stored tool id would not: the URL still means
something in next year's course.

What does not survive is the installation itself. Canvas never returns an
external tool's `shared_secret` from the API, so a **course-level** LTI 1.1
install cannot be recreated from anything in this repository. Two ways round it:

- **Ask your Canvas admin to install the tool at account level.** A course
  resolves a tool by searching itself and then its account chain, so an
  account-level install is present in every course you will ever be given. This
  is the durable fix.
- **Seed the new course with Canvas's own Course Copy**, which carries the tool
  installation across. It is the only path that carries a course-level secret.

Canvas fails silently when a launch URL matches nothing: it accepts the item,
returns a 200, shows a normal-looking module item, and produces "Couldn't find
valid settings for this link" the first time a student clicks it. So push asks
Canvas first whether any installed tool claims the URL. When none does, push
warns, names the tools that _are_ installed, and creates the item anyway. A
visible broken item you can fix beats content dropped on the floor.

## A Plain Push Rebuilds the Module's Item List

This one surprises people, so it is worth stating plainly.

Every `npx course push` deletes and recreates all module items in the modules it
manages. The underlying pages, assignments and files survive — a module item is
a link, not the content — but the consequences are real:

- **Module item ids change on every push**, so direct links of the form
  `/courses/123/modules/items/456` go stale. Link to pages, not to module items.
- **Anything you add by hand in Canvas stops the push of that module.** Before
  it clears a module, push compares what Canvas holds in it against what
  `course/` accounts for. A quiz you placed there, a discussion, an LTI link, a
  page that is not in your repository: push names them, leaves the module
  exactly as it is, carries on with the other modules, and ends the run with a
  non-zero exit status. Nothing is dropped silently.

Two ways out of a refusal, both in the message push prints:

1. **Keep the items.** Add a file under the module's folder for each one,
   carrying the matching `canvas_type` and `canvas_id` in its frontmatter (see
   [frontmatter](frontmatter.md)), and push again. From then on they are yours
   to edit like any other item.
2. **Move them in Canvas** into a module this project does not manage.

`--dry-run` reports the same refusal without touching Canvas, and exits non-zero
too.

The guard has three edges:

- **Text headers are exempt.** Push regenerates them from your subfolders, so
  one added by hand in Canvas is replaced without warning.
- **A page list it cannot read refuses the module.** Matching a module item's
  page slug against the page id in your frontmatter needs the course's page
  list; when that request fails, push refuses rather than guess.
- **A plain binary in a module folder claims its Canvas id through
  `.canvas-sync.json` alone**, having no frontmatter to hold one. A module push
  can still identify while that state is missing therefore reads every binary in
  it as Canvas-only, and refuses. That combination is not exotic: the module's
  `canvas_module_id` lives in `_category_.json`, which is committed, while
  `.canvas-sync.json` is gitignored — so a fresh clone of a course that has been
  pushed is exactly it. A full [`reset-sync-state`](advanced-commands.md) does
  _not_ produce this, because it strips the module id too: push then finds no
  module to protect and creates a second one alongside the first.

The rule of thumb is unchanged: a module this tool manages is generated output.
Anything you want to keep in it belongs in `course/`.

Two smaller cases where a plain push deletes something real:

- Renaming a binary in `_files/` uploads the new one and deletes the old Canvas
  file.
- `push --prune-canvas` deletes the Canvas modules, pages, assignments,
  discussions and files whose local counterparts you removed. It lists them and
  asks first, and flags the items that hold student work — an assignment with
  submissions, a graded discussion, a discussion with replies in it; see
  [Destructive operations and student work](#destructive-operations-and-student-work).

## Destructive Operations and Student Work

Three commands delete things on Canvas: an ordinary `push`,
`push --prune-canvas` and `reset-canvas`. What separates them is not how much
they delete but which kind of object they delete, and only one of those kinds
takes student work with it.

- **Deleting a module item is safe.** A module item is a link. Removing it
  leaves the page, assignment or file it pointed at exactly where it was, with
  its gradebook column and its submissions untouched. That is all an ordinary
  push does to the modules it manages.
- **A quiz and an LTI link are only ever unlinked.** `push --prune-canvas` and
  `reset-canvas` remove the module item for either one and stop there: the quiz,
  its questions and every submission on it stay in Canvas, and so does the tool
  installation that other courses launch. Neither is this project's to delete.
- **A discussion is deleted like a page.** It is authored content here, so
  `push --prune-canvas` deletes the topic itself when you delete its local file,
  and the replies go with it. `reset-canvas` leaves discussions alone.
- **Deleting an assignment is not.** `push --prune-canvas` calls `DELETE` on the
  assignment object itself, and Canvas takes its gradebook column and every
  submission on it. Canvas's `/undelete` sometimes brings the assignment back;
  the submissions frequently do not come with it, so the grades are gone for
  good.
- **`reset-canvas` does that to every assignment in the course**, alongside
  every module, page and file — except the assignments that are really quizzes,
  below. See [Advanced commands](advanced-commands.md#reset-canvas).
- **Some assignments are quizzes.** A graded Classic Quiz is two objects: the
  quiz that holds the questions, and an assignment that holds its gradebook
  column. Canvas returns that assignment from the assignments API like any other
  (`is_quiz_assignment: true`, with the quiz's id in `quiz_id`), and a `DELETE`
  on it deletes the quiz, its questions and every submission. Neither command
  does that any more: `reset-canvas` skips those assignments and names them, and
  `push --prune-canvas` refuses to delete one, reports it as an error, and
  leaves it tracked. If a local file claimed `canvas_type: assignment` for an id
  that Canvas holds as a quiz, that mismatch is yours to settle — delete the
  quiz in Canvas if that is what you meant. A practice quiz has no gradebook
  column and never appears among the assignments, so it is never at risk.
- **A New Quiz is not covered by any of that**, and cannot be: it is genuinely
  an assignment that launches an LTI tool (`is_quiz_lti_assignment: true`, no
  `quiz_id`, no separate quiz object), so this project manages it as the
  assignment it is and both commands delete it like one. That deletes the quiz,
  its questions and every submission on it, and nothing in this repo could
  rebuild the questions — a New Quiz has no markdown source here the way an
  assignment body does. `reset-canvas` names each one it is about to delete, so
  a count of "n assignments" cannot hide it. `push --prune-canvas` does not: it
  lists the item as an ordinary assignment, which is the one place where the
  warning is thinner than the loss.

Pages and files carry no grades, so pruning one costs you the content and
nothing else — recoverable from git, or from a course export.

### Deleting a Module Folder Is Safer Than Deleting an Assignment File

The asymmetry runs the wrong way round from what you would expect:

- **Delete a whole module folder**, and prune deletes the Canvas _module_. The
  module and its item links go; the pages, assignments and files that were in it
  stay in the course, unlinked but intact, gradebook columns and submissions
  included. Prune looks for missing items only inside module folders that still
  exist, so nothing inside a folder you deleted is ever considered for deletion.
- **Delete one assignment file** from a module that still exists, and prune sees
  an item no local file claims. That is a `DELETE` on the assignment object, and
  the grades go with it.

Removing the bigger thing is the safer move. What deleting a module folder costs
you instead is orphans: assignments and pages no module links to any more, which
the tool then forgets — the sync-state entry for the module goes with the module
— and which you clean up in Canvas by hand.

### Fields That Move Grades Already Given

Push sends the whole assignment on every update, and three of the fields it
sends act on work students have already handed in. Canvas applies each one
silently: its web editor warns about them, its API does not.

- **`points_possible`** — Canvas does not rescale the grades already given. The
  raw scores stay as they are, so every percentage in that gradebook column
  moves.
- **`due_at`** — Canvas recomputes late status against the new date, so an
  automatic late policy re-applies or drops its deductions on submissions that
  are already graded.
- **`submission_types`** — Canvas accepts this change only while the assignment
  has no submissions. Once there are any it ignores the change, reports the push
  as a success, and keeps the value it holds. Frontmatter and Canvas disagree
  from then on, and nothing but the warning says so.

Push names the assignment, the field and both values, and then sends the update
anyway. Nothing is blocked: a re-weighting can be entirely deliberate, and only
you know which one this is.

### What the Warnings Tell You

Before it deletes anything that can hold grades, the tool asks Canvas whether
that content already holds student work:

- **`push --prune-canvas`** flags each doomed assignment in its listing
  (`<-- HAS STUDENT SUBMISSIONS: deletes the gradebook column and every grade in it`),
  counts them in a warning, and names them in the question itself:
  `Delete these from Canvas, including the student submissions and grades? (y/N)`.
- **A graded discussion is checked the same way.** Canvas puts an assignment
  behind the topic and the grades live on that assignment, not on the topic, so
  prune fetches the topic, resolves the assignment behind it and flags the item:
  `<-- GRADED DISCUSSION WITH STUDENT WORK: deletes the topic and its 14 replies, plus the gradebook column and every grade`.
  Once a discussion is in the count, the summary line counts "items" instead of
  "assignments", because it is no longer counting one type.
- **An ungraded discussion is flagged for its replies.** No grades are at stake,
  but deleting the topic still deletes everything students wrote in it, so a
  topic with replies in it is never listed as a bare path:
  `<-- 14 REPLIES FROM STUDENTS: no grades at stake, and deleting the topic still deletes every one of them`.
  An empty topic is listed plainly.
- **`reset-canvas`** prints the same warning and lists the assignments by name,
  plus any New Quiz among them.
  [Advanced commands](advanced-commands.md#reset-canvas) shows the full output.
- **`push`** prints one warning per changed field for each of the three fields
  above, including under `--dry-run` — the only mode where the warning arrives
  before the change rather than with it.

Two limits on all of that. A check that fails is reported as unknown, never as
safe — `SUBMISSION STATUS UNKNOWN`, or "could not determine whether 1 item being
deleted has student submissions" — and silence from a failed check is not a
clean bill of health, so treat an unknown as a yes. A topic that says it is
graded but whose assignment Canvas does not list counts as unknown for the same
reason. And the grade checks cover the two types that can carry a gradebook
column, assignments and graded discussions; a **New Quiz** is the gap, because
prune lists one as the ordinary assignment it is. Take a course export first.

All of the above is about Canvas. The tool can also destroy local work: `pull`
overwrites whole files, and `pull --force` overwrites them even when it cannot
tell your writing from Canvas's output. See
[Push and pull are not a merge](#push-and-pull-are-not-a-merge).

## The Folder Structure Is a Contract

The scanner is strict, and it is quiet about it:

- **Only top-level directories under `course/` are modules.** Loose markdown at
  the root of `course/` is ignored — including `course/index.md`, which is why
  that file appears on the preview site but never in Canvas.
- **One level of nesting, and one only.** A subfolder inside a module becomes a
  text header. A folder inside _that_ is **silently dropped**, along with
  everything in it. There is no warning and `validate` does not catch it. This
  is the sharpest edge in the tool.
- **Numeric prefixes drive order.** A file or folder without a `NN-` prefix gets
  position 0, so it sorts first and ties with every other unprefixed sibling in
  whatever order the filesystem returns. `validate` warns, but push proceeds.
  The module-management commands are stricter than push: an unprefixed module
  folder is invisible to `new-item`, `move-module`, `rename-module`,
  `delete-module` and the VS Code sidebar, while push still syncs it.
- **A leading underscore means invisible.** `_files/`, `_category_.json` and
  anything else you prefix with `_` is excluded from sync. Handy as a drafting
  mechanism; easy to trip over if you did not mean it.
- **Canvas item indent is 0 or 1.** Canvas supports five levels; this tool uses
  two.

See [User guide](user-guide.md#course-structure) for the layout the scanner
expects.

## Push and Pull Are Not a Merge

The two directions are not symmetric, and neither one reconciles concurrent
edits.

- **Pull overwrites whole files.** It regenerates the markdown from the Canvas
  HTML. It does not merge your changes with the Canvas version.
- **Conflict detection is a timestamp, not a comparison.** Pull skips a file
  whose modification time is later than the last sync. It does not look at the
  content. That has two consequences worth knowing: a fresh `git clone` sets
  every file's timestamp to checkout time, so pull will skip everything as
  "locally modified"; and push updates the last-sync timestamp too, so a file
  you have just pushed counts as unmodified and a later pull will overwrite it
  with the round-tripped Canvas version. With no sync state at all — right after
  `reset-sync-state`, or on a clone that has never synced — there is no
  timestamp to compare against, so pull skips every file that already exists
  locally and writes only the ones it is adding.
- **The round trip is lossy.** Canvas HTML becomes markdown through a converter.
  Raw HTML, anything the Canvas rich-content editor added, and formatting
  nuances are normalised away.
- **Pull restructures your working tree.** It renames module folders, subfolders
  and files to match Canvas's names and positions. Local naming and numbering
  that differ from Canvas do not survive.
- **Pull never deletes.** An item deleted in Canvas leaves the local file
  behind, and the next push re-creates it in Canvas.

The workflow the tool is built for is one-directional: write locally, push to
Canvas. Pull is for importing an existing course once, or for recovering edits a
colleague made in the web editor — not for a routine round trip.

## Which Fields Reach Canvas

Push sends `points_possible`, `submission_types`, `due_at`, `unlock_at`,
`lock_at` and `published`. Everything else in an assignment's frontmatter is
ignored: group assignments, peer review, allowed attempts, grading type,
assignment groups, and Canvas's per-section date overrides all have to be set in
Canvas.

Pages take only their title and body. A `published:` key on a page is ignored:
push never sends it, so Canvas decides, and you publish pages in Canvas or by
publishing the module.

Discussions take their title, their message body, `discussion_type`,
`require_initial_post`, `delayed_post_at`, `lock_at` and `published`. **A graded
discussion keeps its grading in Canvas only.** Points, due date, grading type
and group set belong to the assignment Canvas puts behind the topic, which this
tool never touches: they appear nowhere in the markdown, and changing them
locally changes nothing. Push and pull both say so when they meet a graded
topic. Set them in Canvas.

See [Frontmatter reference](frontmatter.md) for the fields each type accepts.

## Not a Collaboration Tool

The tool assumes one person owns the markdown. Two colleagues can absolutely
work in one repository — that is what git is for — but there is no locking, and
if you both push to the same Canvas course, the last push wins. Sort out who
owns which module the way you would sort out who owns which file.

## What to Do Instead

- **Quiz-heavy course?** Build the quizzes in Canvas, by hand or from a QTI
  package, and keep a one-file reference here for each so they hold their place
  in the module. Everything about the questions stays a Canvas job, every year.
- **Course that lives in Canvas already, edited by several people in the web
  editor?** This tool will fight you. It wants to be the source of truth.
- **Just want version control for your handouts?** Use the repository and the
  PDF export, and skip the Canvas sync entirely.
