# New Academic Year

How to switch your course materials to a new Canvas course at the start of a new
academic year. Your markdown content stays the same: you just point it at the
new course and push. This page is the Canvas rollover; the
[last section](#the-rest-of-the-year-change) covers the little the other outputs
need.

Most of your course rebuilds itself. Two types need a hand, and one of them
needs your Canvas admin: read
[What a Rollover Does to Each Type](#what-a-rollover-does-to-each-type) before
you start, so nothing is a surprise at the end of step 6.

## 1. Find the New Course ID

Open the new Canvas course in your browser. The course ID is the number after
`/courses/` in the URL:

```
https://school.instructure.com/courses/67890
```

In this example the course ID is `67890`.

## 2. Update Your Configuration

Open `.env` and change `CANVAS_COURSE_ID` to the new value:

```
CANVAS_COURSE_ID=67890
```

Alternatively, re-run the interactive setup:

```bash
npx course init
```

> [!TIP]
>
> The API URL and token usually stay the same between years: only the course ID
> changes.

From here until step 5, `.env` names the new course while `.canvas-sync.json`
still describes last year's, so the commands that act on the ids in it refuse to
run and name both courses. That is the guard against pushing last year's ids at
this year's course, not a problem with your setup; step 5 clears it, and
[troubleshooting](troubleshooting.md#canvas-syncjson-describes-course-n) lists
exactly which commands stop. Two things matter for this window: step 3 below
works throughout, because `reset-canvas` never opens the sync state, and the new
year's modules should be laid out after step 5, because `new-module` is among
the commands that refuse. Running `npx course init` at this step instead of
editing `.env` by hand lifts the refusal straight away, because init rewrites
the sync state too and leaves last year's module ids behind rather than filing
them under the new course; if you go that way, step 5 has nothing left to do.

## 3. Clean the Remote Course (If Needed)

If the new Canvas course already contains content (imported materials, starter
templates, or leftover items from a previous setup), clear it first:

```bash
npx course reset-canvas
```

This deletes all modules, pages, assignments, and files from the configured
Canvas course. The command asks for confirmation before making any changes.

> [!WARNING]
>
> Only run this on the **new** course. Double-check that `CANVAS_COURSE_ID` in
> `.env` points to the correct course before proceeding.

Skip this step if the new course is already empty.

## 4. Update Assignment Dates and Links

Review your assignment frontmatter and update dates for the new academic year:

- `due_at`: assignment deadline
- `lock_at`: when the assignment closes
- `unlock_at`: when the assignment becomes available

Dates use ISO 8601 format:

```yaml
---
title: Lab 1
canvas_type: assignment
points_possible: 10
due_at: "2026-10-15T23:59:00Z"
---
```

Also check any `external_url` items: linked resources may have new URLs for the
current year (e.g. updated ECTS documents, external platforms, or reference
materials).

> [!TIP]
>
> Search your `course/` folder for `due_at` to quickly find all assignments that
> need updated dates.

## 5. Reset Sync State

Make the project forget which Canvas objects it built last year:

```bash
npx course reset-sync-state
```

This deletes `.canvas-sync.json`, the one record of which Canvas object each
file and folder is. Your content is untouched: only the sync bookkeeping goes.

That file is committed, so its deletion is a change to your project like any
other: stage it and commit it. The push in step 6 writes a new one, naming the
new course's objects, and that belongs in a commit too.

## 6. Push to Canvas

Push all course materials to the new Canvas course:

```bash
npx course push
```

Since there are no existing Canvas IDs, every module and item will be created
from scratch. Use `--dry-run` first if you want to preview what will happen:

```bash
npx course push --dry-run
```

## 7. Verify

Confirm everything synced correctly:

```bash
npx course status
```

Then open the new Canvas course in your browser and spot-check a few pages and
assignments.

> [!WARNING]
>
> Never run `npx course pull` on the new course to "check" the result. Pull
> overwrites local files with what Canvas holds, and what Canvas holds is your
> own markup after a round trip through the HTML converter. On a tree that
> already holds your course, that is a rewrite, not a check. `status` answers
> the same question and writes nothing. See
> [Push and pull are not a merge](limitations.md#push-and-pull-are-not-a-merge).

## What a Rollover Does to Each Type

The wipe-and-rebuild above works because your markdown is the source of truth.
That is true of four types and only partly true of two.

**Rebuilt from the repository, nothing to do:**

- **Pages, assignments and discussions.** Recreated from your markdown, body and
  all. A discussion's replies from last year stay in last year's course, which
  is what you want. If a discussion was graded, set its points and due date
  again in Canvas: that grading lives on the assignment Canvas puts behind the
  topic, and no push has ever touched it.
- **Files.** Re-uploaded from `_files/`.
- **Text headers.** Regenerated from your subfolders.
- **External URLs.** Recreated as links. Check the URLs still point somewhere
  useful (step 4).

**A quiz has to be imported by hand, once per course.** The questions are not in
this repository as markdown, and Canvas has no API for a QTI import, so:

1. Import the `.zip` named in the file's `quiz_ref` through **Settings > Import
   Course Content > QTI .zip file** in the new course.
2. Give the quiz the same title the markdown file has, because that title is how
   push finds it.
3. Push. Push matches the quiz by title and records the new id in
   `.canvas-sync.json` for you.
4. Set the availability dates and the time limit in Canvas. QTI carries neither,
   and the quiz arrives unpublished.

Until the quiz is imported, push cannot place that item: the action fails with
the import procedure and the filename in it, and the run ends non-zero. Nothing
else in the module is affected: a failed action costs that action alone.

A quiz file with no `quiz_ref` cannot be rebuilt at all: there is no package to
import, and no questions in the repository. That is why `npx course validate`
warns about it. Run validate before a rollover and settle every one of those
warnings while last year's course is still there to export the package from
(**Settings > Export Course Content**, quiz-only export).

**An external tool relinks itself only if the tool is installed at account
level.** A course resolves an LTI launch URL by searching itself and then its
account chain, so an account-level install is already present in the new course
and the item works the moment push creates it. A **course-level** install is
not: it existed in last year's course only, and Canvas never returns a tool's
`shared_secret` from the API, so nothing in this repository can recreate it.
Your options are to ask your Canvas admin for an account-level install (the
durable fix, it survives every future rollover) or to seed the new course with
Canvas's own Course Copy, which is the only path that carries a course-level
secret across.

Push checks this for you: when no installed tool claims the launch URL it warns,
names the tools that are installed, and creates the item anyway. Canvas gives no
error of its own here, and a student clicking an unresolved item gets "Couldn't
find valid settings for this link".

> [!TIP]
>
> If the new course was seeded with Course Copy rather than left empty, be
> careful with step 3. `reset-canvas` deletes the modules, pages, assignments
> and files it finds, but leaves discussions and quizzes alone. The copied
> discussions then survive with no module item pointing at them, and your push
> creates a second copy of each. Delete the copied discussions in Canvas before
> pushing. Adoption cannot rescue them: push reads a course through its modules,
> so a discussion no module item points at is invisible to it, and claiming one
> by hand needs it back in a module first. See
> [Frontmatter](frontmatter.md#adopting-an-item-you-made-by-hand-in-canvas).

## Quick Reference

The full workflow in one block, numbered as the steps above:

```bash
# Steps 1-2: update .env with the new course ID
# Step 3: clean the new course if it holds content
npx course reset-canvas

# Step 4: update dates and external_url fields in frontmatter
# Import every quiz's QTI zip by hand, under the same title as its file

# Step 5: reset the sync state
npx course reset-sync-state

# Step 6: push to the new course
npx course push

# Step 7: verify
npx course status
```

Check the quiz and LTI items in Canvas afterwards: those are the two the push
cannot guarantee on its own.

## The Rest of the Year Change

The Canvas rollover is the only part with steps. The other outputs need almost
nothing:

- **The website** rebuilds from your files on every push to GitHub; there is
  nothing to repoint.
- **Exports** are regenerated on demand, so a handout whose cover or body
  carries dates is worth re-exporting once step 4 has updated them.
- **Evaluations and sources** get their year folders as you need them: a fresh
  `evaluations/<year>/` for this year's exams, and `sources/retros/<year>/` if
  you keep after-teaching notes (see [the sources folder](sources.md)).
