---
name: course-context-init
description: Read the repo and interview the user to fill in or refresh context/course-context.md, the per-course design context the lesson skills (lesson-design, lesson-summarize, lesson-module-build) rely on. Run once when setting up a course, and again after README, docs, or course structure change substantially. Use for "initialize course context", "set up the course context", "refresh the course context", "cursuscontext invullen", "course context verversen".
---

# Course Context Init

Fill in or refresh `context/course-context.md`, the course-design companion to
`context/writing-style.md` that describes the course's subject, learning goals,
assessment, pedagogy, lesson-plan conventions, module structure, code/download
rules, glossary, and scope boundaries. The lesson skills read it before
generating anything, so the more it reflects the real course, the fewer
questions they need to ask.

Re-running is expected: after `README.md`, docs, or the course structure change,
run this skill again to fold the new facts in. On a re-run, treat existing
non-placeholder content as confirmed: update it only where the repo now
contradicts it, and say so explicitly in the report.

## Steps

1. **Read `context/course-context.md` as it stands.** Note which sections are
   still the shipped template (marked `TODO`) and which are filled in. If every
   section is still `TODO` and the author works in Dutch, offer to start from
   `templates/course-context-nl.md` (the same scaffold with its headings and
   guidance comments in Dutch) before filling anything in.

2. **Read the repo before asking anything.** In order:
   - `course.config.yml`: `title` and `tagline` are the authoritative course
     name and descriptor, and `language` the course language.
   - `README.md` and `AGENTS.md` at the project root: course name, subject,
     institution, audience.
   - `context/writing-style.md`: language, register, student level; do not
     duplicate style rules into the context doc, only cross-reference.
   - Any course-specific doc under `context/` or `sources/` (e.g. a pedagogical
     framework, a competency profile, card or page-type descriptions). These are
     prime sources for the Learning goals, Pedagogy and Module conventions
     sections. `docs/` holds the coursewright tooling docs and is not a source.
   - `evaluations/` if it exists: the most recent evaluation shows the forms,
     question types and weights the Assessment section should record.
   - The existing modules under `course/` (folder names, page files, `_files/`
     contents): infer page roles, ordering, download conventions.
   - `sources/lessons/` and `sources/lesson-plans/` if they exist: infer
     lesson-plan structure, numbering, and whether class versions are used.
   - `sources/reference-materials/glossary.yml` or any similar canonical
     glossary file: infer the Glossary section.

3. **Interview the author: only ask what the repo did not answer.** Ask
   directly, bundling related questions into one round. Candidate topics, one
   per context-doc section:
   - Course overview: anything not in the README (lesson count, minutes per
     lesson, student prior knowledge).
   - Learning goals: the course's overarching goals, the programme competencies
     they concretise, and the notation lesson plans use to reference a goal.
   - Assessment: the evaluation moments, their weight, question formats, allowed
     aids, and the alignment rule the course holds itself to.
   - Pedagogy: recurring teaching methods and the framework they come from.
   - Lesson plans: location, template file, required sections, only if
     `sources/lessons/` is empty or ambiguous.
   - Class versions: whether the author wants them at all; grouping labels for
     the content inventory.
   - Module conventions: page roles the inferred modules did not show (homework?
     reference cards? glossary page?), emoji conventions.
   - Code and downloads: only for courses with code. Archive layout, what to
     exclude, comment language.
   - Scope boundaries: topics that must stay out of the course.

4. **Summarise and confirm.** Before writing, show a short per-section summary
   of what will go into the doc and where it came from (repo inference vs.
   interview). Let the author adjust.

5. **Write `context/course-context.md`.** Keep the section structure of the
   template (Course overview, Learning goals, Assessment, Pedagogy, Lesson
   plans, Class versions, Module conventions, Code and downloads, Glossary,
   Scope boundaries) (the order is the backward-design chain, so do not reorder
   it) and the tip at the top. Replace each answered section's `TODO` with
   concise prose or bullets; leave a section on `TODO` when there is genuinely
   nothing to say yet, and drop the HTML guidance comments from sections that
   are now filled in. Point to repo files (framework docs, worked-example
   modules and lessons) rather than copying their content.

6. **Check the update config.** Confirm `update-from-upstream.conf` still lists
   `context/course-context.md` under `protected_files`, as the shipped conf
   does. If it was removed, warn the author: without it the next upstream update
   overwrites their version with the template. Do not edit the conf yourself.

7. **Report changes.** List what changed per section and remind the author that
   the lesson skills will offer to save newly gathered facts back into this doc
   as they work, that `/course-context-update` folds a working session's
   decisions in without a full re-run, and that re-running this skill after
   major repo changes keeps it current.

## Rules

- **Language.** Write the doc in the language the author works in, as the tip at
  the top asks. That need not be the course language, which
  `context/writing-style.md` states. Interview and reply in the same language.
- Never invent course facts. Everything in the doc comes from the repo or from
  the author; when in doubt, ask or leave `TODO`.
- Do not modify `context/writing-style.md`, `AGENTS.md`, or course content: the
  only written artefact is `context/course-context.md`.
- Do not commit the changes automatically. Leave that to the author.

$ARGUMENTS
