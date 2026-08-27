---
name: lesson-retro
description: Debrief a lesson right after teaching it, in a conversational interview: one question at a time, following up on the answers. Folds timing corrections and tips into the lesson plan's notes-to-self and durable course-wide insights into context/course-context.md, appends a dated retro report to sources/retros/<year>/lesson-NN.md, and logs content fixes for the student material in the issue queue at sources/issues.md. Proposes every edit in chat and applies only after approval. Use for "lesson retro", "debrief after teaching", "how the lesson went", "les nabespreken", "retro les 3", "hoe de les gegaan is".
---

# Lesson Retro

Capture how a lesson actually went while the author still remembers, and turn it
into durable improvements: timing corrections and notes-to-self in the lesson
plan, course-wide insights in
[`context/course-context.md`](../../../context/course-context.md), content fixes
in the issue queue, and a dated section in the lesson's retro report under
`sources/retros/`, the record of the run. The interview is a conversation, not a
form: one question at a time, following up before moving on.

## Input

`$ARGUMENTS` may hold a lesson number (`lesson 3`, `les 3`, `lesson-03`, `3`)
and/or free-text first impressions. Treat those as the first interview answers.
If no lesson is given, ask which lesson was taught; if only one lesson plan is
plausibly recent, propose it in the same breath.

## Steps

### Prepare (Silently)

1. **Read before asking:**
   - `sources/lessons/lesson-NN.md`, in full, especially the timed blocks and
     the existing notes-to-self.
   - The class version `sources/lesson-plans/lesson-plan-NN.md`, if it exists.
   - This lesson's retro reports: `sources/retros/<year>/lesson-NN.md` for the
     current academic year and, if present, the one before. They say what was
     corrected last time (follow up on it: "Block 2 overran last year; did the
     new budget hold?") and whether this year's sections carry class-group
     labels.
   - [`context/course-context.md`](../../../context/course-context.md), to
     recognise when an observation is course-wide rather than lesson-specific.

   Do not summarise these back to the author. They taught the lesson; go
   straight to the first question.

### Interview (One Question at a Time)

2. **Open wide.** First question: how the lesson went, in their own words.
   Everything they volunteer here is material you do not have to ask about.

3. **Then cover the ground below, adaptively.** Skip what the author already
   answered, dig into what they flag, and drop lines that yield nothing after
   one follow-up. Reference the plan's actual block names and time budgets in
   your questions, in the author's language, e.g. "Block 2 was budgeted at 25
   minutes; did that hold?" (a Dutch author gets "Blok 2 stond op 25 minuten;
   klopte dat?") beats "how was the timing?".
   - **Timing**: which blocks ran long or short, where the break actually fell,
     what got cut or rushed at the end.
   - **Comprehension**: what confused students, which questions they asked,
     where the plan's explanation or example did not land.
   - **What worked**: moments to keep and reinforce, not only problems.
   - **Material**: errors or friction in the student pages, exercises, or
     downloads that surfaced during class.
   - **Next time**: anything to add, drop, or reorder.

   If the course is taught to more than one class group (the author says so, or
   this year's retro file already labels its sections by group), ask which group
   this run was. Otherwise never bring groups up.

4. **Know when to stop.** When answers get thin or the author signals done,
   confirm you have what you need and move on. A useful retro can be four
   questions long.

### Propose (in Chat, No Files Yet)

5. **Sort every observation into a destination** and show the sorted list:
   - **Lesson plan `lesson-NN.md`**: timing corrections in the affected blocks
     (adjust the budget, note the reason) and new notes-to-self: pitfalls,
     reserve activities, questions to anticipate. Quote the proposed wording.
   - **Class version**: only if it exists and a timing or emphasis change
     affects it.
   - **`context/course-context.md`**: insights that hold beyond this lesson
     (e.g. "prediction exercises take twice the planned time with this group").
     Name the section it belongs in.
   - **Issue queue `sources/issues.md`**: content errors and friction in the
     student material under `course/`, one entry per fix, in the entry format
     `/issue-report` documents. Diagnosing and fixing them is `/issue-fix`'s
     job; offer to run it once the retro edits land.
   - **Writing-style corrections**: do not fold these in here; point the author
     at `/writing-style-update`.
   - **Retro report `sources/retros/<year>/lesson-NN.md`**: always, whatever
     else an observation touches. One dated section per run: one to three
     sentences on how the lesson went, in the author's words, then short bullets
     for timing deltas, what worked, what confused, changes applied (with file
     pointers) and fixes logged. When the course has more than one class group,
     the group joins the heading (`## 2026-02-12 · groep A`). A dozen lines in
     the colleague-facing register, not a transcript. Show the proposed section
     in full.

   Mark anything you are unsure about as a question, not a proposal.

   Stop. Wait for explicit approval before applying anything.

### Apply (Only After Approval)

6. **Apply.** Surgical, minimal edits, one concern per edit. Keep the lesson
   plan's structure and voice: notes-to-self stay in that section's existing
   style, timing changes touch only the numbers and a short reason. Never
   rewrite blocks wholesale. Append the issue entries to `## Open` in
   `sources/issues.md` (creating the file with `/issue-report`'s documented
   structure on first use), and the report section after the last section in
   `sources/retros/<year>/lesson-NN.md`.

   First retro of a lesson in a year: create the file, and the year folder if
   needed, with an H1 naming the lesson and the academic year
   (`# Retro lesson 3 (2025–2026)`). The year folder takes the two-plus-two form
   `evaluations/` uses (`2526`); when a late-summer date could belong to either
   academic year, confirm which with the author before creating a new folder.

7. **Report.** Say what changed where: the plan and context edits, the report
   section, and the issues logged for `/issue-fix`. If the author corrected the
   same kind of thing twice across retros, suggest the pattern belongs in
   `course-context.md` and point at `/course-context-update` for folding it in.

## Rules

- **Language.** Write everything in the language `context/writing-style.md`
  states the course uses; `course.config.yml`'s `language` key only picks the
  generated labels. Interview and reply in the language the author writes in.
- Record what happened, in the author's words where possible. No editorialising,
  no invented observations, no padding a thin retro.
- The retro is the one sanctioned way to modify an existing lesson plan; touch
  only the blocks and notes the interview justifies.
- Timing corrections change the plan for _next_ year's delivery; if a change
  would alter what the lesson teaches (scope, goals), flag it as a
  `/lesson-design` job instead of editing it in.
- One lesson per retro.
- The report is append-only: record this run and never edit earlier sections. A
  correction the retro produces lands in the lesson plan or in the next retro's
  section, not in history.
- No commits, no pushes, no staging.
- Run `npm run format` on what you edited; Prettier owns markdown wrapping.

$ARGUMENTS
