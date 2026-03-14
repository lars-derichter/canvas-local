---
title: Managing Modules and Items
canvas_type: page
---

# Managing Modules and Items

The CLI provides interactive commands for creating, moving, renaming, and deleting both modules and items. All commands handle renumbering automatically, so you never have to manually rename files to fix gaps or reorder content.

## Working with Modules

A module is a top-level folder inside `course/`. Each module maps to a Canvas module.

### Creating a Module

```bash
npx course new-module
```

You will be asked for a name and a position. The command creates the folder with the correct numeric prefix and a `_category_.json` file inside it.

### Reordering Modules

```bash
npx course move-module
```

Select the module you want to move and pick its new position. All other modules are renumbered to make room.

### Renaming a Module

```bash
npx course rename-module
```

This renames both the folder and the label in `_category_.json`.

### Deleting a Module

```bash
npx course delete-module
```

Removes the folder and all its contents. Remaining modules are renumbered to close the gap.

> [!WARNING]
> Deleting a module removes all its pages, assignments, and files from disk. Make sure you have committed or backed up your work before deleting.

## Working with Items

Items are the files inside a module folder: pages, assignments, external links, file uploads, and subsections.

### Creating an Item

```bash
npx course new-item
```

The command walks you through picking:

1. Which **module** to add the item to (auto-detected if you run the command from inside a module folder)
2. Whether to place it in the **module root** or inside a **subsection**
3. The **type**: page, assignment, url, subsection, or file
4. A **name** and position

For assignments, you will also be asked for the number of points. For URLs, you provide the link.

### Moving Items

```bash
npx course move-item          # reorder within the same module
npx course movetomodule-item  # move to a different module entirely
```

Both commands handle renumbering in the source and destination locations.

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

> [!TIP]
> All item commands auto-detect which module you are in when you run them from inside a module folder. You only need to pick the module manually if you run the command from the project root.
