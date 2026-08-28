# Didactic Foundations

Coursewright's suggested workflow and its skills are built on two ideas from
course-design research: backward design and constructive alignment. A third
element is home-grown: an improvement loop that feeds what happened in class
back into next year's material. This page names all three, shows where each
lives in the tooling, and draws the boundary that matters: they are a proven
base to start from, not a straitjacket. Every structure described here is a
default, and your own conventions in
[course-context.md](../context/course-context.md) override it. None of it is
tied to one destination: the module the workflow produces publishes to the
website, a handout and Canvas alike. The [lesson workflow](lesson-workflow.md)
page is the practical tour; this one is the reasoning behind it.

## Backward Design

Backward design (Wiggins & McTighe, 2005) plans a course in reverse: first what
students should be able to do, then how you will know they can, and only then
the teaching that gets them there. Deciding the destination and the evidence
first keeps the lessons from collapsing into a topic list.

In Coursewright that order is written into one file.
[course-context.md](../context/course-context.md) opens with learning goals,
then assessment, then pedagogy, and every lesson skill reads it top to bottom
before generating anything. The two skills that maintain the file
(`/course-context-init` and `/course-context-update`) refuse to reorder its
sections for the same reason: the order is the design chain. A lesson designed
with `/lesson-design` starts from the goals it serves, and its design brief
states how each lesson goal concretises a course goal.

## Constructive Alignment

Constructive alignment (Biggs, 1996) is the companion idea: goals, assessment
and teaching activities should point at the same thing, and at the same level. A
goal phrased as "apply" is not served by an exam that only asks students to
reproduce.

The skills make that checkable by sharing one vocabulary. A goal is **taught**
when a page explains it, **practised** when students do something with it
(exercises and homework count, reading a summary does not), **seeded** when a
lesson only mentions or previews it, and **assessed** when an evaluation tests
it. On top of that vocabulary:

- `/coverage-map` builds the goal-by-goal matrix and reports the gaps: goals
  never practised, practised but never assessed, assessed but never taught, and
  goals whose exam weight is out of proportion to their lesson time.
- `/evaluation-design` maps every question to a goal a lesson in scope actually
  practised, and flags a question that tests a goal above the level it was
  practised at.
- `/rubric-build` traces every criterion to a requirement in the assignment text
  or a learning goal, and reports requirements without a criterion and criteria
  without a basis.
- `/quiz-build` carries the goal of each question as a column in its blueprint
  and names the goals no question touches.

All of it matches on the goal notation you define once in `course-context.md`
(`LG3`, or whatever your programme uses).

## The Improvement Loop

A course design is a hypothesis until you teach it. `/lesson-retro` debriefs a
lesson right after class and routes each observation to where it changes next
year's delivery: timing corrections into the lesson plan, course-wide insights
into `course-context.md`, content errors into the issue queue for `/issue-fix`,
style corrections into the writing-style guide. Each retro also reads last
year's report for the same lesson and follows up: did the correction hold? A
pattern that returns retro after retro is promoted to a durable rule, so you
give the same feedback once instead of every year.

## The Quieter Patterns

A few smaller commitments run through all the skills, less famous but just as
deliberate:

- **Design first, write after approval.** Every generating skill proposes its
  design in chat and writes nothing until you approve it. The thinking is yours
  to check before any file exists.
- **Skills report, you decide.** A gap in coverage, a term used before its
  lesson, a question without a goal: the skills flag these and stop. Whether a
  gap is a problem is a course-design call, and that call is never automated.
- **Sequencing is checked.** `/consistency-check` flags a glossary term used in
  prose before the lesson that introduces it, and prerequisite references that
  point at the wrong lesson after a restructure. Concepts arrive in the order
  you planned.
- **Two registers.** Material under `course/` and `evaluations/` is written for
  students; material under `sources/` is written for you and your colleagues.
  The [writing style guide](../context/writing-style.md) defines both, and
  `/proofread` applies the right one by path.

## Defaults, Not Rules

None of this is enforced, and that is deliberate. You can run the whole pipeline
with the learning-goals section still on `TODO`: the skills ask instead of
refusing. Module structure, page roles, lesson-plan format, difficulty scheme,
the goal notation itself: each is a default that your `course-context.md` and
your existing material override, so a course adopting the tooling mid-run keeps
its own conventions. The same goes for teaching methods: live coding, PRIMM and
worked examples appear in the templates as examples, and the pedagogy section is
yours to fill with whatever your course actually does. Start from the base, keep
what serves you, and overrule the rest.

## Further Reading

The originals behind the two named ideas:

- Biggs, J. (1996). Enhancing teaching through constructive alignment. _Higher
  Education, 32_(3), 347–364. https://doi.org/10.1007/BF00138871
- Wiggins, G., & McTighe, J. (2005). _Understanding by design_ (Expanded 2nd
  ed.). ASCD.
