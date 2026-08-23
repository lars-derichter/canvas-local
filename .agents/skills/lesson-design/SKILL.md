---
name: lesson-design
description: Help draft a new lesson plan in sources/lessons/, following context/course-context.md and the colleague-facing register of context/writing-style.md. Accepts rough notes, a request for the next logical lesson, or pure Q&A. Phase A presents a design with pros/cons of the author's suggestions and its own; Phase B writes the draft only after approval. Use for "design lesson", "design the next lesson", "draft a lesson plan", "nieuwe les ontwerpen", "lesplan opzetten", "vervolg op les X".
---

# Lesson Design

Design a new lesson plan together with the author and write it to
`sources/lessons/lesson-NN.md` in the colleague-facing register of
[`context/writing-style.md`](../../../context/writing-style.md), following
[`context/course-context.md`](../../../context/course-context.md).

## Input

`$ARGUMENTS` may combine a lesson number (`lesson 4`, `les 4`, `4`), a path to a
notes file, and free text with intent, or the author simply asks for "the next
logical lesson". Three modes, combinable:

- **Notes**: the author's bullets are hard constraints, not suggestions to round
  out.
- **Progression**: a follow-up to an earlier lesson. Derive the scope from the
  course context and from what earlier lessons actively practised versus only
  seeded. Present two or three candidate directions neutrally with pros and
  cons; let the author choose before designing further.
- **Q&A**: only vague intent. Ask at most three sharp questions (bundled into
  one round): the moment in the course's running context, active versus seeded
  learning goals, ambition (calm / standard / bold), material constraints.

## Steps

### Phase A: Design (Writes Nothing)

1. **Read the fixed inputs**: `course-context.md` (pedagogy, learning-goal
   scheme, lesson-plan conventions, scope boundaries); follow the documents it
   points to, and for a needed section still `TODO`, infer the answer from the
   repo or ask, offering at the end to save it back; `context/writing-style.md`
   (shared rules plus the colleague-facing section); all existing files in
   `sources/lessons/` in full, tracking which learning goals are actively
   practised versus only seeded and the running context (project, storyline,
   case) at each point; the structural template (the lesson plan named in
   `course-context.md`, else the lowest-numbered existing lesson). If the folder
   is empty, propose a structure (goals, preparation, timed blocks, deliberate
   exclusions, notes-to-self), confirm it, and note it as a candidate for
   `course-context.md`.

2. **Confirm the lesson number** (from `$ARGUMENTS`, else the next free slot)
   with the author in one sentence.

3. **Present the design as a chat message** with these sections:
   - **One-sentence proposal**, in the voice of the template's opening line.
   - **Learning goals (proposal)**: 3–5 bullets tied to the course's
     learning-goal scheme in its reference notation. Say how each lesson goal
     concretises the course goal it serves. The goals are what the rest of the
     design answers to. If the course has no scheme, write plain goals and say
     so in one line, offering `/course-context-init` to define one; propose,
     never insist, and never block the design on it.
   - **Place in the course**: two sentences (the concrete moment in the running
     context, and what students bring from earlier lessons).
   - **Block structure in broad strokes**: blocks with activity and time budget;
     no full timing yet.
   - **Deliberate exclusions**: two or three, motivated from the course context.
   - **Pros and cons**, two sub-headings: _Your suggestions_: one bullet per
     author input element, what it gains and what it costs, no reflexive
     nodding; _My suggestions_: the same for what the skill adds or deviates,
     naming rejected alternatives and why.
   - **Open questions** the author must decide before a full draft.

   Adjust on request and stay in Phase A until the author explicitly approves.
   Stop. Wait for explicit approval before starting Phase B.

### Phase B: Draft (Only After Approval)

4. **Draft and write the lesson plan** with the template lesson's structure,
   section order, heading levels, and separators. Typical elements (the template
   wins where it differs): title plus a 2–4-sentence opening (which lesson, what
   the previous one delivered, where this one heads); the approved learning
   goals in the template's notation; the place in the running context and what
   the lesson must deliver; **Preparation** (teacher setup, what students
   already have); **Timed blocks** adding up to the course's lesson length,
   breaks included, with code or material samples where they carry the
   explanation, not as decoration; **Deliberate exclusions**, each motivated in
   one sentence; **Notes to self**: only tips not already elsewhere (timing
   pitfalls, reserve activities, anticipated questions). Where the lesson
   introduces a future student-facing reference page (card, cheat sheet), name
   it in the block prose the way existing lessons do, so `/lesson-module-build`
   can pick it up. Apply the colleague-facing checklist of
   `context/writing-style.md` to the whole draft: no student-facing conventions
   (page-title emoji, student callouts) unless `writing-style.md` says
   otherwise. Then write the file in one `Write`.

5. **Update the glossary, only if the course has one** (Glossary section of
   `course-context.md`). Add the technical terms a student meets for the first
   time in this lesson to the canonical glossary file, per that file's own
   conventions: skip what is already a lemma or a synonym under another lemma;
   never standardise on a synonym or invent one; definitions of one or two
   sentences in the voice of the existing entries, tagged with this lesson's
   number. If in doubt whether a term belongs, ask the author in one bundled
   question. Page regeneration happens in `/lesson-module-build`, not here.

6. **Report and offer follow-ups, do not run them**: `/proofread` on the new
   plan, `/lesson-summarize` for the one-page class version,
   `/lesson-module-build` when the lesson is ready to become a module, and
   saving gathered course facts into `course-context.md`.

## Rules

- **Language.** Write everything in the language `context/writing-style.md`
  states the course uses; `course.config.yml`'s `language` key only picks the
  generated labels. Reply in chat in the language the author writes in.
- Mirror the template lesson plan's conventions, not `course/`'s.
- Do not invent learning goals or activities that follow from neither the
  author's input nor the course context; your own initiative belongs under _Pros
  and cons: my suggestions_.
- If the author raises a topic listed under the scope boundaries in
  `course-context.md`, flag it and propose an alternative. Never silently comply
  or silently drop it.
- One lesson per call. Never change existing lessons; the only written artefacts
  are the new `lesson-NN.md` and, when applicable, new glossary entries.
- No commits, no pushes, no staging.

$ARGUMENTS
