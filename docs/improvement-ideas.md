# Improvement Ideas

Feature ideas and bug fixes for future development.

## Course items of type URL show up as documents in docusaur preview

These items are rendered like any other markdown document. Instead they should
render as a document showing the link from the external_link frontmatter field.
These files should not have any real contents apart from the frontmatter.

## Update Claude `/commit` Skill

The Claude commit skill ignores changes to canvas_id changes in course
materials. This is good when working in development mode, but not when working
on real course materials.

We need a way to check which mode we are in. I would suggest checking the URL of
the git remote (origin). If it matches:
`git@github.com:lars-derichter/canvas-local.git` we are in development mode,
otherwise we are in production mode.

## Extra (VS Code) commands

A command to merge two markdown files and renumber surrounding files. In
terminal mode the numbers of the module/subfolder (if not inside a folder) and
files should be asked. In the VS Code sidebar this should work by selecting two
files and right clicking or calling the command with the command palette.

A command to split the file at the current cursor position. Should be called
through the command palette.

## Print / Export Support

Add print media CSS for the Docusaurus site or a PDF export option. Educators
often need printable versions of course materials for exams, handouts, or
offline review.

## Content Templates

Extend `npx course new-item` with template options: lab assignment, reading
assignment, lecture notes, quiz instructions, etc. Templates would provide
pre-filled frontmatter and boilerplate markdown tailored to common course item
patterns.

## Claude Helper Skills

Create Claude skills that help with common tasks while creating course
materials.

## Multilingual support

Alert labels are always in Dutch. There should be a possibility to set the
course language and get the labels in that language. Should also check where
else in the user interface labels etc. are used.

This could also come in handy for Claude to know what language the course is in.

## Search Across Course Content

A local search command (`npx course search "keyword"`) that searches all course
markdown files and shows results with context lines. Faster than grep for
educators who aren't terminal-savvy.

## Implemented

### VS Code Sidebar for Course Structure

A tree view in the VS Code sidebar showing modules and items, with inline
actions like push single item, open in Canvas, move, and rename. Would be much
faster than the command palette for frequent operations.
