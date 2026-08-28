---
name: ai-tutor-build
description: Build one central AI module under course/ for students: a copy-paste prompt page per selected prompt type (guardrailed tutor, concept explainer, exam coach and more), a policy stub when the course has no AI-use page yet, and study packs, markdown exports of the course material that students attach to the chatbot together with the prompt. Phase A proposes the module, the prompts and the packs and stops for approval; Phase B writes the pages and generates the packs with npx course export -f md. Use for "build AI tutor", "AI tutor module", "chatbot prompts for my students", "AI-tutor bouwen", "AI-module maken", "chatbotprompts voor mijn studenten".
---

# AI Tutor Build

Build one AI module under `course/` that turns any chatbot into a study aid with
guardrails: a page per prompt type that a student pastes as the first message, a
policy stub when the course has no AI-use page yet, and study packs, plain
markdown exports of the course that the student attaches alongside the prompt so
the chatbot answers from the course rather than from memory.

## Input

`$ARGUMENTS` may hold prompt-type names from the catalogue in
[`references/prompt-types.md`](references/prompt-types.md), a prefix or slug for
the AI module, a pack scope (`module`, `course`, `flagged` or `toc`), and/or
free text. Empty means: propose defaults.

## Steps

### Phase A: Design (Writes Nothing)

1. **Read**, in order:
   [`context/course-context.md`](../../../context/course-context.md): Course
   Overview (language, level), Assessment (evaluation moments, aids allowed),
   Pedagogy, Code and Downloads (filled in, it marks a course with code),
   Glossary, Scope Boundaries. For a needed section still `TODO`, ask once and
   offer `/course-context-update` at the end to record the answer. Then
   [`context/writing-style.md`](../../../context/writing-style.md) (the pages
   use the student-facing register),
   [`docs/frontmatter.md`](../../../docs/frontmatter.md), both `references/`
   files of this skill, the list of modules under `course/`, the lowest-numbered
   module as the worked example for page conventions, and any existing AI-policy
   page: search page titles for AI and policy words in the course language, and
   ask when unsure.

2. **Classify the course** (code? exams or tests? writing?) and pick the
   suggested prompt types from the catalogue's "suggest when" column. List the
   remaining types in one line so the teacher can add them.

3. **Propose in chat**:
   - **The module**: prefix, slug and label. `00-` when the course keeps its
     meta modules (agreements, practical information) ahead of the lessons, else
     the next free `NN-`. Say that a `00-` folder is created by hand, because
     `npx course new-module` refuses position 0. Label in the course language.
   - **The pages**: filename and title per selected type (📘, per the legend in
     `writing-style.md`), plus the policy stub, only when no policy page exists.
   - **The prompt scaffold**: the catalogue's shared boilerplate filled in with
     course facts (course name, language, level, scope boundaries, glossary
     terms, and the assessment criteria where a type needs them), shown once;
     per type only its distinguishing rules and kickoff line.
   - **The packs**: the scope (default one pack per module; alternatives: the
     whole course as one pack, `--flagged` items only, or a curated `--toc`
     selection), the modules included (never the AI module itself, never
     anything the teacher excludes), the pack filenames and the
     `NN-study-packs/` subsection that will hold them.
   - **The privacy and copyright confirmation** from
     [`references/attaching-files.md`](references/attaching-files.md), asked as
     an explicit question, and the per-tool upload lines with their check date,
     for the teacher to prune.

   Adjust on request and stay in Phase A. Stop. Wait for explicit approval
   before starting Phase B.

### Phase B: Write (Only After Approval)

4. **Module folder** and `_category_.json`: a `label` and a `position` matching
   the prefix, pretty-printed the way Prettier leaves it, like the existing
   modules'.

5. **Policy stub page** (only when none exists): a short student-facing page
   saying that the rules for AI use in this course are set by the institution
   and the teacher, and where to find them, with this comment at the top for the
   author:
   `<!-- TODO: replace this stub with the institution's policy, or run /ai-policy-build to write one. -->`.
   The prompt pages link to it as the course rules.

