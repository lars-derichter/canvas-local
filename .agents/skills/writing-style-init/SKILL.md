---
name: writing-style-init
description: Interview the author and analyse samples of their writing to rewrite context/writing-style.md to match their voice, audience, and formatting preferences. Confirms the intended changes before writing. Use for "initialize style", "set up the style guide", "configure the writing style", "stijlgids opzetten", "schrijfstijl instellen".
---

# Writing Style Init

Adapt [`context/writing-style.md`](../../../context/writing-style.md) (the
writing-style guide your AI assistant follows when drafting course content) to
the course author's own voice and audience.

## Steps

1. **Ask for writing samples**: 1–3 file paths or pasted texts representative of
   the voice the author wants imitated (course material, blog posts, handouts).
   Samples reveal habits the author may not articulate. Without samples, proceed
   interview-only and warn explicitly that the resulting `writing-style.md` is a
   best guess, refinable later via `/writing-style-update` or direct edits.

2. **Analyse the samples, then interview only what they did not answer** (ask
   the author, bundling related questions into one round). Dimensions for both:
   - Language and regional variety (English: UK/US; Dutch: Flemish/Netherlands;
     …); student age band and CEFR level if the course language is not the
     students' first language.
   - Register and formality (first-name basis, je/u, tu/vous), for both the
     student-facing and the colleague-facing register.
   - Sentence length, rhythm, and tone latitude (jokes, parenthetical asides,
     personal voice I/we).
   - Tech-term handling: translated or kept in the source language.
   - Punctuation habits (em-dashes, quote style, ellipsis); headings case.
   - Emoji: the page-title signalling system, a custom set, or none.
   - Callouts: GitHub-alert syntax, Docusaurus admonitions, or plain
     blockquotes; preferred labels per type.
   - Instruction style for exercises and exams: same voice as explanations, or
     strictly neutral.
   - AI tells the author particularly dislikes: prime with examples from the
     current `writing-style.md` and from the AI-tells section of whichever
     baseline in [`templates/`](../../../templates/) matches the course
     language.

3. **Summarise and confirm** the intended changes before writing anything.

4. **Pick the starting point.** `context/writing-style.md` ships as the English
   baseline, which primes badly for a course in another language. Unless the
   course language already matches what the file holds, copy the right baseline
   from [`templates/`](../../../templates/) over `context/writing-style.md`
   first and adapt from there:
   - `writing-style-en.md`: English, UK spelling, title-case headings. The
     shipped `context/writing-style.md` starts from this baseline.
   - `writing-style-en-us.md`: English, US spelling, title-case headings.
   - `writing-style-nl-be.md`: Nederlands, Vlaamse variant.
   - `writing-style-nl.md`: Nederlands, variant Nederland.

   A copied baseline still links to its `templates/` siblings by bare filename;
   repoint those links (`writing-style-en-us.md` →
   `../templates/writing-style-en-us.md`) and drop the copy-me tip at the top.

   For a course in a language no baseline covers, start from
   `writing-style-en.md` and write the adapted guide in the course language: the
   structure is what matters, and step 5 preserves it.

   Never edit anything in `templates/` itself: those are shipped defaults,
   overwritten on upstream updates.

5. **Rewrite `context/writing-style.md`.** Read its current headings first and
   preserve the document's structure, in particular the shared-rules section and
   the two register sections (student-facing and colleague-facing) that
   `## Audiences` introduces: most skills apply one register or the other by
   reading those sections. Every baseline carries that structure, translated
   where the baseline is not in English, so this holds whichever one you started
   from. Only the content adapts. Keep the note at the top that names the course
   language, in whatever language the guide itself is written
   (`writing-style.md` is consumed by AI tools).

6. **Check `AGENTS.md` at the project root** and update it only where it now
   directly contradicts the new `writing-style.md`.

7. **Report** what changed and remind the author they can refine further with
   `/writing-style-update` or by editing the file directly.

## Rules

- **Language.** The guide is written in the language it prescribes, so a course
  in another language gets a guide in that language. Interview and reply in the
  language the author writes in.
- Never guess beyond what samples plus interview support; when in doubt, ask.
- No commits, no pushes, no staging.
- Run `npm run format` on the guide after writing; Prettier owns markdown
  wrapping.

$ARGUMENTS
