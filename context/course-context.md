# Course Context

> [!TIP]
>
> This document describes _your course_: its learning goals, assessment,
> pedagogy and conventions, so the lesson skills (`/lesson-design`,
> `/lesson-summarize`, `/lesson-module-build`) work from your material instead
> of guessing. It is the course-design companion to
> [writing-style.md](writing-style.md), which covers writing style only, and its
> sections run in backward-design order: what students should be able to do, how
> you will know they can, and only then how they get there. Run
> `/course-context-init` to fill it in (the skill reads your repo and interviews
> you for the rest) or edit it by hand; a section left on `TODO` counts as
> unanswered, and a skill that needs it will ask and offer to save the answer
> here; `/course-context-update` folds a working session's decisions in
> afterwards. Write it in whichever language you and your assistant work in.
> Dutch courses can copy
> [`templates/course-context-nl.md`](../templates/course-context-nl.md) over
> this file first. Keep the file in `protected_files` in
> `update-from-upstream.conf`, so upstream updates never overwrite your version.
> See [Customisation](../docs/customisation.md).

## Course Overview

<!-- Subject, course name, institution, programme, language of instruction,
students' level (year, prior knowledge, CEFR level if relevant), course length
(number of lessons/weeks, minutes per lesson). The machine-readable course name
and language settings live in course.config.yml (`title` names the preview site,
`language` drives generated labels and the site locale); keep them consistent
with what you write here. -->

TODO

## Learning Goals

<!-- The course's overarching learning goals: what a student can do at the end
of the course. List them here, or point to the document that holds them, and
state which programme or curriculum competencies each one concretises. Also
give the numbering scheme and the exact notation lesson plans, modules and
evaluations use to reference a goal (e.g. `LG3`): /coverage-map,
/evaluation-design and /rubric-build match on that notation. A lesson's own
goals are concretisations of these, not a parallel list; say here how a lesson
goal points back at the course goal it serves. -->

TODO

## Assessment

<!-- How the learning goals are evidenced. Per evaluation moment: its form
(exam, test, portfolio, project), when it falls, its weight in the final grade,
the question formats the course uses, the aids students may bring (open or
closed book, IDE, cheat sheet), and which goals it covers. State the alignment
rule the course holds itself to, for example that every goal is assessed at
least once, and that no goal is assessed above the level at which it was
practised. Evaluation material lives in `evaluations/<year>/`; name the most
recent one as the worked example. -->

TODO

## Pedagogy

<!-- The course's pedagogical approach, chosen to serve the learning goals
above. If a framework document exists in this repo, point to it here and
summarize only what the skills need. Also name recurring teaching methods (e.g.
live coding, PRIMM, worked examples) if lesson plans refer to them. -->

TODO

## Lesson Plans

<!-- Where full lesson designs live and how they are structured. Defaults the
skills assume when this section is TODO:
- Location and naming: `sources/lessons/lesson-NN.md` (two-digit number).
- Template: the lowest-numbered existing lesson plan is the structural worked
  example.
List here any required sections, timing conventions, or rules that a new
lesson plan must follow, including how a plan states its own goals and ties
them to the course goals above. -->

TODO

## Class Versions

<!-- Whether you distill lesson plans into one-page class versions (a teaching
reminder for in the classroom). Defaults: written to
`sources/lesson-plans/lesson-plan-NN.md`, mirroring the lesson-plan number;
content inventory as a plain concept list. If you group the inventory (e.g.
passive decor vs. actively practised vs. flagged-for-later), define the groups
and their labels here. -->

TODO

## Module Conventions

<!-- How a generated student-facing module under `course/` is built beyond
what docs/frontmatter.md and writing-style.md already define: the page roles and their
order (overview, content pages, reference cards, summary, glossary, homework),
which page types your course uses, per-page-type emoji or title conventions,
and any recurring page structure (e.g. a three-part reference-card layout).
Point to one or two existing modules as worked examples. -->

TODO

## Code and Downloads

<!-- Only for courses with code. The programming language(s), how downloadable
code projects in `_files/` are laid out (e.g. zip containing
`<project>/src/**` for IntelliJ), what must never end up in an archive
(IDE metadata, build files, compiled artifacts), and comment-language rules
for code samples. -->

TODO

## Glossary

<!-- Whether the course maintains a canonical glossary that generates
per-module glossary pages. Default when used:
`sources/reference-materials/glossary.yml`, rendered with
`npx course build-glossary` (see the command's --help for flags). State the
path, or state that the course has no glossary. -->

TODO

## Scope Boundaries

<!-- Topics deliberately outside this course, so design conversations flag
them instead of silently including them. List each with a one-line reason
(comes later in the programme, out of scope for the level, ...). -->

TODO
