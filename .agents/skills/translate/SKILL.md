---
name: translate
description: Translate a document, a passage, or text pasted with the call from one language into another, so the result reads as written rather than translated. Infers the source language, confirms the target, follows the source's register, and checks the result against the original for added or dropped information. Fragments go to chat; for a file it asks where to write. Use for "translate", "translate this page into Dutch", "put this in English", "vertaal dit", "vertaal deze pagina naar het Nederlands", "zet dit om naar het Engels".
---

# Translate

Render one document, passage, or pasted fragment in another language. The
information content matches the original one to one; the wording, rhythm, and
idiom are those of someone writing in the target language, not those of the
source carried across. A reader who never sees the original should not be able
to tell there was one.

## Input

`$ARGUMENTS` may hold a path, a target language, the text itself, or nothing.
Text pasted with the call is the source. Empty: use the file open in the IDE
when the request plausibly concerns it, otherwise ask what to translate. That
intake question is free.

## Steps

1. **Identify the source.** In order: an explicit path in `$ARGUMENTS`; text
   pasted with the call; the file open in the IDE; ask. Read a file in full
   before translating any of it: register, terminology, and the audience are
   properties of the whole document.

2. **Determine the source language**, inferred from the text, with the regional
   variety where it shows. Ask only when the text is genuinely ambiguous or
   mixes languages; in a mixed document, establish which language is the prose
   and which are quoted or technical, and say what you concluded.

3. **Determine the target language.** Take it from `$ARGUMENTS` when named. When
   the source is not in the course language, propose the course language and
   confirm. When the source already is in the course language, ask. The course
   language is the one
   [`context/writing-style.md`](../../../context/writing-style.md) states.
   `course.config.yml`'s `language` key only picks generated labels and cannot
   express a variety. Ask about the variety (Flemish against Netherlands Dutch,
   UK against US English) only when it is unsettled and the text is long enough
   for it to show.

4. **Fix the register and the ruleset**, in this order:
   - Target is the course language and the text is student-facing (`course/`,
     and what students receive under `evaluations/`: assignment and exam
     instructions): read `context/writing-style.md` in full and apply its shared
     plus student-facing rules.
   - Target is the course language, anything else: the same guide, shared plus
     colleague-facing rules, with the reading level following the source.
   - Target is not the course language: the source's own register and reading
     level, in ordinary current usage of the target language. Do not carry over
     the course guide's language-specific rules: its spelling variety, its
     heading-case rule, its list of AI tells all describe another language.
   - Register genuinely unclear: ask.

5. **Translate in units of thought, not in words.** Sentence boundaries may
   move, a subordinate clause may become its own sentence, two short sentences
   may merge. An idiom takes a target-language equivalent or plain phrasing,
   never a literal rendering. Where the source's own phrasing is clumsy,
   translate what it means, not how it stumbles.

6. **Apply the target language's mechanics**: decimal and thousands separators,
   date and time formats, quotation marks, capitalisation of headings, titles,
   days, and months, the address form, spacing before punctuation, and how list
   items are punctuated.

7. **Leave the non-prose alone.** Code inside fences and inline code,
   identifiers, commands, paths and file names, URLs and link targets,
   frontmatter keys, alert markers (`[!NOTE]` and its siblings), numeric
   filename prefixes, HTML comments. Translate what a reader reads: prose,
   headings, link text, alt text, table cells, captions, and code comments where
   the comment-language rule in
   [`context/course-context.md`](../../../context/course-context.md) calls for
   it. Terms the course deliberately keeps in another language stay as they are.
   The course glossary and writing-style.md's terminology rule decide, and
   neither permits inventing a house translation for a term a student meets in
   the tooling.

8. **Flag, never invent.** Puns, mnemonics, acronyms that only expand in the
   source language, culture-bound examples, and institution or interface labels
   the target audience does not share: render the meaning, and collect what you
   adapted for the closing report. Never substitute a new example, a new
   mnemonic, or a localised label on your own.

9. **Verify against the original, twice.** First side by side, claim by claim:
   every fact, number, name, condition, qualification, negation, and hedge in
   the source is present in the translation, and nothing is present that the
   source did not carry. Repair what drifted. Then read the translation on its
   own, as if it were an original, for translated feel and AI tells: literal
   idioms, calqued collocations, the source language's sentence rhythm,
   decorative tricolons, bold scattered through prose, a closing summary the
   source never had. The target language's tells govern; when the target is the
   course language, writing-style.md lists them.

10. **Deliver.** A fragment goes to chat. For a file, propose a destination and
    ask before writing anything: the default suggestion is the source's own
    folder with a language suffix (`03-methods.md` → `03-methods.nl.md`). When
    the source is under `course/` or `evaluations/`, say in that same question
    that a copy there becomes a separate page to the course scanner and to
    `npx course push`, and offer a path outside those folders as the
    alternative. Never overwrite the source unless the author asks. Report the
    destination and everything collected in step 8.

11. **Offer follow-ups, do not run them**: `/proofread` on the result when the
    target is the course language, `/issue-report` for anything the source
    itself got wrong along the way.

## Rules

- **Language.** These instructions are English; the translation is in the target
  language. Reply in chat in the language the author writes in.
- Length is not a constraint. Dutch runs longer than English, and forcing the
  source's word count produces padding in one direction and compression in the
  other. Expansion must not become explanation the source did not carry.
- Do not edit the source. No commits, no pushes, no staging.
- Run `npm run format` on any file you wrote; Prettier owns markdown wrapping.

$ARGUMENTS
