---
name: coverage-map
description: Cross-reference the course's learning goals against lessons, modules, and evaluations and report alignment gaps: goals never practised, practised but never assessed, assessed but never taught. Structure, links, and numbering are /consistency-check's job. Report-only; offers to save the report as a file but writes nothing by default. Use for "coverage map", "learning-goal coverage", "which goals are never tested", "leerdoelendekking", "dekkingsmatrix", "welke leerdoelen zijn nog niet getest".
---

# Coverage Map

Cross-reference the course's learning goals with the lesson plans under
`sources/lessons/`, the student modules under `course/`, and the assessment
material under `evaluations/`, following the learning-goal scheme defined in
[`context/course-context.md`](../../../context/course-context.md). Report which
goals are taught, practised, and assessed, and where the gaps are.

## Input

`$ARGUMENTS` may narrow the scope: a goal reference (in the course's own
notation), a lesson number, or an evaluation folder (e.g. `2526`). Empty means
the whole course.

## Steps

1. **Read the learning-goal scheme.** Read
   [`context/course-context.md`](../../../context/course-context.md),
   specifically the Learning goals section: the course-wide goals and the exact
   notation lesson plans use to reference them. Read the Assessment section too,
   for the alignment rule the course holds itself to and the weight each
   evaluation carries. Follow any framework document they point to.
   - If Learning goals is `TODO`, infer the scheme from the lesson plans under
     `sources/lessons/` (a consistent goal notation across plans counts as a
     scheme). If that fails, ask the author once, and at the end offer to save
     the answer into `course-context.md`.
   - If the course turns out to have no explicit learning-goal scheme at all,
     say so, offer `/course-context-init` to help define one, and stop. Do not
     invent goals to map.

2. **Read the teaching side.** Every lesson plan in `sources/lessons/`, in full.
   Per plan, record which goals the lesson **actively practises** versus which
   it only **seeds** (mentions, previews, uses passively). Follow the plan's own
   labels where it makes that distinction; otherwise judge from the block
   descriptions and say so in the report.

3. **Read the practice side.** Every module under `course/`. What students
   themselves work through counts as **practised**: exercise sections on content
   pages and homework pages (`canvas_type: assignment` or the page role
   `course-context.md` defines). Pure reading pages (overview, summary,
   reference cards, glossary) count as taught, not practised.

4. **Read the assessment side.** Everything under `evaluations/`. Per question
   or task, record which goal(s) it assesses, using the material's own goal
   references where present and careful inference where not. Flag inferred
   mappings as such. Note roughly how much weight (points, question count) each
   goal carries.

5. **Classify per goal**: taught / practised / assessed, each with the file(s)
   and lesson number(s) that back the claim. A goal can hold any combination,
   including none.

6. **Report in chat.** In this order:
   - A compact matrix, goals as rows, lessons and evaluations as columns, one
     mark per cell (e.g. `T` taught, `P` practised, `A` assessed, `s` seeded
     only). Keep it readable; split it if the course is wide.
   - **Gap lists**, each entry citing its evidence:
     - Goals never practised (taught or seeded, but no student work).
     - Goals practised but never assessed.
     - Goals assessed but never taught.
     - Goals whose assessment weight is out of proportion to their teaching time
       (heavy on the exam, thin in the lessons, or the reverse). State both
       numbers.
   - One-line totals: goals covered end-to-end versus goals with gaps.

   If every goal is taught, practised, and assessed in reasonable proportion,
   say the course is aligned and stop. Do not invent findings.

7. **Offer, do not do**: save the report as a dated markdown file under
   `sources/reports/` (e.g. `sources/reports/coverage-map-YYYY-MM-DD.md`). Only
   write it when the author says yes.

## Rules

- **Language.** Report in the language the author writes in; goal references and
  quoted material keep the wording the course uses.
- Read-only by default. The only file this skill may ever write is the report
  under `sources/reports/`, and only on explicit request.
- Mechanical gaps only. Whether a gap is a _problem_ is the author's call; do
  not editorialise about the course design beyond the four gap lists.
- Every claim cites file(s). A cell in the matrix without evidence is an empty
  cell, not a guess.
- Mark inferred goal mappings (step 4) explicitly; do not present them with the
  same confidence as explicit references.
- No commits, no pushes, no staging.

$ARGUMENTS
