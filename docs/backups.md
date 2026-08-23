# Backing up a Canvas Course

Nothing in Canvas Course Builder undoes a delete, and your repository cannot
help: git holds every version of what you wrote and nothing at all of what only
ever existed in Canvas. Canvas itself has an `/undelete` endpoint that sometimes
brings a deleted assignment back, though the submissions frequently do not come
with it, which makes it a lifeline rather than a plan. So before you point this
tool at a course that already holds content — a course you taught last year, a
course a colleague handed over, any course with student work in it — take a
backup.

This takes a few minutes once. It is the difference between a bad afternoon and
a bad semester.

> [!WARNING]
>
> Two commands can destroy Canvas content: `npx course reset-canvas` deletes
> every module, page, assignment and file in the course, including content this
> tool never created. `--prune-canvas`, on either `npx course push` or
> `npx course sync`, deletes the Canvas modules and items you removed locally,
> and `npx course sync --prune` adds the other direction to it. Deleting an
> assignment is the one that reaches student work: it takes the gradebook column
> and every submission on it. A run without a prune flag deletes nothing, but it
> does overwrite: the Canvas copy of anything a local file tracks is replaced by
> what the file says. See [Limitations](limitations.md) for exactly what each
> one touches.

## Route 1: Export the Course to a File

The quickest backup, and the one to take before your first push. It produces a
single `.imscc` file you download and keep.

1. Open the course in Canvas and click **Settings** in the course navigation.
2. In the right-hand sidebar, click **Export Course Content**.
3. Choose **Course** as the export type and click **Create Export**.
4. Wait for the export to finish — Canvas emails you when it is ready for a
   large course — then click the link to download the `.imscc` file.
5. Store it somewhere that is not your laptop's Downloads folder.

To restore it, create or open a course, go to **Settings > Import Course
Content**, choose **Canvas Course Export Package**, and upload the file.

An export carries pages, assignments, files, modules, quizzes and discussions.
It does **not** carry student submissions, grades, or announcements sent to
students. If those matter, back the course up before anyone submits anything, or
export the gradebook separately from **Grades > Export**.

## Route 2: Copy the Course Into a Sandbox

A copy gives you a working Canvas course to compare against, rather than a file
you have to import before you can look at it.

1. Open the course, click **Settings**, then **Copy this Course** in the
   right-hand sidebar.
2. Give the copy a name that says what it is —
   `Backup of Web development 2025-26, before sync` — and set the dates.
3. Click **Create Course**.

Whether you can do this depends on your Canvas permissions. If the button is not
there, ask whoever administers Canvas at your institution for a sandbox course;
most institutions hand them out on request.

## Route 3: Work in a Sandbox, Then Copy Over

The safest way to start, and the one to use while you are still learning what
push does.

1. Get an empty sandbox course, and put its course ID in `.env` with
   `npx course init` (see [Canvas setup](canvas-setup.md)).
2. Push, look at the result, fix, push again. Break whatever you like — nobody
   is enrolled.
3. When the course looks right, copy it into the real course: open the real
   course, **Settings > Import Course Content > Copy a Canvas Course**, and pick
   the sandbox.
4. Only then point `.env` at the real course. See
   [New academic year](new-academic-year.md), which is the same move performed
   every summer.

The cost of this route is that the Canvas ids differ between the two courses, so
your `.canvas-sync.json` describes the sandbox, not the real course. Run
`npx course reset-sync-state` when you switch. Forgetting is no longer silent:
`sync`, `push`, `pull` and `status` all refuse to run while `.env` and the sync
state name different courses, and say which is which. Do not read that as a
guard on everything, though. `reset-canvas` never opens the sync file, so it
deletes whatever course `.env` names, mismatch or not.

## What Git Backs up, and What It Does Not

[Git and GitHub](git-and-github.md) call your repository a backup, and for your
own writing it is: every version of every markdown file, recoverable. That is
the half of the problem git solves.

It does not back up Canvas. Your repository knows nothing about the pages a
colleague wrote in the web editor, the quiz you built by hand, the discussion
threads, or the student submissions. Pushing your markdown to GitHub protects
your markdown. Only a Canvas export or a course copy protects the course.

