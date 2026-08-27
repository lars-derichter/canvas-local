# Advanced Commands

Commands for managing sync state and Canvas content. These commands modify state
destructively. Only use them if you know what you are doing.

> [!WARNING]
>
> Canvas has no undo. Back the course up before running anything on this page:
> see [Backing up a Canvas course](backups.md).

## reset-sync-state

```bash
npx course reset-sync-state
```

Removes all instance-specific sync artifacts from the local codebase:

1. Deletes `.canvas-sync.json`, the one record of which Canvas module, item,
   uploaded icon and embedded file each folder and file is. That deletion is the
   reset.
2. Sweeps stray sync bookkeeping out of the tree: a `canvas_id` in a markdown
   file's frontmatter and a `customProps.canvas_module_id` in a folder's
   `_category_.json`. Neither is part of the format, and a leftover one is a
   second answer to a question the sync state owns alone. `canvas_type` is left
   alone: that is your declaration of what a file should become, not a record of
   what Canvas did.

After running this command the project is back to a "never pushed" state: the
next `push` will create everything fresh on Canvas.

**When to use:**

- Switching to a different Canvas instance or course. This is not optional: the
  sync state records which course it describes, and every command that acts on
  the ids in it refuses to run against a different one, before it acts, so a run
  that stopped changed nothing.
  [Troubleshooting](troubleshooting.md#canvas-syncjson-describes-course-n) lists
  which commands stop, which read the mismatched file and carry on, and which
  never open it. Either this command or `npx course init` clears the mismatch.
- Preparing the repo for sharing (strip instance-specific IDs).
- Testing the full sync flow from scratch.

**Note:** The command asks for confirmation, and touches nothing on Canvas. The
Canvas course keeps all its content, which is what makes the next push the part
to watch: every module reads as unlinked, `sync` and `status` refuse a module
that holds items on both sides, and `push` answers that refusal by pinning a
direction, adopting what it can pair by type and title and creating a second
copy of what it cannot. Read the report rather than assuming either outcome. See
[Push reconciles a module's item list](limitations.md#push-reconciles-a-modules-item-list).

## reset-canvas

```bash
npx course reset-canvas
npx course reset-canvas --dry-run   # show what would go, delete nothing
```

Deletes **all** content from the Canvas course configured in `.env`, not only
content this tool created:

- All modules
- All pages
- All assignments, except the ones that are really a quiz
- All files

Deleting an assignment deletes its gradebook column and the student submissions
on it. Canvas's `/undelete` sometimes brings an assignment back, but the
submissions frequently do not come with it, so grades are lost for good. Export
the gradebook first. See [Backing up a Canvas course](backups.md). For which
deletions cost grades and which cost only content, see
[Destructive operations and student work](limitations.md#destructive-operations-and-student-work).

Classic quizzes, discussions, announcements and rubrics survive, but the modules
that linked them do not.

Quizzes survive because the command skips them, not because it cannot reach
them. A graded Classic Quiz is two objects in Canvas, the quiz and an assignment
holding its gradebook column, and deleting that assignment would delete the
quiz, its questions and every submission. `reset-canvas` leaves those
assignments where they are, names them, and keeps them out of its count. A New
Quiz gets no such shield: it is genuinely an assignment, with no separate quiz
object for the guard to protect, so the command deletes it like one and names
every one it is about to take, questions and submissions included.
[Destructive operations and student work](limitations.md#destructive-operations-and-student-work)
has the full picture.

The command lists what the course holds, names the assignments that students
have already submitted to, the ones it is skipping and the New Quizzes it is
not, then asks:

```
[reset-canvas] Canvas course 123 contains 4 modules, 18 pages, 2 assignments.
[reset-canvas] All of it will be deleted, including content this project never created.
[reset-canvas] Every assignment counted above is deleted, and its gradebook column and its student submissions go with it.
[reset-canvas] Classic quizzes, discussions, announcements and rubrics are left alone, but the modules that linked them are not.
[reset-canvas] 1 of the assignments on this course is the gradebook half of a graded quiz. It is skipped: deleting it deletes the quiz, its questions and every submission on it, and nothing here could rebuild the quiz afterwards.
  - Test 1 (kept, with its quiz)
[reset-canvas] 1 of the assignments counted above is a New Quiz, which the line above does not cover: only Classic quizzes are left alone. A New Quiz is an assignment, so it is deleted with the rest — and that deletes the quiz, its questions and every submission on it. Nothing here could rebuild the questions afterwards.
  - Quiz 2 (New Quiz: deleted, with its questions)
[reset-canvas] WARNING: 1 assignment being deleted has student submissions. Deleting an assignment deletes its gradebook column and every submission and grade in it.
  - Exercise 2 (has student submissions)
[reset-canvas] Canvas has no undo. Back the course up first — see docs/backups.md.
[reset-canvas] Delete all content on course 123, including the student submissions and grades? (y/N)
```

Canvas lists three assignments on that course; two of them are counted above,
because the third is the quiz.

The submission check costs no extra request: Canvas puts
`has_submitted_submissions` on the assignments the command already listed. When
Canvas does not answer it (an older instance, a trimmed response), the
assignment is reported as `submission status unknown` and the warning says the
status could not be determined. It is never reported as safe.

Anything other than `y` cancels, and so does an input stream that ends without
answering: `< /dev/null`, a CI step or an editor task with nothing to say
cancels rather than deleting. A piped answer is not silence, though.
`printf 'y\n' | npx course reset-canvas` answers the question like a typed `y`,
and the deletion runs.

If individual deletions fail the command continues with the remaining items,
reports a summary of errors at the end, and exits non-zero. So does a run that
found no `CANVAS_COURSE_ID` to work from, and a cancelled one: like a declined
`push` or `pull`, a run that did not do what it was asked does not report
success, however the "no" arrived.

Use `--verbose` to see each deletion as it happens:

```bash
npx course --verbose reset-canvas
```

**Typical workflow:** Run `reset-canvas` followed by `reset-sync-state` to get
both Canvas and local state back to a clean slate, then `push` to re-create
everything.

## Resilience and Conflict Detection

The commands above run on the same engine as every sync, so its guards apply: a
failing request is retried with backoff, an item that fails mid-run does not
stop the rest, a stale id is recovered by recreating the object, what changed is
decided by content rather than timestamps, and a file git reports as modified or
untracked is never written over unless `pull --force` asked first. The mechanics
are in [architecture](architecture.md#error-recovery); the user-visible side in
[Push and pull are not a merge](limitations.md#push-and-pull-are-not-a-merge),
[Skipped with "(git-dirty)"](troubleshooting.md#git-dirty-under-skipped) and
[A stale id on the sync row](troubleshooting.md#a-stale-id-on-the-sync-row-404-on-update).
