# Lesson Workflow

Canvas Course Builder includes a set of [AI-assistant](ai-assistants.md) skills
that take a lesson from rough idea to published Canvas module. Using them is
optional — you can keep writing modules by hand — but together they form a
complete authoring flow.

## Where to Start

Not with lesson one. The skills are built around a chain that runs backwards
from what you want to be true at the end:

```
what students should be able to do        (learning goals)
   ↓
how you will know they can                (assessment)
   ↓
what gets them there                      (lessons)
   ↓
what they read and hand in                (the module under course/)
```

This is [backward design](#further-reading): decide the destination and the
evidence first, and the teaching follows from both. Its companion idea is
constructive alignment — that goals, assessment and teaching activities should
point at the same thing, and at the same level. A goal phrased as "apply" is not
served by an exam that only asks students to reproduce.

You write the first two links of that chain into
[course-context.md](../context/course-context.md), once, and every skill reads
them from there. That is why the file's sections run in that order, and why
`/coverage-map` can tell you which goals are taught but never assessed.

Nothing enforces this. You can run the whole pipeline with the goals section
left as `TODO`, and the skills will ask instead of refusing. But a course whose
goals are written down is one where the skills stop guessing, and where
`/evaluation-design` can flag a question that tests something no lesson
practised.

**Adopting mid-course?** Skip ahead to
[Adopting the workflow mid-course](#adopting-the-workflow-mid-course). You do
not have to start over to start here.

## The Pipeline

```
idea/notes
   │  /lesson-design
   ▼
sources/lessons/lesson-NN.md          (full lesson plan, for you and colleagues)
   │  /lesson-summarize                │  /lesson-module-build
   ▼                                   ▼
sources/lesson-plans/                 course/NN-<slug>/
lesson-plan-NN.md                     (student-facing module)
(one-page class version)                 │  /proofread, npm start
                                         ▼
                                      npx course push
```

## The Two Registers

The workflow produces material for two audiences, defined in
[writing-style.md](../context/writing-style.md):

- **Colleague-facing** — the lesson plan and class version under `sources/`.
  Written for you and fellow teachers; never served by Docusaurus or synced to
  Canvas.
- **Student-facing** — the module under `course/`; served by Docusaurus and
  pushed to Canvas.

## Course Context

All lesson skills read [course-context.md](../context/course-context.md) first:
your course's learning goals, assessment, pedagogy, lesson-plan template, module
page roles, code-download conventions, glossary, and scope boundaries. Its
sections follow backward design — goals, then the evidence for them, then the
teaching that gets students there — so a lesson design starts from the goals it
serves rather than from the topic list. Run `/course-context-init` once to fill
it in; the skills ask about (and offer to record) anything it doesn't cover yet,
and `/course-context-update` folds a working session's decisions in afterwards.
The richer that file, the less the skills need to ask.

## Steps

1. **Design** — `/lesson-design` turns notes, a "next logical lesson" request,
   or a Q&A conversation into a full lesson plan at
   `sources/lessons/lesson-NN.md`. It always proposes a design first — with pros
   and cons of your ideas and its own — and writes only after you approve.
2. **Class version** (optional) — `/lesson-summarize` distills the plan into a
   one-page teaching reminder at `sources/lesson-plans/lesson-plan-NN.md`.
3. **Build** — `/lesson-module-build` converts the plan into a student module
   under `course/`: overview, content pages, reference cards (if your course
   uses them), summary, glossary page, homework assignment, downloadable code
   archives, and placeholder images with TODO notes. Again design-first,
   write-after-approval.
4. **Check and publish** — `/proofread` the new pages, preview with `npm start`,
   then `npx course push`.

See [ai-assistants.md](ai-assistants.md) for what each skill does in detail.

## The Glossary Pipeline

If your course maintains a canonical glossary, per-module glossary pages are
_generated_, never hand-written:

- The canonical source is one YAML file, by default
  `sources/reference-materials/glossary.yml`:

  ```yaml
  # Optional; defaults shown. Lives in the glossary file itself so your
  # settings survive upstream updates.
  config:
    title: "📘 Glossary"            # forced page title
    page_pattern: "glossary\\.md$"  # which page files to (re)generate
    module_pattern: "^(\\d+)"       # folder regex that yields the lesson number
    intro: "This is the glossary as it stands after lesson {lesson}. ..."
    kinds: [concept, code, operator]
    code_kinds: [code, operator]    # kinds rendered as inline code
    headings:
      operators: Operators
      terms: Terms

  terms:
    - term: variable
      lesson: 1
      kind: concept
      synonyms: []
      definition: A named box that holds a value.
    - term: "&&"
      lesson: 2
      kind: operator
      synonyms: []
      definition: Logical and.
  ```

- `npx course build-glossary` rewrites every matching module page as the
  cumulative list of all terms up to that module's lesson number. The lesson
  number comes from a `lesson:` frontmatter key on the page, or else from
  `module_pattern` applied to the folder name (by default the module's numeric
  prefix).
- `npx course build-glossary --check` verifies the pages are up to date without
  writing — useful before a push.
- Regeneration is safe on an already-synced page. Which Canvas page it is lives
  in `.canvas-sync.json`, keyed by the file's path, so rewriting the body cannot
  break the link; and the page's existing frontmatter is carried over rather
  than replaced.

New terms enter the YAML file when you design a lesson (`/lesson-design` adds
them) or build a module; the pages then follow from one command.

## Assessment

The second link in the chain, and the one it is easiest to leave until it is too
late to change anything. The same design-first pattern applies: the first three
skills form a pipeline — `/evaluation-design` produces the approved blueprint,
`/quiz-build` turns approved questions into a Canvas-import zip, and
`/rubric-build` adds the grading criteria — but each also works on its own:

- `/evaluation-design` — draft an exam or test, starting from a blueprint matrix
  (learning goals × questions × difficulty) that flags over- and under-tested
  goals. It refuses to test what no lesson in scope actually practised.
- `/rubric-build` — a grading rubric for an assignment, every criterion traced
  to the assignment text or a learning goal.
- `/quiz-build` — a QTI package Canvas imports as a quiz, from a question list
  or straight from your lessons. The questions are import-only, by hand: what
  syncs is a reference file holding the quiz's place in a module. See
  [Limitations](limitations.md#quiz-questions-never-sync).
- `/coverage-map` — the whole-course picture: which goals are taught, practised,
  and assessed, and where the gaps are. This is the alignment check; run it
  before you write an exam, not after.

Written in full, before the lessons, the blueprint is what a course design
starts from. Written after, it is a report on what you happened to teach. The
skills work either way and it is your call — but that is the difference the
first section of this page is pointing at.

## After Teaching: The Retro

`/lesson-retro` closes the loop. Right after a lesson, it interviews you — one
question at a time — about timing, comprehension, what worked, and material
friction, then folds timing corrections and notes-to-self back into the lesson
plan and course-wide insights into `course-context.md`. Next year's version of
the lesson starts better than this year's. Content fixes for the student pages
that surface in the retro can be logged with `/issue-report` so `/issue-fix`
picks them up later.

## Course Quality

Two report-only sweeps complement the single-file `/proofread`:

- `/consistency-check` — dead links, terms used before their introducing lesson,
  glossary drift, numbering and frontmatter problems across all modules.
- `/image-todos` — every placeholder image and image-TODO block still waiting
  for real artwork.

For the findings you stumble on yourself while reviewing, `/issue-report` is the
retail counterpart of those wholesale sweeps: it logs one error or wanted change
into `sources/issues.md` with at most one question, so you stay in your
reviewing flow. Later, `/issue-fix` triages the whole queue — checking whether
each fix has wider implications, from the same defect on other pages to a style
rule that belongs in `writing-style.md` — and applies the fixes after you
approve its plan.

## Adopting the Workflow Mid-Course

Nothing requires starting from scratch. Point `course-context.md` at your
existing modules as worked examples, put any existing lesson plans in
`sources/lessons/` (numbered `lesson-NN.md`), and the skills pick up your
conventions from there.

The same goes for the design chain at the top of this page. A course already
running has its lessons; what it often lacks is the goals written down and the
alignment checked. Run `/course-context-init` to get the goals on paper, then
`/coverage-map` to see which of them your existing material actually teaches,
practises and assesses. Fixing the gaps it finds is cheaper than redesigning
anything.

## Further Reading

The two ideas this workflow is built on, if you want the originals:

- Biggs, J. (1996). Enhancing teaching through constructive alignment. _Higher
  Education, 32_(3), 347–364. https://doi.org/10.1007/BF00138871
- Wiggins, G., & McTighe, J. (2005). _Understanding by design_ (Expanded 2nd
  ed.). ASCD.
