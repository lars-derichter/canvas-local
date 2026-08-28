---
title: Working With an AI Assistant
canvas_type: page
---

# Working With an AI Assistant

Writing a course is a lot of small, repetitive jobs: drafting pages, keeping
your style consistent, building quizzes, checking for broken links. An AI
assistant that works inside your editor can take on much of that, and this
project is set up to make it easy.

The project works with AI coding assistants that run in your terminal or inside
VS Code: Claude Code, OpenAI Codex, and other agentic tools. You talk to them in
plain language, and they can read and write your files, run the `npx course`
commands, and follow packaged workflows called **skills**. Project instructions
in `AGENTS.md` give any of them full context out of the box.

## What Are Skills?

A skill is a ready-made workflow you trigger with a short command. Instead of
explaining a whole task from scratch, you name the skill and the assistant
follows instructions written for exactly that job. For example:

- `/proofread course/01-getting-started/04-writing-your-pages/02-alerts.md`
  checks a page against the project’s writing style and your spelling.
- `/lesson-module-build lesson-03` turns a finished lesson plan into a complete
  set of student pages.

Skills are plain markdown files in the `.agents/skills/` folder, so you can read
what each one does and adjust it to fit how you work.

## What You Can Do With It

Beyond everyday help (“draft a page about X”, “move these three items to another
module”, “why did my push fail?”), this project ships a set of skills built for
course authoring. The main families:

- **Writing style**: `/writing-style-init` adapts the style guide to your voice,
  `/writing-style-update` folds in new preferences, and `/proofread` checks a
  page against it. `/translate` puts a page or a pasted passage into another
  language without it sounding translated.
- **Lessons**: `/lesson-design` helps you plan a lesson, `/lesson-summarize`
  makes a one-page class version, and `/lesson-module-build` turns the plan into
  finished student pages. After teaching, `/lesson-retro` debriefs the lesson
  and folds your notes back in.
- **Evaluation**: `/evaluation-design` blueprints an exam, `/quiz-build` turns a
  question list into a Canvas quiz, and `/rubric-build` writes a grading rubric.
- **Quality**: `/consistency-check` sweeps the whole course for dead links and
  drift, `/coverage-map` checks which learning goals are taught and tested, and
  `/image-todos` lists the artwork you still owe.
- **Export styling**: `/export-style-init` derives a PDF or Word style from a
  reference document, and `/export-style-update` tweaks it in plain language
  (see [Exporting to PDF or Word](08-publishing/03-pdf-and-word.md)).

You do not have to memorise these. Type `/` in Claude Code (or ask any assistant
what skills it sees) to get the list, or just describe what you want and let it
suggest the right one.

## Getting Started

1. Pick a tool and open your project folder with it: Claude Code
   ([claude.ai/code](https://claude.ai/code)), OpenAI Codex
   ([developers.openai.com/codex](https://developers.openai.com/codex)), or
   another agentic tool. Most work in the terminal and as a VS Code extension.
2. Ask for something in plain language, or name a skill like `/proofread`.
3. Review what it proposes before it acts. The skills that make bigger changes
   stop and show you a plan first.

> [!TIP]
>
> You stay in control. The assistant works on your local files and runs the same
> `npx course` commands you would, and it asks before doing anything you have
> not already allowed, like pushing to Canvas or committing to git.

## Choosing a Tool

You are not locked in. Claude Code and Codex read the same `AGENTS.md`
instructions and the same skills, so you can switch tools, or work next to a
colleague who uses a different one, without changing anything in the project.
The skills follow the open Agent Skills format, plain markdown files: if your
assistant does not support skills, you can still open a skill file and paste its
instructions, or simply describe the task yourself.

> [!NOTE]
>
> For the full list of skills and what each one does, see the AI assistants
> guide (`docs/ai-assistants.md`) and the lesson workflow guide
> (`docs/lesson-workflow.md`) in your project folder, also readable on GitHub.
