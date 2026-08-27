---
name: course-context-update
description: Review course-design decisions and corrections the author settled in this conversation, and fold them into context/course-context.md as durable facts. Proposes the edits and applies them only after approval. Use for "update course context", "save this to the course context", "remember this course decision", "cursuscontext bijwerken", "onthoud deze cursusafspraak".
---

# Course Context Update

Turn course-design facts settled in the current conversation into permanent
entries in [`context/course-context.md`](../../../context/course-context.md), so
the lesson skills work from them instead of asking the same question next
session. The session-sized counterpart to `/course-context-init`, which fills
the whole document from the repo and an interview.

## Steps

1. **Scan the conversation** for course-design signals: learning goals and the
   notation used to reference them, assessment rules ("every goal is tested at
   least once", weights, allowed aids), teaching methods the author named,
   lesson-plan or module conventions they corrected, code and download rules,
   glossary decisions, and scope calls ("that belongs in the follow-up course").
   Separate a durable course fact from a one-off decision about the artefact in
   hand: only the first belongs in the document.

2. **Cluster the findings by the actual current headings of
   `course-context.md`**: read them at runtime, never assume the section list or
   its language. A Dutch course has Dutch headings and its own goal notation;
   the set of sections is fixed and ordered, the names are not. Each finding
   lands in one of two cases: a section still on `TODO` that the conversation
   now answers, or a filled section a new fact contradicts or sharpens.

3. **Propose the edits**: a concise list with the reason and the source in the
   conversation for each. For a `TODO` section, replace the `TODO` and drop that
   section's HTML guidance comment. For a filled section, propose a replacement
   rather than an append, and say which it is. Stop and wait for explicit
   approval, then apply with surgical, minimal edits so the author can review a
   small diff. Never reorder the sections: their order is the backward-design
   chain.

4. **Flag what this document cannot fix.** A course name or language settled in
   conversation also lives in `course.config.yml`; a changed goal notation
   leaves existing lesson plans, modules and evaluations spelling the old one,
   which is what `/coverage-map`, `/evaluation-design`, `/rubric-build`,
   `/quiz-build` and `/lesson-module-build` match on. Name these in the report
   and leave them to the author.

5. **Report what changed** per section, and hand off the rest: writing-style
   corrections to `/writing-style-update`, observations about a lesson you just
   taught to `/lesson-retro`.

## Rules

- **Language.** Write new content in the language `course-context.md` itself
  uses. Reply in chat in the language the author writes in.
- If the conversation holds no course-design signals, say so and stop. Do not
  invent facts, and do not go read the repo to find some: filling the document
  from the repo is `/course-context-init`'s job.
- Prefer concrete, checkable statements over intentions: "goals are referenced
  as `LG3` in each lesson plan's own goals section" beats "goals are clearly
  referenced".
- `context/course-context.md` is the only written artefact. No commits, no
  pushes, no staging.
- Run `npm run format` on the doc after editing; Prettier owns markdown
  wrapping.

$ARGUMENTS
