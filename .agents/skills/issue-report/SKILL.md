---
name: issue-report
description: Quickly log an error or wanted change in course material into the issue queue at sources/issues.md: locates the file, quotes the passage to confirm, asks at most one clarifying question, and never diagnoses or fixes anything (that is /issue-fix). Use for "report issue", "log this for later", "found a mistake on page X", "issue melden", "noteer deze fout", "dit wil ik nog aanpassen".
---

# Issue Report

Capture an error or a wanted change while the author is reviewing course
material, without breaking their flow. One bullet is appended to the issue queue
in `sources/issues.md`; the diagnosis and the fix wait for `/issue-fix`. Speed
beats completeness here: pin the file and the passage, log, and get out of the
way.

## Input

`$ARGUMENTS` is free-form: a description of the problem, plus any locator: a
repo path, a page title as rendered on the Docusaurus site or in Canvas, a
module or lesson number, or a quoted snippet of the offending text. The author
is usually reading the rendered site, not the raw file: rendered titles come
from frontmatter `title:` or the first heading, and numeric prefixes are
stripped (`03-methods` renders as "Methods"). Empty means ask what to report.
That intake question does not count against the question budget below.

## Steps

1. **Locate the file.** In order: an explicit path in `$ARGUMENTS`; the file
   currently open in the IDE, if the report plausibly concerns it; a fuzzy match
   of the given page title against frontmatter titles and first headings across
   `course/` and `evaluations/` (case-insensitive, numeric prefixes stripped); a
   grep for the complained-about text itself. Exactly one candidate: proceed
   without asking.

2. **Pin the passage.** Find the disputed text in the located file and quote it
   exactly as it stands there, not as the author paraphrased it. The verbatim
   quote is the anchor `/issue-fix` will use: line numbers drift, quotes do not.

3. **Ask at most one clarifying question**, only when the file or the passage
   stays ambiguous (several candidate files, no match for the quoted text,
   several matches). Present the candidates as options; if both file and passage
   are open, combine them in that one question. Still unresolved after the
   answer: log anyway with the best guess and a `location unverified` marker:
   `/issue-fix` sorts it out.

4. **Classify lightly** from the author's wording, never by asking: `[error]`
   (wrong content, typo, broken link), `[change]` (correct but should be
   different), `[style]` (a preference about how the text is written), `[idea]`
   (new material or a new feature). Default `[change]`.

5. **Check for duplicates** against both `## Open` and `## Resolved` in
   `sources/issues.md`.
   - An open entry for the same file and passage: say so and offer to extend
     that entry with a dated note instead of adding a second bullet.
   - A resolved entry that matches: check the current file text. If it is
     already correct, the author is probably looking at a stale rendering: say
     so, mention that `npx course push` republishes to Canvas (do not run it),
     and log nothing. If the defect is genuinely back, log a new entry with a
     "regression of <date>" note.

6. **Append the entry** at the end of `## Open`, in the format documented in the
   queue file itself:

   ```
   - **YYYY-MM-DD · path** — [tag] — "exact quote" — what is wrong or
     wanted, one sentence — proposal: … (optional)
   ```

   An issue spanning several files gets a glob or a short description in the
   path field. Create `sources/issues.md` (and `sources/` if needed) on first
   use, with this structure: an intro naming `/issue-report` and `/issue-fix`
   and welcoming hand-added bullets, a `## How to add an issue yourself` section
   with the bullet format and one example, `## Open`, and `## Resolved`. Quote
   the appended line back to the author as confirmation.

7. **Stop.** Never fix, never start diagnosing, never open the affected file for
   editing. Close with one sentence: `/issue-fix` works the queue. For a
   `[style]` entry, add one more: `/writing-style-update` can make the
   preference a durable rule in `context/writing-style.md`: the logged entry
   covers only this one instance.

## Rules

- **Language.** Log the entry in the language the author reports in; the quoted
  passage stays verbatim as it stands in the file, whatever language that is.
- Append-only: never restructure, reword, or reorder existing entries.
  Hand-added bullets are first-class, however minimal.
- Course specifics come from
  [`context/course-context.md`](../../../context/course-context.md) at runtime;
  hardcode nothing.
- No commits, no pushes, no staging.

$ARGUMENTS
