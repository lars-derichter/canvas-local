---
slug: /
title: Coursewright
sidebar_position: 0
---

# Write Your Course in Markdown, Publish It to Canvas

**Coursewright** moves your course out of the Canvas web editor and into plain
files on your computer, with version control, search and replace, offline work,
a local preview, and one command to publish.

This site is the proof: it is a course built with the tool, previewed with the
tool, and published straight from the repository.

> [!TIP]
>
> New here? Head into the **Getting Started** module in the sidebar. It walks
> through writing markdown, organising a course, syncing with Canvas, and
> working with an AI assistant, and every page of it is a working example of
> something the tool can publish.

## The Problem It Solves

The Canvas editor is fine for a page or two. Maintaining a whole course in it is
another matter: no history, no search and replace across pages, no offline work,
no way to review a change before students see it, and no way to reuse last
year’s material without clicking through it all again.

Coursewright treats your markdown as the source of truth and Canvas as a
publishing target. You write in your own editor, review every change, and push
when you are ready.

## What You Get

- **Your own tools.** Write in VS Code or any editor, keep everything in git,
  and review every change before it goes live.
- **Instant preview.** A local website shows your course as you write, in the
  structure students will see. That is what you are looking at now.
- **One-command Canvas sync.** `npx course push` creates and updates modules,
  pages, assignments, and files. `pull` brings remote edits back into markdown,
  and `status` shows what would change.
- **PDF and Word export.** Hand out a styled course text or a single chapter,
  with your institution’s branding.
- **A VS Code extension.** Every command in the sidebar, so daily work needs no
  terminal.
- **AI-assisted authoring.** Bundled skills help design lessons from their
  learning goals, build student modules, generate Canvas quizzes, proofread, and
  check a whole course for consistency.
- **A template that stays updatable.** Create your course from the template and
  keep pulling in tooling improvements; your content is never overwritten.

## Who It Is For

Lecturers and teaching teams who maintain course material in Canvas and want the
comfort of files, folders, and version control. You do not need to be technical:
the beginner walkthrough starts from a computer with nothing installed.

It is also opinionated, and honest about it. Every Canvas item type crosses, but
not all of them in the same way: pages, assignments, discussions and files live
in your own files and are rebuilt from them, while a quiz or an external tool
syncs only as a reference to something that stays in Canvas. Quiz questions
never cross at all. And the folder layout is a contract: one folder per module,
one level of nesting, numbered prefixes. Better to know that now than in week
six.

## Start Here

- **[Your First Course, Step by Step](https://github.com/lars-derichter/coursewright/blob/main/docs/first-course.md)**:
  from nothing installed to a published Canvas module.
- **[What It Does Not Do](https://github.com/lars-derichter/coursewright/blob/main/docs/limitations.md)**:
  read this before committing a semester to it.
- **[The project on GitHub](https://github.com/lars-derichter/coursewright)**:
  the code, the documentation, and the **Use this template** button.

The tooling is MIT licensed; the example course content on this site is CC
BY-NC-SA 4.0.
