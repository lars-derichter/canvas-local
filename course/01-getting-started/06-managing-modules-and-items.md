---
title: 📘 Managing Modules and Items
canvas_type: page
---

# Managing Modules and Items

As your course grows you add pages, shuffle them around, and clean up what you
no longer need. The Course Manager panel does all of it, and it renumbers the
files for you, so you never rename anything by hand to close a gap.

## Creating

**Course: New Module** sits in the panel’s title bar. It asks for a name and a
position, then writes the folder with the right numeric prefix and a
`_category_.json` inside it.

For an item, right-click a module or a subsection and choose **Course: New
Item**. It asks where the item goes, which of the five types it is, a name and a
position. An assignment also asks for its points, an external URL for its
address.

## Reordering

Drag an item up or down inside its module, or drag a module onto another module.
If you would rather pick from a list, right-click and choose **Course: Move
Item** or **Course: Move Module**. Everything around it is renumbered to make
room.

## Renaming

Right-click and choose **Course: Rename Item**, which changes both the file name
and the `title` in the frontmatter. **Course: Rename Module** does the same for
a module: the folder, and the label in its `_category_.json`.

## Deleting

Right-click and choose **Course: Delete Item** or **Course: Delete Module**,
then confirm the dialog. The remaining files close the gap.

> [!WARNING]
>
> Deleting a module deletes its pages, assignments and files from disk. Commit
> your work first.

Nothing here touches Canvas. An item you delete locally stays in your Canvas
course, listed as orphaned in every report, until you prune it.

## Moving to Another Module

Drag the item onto the other module, or onto one of its subsections. From the
right-click menu it is **Course: Move Item to Module**. Subsections can move
too, always into the module root, because subsections never nest.

## Merging Two Items

Merging takes two right-clicks, and the order matters. Right-click the item that
will be **deleted** and choose **Merge: Set as Source**. Then right-click the
item that **receives** its content and choose **Merge with Source**. A dialog
names both files and says again that the source is deleted. Page and assignment
rows only.

The Canvas page behind the source is left alone, and sits there until you prune
it.

## Splitting an Item

Open the page and put the cursor on the last line that should stay. Then
right-click in the editor and choose **Course: Split Item at Cursor**, and give
the new item a title. Everything below the cursor line moves into it.

## From the Terminal

The panel runs the CLI, so every one of these is also a command:

```bash
npx course new-module         # create a module
npx course move-module        # reorder a module
npx course rename-module      # rename a module
npx course delete-module      # delete a module
npx course new-item           # create an item
npx course move-item          # reorder an item within its module
npx course movetomodule-item  # move an item to another module
npx course rename-item        # rename an item
npx course delete-item        # delete an item
npx course merge-items        # merge two items into one
npx course split-item         # split an item into two
```

They ask for what they need, and the item commands work out which module you
mean when you run them from inside a module folder. Two of the prompts run the
other way round from the sidebar: `merge-items` asks for the target first and
the source second, and `split-item` asks which line to split after, counted from
the first line after the frontmatter.

Flags answer the questions instead, which is what you want in a script:

```bash
npx course new-item -m 01-getting-started -t page -n "My New Page"
npx course delete-module --module 02-old-module --yes
```

Run `npx course <command> --help` for the flags a command takes.

## Try It

1. Drag your Scratch item to the top of the module, and watch the numbers on the
   files change in VS Code’s Explorer.
2. Right-click it, choose **Course: Delete Item**, and confirm.

> [!CHECK]
>
> The remaining items are numbered without a gap, and the status bar reported
> both commands as they finished.
