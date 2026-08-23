---
name: evaluation-design
description: Design an exam or test in evaluations/ from the lessons taught so far, following context/course-context.md and the student-facing register of context/writing-style.md. Phase A proposes a blueprint matrix (learning goals × questions × difficulty) and flags over- and under-tested goals; Phase B writes the evaluation only after approval. Use for "design evaluation", "design a test", "write an exam on lessons 1 to 4", "toets ontwerpen", "examen opstellen", "test maken over les 1 tot 4".
---

# Evaluation Design

Design an exam or test together with the author and write it under
`evaluations/<year>/<slug>/`, following
[`context/course-context.md`](../../../context/course-context.md). The
evaluation itself is student-facing material per
[`context/writing-style.md`](../../../context/writing-style.md); the
accompanying blueprint is colleague-facing.

## Input

`$ARGUMENTS` may combine an evaluation name or type (`test 1`, `exam`, `resit`,
`examen`, `herexamen`), a lesson range (`lessons 1 to 4`, `les 1 tot 4`, or
"everything taught so far"), a path to a notes file with question ideas or
constraints, and free text with intent. If the scope is not given, default to
every lesson with a plan in `sources/lessons/` and confirm the range in one
sentence.

## Steps

### Phase A: Blueprint (Writes Nothing)

1. **Read the fixed inputs**: `course-context.md`, the Learning goals section
   (the goals and their reference notation), the Assessment section (evaluation
   moments, weights, question formats, allowed aids, and the course's alignment
   rule), pedagogy, scope boundaries; for a needed section still `TODO`, infer
   the answer from the repo or ask, offering at the end to save it back;
   `context/writing-style.md` (shared rules plus the student-facing section);
   every lesson plan in scope, in full, tracking per lesson which learning goals
   were actively practised versus only seeded and how much lesson time each goal
   received; existing evaluations under `evaluations/` as worked examples (the
   most recent is the structural template). If none exist, the Phase A proposal
   doubles as a proposal for the evaluation format. Confirm it explicitly.

2. **Confirm the destination** in one sentence: the highest-numbered
   academic-year folder under `evaluations/` (e.g. `2526/`) unless the author
   says otherwise, plus a slug mirroring existing siblings (`test1`, `exam`).

3. **Settle the practicalities** before designing questions, from the Assessment
   section of `course-context.md` first, then the worked example, then the
   author (bundle open ones in one question round): duration, total points,
   question formats the course uses, allowed aids (open/closed book, IDE, cheat
   sheet), and the evaluation's weight in the course grade if the instructions
   must state it.

4. **Present the blueprint in chat** with these sections:
   - **One-sentence proposal**: what the evaluation covers, in what form.
   - **Blueprint matrix**: one row per question: number, short description,
     learning goal(s) tested (in the course's reference notation), difficulty
     (reproduction / application / transfer, or the course's own scheme),
     points. A per-goal summary axis is fine if the matrix gets wide.
   - **Coverage check**: goals in scope the matrix does not test, goals whose
     point weight is disproportionate to their lesson time, and goals tested
     only at reproduction level while the lessons practised application. Flag
     each; propose a correction or a motivated acceptance.
   - **Pros and cons**, two sub-headings as in `/lesson-design`: _Your
     suggestions_: one bullet per author input element, honest; _My
     suggestions_: the same for what the skill adds, naming rejected
     alternatives and why.
   - **Open questions** the author must decide before Phase B.

   Adjust on request and stay in Phase A until the author explicitly approves.
   Stop. Wait for explicit approval before starting Phase B.

### Phase B: Write (Only After Approval)

5. **Write the evaluation** to `evaluations/<year>/<slug>/instructions.md`,
   mirroring the worked example (or the format agreed in Phase A): full question
   text, points per question, the agreed practicalities. Student-facing register
   of `context/writing-style.md`; code in questions follows the course's code
   conventions from `course-context.md`.

6. **Write the blueprint** to `evaluations/<year>/<slug>/blueprint.md`: the
   approved matrix, the coverage notes, and a model answer or scoring hint where
   a question needs one. Colleague-facing; never handed to students.

7. **Style-check `instructions.md`** against the student-facing rules of
   `context/writing-style.md`, then report both paths and offer follow-ups, do
   not run them: `/proofread` on `instructions.md`, `/rubric-build` for open
   questions, `/quiz-build` if part should become a Canvas quiz, `/coverage-map`
   for the whole-course picture, saving gathered facts into `course-context.md`.

## Rules

- **Language.** Write everything in the language `context/writing-style.md`
  states the course uses; `course.config.yml`'s `language` key only picks the
  generated labels. Reply in chat in the language the author writes in.
- Test only what was taught: every question maps to a learning goal a lesson in
  scope actively practised; a question on merely-seeded or out-of-scope material
  must be flagged in Phase A, never slipped in.
- Do not invent learning goals. If the course has no explicit goal scheme,
  derive per-lesson goals from the lesson plans and say you did so.
- `evaluations/` is never served by Docusaurus or synced to Canvas; still keep
  filenames lowercase and hyphenated like the rest of the repo.
- Never change lesson plans, course modules, or other evaluations.
- No commits, no pushes, no staging.

$ARGUMENTS
