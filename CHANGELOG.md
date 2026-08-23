# Changelog

## Unreleased

- **`npx course sync` reconciles both directions in one run.** Push regenerated
  and pull imported, and neither looked at what the other side had done since,
  so the two were never a round trip. Sync compares three things instead of two:
  what is in `course/`, what is in the Canvas course, and what
  `.canvas-sync.json` recorded at the end of the last run. That third one is
  what makes "changed here", "changed there", "changed on both sides" and
  "deleted here" four different questions with four different answers, so an
  item only you touched is pushed, an item only Canvas touched is pulled, and
  only a genuine collision has to be settled at all — by the newest change, or
  by whatever `--conflict local|canvas|ask` says. Deletion is not part of that:
  an item that has vanished from one side is reported as an orphan and left
  alone until a prune flag asks otherwise. See
  [The reconcile engine](docs/architecture.md#the-reconcile-engine).
- **Change is detected by content, not by timestamps.** Each side is hashed and
  compared against its own stored hash from the last run, and the two hashes are
  never compared with each other — Canvas rewrites markup it is handed, so a
  page can be byte-different on the two sides and unchanged on both. Neither
  hash reads a modification time, and that is what the old system got wrong:
  pull refused any file whose mtime was later than `last_sync`, and status
  called a fresh `git clone` — which stamps every file it checks out with the
  checkout time — an entirely modified course. Exactly one decision still reads
  a timestamp, the `newest` tiebreak, and only an item whose two hashes have
  both moved reaches it; push and pull never do, because pinning a direction has
  already answered that question.
- **`push`, `pull` and `status` are the same engine with one choice pinned.**
  Push writes only to Canvas and lets the local copy win; pull writes only to
  `course/` and lets Canvas win; status writes to neither and previews what a
  `sync` would do. There is no separate push algorithm and no separate pull
  algorithm any more, so the four agree with each other by construction rather
  than by four implementations happening to match, and every one of them ends
  with the same report: what was applied, what a pinned direction would not let
  it apply, what is orphaned on each side, which collisions were settled and
  how, which items were skipped and why, and what needs a person. `-m` scopes
  any of the four to named module folders, and the three that write take
  `--dry-run`. See
  [One engine, four commands](docs/user-guide.md#one-engine-four-commands).
- **Flags and commands that are gone, or that now mean something else.** Worth
  reading before you run a script that has been working. `npx course diff` is
  removed; `status` answers what it answered, against the live course rather
  than against a guess made from the local side. `status --remote` goes with it,
  and so does the offline comparison the flag opted out of — status reads Canvas
  on every run and errors when it cannot. `push --drop-canvas-only` is gone
  because nothing needs it any more. `push --prune` is now
  `push --prune-canvas`; the old spelling is still registered, but only so it
  can error with a pointer rather than with commander's bare "unknown option".
  `--prune` on `sync` means **both** directions, which is a different and larger
  thing than what it used to mean on push. And `pull --force` guards something
  else now: it overrides the git guard described further down rather than a
  comparison of file timestamps, so a script that has always passed `-f` is
  overriding a different protection than the one it was written against.
- **The sync state is committed to git, and it is the only record of what an
  item is.** Which Canvas object a file had become used to be recorded in three
  places at once: `.canvas-sync.json`, which was gitignored, a `canvas_id` in
  the markdown frontmatter, and a `customProps.canvas_module_id` in each
  folder's `_category_.json`. Three copies of one fact drift apart, so the first
  is now the only one. It is committed rather than ignored, it is keyed by each
  item's path under `course/`, and a push or a pull therefore leaves a change
  there to commit beside the content that caused it — which is also what gives a
  colleague who clones the repository a course that already knows what it is.
  Keyed by path it is legible on purpose: open it, recognise your own course in
  it, repair a row by hand. The schema is version 4, and a file written by any
  other version is refused rather than guessed at, because v3 keyed items the
  other way round and misreading the mapping would push a duplicate of
  everything. There is no migration: `reset-sync-state`, then `push`. Read
  [The sync state moved to schema v4](docs/updating-your-project.md#the-sync-state-moved-to-schema-v4-one-off)
  first — that push is the part to watch. A `canvas_id` an older version left in
  your frontmatter is inert from now on, ignored by every command, stripped by
  the next pull, and swept out of the tree by `reset-sync-state`.
- **A Canvas object that is already there is claimed rather than copied a second
  time.** Under `push` or `pull`, an item that has no row yet is paired with the
  Canvas object of the same type and title in the same module, and the two are
  tied together from then on. That is how this tool takes over a course it did
  not create, and it is the general form of the trick push used to do for
  quizzes alone: every type is eligible, text headers included. Types have to
  match exactly — a local page does not adopt a Canvas assignment of the same
  name, because that is a conversion and this tool cannot do one — and a title
  carried by two items on either side says nothing about which claims which, so
  nothing is adopted for it and the report names them. `sync` and `status` adopt
  nothing on purpose: with no direction pinned there is nothing to say which of
  two copies is the real one, so they refuse a module whose two sides hold items
  with nothing linking them, per module and never for the whole course.
  [Adopting an item you made by hand in Canvas](docs/frontmatter.md#adopting-an-item-you-made-by-hand-in-canvas)
  covers the row to write when the match cannot be made.
- **A rename is recognised as a rename.** The path is an item's address, so
  renaming or renumbering a file used to read as a delete and a create — which
  offers to delete the Canvas object and to build a second copy of it beside
  itself. The renaming commands re-key the row as they go, so the common case
  never needs detecting at all. One made by hand in Finder, or arriving with a
  merge, is matched the way git matches: identical content wherever it landed is
  re-keyed silently, while a file whose name changed but which stayed in its
  folder under the same title is a rename plus an edit, which is a guess rather
  than a fact, so it is reported and confirmed instead. Ambiguity is refused
  rather than resolved, because handing one item another's Canvas ids is worse
  than the delete and create it falls back to. A `title:` line is written into a
  file that declares none the first time a run creates or adopts its Canvas
  object, which is what lets the filename be an address rather than a display
  name.
- **A module reordered in Canvas renumbers your files instead of being
  reverted.** Ordering is reconciled three ways like everything else, so a drag
  in the Canvas module list is a change like any other rather than something the
  next push silently undoes. The renumbering goes through temporary names,
  because a reorder routinely swaps two files into each other's slots, and it
  moves one depth at a time so that a text header's children travel with the
  folder. If a write throws partway it puts back what it had already moved, and
  a run killed outright leaves names a later run recognises and sweeps back
  before it scans — a parked file is invisible to the scanner, which would
  otherwise read it as an item deleted locally and offer its Canvas object to
  the next prune.
- **Nothing overwrites work git cannot give back.** Git is the undo for this
  whole system, so a write onto a file holding uncommitted changes destroys the
  only copy of them. One `git status` covers the whole run, and every write into
  `course/` is refused for a path it reports as modified or untracked — the item
  itself, a `_category_.json`, a binary being downloaded into `_files/`.
  Untracked counts, and it is the case that matters most: git holds no copy at
  all of a file it has never seen. The item is reported as skipped with the
  remedy, and a run with a skip in it exits non-zero. Where git cannot answer,
  outside a checkout or wherever it will not run, every file on disk reads as
  dirty and a pull writes nothing. `pull --force` is the one lever that switches
  the guard off, for overwrites and deletes alike; it asks first, and it counts
  what git named rather than what the scanner saw, so a tree whose only
  uncommitted work is an image under `_files/` is no longer overridden without a
  question.
- **Deleting is opt-in, on both sides, and says what it costs.** An item the
  sync state knows that has since vanished from one side is an orphan, and an
  orphan is reported rather than acted on. `--prune-canvas` deletes on Canvas,
  `--prune-local` deletes in `course/`, `sync --prune` does both, and each lists
  what it would take by name before it asks. Only something the sync state
  already tracked is ever a candidate, so a page a colleague added by hand is
  never one. Where a doomed assignment or graded discussion holds student work,
  the confirmation question says so in the sentence you answer rather than in a
  paragraph above it. One delete needs no flag, and exactly one: the Canvas file
  a renamed binary orphaned, which nothing else would ever clear out, and which
  push checks three ways before it goes.
- **A question nothing can answer stops the run instead of hanging it.** Every
  prompt used to wait forever on a closed input stream, so a command run from a
  script, from an editor task or by an assistant stopped dead with the event
  loop drained — after which the process exited 0, as though it had done what it
  was asked. The two shapes are now separate. A destructive confirmation
  cancels, because not deleting is a safe answer to it. Every other question has
  no safe answer to fall back on — a run that cannot say which module to create
  must not invent one — so it ends the run with an error naming the command, the
  question and the flags that would have answered it, and exits 1. Three more
  runs exit non-zero rather than reading as clean: a declined first-push
  warning, a declined `pull --force` confirmation, and `status` over a course a
  `sync` would refuse rather than work through.
- **`--help` names the flags that have to be paired.** Eight commands enter
  their non-interactive path only when two flags are present — `move-item` wants
  `--position` beside `--path`, `rename-module` wants `--name` beside
  `--module`, and so on — while the help advertised the first as enough. A
  script that passed only it used to get a prompt, and now that an unanswerable
  prompt is a failed run rather than a hang, that is a run that stops.
- **A sync state describing another Canvas course stops the command before it
  acts.** Five commands loaded the sync state up front and refused there. Nine
  others reached the same check only through the code that records a rename or
  drops a row, which runs after the work rather than before it, so the refusal
  landed on top of the damage: `merge-items` had already written the source body
  into the target and still had the source on disk, and `move-item` had already
  renumbered every file in the module. It was not even consistent. A `move-item`
  that happened to shift no file never reached the check at all and reported
  success. One hook now asks the question before any command's action. A
  `move-item` that renumbers nothing therefore refuses where it used to succeed,
  which is the point: whether the sync state describes this course cannot depend
  on how many files a command happens to touch. `init` and `export` still read a
  mismatched state on purpose, and the local content tools, `reset-sync-state`
  among them, never open it and are not stopped.
- **A refusal reads as a refusal rather than as a crash.** The course-mismatch
  message is three paragraphs of what happened and which of the two ways out
  applies, and it arrived under a Node unhandled-rejection dump, where the
  sentence telling you to run `reset-sync-state` sat between a source excerpt
  and twelve frames of commander. Every deliberate stop now prints as its
  message and exits 1. Anything the tool did not mean keeps its stack, because a
  `TypeError` in the planner is a bug report and a bug report is its frames.
  `--verbose` still reaches the stack for both.
- **An emptied date in the frontmatter clears it on Canvas.** `due_at`,
  `lock_at`, `unlock_at`, `delayed_post_at`: writing the key with nothing after
  it now sends an explicit null, where before it was indistinguishable from
  never having written the key, so Canvas kept the old date forever and the
  markdown quietly disagreed with the course from then on. Leaving the key out
  still means "keep what you have", which is what makes this safe for a course
  whose frontmatter has never mentioned a date. See
  [Clearing a date](docs/frontmatter.md#clearing-a-date).
- **Everything the tool writes under `course/` comes out Prettier-formatted.**
  Pull used to hand back markdown in whatever shape the converter produced, so
  the first `npm run format` after a pull rewrote half the course and buried the
  actual change. Worse, rewrapping a file moved its hash off the row the pull
  had just recorded, so the next run read it as changed locally and pushed it
  back — byte-identical HTML on Canvas, and a phantom change in every report
  until somebody formatted. "Format your code" and "sync your course" fought.
  Every write now runs through Prettier against the project's own resolved
  config and records the hash of the bytes it actually wrote. That is the sync
  engine, and `new-item`, `split-item`, `merge-items`, `rename-item`,
  `reset-sync-state` and `build-glossary` as well — that last one had been
  reporting its glossary pages stale on every `--check` for exactly this reason,
  because the page on disk is Prettier-canonical and its render was not.
  `prettier` moves from a development dependency to a runtime one, loaded
  lazily. One write is carved out: the `title:` line a run splices into a file
  that declares none touches nothing else in the file, because the rest of it is
  yours and the run had otherwise only read it. And `.prettierignore` can no
  longer keep Prettier out of `course/`; it still works for `evaluations/` and
  `sources/`, which the tool never writes to.
- **Markdown survives a push and a pull.** Turndown escaped `_`, `*`, backticks
  and brackets globally, so every pulled file came back peppered with
  backslashes — `snake_case` returned as `snake\_case` — and strikethrough,
  task-list checkboxes and empty list items were dropped outright. An underscore
  inside a word is now left alone, the emphasis delimiter is chosen per node
  rather than once for the whole document, and the three dropped constructs come
  back. What the tests pin is not that the markdown returns identical, which it
  will not and need not: it is that the HTML a second push would send equals the
  HTML the first one sent.
- **Discussions, quizzes and external tools sync.** Every type of item a Canvas
  module can hold now crosses in both directions, but not all of them the same
  way. A discussion is content like a page: the markdown body is the message,
  push writes it, pull reads it back, and a rollover into a fresh course
  recreates it from the repository. A quiz and an LTI link are references — the
  file says which Canvas object belongs at that position and holds nothing else,
  because a quiz's questions and submissions are not things this project could
  rebuild. Push never creates, updates or deletes either one. Which quiz an item
  means is resolved from the id on its row in `.canvas-sync.json` while the
  course still lists it, then from a quiz item already sitting in that module
  under the same title, and failing both from a quiz anywhere in the course
  whose title matches exactly; the id it lands on is recorded on the row, so the
  manual QTI import that a new academic year needs has to happen once and push
  picks it up from there. Two quizzes sharing a title is an error rather than a
  guess. It names every id it found, and the way out is to delete the stale quiz
  in Canvas, or to place the one you mean in the module by hand, where push
  claims it by title without ever running the course-wide search.
- **`push` no longer drops the items in a module it did not put there.** It used
  to clear each module and build the item list again, so a quiz you placed by
  hand, a discussion, an LTI link or a page that is not in your repository
  vanished from the module on the next push. The claim in the README that a push
  silently drops hand-added items was accurate, and this is the fix for it
  rather than a note about it. The fix arrived twice. First as a refusal: push
  named the unaccounted-for items with their Canvas links, left the module
  exactly as it was and exited non-zero. Then the reconcile engine replaced that
  with something better for a run that has picked a direction — push adopts what
  it can pair and leaves the rest where it is, so the module survives without
  the run stopping. The refusal itself lives on in `sync` and `status`, which
  pin no direction and so cannot pair anything.
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
  delete landing in a course the run was never pointed at. `sync`, `push`,
  `pull`, `status` and `delete-module` now refuse while the two disagree, name
  both courses, and give the two ways out, and the item commands stop at the
  point where each records its change, along with `move-module` and
  `rename-module`. The check also covers `CANVAS_API_URL`, where a matching
  course id on a different instance is a different course. A file that claims no
  course contradicts nothing and is stamped from the environment instead. Two
  commands read such a file and carry on, and neither writes to Canvas: `init`,
  because it is the repair — it drops the old course's module, file and icon ids
  rather than filing them under the new course id, which is what it used to do —
  and `export`, which reads the ids only to footnote cross-links. Do not read
  the refusal as a guard on everything, though. The commands that never open the
  file are not stopped at all, and `reset-canvas` is one of them: it deletes
  everything in the course `.env` names, and a mismatch is exactly the situation
  in which `.env` may not be naming the course you think it is.
- **`delete-module` reads the sync state before it deletes the folder.** Both
  refusals on that read — a state describing another Canvas course, and one
  written by a schema this version cannot read — exist to stop the command
  editing a state file that is not this course's. It ran the read after
  `fs.rmSync`, so the folder was already gone by the time the refusal arrived,
  which is the guard's promise exactly inverted. It now runs first, above the
  confirmation too, so nobody answers "yes, delete it" to a run that then
  refuses.
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
- **`push` asks before its first push into a Canvas course that already holds
  content.** It counts the modules, pages, assignments and files that are
  already there, names the count, and asks; declining ends the run without
  writing. `reset-canvas` gained the same shape — it lists what the course
  contains before asking, rather than prompting blind, and it takes a
  `--dry-run` — and the `--prune-canvas` prompt points at
  [`docs/backups.md`](docs/backups.md). This entry used to record something else
  besides: that a plain push cleared and rebuilt the item list of every module
  it manages, churning the module item ids with it. The reconcile engine
  overtook that before the release; see the entries at the top of this section.
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
