---
title: 📘 How This Works
canvas_type: page
---

# How This Works

You are looking at a course built with Coursewright. Every page in this module
is a plain markdown file in a folder on a computer, previewed as this website,
and published to Canvas with one command.

This module walks you through doing that yourself. Work through it in order:
each page assumes the one before it.

## The Three Places Your Course Lives

- **Your computer** is where you write. Markdown files in a `course/` folder,
  one folder per module, edited in VS Code or any editor you like.
- **The preview** is this website. It runs locally with `npm start` and updates
  as you type, so you see what you are making before anyone else does.
- **Canvas** is where students read it. `npx course push` converts your markdown
  to Canvas pages, assignments, links, and files, and puts them in modules.

Your files are the source of truth. Canvas is a publishing target, the way a
website is a publishing target for a document you wrote.

## What That Buys You

- **A history.** Every version of every page, and the ability to go back.
- **Search and replace** across the whole course, in seconds.
- **Offline work.** Trains, planes, and buildings with bad wifi.
- **Review before publishing.** You see exactly what will change, and decide.
- **Reuse.** Next year’s course starts from this year’s files, not from clicking
  through Canvas.

## What You Will Do in This Module

1. Write pages in markdown, with headings, images, code, and coloured callouts.
2. Organise them into modules and subsections, and learn which file becomes
   which kind of Canvas item.
3. Work from the VS Code sidebar instead of typing commands.
4. Publish to Canvas, after first backing it up (which matters more than it
   sounds).
5. Export a chapter to PDF or Word, save your work with git, and see what an AI
   assistant can do with all of this.
6. Do a small practice assignment, which is itself a Canvas assignment published
   from a file.

> [!TIP]
>
> Nothing here is permanent. The whole module can be removed from your course
> with one answer during `npx course setup`, and it stays readable on the
> project’s website afterwards.

## A Word on the Numbers

Every file and folder starts with a two-digit number: `01-`, `02-`, and so on.
That number sets the order, in this preview and in Canvas, and it is stripped
from the title students see. You will meet the rest of the naming rules in
[Folder Layout](./04-organising-your-course/01-folder-layout.md).
