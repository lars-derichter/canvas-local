---
title: 📘 How This Works
canvas_type: page
---

# How This Works

You are looking at a course built with Coursewright. Every page in this module
is a plain markdown file in a folder on a computer. The same files are published
as this website, exported as a PDF or Word handout, or pushed to Canvas.

This module walks you through doing that yourself. Work through it in order:
each page assumes the one before it. Every step happens in the VS Code sidebar,
with the terminal command named alongside it for anyone who would rather type.

## The Three Places Your Course Lives

- **Your computer** is where you write. Markdown files in a `course/` folder,
  one folder per module, edited in VS Code or any editor you like.
- **The preview** is this website. **Course: Preview** in the sidebar starts it
  (terminal: `npm start`), and it updates as you type, so you see what you are
  making before anyone else does.
- **Where students read it** is your choice: the course website, a printed or
  downloaded handout, or Canvas. All three are built from the same files.

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

1. Set up VS Code and the Course Manager sidebar.
2. Write pages in markdown, with headings, images, code and coloured callouts.
3. Organise them into modules and subsections, and learn which file becomes
   which kind of item.
4. Create, move, rename, merge and split items.
5. Save your work with git.
6. Publish by one of three routes: a course website, a PDF or Word handout, or
   Canvas (that one after a backup, which matters more than it sounds).
7. See what an AI assistant can do with all of this.
8. Do a small practice assignment, which is itself a Canvas assignment published
   from a file.
9. Join a discussion, which is itself a Canvas discussion published from a file.

> [!TIP]
>
> Nothing here is permanent. The whole module can be removed from your course
> with one answer during `npx course setup`, and it stays readable at
> [coursewright.md](https://coursewright.md/) afterwards.

## A Word on the Numbers

Every file and folder starts with a two-digit number: `01-`, `02-`, and so on.
That number sets the order, in this preview and in Canvas, and it is stripped
from the title students see. You will meet the rest of the naming rules in
[Folder Layout](./05-organising-your-course/01-folder-layout.md).