## What Each Command Puts at Risk

The routes above protect different things, and the command you are about to run
decides which one you need.

| Command                                      | What it can destroy                                                                                                                            | What protects you                               |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `push`                                       | the Canvas copy of anything a local file tracks, overwritten with what the file says                                                           | a course export or a course copy                |
| `sync`                                       | the Canvas copy and the local copy of anything the sync state tracks, each replaced by whichever side changed it last                          | a course export or a course copy, plus a commit |
| `push --prune-canvas`, `sync --prune-canvas` | the Canvas modules, pages, assignments, discussions and files you deleted locally — and, with each assignment or graded discussion, its grades | a course export **and** the gradebook           |
| `pull --prune-local`, `sync --prune-local`   | the local files and folders Canvas no longer holds                                                                                             | git: a commit                                   |
| `sync --prune`                               | both prune rows above, in one run                                                                                                              | a course export, the gradebook **and** a commit |
| `reset-canvas`                               | every module, page, assignment and file in the course, including content this tool never created, and every grade                              | a course export **and** the gradebook           |
| `pull --force`                               | your local markdown, overwritten with the Canvas version, uncommitted work included; with `--prune-local`, deleted rather than overwritten     | git: a commit, not a Canvas backup              |

The assignment row is the one that bites. A course export carries assignments
but not submissions or grades, so an export taken before a prune restores the
assignment as an empty shell — the column comes back without the work in it.
Grades live in one backup only, **Grades > Export**, and that CSV is a record
rather than a restore: the files students uploaded are not in it, and a deleted
assignment comes back as a new column you would paste the scores into by hand.

Every row above `pull --force` leaves uncommitted work alone. A local file git
reports as modified or untracked is never overwritten and never deleted on any
of them, and `sync` has no flag that changes that. `pull --force` is the one
lever that switches the guard off, and outside a git checkout the guard covers
every file in `course/`, so a forced pull there writes over all of them.

One assignment none of them deletes: Canvas lists the gradebook half of a graded
Classic Quiz among the course's assignments, and deleting it deletes the quiz,
its questions and its submissions. `reset-canvas` skips those and names them;
`--prune-canvas` refuses them and says why, on `push` and on `sync` alike,
because the refusal lives in the engine rather than in either command. Quiz and
LTI items are only ever unlinked from their module, never deleted. A course
export is still the only thing that brings a quiz back.

A **New** Quiz is not one of those. Canvas builds it as an assignment that
launches an LTI tool, with no separate quiz object behind it, so the guard above
has nothing to catch and this project manages it as the assignment it is.
`reset-canvas` deletes it — with its questions and every submission on it — and
names it in the summary so a count of assignments cannot hide it.
`--prune-canvas` deletes it too, and lists it as an ordinary assignment. Nothing
in this repo can rebuild a New Quiz's questions; a course export is the only
thing that brings one back.

Deleting the local file of a **graded** discussion deletes the topic, every
reply in it and the grades behind it. Prune checks for that: it resolves the
assignment Canvas keeps behind the topic, flags the item in the listing with its
reply count, and counts it in the warning above the confirmation. An ungraded
topic has no grades to lose, but its replies still go, so that is flagged too. A
check it cannot complete is reported as unknown, never as safe. Export first
anyway, and know what the export does not carry: it brings the topic back, not a
word students wrote in it.

Deleting a whole module folder is a cheaper mistake than deleting a single
assignment file, which is the reverse of what most people assume. See
[Destructive operations and student work](limitations.md#destructive-operations-and-student-work)
for why, and for the warnings the commands print before they act.

## When to Take One

- **Before the first push to any course that already has content.** The CLI
  warns you at this point and asks for confirmation.
- **Before `reset-canvas`, and before any run carrying a prune flag**, every
  time. Each of them stops for a confirmation and points back here. On a course
  students have submitted to, export the gradebook as well: no course export or
  course copy carries grades.
- **At the end of each academic year**, before you repoint the project at a new
  course.
- **Before you try something you have not tried before**, which for a while is
  most things.
