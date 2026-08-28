---
title: Managing Modules and Items
canvas_type: page
---

# Managing Modules and Items

As your course grows, you will need to add new content, reorganise things, and
sometimes clean up. The CLI has interactive commands for all of this, and they
handle renumbering automatically, so you never have to manually rename files to
fix gaps or reorder content.

## Working With Modules

A module is a top-level folder inside `course/`. Each module maps to a Canvas
module.

### Creating a Module

```bash
npx course new-module
```

You will be asked for a name and a position. The command creates the folder with
the correct numeric prefix and a `_category_.json` file inside it.

### Reordering Modules

```bash
npx course move-module
```

Select the module you want to move and pick its new position. All other modules
are renumbered to make room.

### Renaming a Module

```bash
npx course rename-module
```

This renames both the folder and the label in `_category_.json`.

### Deleting a Module

```bash
npx course delete-module
```

Removes the folder and all its contents. Remaining modules are renumbered to
close the gap.

> [!WARNING]
>
> Deleting a module removes all its pages, assignments, and files from disk.
> Make sure you have committed or backed up your work before deleting.

## Working With Items

Items are the files inside a module folder: pages, assignments, external links,
file uploads, and subsections.

### Creating an Item

```bash
npx course new-item
```

The command walks you through picking:

1. Which **module** to add the item to (auto-detected if you run the command
   from inside a module folder)
2. Whether to place it in the **module root** or inside a **subsection**
3. The **type**: page, assignment, url, subsection, or file
4. A **name** and position

For assignments, you will also be asked for the number of points. For URLs, you
provide the link.

### Moving Items

```bash
npx course move-item          # reorder within the same module
npx course movetomodule-item  # move to a different module entirely
```

Both commands handle renumbering in the source and destination locations.
`movetomodule-item` can also place the item inside a subsection of the
destination module, and it works on subsections themselves: a subsection can
move to another module, but always into the module root, because subsections are
never nested.

### Renaming an Item

```bash
npx course rename-item
```

Updates the filename and the `title` in the frontmatter.

### Deleting an Item

```bash
npx course delete-item
```

Removes the file and renumbers the remaining items to close the gap.

### Merging Two Items

Sometimes you realise that two separate pages would work better as one. Instead
of copying and pasting manually:

```bash
npx course merge-items
```

You pick the **target** first, the item that keeps its frontmatter and receives
the content, and then the **source**. The source content is appended to the
target and the source file is deleted from your folder. Remaining items are
renumbered automatically.

The Canvas page behind the source is left alone. Until you remove it with
`npx course push --prune-canvas`, every sync report lists it as orphaned on
Canvas.

### Splitting an Item

The opposite situation, where a page has grown too long and you want to break it
up:

```bash
npx course split-item
```

Choose the file. The command tells you how many body lines it has, counted from
the first line after the frontmatter, and asks which line to split after. Then
give the new item a title. Everything below that line moves into the new file,
and the original is trimmed.

> [!TIP]
>
> All item commands auto-detect which module you are in when you run them from
> inside a module folder. You only need to pick the module manually if you run
> the command from the project root.

## Skipping the Prompts

Every command also accepts flags, so you can skip the interactive prompts
entirely, which is useful for scripts or when you already know exactly what you
want:

```bash
npx course new-item -m 01-getting-started -t page -n "My New Page"
npx course delete-module --module 02-old-module --yes
```

Run `npx course <command> --help` to see the flags for each command.