6. **Prompt pages**, one per selected type, in this shape:
   - An intro paragraph: what the role does and why it helps learning.
   - A "How to use it" numbered list: open a chatbot of your choice (ChatGPT,
     Claude, Gemini or another); start a new chat; attach the study pack for
     what you are studying; paste the whole prompt as your first message; then
     ask your question or paste your work.
   - One line on where the course rules do not allow it, linking the policy
     page.
   - `## The prompt`: "copy everything in the box below", then the whole prompt
     in a ```text fence. The prompt is the shared boilerplate plus the type's
     distinguishing rules plus the course facts, in the student's first person,
     so it pastes unchanged.
   - A `[!WARNING]` that the AI can be wrong and that the course wins ties.
   - Cross-links to the sibling prompt pages.

   The section titles above are the model's, not the page's: page titles,
   headings and the prompt itself are all in the course language.

7. **Study packs**, generated by the CLI. Per module:

   ```bash
   npx course export -f md -m <NN-slug> -o course/<ai-module>/_files/<NN-slug>.md
   ```

   Whole course, flagged or curated: write the TOC first, delete the AI module's
   own lines and the teacher's exclusions from it, then export it. The TOC file
   stays in `sources/study-packs/` so the pack can be regenerated.

   ```bash
   npx course export-toc -o sources/study-packs/<pack>.toc.md   # --flagged for the flagged scope
   npx course export -f md --toc sources/study-packs/<pack>.toc.md -o course/<ai-module>/_files/<pack>.md
   ```

   Verify every pack: it exists and is non-empty, and
   `grep -nE ':::|\{#|<!--' <pack>` plus a grep for the absolute repository path
   both return nothing.

8. **The `NN-study-packs/` subsection**, last in the module: a
   `_category_.json`; an intro page (what a pack is and why to attach it, which
   pack goes with which module, the upload steps from `attaching-files.md`, and
   that a pack is a snapshot of the course at the date in its header) with the
   exact regenerate commands in an HTML comment at the top, so the next author
   finds them; and one file-item wrapper per pack (`canvas_type: file`,
   `file_ref: ../_files/<pack>.md`, a title with the 📦 emoji), per
   [`docs/frontmatter.md`](../../../docs/frontmatter.md#file-item). The
   tutorial's `12-download-this-course/` subsection is the worked example while
   the course still ships it. A `.md` file item works in the preview and on
   Canvas, because the wrapper emits a `@site/` URL that Docusaurus bundles as
   an asset. A plain `[link](../_files/pack.md)` in a page body does not:
   Docusaurus routes `.md` links as pages and the Canvas push skips them. Never
   link a pack from a page body; ship it as a file item.

9. **Checks**: `npm run lint:links` and `npm run build` must pass. Say to open
   one wrapper with `npm start` to see the download card.

10. **Report in chat**: files by group (pages, wrappers, packs,
    `_category_.json`); the prompt types built; every pack with its regenerate
    command and a staleness warning (a pack is a snapshot: regenerate after
    editing a lesson); the privacy note. Suggest as separate steps, do not run:
    `/ai-policy-build` when the stub was written, `/proofread` on the module,
    `/course-context-update` for anything `course-context.md` was missing.
    `npx course push` is the author's to run.

## Rules

- **Language.** Write everything in the language `context/writing-style.md`
  states the course uses; `course.config.yml`'s `language` key only picks the
  generated labels. Reply in chat in the language the author writes in.
- Packs come from the CLI only, never hand-written or edited. The export reads
  `course/` alone, so `evaluations/` and `sources/` never enter a pack.
- A re-run on a course that already has the AI module proposes only additions
  and regenerations, never a rewrite of a page the teacher edited.
- Never change other modules under `course/`.
- No commits, no pushes, no staging.
- Temp files go in the session scratchpad.
- Run `npm run format` on the markdown you wrote (packs are Prettier-ignored);
  Prettier owns markdown wrapping.

$ARGUMENTS
