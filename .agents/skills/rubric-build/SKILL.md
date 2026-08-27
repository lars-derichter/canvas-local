---
name: rubric-build
description: Generate a grading rubric for an assignment or evaluation, with criteria drawn from the assignment text and aligned to the course's learning goals. Phase A proposes the criteria-by-levels matrix and stops for approval; Phase B writes a colleague-facing markdown rubric. Use for "rubric", "grading criteria", "marking key for the assignment", "rubric maken", "beoordelingsrubriek", "verbetersleutel voor de opdracht".
---

# Rubric Build

Build a grading rubric for one assignment (a homework page under `course/` or an
evaluation under `evaluations/`), aligned with the learning goals it serves,
written as a colleague-facing markdown file. Markdown only: pushing rubrics to
Canvas would need a `lib/canvas/rubrics.js` that does not exist.

## Input

`$ARGUMENTS` may hold a path to the assignment, free text naming it (_"homework
lesson 3"_, _"huiswerk les 3"_), and/or constraints (point total, number of
levels). If empty, propose the file open in the IDE when it is an assignment or
evaluation; otherwise ask for a path. Stop with one sentence if the target is
not a markdown file under `course/` or `evaluations/`.

## Steps

### Phase A: Design (Writes Nothing)

1. **Read the fixed inputs**, in this order:
   - The assignment itself, in full. Its stated requirements are the primary
     source of criteria.
   - [`context/course-context.md`](../../../context/course-context.md): the
     learning-goal scheme and its notation. If it is `TODO`, infer goals from
     the lesson plan the assignment belongs to, or ask the author once, and
     offer `/course-context-update` at the end to record what you learned.
   - The lesson plan(s) in `sources/lessons/` that the assignment belongs to,
     for the goals it practises and the level at which they were taught.
   - [`context/writing-style.md`](../../../context/writing-style.md): the rubric
     is colleague-facing.
   - Existing rubrics under `evaluations/**/rubric*.md` or `sources/rubrics/`,
     if any, as the structural worked example.

2. **Settle the grading model.** From `$ARGUMENTS`, the worked example, or one
   bundled question round: analytic (criteria × levels, the default) or
   holistic; number of levels and their labels (default four: the worked
   example's if there is one, otherwise insufficient / sufficient / good /
   excellent, in the course language); point total and whether points sit per
   criterion or per cell.

3. **Derive the criteria.** Each criterion traces to a requirement in the
   assignment text or to a learning goal it practises; a criterion you add on
   your own initiative is allowed only when the alignment check flags it as
   yours. Typical count: three to six. For each, note the source (quoted
   requirement, goal reference, or own initiative).

4. **Propose in chat, no files:**
   - **The matrix.** Criteria as rows; per criterion: weight in points, the
     goal(s) it serves, and a one-line descriptor per level. Descriptors name
     observable differences (what the work shows), not adjectives.
   - **Alignment check.** Requirements in the assignment with no criterion,
     criteria with no basis in the text or goals, and goals the assignment
     claims to practise but the rubric cannot see. Flag each.
   - **Open questions.** Anything the author must decide before Phase B.

5. Adjust on request and stay in Phase A. Stop. Wait for explicit approval
   before starting Phase B.

### Phase B: Write (Only After Approval)

6. **Write the rubric file.** Destination:
   - Assignment under `evaluations/<year>/<slug>/` → `rubric.md` in that same
     folder.
   - Homework page under `course/` → `sources/rubrics/<module-slug>.md`. Never
     inside `course/`: a rubric page there would be served and synced.

   Content: title naming the assignment, a link to it, the point model, the
   criteria × levels table, and per criterion a short grading note (common
   mistakes to look for, partial-credit guidance) where Phase A surfaced one.
   Colleague-facing register of `context/writing-style.md`.

7. **Report the path written, then offer, do not run:**
   - Appending a student-facing summary of the criteria to the assignment page
     (no level descriptors, just what is graded, headed by the course's own
     phrase for what you are marked on). It edits student-facing material, so it
     happens only when the author accepts this offer.
   - `/proofread` on the rubric.

## Rules

- **Language.** Write everything in the language `context/writing-style.md`
  states the course uses; `course.config.yml`'s `language` key only picks the
  generated labels. Reply in chat in the language the author writes in.
- One assignment per call.
- Never change the assignment page or lesson plans outside an accepted step 7
  offer.
- No commits, no pushes, no staging.
- Run `npm run format` on what you wrote; Prettier owns markdown wrapping.

$ARGUMENTS
