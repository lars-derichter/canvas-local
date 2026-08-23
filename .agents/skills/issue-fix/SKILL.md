---
name: issue-fix
description: Work through the open issues in sources/issues.md. Phase A verifies and groups every entry, checks wider implications (same defect elsewhere, style-rule drift, glossary, course context, lesson plans, evaluations), bundles all clarifying questions into one round, and presents one fix plan; Phase B applies the fixes only after approval and moves entries to Resolved. Never fixes style preferences silently, never commits. Use for "fix issues", "work the issue queue", "fix the queue", "issues afwerken", "werk de foutenlijst af", "los de issues op".
---

# Issue Fix

Work through the issue queue that `/issue-report` (and the author's own hand)
filled in `sources/issues.md`.

## Input

`$ARGUMENTS` may limit the scope: a date or date range, a file or module, a type
tag (e.g. `[error] only`, `alleen [error]`), or free text matched against the
entries. Empty means every entry under `## Open`.

## Steps

### Phase A: Triage (Writes Nothing)

1. **Read the fixed inputs**: `sources/issues.md` in full (`## Open` _and_
   `## Resolved`),
   [`context/writing-style.md`](../../../context/writing-style.md), and
   [`context/course-context.md`](../../../context/course-context.md). If the
   queue file is absent or `## Open` is empty, say so, mention `/issue-report`,
   and stop. Never create the queue file here.

2. **Verify every entry in scope** against the current files: find the quoted
   passage. Number the entries 1..N for the plan. A passage that is already
   corrected or gone becomes the proposed action "already fixed, move to
   Resolved". An entry marked `location unverified`, or whose quote no longer
   matches anything, goes to the question round.

3. **Group related entries.** Same file, same term, same style rule, same root
   cause. Groups, not individual entries, are the fix units in the plan. Expand
   multi-file entries (glob or description in the path field) to concrete files
   here.

4. **Check wider implications per group.** Every claim backed by a grep hit or a
   file path. A hunch is a question, not a plan item:
   - **Same defect elsewhere.** Grep `course/` and `evaluations/` for the same
     wrong text or pattern; list the extra hits.
   - **Style rule.** Does the fix encode a durable writing preference that
     `context/writing-style.md` does not have yet? Mark the group for an
     `/writing-style-update` offer (never edit `writing-style.md` here) and grep
     for other pages that would violate the would-be rule.
   - **Glossary.** Does the fix change or rename a term? Check the canonical
     glossary (default `sources/reference-materials/glossary.yml`; path per
     `course-context.md`) and note whether `npx course build-glossary` must be
     re-run afterwards.
   - **Course context.** Does the fix contradict a fact recorded in
     `context/course-context.md`? Mark the group for a `/course-context-update`
     offer. Never edit `course-context.md` here.
   - **Lesson plans.** Grep `sources/lessons/` and `sources/lesson-plans/`:
     would the fixed student page now contradict the plan it was built from?
     Flag it: the plan edit belongs to `/lesson-retro` or the author, not this
     skill.
   - **Evaluations.** Does anything under `evaluations/` test or restate the
     pre-fix version?
   - **Inbound links.** If a fix renames a heading or a file, grep for relative
     links pointing at it.

5. **Bundle every clarifying question into one question round**: unverifiable
   locations, entries that are really author decisions rather than defects,
   whether an approved fix should extend to the same-defect-elsewhere hits. A
   question that surfaces later goes into a plan revision, never a second ad-hoc
   round.

6. **Present one fix plan in chat**, per group and numbered entry: the proposed
   action (fix as described / already fixed, move only / not a defect, close as
   author decision / route to `/writing-style-update`, `/course-context-update`
   or `/lesson-retro` / defer), the files it touches, and the follow-ups from
   step 4. Add a separate list of what will _not_ be fixed and why.

7. Adjust the plan on request and stay in Phase A until the author explicitly
   approves. Stop. Wait for explicit approval before starting Phase B.

### Phase B: Fix (Only After Approval)

8. **Apply the fixes serially**, group by group: minimal edits, one concern per
   edit, including the approved same-defect-elsewhere hits. Re-grep after each
   fix to confirm it landed.

9. **Style pass on the touched passages.** Check every edited passage in
   `course/` and `evaluations/` against the student-facing checklist of
   `context/writing-style.md`. Passages only: no whole-file rewrites; a heavily
   edited file gets a `/proofread` recommendation in the report instead.

10. **Carry out the approved side effects**: glossary edits (then
    `npx course build-glossary` if the course keeps generated glossary pages),
    link fixes from the inbound-link check.

11. **Move every handled entry to `## Resolved`**, keeping its text and
    appending `→ resolved YYYY-MM-DD: what fixed it (files touched)`, or the
    non-fix outcome: already fixed, author decision, routed to
    `/writing-style-update`. Deferred entries stay under `## Open` with a dated
    `deferred:` note. Never delete an entry; Resolved is the dedupe memory for
    `/issue-report`.

12. **Report and offer follow-ups, do not run them**: `/writing-style-update`
    for the style preferences that surfaced; `/course-context-update` for the
    course facts a fix contradicted; `/proofread` for heavily edited files;
    `/commit` for the changes; and the reminder that Canvas keeps serving the
    old text until `npx course push`: never run the push.

## Rules

- **Language.** Write everything in the language `context/writing-style.md`
  states the course uses; `course.config.yml`'s `language` key only picks the
  generated labels. Reply in chat in the language the author writes in.
- Never fix silently: `[style]` preferences route through the
  `/writing-style-update` offer, design decisions and scope changes go back to
  the author, anything unclear goes into the question round.
- Fix only what the queue and the approved plan cover: no drive-by rewrites of
  surrounding prose.
- Every Resolved move states what changed, or why nothing had to.
- Course specifics (glossary path, conventions) come from `course-context.md` at
  runtime; hardcode nothing.
- No commits, no pushes, no staging; never run `npx course push`.

$ARGUMENTS
