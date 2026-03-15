# New Academic Year

How to switch your course materials to a new Canvas course at the start of a new
academic year. Your markdown content stays the same — you just point it at the
new course and push.

## 1. Find the new course ID

Open the new Canvas course in your browser. The course ID is the number after
`/courses/` in the URL:

```
https://school.instructure.com/courses/67890
```

In this example the course ID is `67890`.

## 2. Update your configuration

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
> The API URL and token usually stay the same between years — only the course ID
> changes.

## 3. Clean the remote course (if needed)

If the new Canvas course already contains content — imported materials, starter
templates, or leftover items from a previous setup — clear it first:

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

## 4. Update assignment dates and links

Review your assignment frontmatter and update dates for the new academic year:

- `due_at` — assignment deadline
- `lock_at` — when the assignment closes
- `unlock_at` — when the assignment becomes available

Dates use ISO 8601 format:

```yaml
---
title: Lab 1
canvas_type: assignment
points_possible: 10
due_at: "2026-10-15T23:59:00Z"
---
```

Also check any `external_url` items — linked resources may have new URLs for the
current year (e.g. updated ECTS documents, external platforms, or reference
materials).

> [!TIP]
>
> Search your `course/` folder for `due_at` to quickly find all assignments that
> need updated dates.

## 5. Reset sync state

Remove all Canvas IDs from your local files so the next push creates everything
fresh on the new course:

```bash
npx course reset-sync-state
```

This strips the `canvas_id` field from every markdown file in `course/` and
deletes `.canvas-sync.json`. Your content is untouched — only sync metadata is
removed.

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
npx course status --remote
```

Then open the new Canvas course in your browser and spot-check a few pages and
assignments.

## Quick reference

The full workflow in one block:

```bash
# 1. Update .env with the new course ID
# 2. Clean remote course if it has existing content
npx course reset-canvas

# 3. Update due_at / lock_at / unlock_at dates in assignment frontmatter
# 4. Update external_url fields if needed

# 5. Reset local sync state
npx course reset-sync-state

# 6. Push to the new course
npx course push

# 7. Verify
npx course status --remote
```
