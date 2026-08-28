---
name: ai-policy-build
description: Interview the teacher and write a student-facing AI-use policy page into the course's AI module under course/, replacing the stub /ai-tutor-build leaves, from one of three starting points: the AI Assessment Scale (AIAS), the two-lane approach, or a custom one-off policy from a deeper interview; then offer /course-context-update to record the decisions under Assessment in context/course-context.md. Phase A explains the starting points, interviews and proposes an outline, then stops for approval; Phase B writes the page. Use for "build AI policy", "write the AI rules for my course", "AI-use policy page", "AI-beleid opstellen", "AI-afspraken schrijven", "AI-regels voor mijn vak".
---

# AI Policy Build

Write the page that tells students where AI may help them in this course and
where it may not: one student-facing policy page in the course's AI module,
built from an interview with the teacher and one of three starting points. The
rules are the teacher's; the skill brings the vocabulary, the questions and the
page shape.

## Input

`$ARGUMENTS` may hold a starting point (`aias`, `two-lane`, `both` or `custom`),
a target path for the page, an institution policy (pasted, or a path or URL that
holds it), and/or free text. `both` means the lanes name the supervised moments
and the AIAS levels the open ones. Empty means: read the course and offer all
three starting points.

## Steps

### Phase A: Interview (Writes Nothing)

1. **Read**, in order:
   [`context/course-context.md`](../../../context/course-context.md): Assessment
   (the evaluation moments, their form, the aids allowed), Pedagogy, Scope
   Boundaries, and Course Overview for language and level. For a needed section
   still `TODO`, ask once and offer `/course-context-update` at the end to
   record the answer. Then
   [`context/writing-style.md`](../../../context/writing-style.md) (the page
   uses the student-facing register),
   [`docs/frontmatter.md`](../../../docs/frontmatter.md), the AI module under
   `course/` (the policy stub `/ai-tutor-build` leaves, marked by a TODO comment
   that names this skill, or an existing policy page: search page titles for AI
   and policy words in the course language and ask when unsure), and
   [`references/frameworks.md`](references/frameworks.md). When the course has
   no AI module, propose a location for the page or `/ai-tutor-build` first, and
   stop.

2. **Offer three starting points**, a few lines each in chat, taken from
   `frameworks.md`: the AIAS levels; the two-lane approach; and a custom one-off
   policy for when neither fits or both feel like overkill (a small course, a
   single assessment moment, an institution policy that already fixes the rules,
   a stance the frameworks do not express). Name the combination too: Lane 1 is
   AIAS level 1, and AIAS levels 2 to 5 live inside Lane 2. Recommend one from
   what Assessment says about the evaluation moments. The teacher chooses.

3. **Interview.** A shared core, bundled per assessment moment (homework,
   projects, tests, exams: whatever Assessment lists): what AI use is allowed
   there; the disclosure rule (a one-line "AI used for: …" note on every
   submission, or none); which tools are disallowed; whether tests are AI-free
   and how that is checked (IDE assistants off, supervision, a declaration); an
   institution policy to name or link; an annual review note. With a framework,
   ask for the level or the lane per moment, in the framework's own terms. With
   custom, go deeper, in follow-up rounds, until the intent is unambiguous: the
   reason behind the stance (what the teacher wants students to learn by doing
   it themselves, and why); the grey zones decided one by one (brainstorming,
   having something explained, translation, code completion, proofreading,
   generating examples, summarising sources); what happens when the rule is
   broken and whether students are told; how the rule differs between homework,
   projects and tests; what the teacher would answer a student who asks "may I
   use it for X"; the tone (trust-based or enforcement). Then play the draft
   rules back as short student-facing sentences and ask the teacher to correct
   each one before proposing the page.

4. **Propose the page outline**: the title (📘, per the legend in
   `writing-style.md`); an intro on why the course draws the line where it does;
   a summary table (assessment moment by what is allowed); one section per
   moment; the disclosure rule; the tools; links to the prompt pages of the AI
   module; an `[!IMPORTANT]` on why the rules are in the student's own interest;
   and a closing `[!NOTE]` with the review note. With a framework, one short
   line names it and links its resource site; with custom, no framework mention.
   Add the exact text to record under Assessment in `course-context.md`.

   Adjust on request and stay in Phase A. Stop. Wait for explicit approval
   before starting Phase B.

### Phase B: Write (Only After Approval)

5. **Write the page** in the outline approved in step 4: replace the stub in
   place, same filename, so the prompt pages' links hold; without a stub, create
   `01-<slug>.md` in the AI module. Student-facing register. A student page
   carries no reference list; the framework line with its link is all it says
   about the source. The rules are the ones confirmed in step 3, nothing more.

6. **Checks**: `npm run lint:links`.

7. **Report in chat**: the path; the decisions recorded; the offer to run
   `/course-context-update` with the exact Assessment text from step 4; a
   reminder that the rules are reviewed every year, so the page needs a date in
   the calendar. `npx course push` is the author's to run.

## Rules

- **Language.** Write everything in the language `context/writing-style.md`
  states the course uses; `course.config.yml`'s `language` key only picks the
  generated labels. Reply in chat in the language the author writes in.
- Never invent institution policy. When the teacher has none and wants to add it
  later, write a visible `TODO` where the link would go.
- Never edit `context/course-context.md`, its template, or any page other than
  the policy page.
- Framework claims come from `references/frameworks.md` only.
- A custom policy contains nothing the teacher did not confirm in the interview.
- No commits, no pushes, no staging.
- Run `npm run format` on the markdown you wrote; Prettier owns markdown
  wrapping.

$ARGUMENTS
