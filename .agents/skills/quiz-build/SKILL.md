---
name: quiz-build
description: Turn a question list into a QTI 1.2 package that Canvas can import as a quiz, plus import instructions. Phase A maps every question to a supported QTI type and stops for approval; Phase B generates and verifies the .zip. Use for "build quiz", "make a Canvas quiz from these questions", "generate QTI", "quiz maken", "QTI genereren", "Canvas quiz van deze vragen".
---

# Quiz Build

Convert a list of questions into a QTI 1.2 `.zip` that imports into Canvas as a
quiz, written under `evaluations/<year>/<slug>/`. No Canvas API is involved —
import happens through the Canvas UI, and the instructions land in the companion
file.

## Input

`$ARGUMENTS` may hold a path to a question list (markdown), a quiz title, and/or
free text. Question sources, in order of preference: a markdown file given as a
path (e.g. a `blueprint.md` from `/evaluation-design`); questions drafted
earlier in the conversation; or nothing yet — then draft questions from the
lesson plans in scope as part of Phase A, after reading
[`context/course-context.md`](../../../context/course-context.md).

## Supported Question Types

Canvas's QTI 1.2 import understands these `question_type` values; map every
question to one:

| Type                          | `question_type`             |
| ----------------------------- | --------------------------- |
| Multiple choice (one correct) | `multiple_choice_question`  |
| Multiple answers              | `multiple_answers_question` |
| True/false                    | `true_false_question`       |
| Short answer (exact text)     | `short_answer_question`     |
| Numerical answer              | `numerical_question`        |
| Essay (manually graded)       | `essay_question`            |

A question that fits none of these (matching, ordering, hotspot, code execution)
is flagged in Phase A: propose a rephrasing into a supported type or a downgrade
to `essay_question`, and let the author choose.

## Steps

### Phase A — Inventory (Writes Nothing)

1. **Read** [`context/writing-style.md`](../../../context/writing-style.md) —
   question text is student-facing — and the question source; draft questions
   now, in chat, if they must come from lessons. Read the Learning goals section
   of [`context/course-context.md`](../../../context/course-context.md) too,
   unless it is `TODO`.

2. **Confirm the destination** in one sentence: `evaluations/<year>/<slug>/`,
   with the year folder the highest-numbered under `evaluations/` and the slug
   from the quiz title.

3. **Propose in chat**: quiz title; per question a numbered row with the
   (shortened) text, the mapped `question_type`, the correct answer(s), and
   points — for multiple choice, all options with the correct one marked; the
   total; and the flag list from the type mapping above.

   Add the **learning goal** each question serves, in the course's own notation,
   as a column on that same row. Questions that arrived from an
   `/evaluation-design` blueprint carry theirs already. Below the table, name
   any goal in scope that no question touches, and any question serving no goal.
   Report it and let the author decide; never drop or invent a question over it.
   Skip the column and the paragraph when the course states no goals — say so in
   one line rather than guessing, and offer `/course-context-init`.

   Stop. Wait for explicit approval before starting Phase B.

### Phase B — Generate (Only After Approval)

4. **Generate the package with a throwaway Node script** in the session
   scratchpad — never hand-write the XML; the script must escape question text
   properly (`&`, `<`, `>`, quotes). Package layout and per-item XML: read
   [`references/qti-12.md`](references/qti-12.md) first.

5. **Build and verify.** Build the zip in the scratchpad, then `cp` it to
   `evaluations/<year>/<slug>/<slug>-qti.zip` (never let `zip` write directly
   into a cloud-synced folder). Verify: `unzip -l` shows exactly the manifest
   and the assessment XML; both XML files parse (`xmllint --noout` if available,
   else a Node sanity check for balanced tags and escaped `&`); question count
   and per-item `question_type` and points match Phase A.

6. **Write the companion file** `evaluations/<year>/<slug>/questions.md`: the
   approved question list with correct answers and points (colleague-facing —
   the readable source of truth for the zip), plus an import section titled in
   the course language ("Importing into Canvas"; a Dutch course would title it
   "Importeren in Canvas") with these steps:
   1. Canvas → course → **Settings** → **Import Course Content**.
   2. Content Type **QTI .zip file**; choose the generated zip.
   3. Leave the default question bank; check **Import existing quizzes as New
      Quizzes** only if the course uses New Quizzes.
   4. **Import**, wait for _Completed_ under Current Jobs.
   5. The quiz appears under **Quizzes**, unpublished. Check every question and
      point value, set availability dates and time limit (QTI does not carry
      those), then publish.

7. **Offer to place the quiz in a module.** Push only puts a quiz in a Canvas
   module when `course/` holds a reference file for it, and
   `npx course new-item` has no quiz type — so ask whether the author wants one
   and in which module, then write it by hand:
   `course/<NN-module>/<NN-slug>.md`, frontmatter only, with `title` exactly the
   quiz title, `canvas_type: quiz`, and `quiz_ref` the zip's path **from the
   repository root**. The body stays empty; the questions live in the package
   and in Canvas. Fields and their rules:
   [`docs/frontmatter.md`](../../../docs/frontmatter.md#quiz).

   Name the order this imposes: import the package first, because push places
   the item and never creates a quiz. Push a title the course does not hold yet
   and that item is refused — with the step 6 procedure as the error message.

8. **Report in chat**: every path written, question count, total points, a
   pointer to the import section in `questions.md`, and a reminder that a
   re-import creates a second quiz — delete the old one in Canvas after
   replacing it.

## Rules

- **Language.** Write everything in the language `context/writing-style.md`
  states the course uses; `course.config.yml`'s `language` key only picks the
  generated labels. Reply in chat in the language the author writes in.
- QTI only, and no Canvas API calls from here: Canvas has no API for a QTI
  import, so the package goes in by hand. Sync does track quizzes, but only as a
  reference — which quiz sits where in a module, never its questions
  ([Limitations](../../../docs/limitations.md#quiz-questions-never-sync)).
- Every non-essay question needs a correct answer on record before Phase B.
  Never guess a correct answer; ask.
- Generated code, ids, and filenames: lowercase, hyphenated, ASCII.
- No commits, no pushes, no staging.

$ARGUMENTS
