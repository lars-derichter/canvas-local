# Advanced Commands

Commands for managing sync state and Canvas content. These commands modify state
destructively — only use them if you know what you are doing.

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
2. Sweeps up what older versions of this tool left in the tree: the `canvas_id`
   in a markdown file's frontmatter and the `customProps.canvas_module_id` in a
   folder's `_category_.json`. Neither is written any more, and a leftover one
   is a second answer to a question the sync state now owns alone. `canvas_type`
   is left alone — that is your declaration of what a file should become, not a
   record of what Canvas did.

After running this command the project is back to a "never pushed" state — the
next `push` will create everything fresh on Canvas.

**When to use:**

- Switching to a different Canvas instance or course. This is not optional: the
  sync state records which course it describes, and `sync`, `push`, `pull`,
  `status` and `delete-module` refuse to run against a different one, because
  the ids in it mean nothing there and a Canvas file id is not even scoped to a
  course. The item commands hit the same refusal, along with `move-module` and
  `rename-module`, and every one of them refuses before it acts, so a run that
  stopped changed nothing. Two commands read the mismatched file and carry on,
  and neither writes to Canvas: `init`, which repairs it, and `export`. The rest
  never open it and are not affected: `setup`, `new-module`, `validate`,
  `search`, `build-glossary`, `export-toc`, `reset-canvas` and this command.
  Either this command or `npx course init` clears it.
- Preparing the repo for sharing (strip instance-specific IDs).
- Testing the full sync flow from scratch.

**Note:** The command asks for confirmation, and touches nothing on Canvas. The
Canvas course keeps all its content, which is what makes the next push the part
to watch. What the reset leaves behind is a course in which every module reads
as unlinked, and where both sides of one still hold items, `sync` and `status`
refuse that module rather than guess. `push` and `pull` do not refuse: each pins
a direction, which is the answer the refusal is asking for, and from there
adoption pairs a local file with the Canvas object of the same type and title,
claiming what is already there instead of copying it. What cannot be paired is
created, so a title that differs between the two sides, an item whose type
changed, or two items in one module sharing a title each end up as a second copy
on Canvas. Read the report rather than assuming either outcome. See
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
the gradebook first — see [Backing up a Canvas course](backups.md). For which
deletions cost grades and which cost only content, see
[Destructive operations and student work](limitations.md#destructive-operations-and-student-work).

Classic quizzes, discussions, announcements and rubrics survive, but the modules
that linked them do not.

Quizzes survive because the command skips them, not because it cannot reach
them. A graded Classic Quiz is two objects in Canvas: the quiz that holds the
questions, and an assignment that holds its column in the gradebook. That second
object is returned by the assignments API like any other assignment — flagged
`is_quiz_assignment: true`, carrying the quiz's id in `quiz_id` — and a `DELETE`
on it deletes the quiz, its questions and every submission on it. `reset-canvas`
leaves those assignments where they are, names them in its output, and keeps
them out of the count of assignments it is about to delete. A practice quiz has
no gradebook column and never appears in that list at all, so it was never at
risk.

A New Quiz is the exception that does get deleted: it is genuinely an
assignment, one that launches an LTI tool, with no separate quiz object behind
it for the guard to protect. Because the line above it promises that quizzes are
left alone, the command says which kind is which and names every New Quiz it is
about to delete. Deleting one takes its questions and every submission on it,
and nothing in this project could rebuild the questions — a New Quiz has no
markdown source here the way an assignment body does.

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
Canvas does not answer it — an older instance, a trimmed response — the
assignment is reported as `submission status unknown` and the warning says the
status could not be determined. It is never reported as safe.

Anything other than `y` cancels, so a piped or non-interactive run cancels
rather than deleting.

If individual deletions fail the command continues with the remaining items and
reports a summary of errors at the end.

Use `--verbose` to see each deletion as it happens:

```bash
npx course --verbose reset-canvas
```

**Typical workflow:** Run `reset-canvas` followed by `reset-sync-state` to get
both Canvas and local state back to a clean slate, then `push` to re-create
everything.

## Resilience and Conflict Detection

- **Retry logic**: a call that comes back 429 (rate limit) or 5xx is retried up
  to 3 times on top of the first attempt, with exponential backoff, so a failing
  request is made 4 times before it gives up. The log counts them:
  `(attempt 2/4)`. A network error is retried the same way with one exception, a
  `POST`, because a dropped connection leaves it unknown whether Canvas
  processed the request and a duplicate page or assignment is worse than a clean
  failure.
- **Error recovery**: If a single module or item fails during push/pull, the
  remaining items continue and a summary of errors is shown at the end.
- **Conflict detection**: what changed is decided by content, not by a
  timestamp. Each side is compared against the fingerprint the last sync
  recorded for it, which is what separates "changed here" from "changed there"
  and both from "changed on both sides". Neither fingerprint reads a
  modification time, so a fresh `git clone` is not mistaken for an entirely
  edited course. One decision still reads a timestamp, the `newest` tiebreak,
  and only an item whose two fingerprints have both moved reaches it; `push` and
  `pull` never do, because pinning a direction has already answered that
  question. See
  [Push and pull are not a merge](limitations.md#push-and-pull-are-not-a-merge).
- **Forced overwrite**: a file git reports as modified or untracked is never
  written over and never deleted. `pull --force` switches that guard off, for
  overwrites and deletes alike. It asks first whenever it would override at
  least one such file under `course/`, and whenever git could not answer at all,
  which outside a checkout is every file in the tree. A non-interactive run
  answers no and cancels. See
  [Skipped with "(git-dirty)"](troubleshooting.md#git-dirty-under-skipped).
- **Stale ID recovery**: a 404 on updating a page, assignment or discussion
  means the object was deleted in Canvas, so it is created again and the new id
  recorded. A module is not: a 404 there fails the action, and the run reports
  it.
