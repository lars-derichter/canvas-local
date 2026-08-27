---
name: lesson-summarize
description: Generate a concise class version (one-page teaching reminder) of a full lesson plan from sources/lessons/ and write it to sources/lesson-plans/. Writes without an approval phase; asks before overwriting an existing class version. Use for "summarize lesson", "class version", "make a one-page teaching reminder", "klasversie maken", "bondig lesplan", "lesplan samenvatten".
---

# Lesson Summarize

Turn a full lesson design under `sources/lessons/` into a class version under
`sources/lesson-plans/`: one page (think A5) with learning goals, content, and
timeline in telegram style: a teaching reminder for in the classroom, nothing
more. It writes without an approval phase: the class version is a low-stakes
derivation of an already-approved lesson plan.

Conventions come from the Class versions section of
[`context/course-context.md`](../../../context/course-context.md); the
lowest-numbered file under `sources/lesson-plans/` (if any) is the worked
example to mirror. Where both are silent, use the defaults below.

## Input

`$ARGUMENTS` may hold a path. If empty, use the file open in the IDE when it is
under `sources/lessons/`; otherwise ask. Stop with one sentence if the file is
not a `.md` under `sources/lessons/`.

## Steps

1. **Determine the destination**: `sources/lessons/lesson-NN.md` →
   `sources/lesson-plans/lesson-plan-NN.md`. If it already exists, show its
   contents and ask whether to overwrite, merge, or stop.

2. **Read**: the source lesson in full; `course-context.md`, the Class versions
   section (grouping labels) and the Learning goals section (the goal-reference
   notation); if Class versions is still `TODO`, use the defaults below and
   offer at the end to record the choices made;
   [`context/writing-style.md`](../../../context/writing-style.md), shared rules
   plus the colleague-facing section; the worked example, if any.

3. **Check the source's learning goals.** The source must state lesson-specific
   goals in the course's notation. If they are missing, stop and tell the author
   to first bring the source in line with the course's lesson-plan format. Do
   not repair it here.

4. **Draft the class version.** Fixed structure (the worked example wins where
   it deviates). The section names below are roles, not literal headings, so
   translate them into the course language (a Dutch course heads these
   `Leerdoelen`/`Inhouden`/`Tijdslijn`). The worked example, if there is one,
   already carries the course's own wording; follow it.
   - **H1** identical to the source title, then a single pointer line linking to
     the source and noting this is a teaching reminder, not a design document.
   - **Learning goals**: one telegram-style line per goal (kernel verb +
     object), the goal-reference notation in compact form, 3–6 items.
   - **Content**: the lesson's concepts as a compact list, using the inventory
     groups from `course-context.md` if it defines them (omit empty groups).
   - **Timeline**: chronological bullets, each starting
     `**HH:MM–HH:MM (N min): Activity name.**`, then short fragments: no
     rationale, no "why". Breaks get one sentence. Concrete decisions stay: key
     examples, commands, links to homework scaffolds, the exit-ticket question.
   - **Optional, only if the source has them**: reserve activities (one line),
     materials (one line).

   Leave out: pedagogical rationale, deliberate-exclusion considerations,
   notes-to-self, class management (unless the author explicitly asks), and long
   code blocks. Replace those with a short inline reference to the example's key
   tokens.

5. **Fit the page**: aim for ~30–40 rendered lines (one A5 page must remain
   plausible). Too long? Tighten the timeline first; goals and content are
   already terse.

6. **Style-check** against the colleague-facing rules of
   `context/writing-style.md` (no page-title emoji, no student callouts), then
   write the destination file and report the path.

7. **Offer follow-ups, do not run them**: a print preview to confirm the page
   fits, `/proofread` on the result, recording any grouping or heading choices
   `course-context.md` did not cover.

## Rules

- **Language.** Write everything in the language `context/writing-style.md`
  states the course uses; `course.config.yml`'s `language` key only picks the
  generated labels. Reply in chat in the language the author writes in.
- Mirror the worked example under `sources/lesson-plans/`, not `course/`.
- Never invent activities or goals not in the source; if something belongs on
  the page but is missing from the source, surface the gap and stop.
- Do not modify the source lesson. No commits, no pushes, no staging.
- Run `npm run format` on the file you wrote; Prettier owns markdown wrapping.

$ARGUMENTS
