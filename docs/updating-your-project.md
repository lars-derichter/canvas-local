# Updating Your Project

The original Canvas Course Builder project may receive bug fixes, new features,
or improved documentation over time. This guide shows you how to pull those
updates into your project.

> [!TIP]
>
> Before updating, make sure all your local changes are committed. Run
> `git status` to check — if it shows nothing to commit, you're good to go.

## One-Time Setup

Add the original Canvas Course Builder project as a remote called `upstream`.
You only need to do this once:

```bash
git remote add upstream https://github.com/lars-derichter/canvas-course-builder.git
```

You can verify it was added:

```bash
git remote -v
```

You should see both `origin` (your project) and `upstream` (the original
project).

The first time you run the script it creates a configuration file,
`update-from-upstream.conf`, and exits without merging anything. Review the
file, commit it, then run the script again. See
[Configuring what's protected](#configuring-whats-protected) for what the
settings mean.

## Pulling Updates

The easiest way to update is with the included script:

```bash
bash update-from-upstream.sh
```

The script:

1. Fetches the latest changes from upstream.
2. Squash-merges them into a **single commit** on your branch — upstream's full
   history is not imported.
3. Always keeps your protected paths. The content directories (`course/`,
   `evaluations/`, `sources/`) and the protected files (`README.md`,
   `AGENTS.md`, `CLAUDE.md`, the style and course-context guides,
   `course.config.yml`, and the config file itself) are restored from your
   version, never overwritten by upstream.
4. Prompts you for any **other** file that changed on both sides. For each
   conflict you choose what to do (see
   [Resolving conflicts](#resolving-conflicts) below).
5. Tags the merge point so you can see which upstream version you're on.

After running the script, install any updated dependencies:

```bash
npm install
```

Then push your updated branch to GitHub:

```bash
git push
```

## Configuring What's Protected

The script reads its settings from `update-from-upstream.conf`. The file uses a
simple `key = value` format with space-separated lists; lines starting with `#`
are comments.

```ini
# Directories whose local content is always kept (never overwritten by upstream).
protected_dirs = course evaluations sources

# Individual files always kept. Includes this config file itself so your
# customizations here survive future upstream updates.
protected_files = README.md AGENTS.md CLAUDE.md context/writing-style.md context/course-context.md update-from-upstream.conf course.config.yml

# Upstream git remote and branch to merge from.
upstream_remote = upstream
upstream_branch = main
```

- **`protected_dirs`**: directories whose local content is always kept. Anything
  upstream adds inside them is dropped.
- **`protected_files`**: individual files always kept. The config file lists
  itself here, so your edits to it survive future updates. Add any tooling file
  you've customised and don't want upstream to touch.
- **`upstream_remote`** / **`upstream_branch`**: where to merge from.

> [!NOTE]
>
> When upstream introduces a new file that belongs in `protected_files`, the
> script handles it in two steps: the first update brings the file in, and the
> next run registers it in your `protected_files` automatically. Don't add a
> file to `protected_files` by hand before it exists in your project; the
> protection step deletes protected files that are absent from your history,
> which would eat the incoming file.

Because the config file is itself protected, edits you make here are never
overwritten. Commit the file after changing it.

> [!TIP]
>
> `export-styles/` and `src/css/themes/` ship unprotected on purpose: they hold
> defaults you copy out of, not edit in place. Keep your own export style or
> theme under `sources/` and point `export.style:` / `theme:` in
> `course.config.yml` at it — `sources/` is protected and `course.config.yml` is
> too. If you would rather edit a shipped file in place, add it to
> `protected_files`, or choose `a` at the conflict prompt. See
> [Customization](customization.md#branding).

### Deleting Files That Belong to the Tooling Project

"Use this template" copies the whole repository, so your course starts out with
a handful of files that govern the upstream project rather than your course: the
[code of conduct](../CODE_OF_CONDUCT.md), the [security policy](../SECURITY.md),
`.github/ISSUE_TEMPLATE/`, `.github/PULL_REQUEST_TEMPLATE.md`,
[CONTRIBUTING.md](../CONTRIBUTING.md) and the tooling's
[CHANGELOG.md](../CHANGELOG.md). Each says up front which project it applies to,
so leaving them costs nothing and keeps the bug-report route to the upstream
project open. Most people leave them.

If you would rather not carry them, deleting the files is only half the job: the
next update delivers them again. Delete them, commit the deletions, then list
them here:

```ini
protected_dirs = course evaluations sources .github/ISSUE_TEMPLATE
protected_files = README.md AGENTS.md CLAUDE.md context/writing-style.md context/course-context.md update-from-upstream.conf course.config.yml CODE_OF_CONDUCT.md SECURITY.md .github/PULL_REQUEST_TEMPLATE.md
```

Protection restores a path from your own history, and a protected path absent
from your history gets removed instead — which is what you want here. Commit the
deletions first, so "absent from your history" is true by the time the next
update runs.

> [!WARNING]
>
> Protect the individual paths, not `.github` as a whole. That directory also
> holds the CI workflow and the [GitHub Pages](hosting.md) deploy workflow;
> protecting it wholesale would freeze both at the version you happen to have
> today.

`LICENSE` and `THIRD-PARTY.md` are a different case: they cover code that stays
in your repository, so leave them alone.

### Renamed Files and Folders

Upstream occasionally renames a skill folder or a docs file. A squash merge does
not delete the old path in your project, so the update script prunes known old
paths automatically, but it can only do that from the run _after_ the one that
brought it the new list. After an update that renames files, either run the
update once more or remove the old paths yourself with `git rm -r`. If you
customised one of the old files, re-apply your edits to the renamed successor;
the old content stays in your git history.

A **protected** file that moves is the one case the script cannot prune for you:
it restores your version at the old path before pruning would run, so deleting
the old path automatically would throw your customisations away. Move those by
hand.

### Moving to `context/` (One-Off)

The style guide and the course context used to live in `docs/`. They now sit in
`context/`, which holds the files that are yours rather than the tooling
project's, and the style guide is called `writing-style.md` there so that
nothing confuses it with the export styles. Both are protected, so the update
leaves you with your versions at the old paths and upstream's blank baselines at
the new ones, while the skills already read the new ones. Fix that once, running
whichever of the first two lines matches what your repository actually holds:

```bash
mv -f docs/style.md          context/writing-style.md   # coming from 1.0.0
mv -f context/style.md       context/writing-style.md   # if already on context/
mv -f docs/course-context.md context/course-context.md
```

Then open `update-from-upstream.conf` and replace the old paths in
`protected_files` with `context/writing-style.md` and
`context/course-context.md`, keeping any entries you added yourself. Without
this step the next update overwrites both files with the shipped baselines.

Finally, run
`grep -rn "docs/style\.md\|context/style\.md\|docs/course-context\.md" .` and
fix anything left in `course/`, `evaluations/` or `sources/` — those are
protected, so upstream never touches them and they may still point at the old
locations.

### The Course Title Moved Into `course.config.yml` (One-Off)

The preview site used to be titled from `docusaurus.config.js`. It now reads
`title` from `course.config.yml`, which is protected, so your choice survives
future updates. One consequence for an existing project: **add a `title:`**.
Your `course.config.yml` is protected and therefore does not gain the new key,
so until you add it the site falls back to the generic label for your course
language: "Course", or "Cursus". Nothing breaks, but nothing names your course
either.

### Publishing Moved Out of `docusaurus.config.js` (One-Off)

The site's public address used to be written into `docusaurus.config.js` by
`npx course setup-pages`, which also generated a deploy workflow. Both now come
from GitHub Pages at build time, and `.github/workflows/deploy.yml` ships with
the project, so the command is gone. Publishing is the **Settings > Pages**
source setting and nothing else. See [Hosting](hosting.md).

If you already publish, this update touches `docusaurus.config.js` and
`.github/workflows/deploy.yml`, neither of which is protected, so the script
prompts you for both. **Take upstream's version of each.** Upstream's
configuration with your old workflow is the one combination that breaks: the old
workflow passes no address, so the site rebuilds at the root path and its links
and assets 404 under your project path. Keeping both of your own files also
still works, but leaves you maintaining a workflow the project no longer
generates.

> [!WARNING]
>
> If you wrote your own `.github/workflows/deploy.yml` for a different host,
> rename it before updating. Upstream now ships a file at that path, and the
> conflict prompt is your only chance to keep yours.

### The Sync State Moved to Schema v4 (One-Off)

Which Canvas object each file is used to be recorded in three places at once: a
`canvas_id` in the markdown frontmatter, a `customProps.canvas_module_id` in
each `_category_.json`, and `.canvas-sync.json`. They drifted apart, so the
first two are gone and `.canvas-sync.json` is the only record left. It is keyed
by each file's path under `course/`, it carries `schema_version: 4`, and it is
committed rather than gitignored, because a source of truth belongs in git.

An existing project meets three things after this update:

- **Every command that opens the sync state stops.** A v3 file is not upgraded
  in place, it is refused:

  ```text
  .canvas-sync.json has schema_version 3, but this version only reads 4. Run `npx course reset-sync-state` and push again to rebuild it.
  ```

- **The old keys are still in your tree, and nothing reads them.** `course/` is
  protected, so the update leaves every `canvas_id` and `canvas_module_id`
  exactly where it was. They are inert, not harmful, but they are a second
  answer to a question that now has one.
- **`git status` shows `.canvas-sync.json` as untracked.** Only
  `.canvas-sync.json.tmp` is ignored now. Commit the file once it is rebuilt,
  and commit it alongside the content of every push and pull from then on.

Do what the message says. Back the Canvas course up first
([Backups](backups.md)), then:

```bash
npx course reset-sync-state
npx course push
```

`reset-sync-state` never opens the state file, so the refusal above does not
stop it. It asks for confirmation, deletes `.canvas-sync.json`, and strips the
leftover `canvas_id` and `canvas_module_id` keys on its way through. It touches
nothing on Canvas: see
[Advanced commands](advanced-commands.md#reset-sync-state).

The push that follows is the part to watch, because your Canvas course still
holds everything the old state described and the new state describes nothing.
Push pins the local copy as the winner, pairs each module with the Canvas module
of the same name, and pairs each item with the Canvas object of the same type
and title, claiming what is already there instead of copying it. What it cannot
pair, it creates. So a page you renamed on one side only, an item whose type you
changed, or two items in a module sharing one title all end up as a second copy
on Canvas. Read the report before you assume the course came through clean, and
run `npx course push --dry-run` first if you would rather see the plan than the
result. See
[Push reconciles a module's item list](limitations.md#push-reconciles-a-modules-item-list)
for what that pairing does item by item.

> [!WARNING]
>
> Use `push`, not `sync`, for this first run. With nothing in the state linking
> the two sides, `sync` cannot tell which copy is newer and refuses every module
> that holds items on both sides. Push answers that question by pinning a
> direction, which is exactly what the refusal asks for.

## Resolving Conflicts

A conflict only happens when a file outside your protected paths was changed
**both** locally and upstream. For each such file the script shows when each
side was last committed and prompts:

```
Conflict: docusaurus.config.js
  local last commit:    2026-05-20
  upstream last commit: 2026-05-28
  [l]ocal  [u]pstream  [m]erge in editor  [a]lways keep local   (default: upstream = most recent)
```

| Choice | What it does                                                                                                                          |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `l`    | Keep your version of the file.                                                                                                        |
| `u`    | Take the upstream version.                                                                                                            |
| `m`    | Open the conflict-marked file in your editor so you can merge by hand. The script waits, then checks that no conflict markers remain. |
| `a`    | Keep your version **and** add the file to `protected_files` in the config, so it stops conflicting on future updates.                 |
| Enter  | Apply the default — whichever side was committed most recently (ties go to upstream).                                                 |

If the script runs without a terminal (e.g. from another script), it applies the
default automatically for every conflict.

The `a` option is the clean way to "pin" a tooling file you've customised: the
next update restores it from your version before the resolver ever runs, so you
won't be asked again.

## Recovering Local Changes to Tooling Files

If you took the upstream version (`u`, or the default) of a file you'd actually
customised, you can recover your version afterwards.

**Before pushing** — restore your version from the previous commit:

```bash
git checkout HEAD~1 -- path/to/file
git add path/to/file
git commit -m "Restore local changes to path/to/file"
```

**After pushing** — recover from an earlier commit:

```bash
# See what changed
git diff HEAD~1 HEAD -- path/to/file

# Restore your version entirely
git checkout HEAD~1 -- path/to/file

# Or selectively re-apply your edits on top of the upstream version
```

> [!TIP]
>
> To stop being asked about a file you always want to keep, choose `a` (always
> keep local) at the prompt, or add it to `protected_files` yourself.

## Manual Workflow

If you prefer to run the steps yourself instead of using the script:

1. **Fetch** the latest changes:

   ```bash
   git fetch upstream
   ```

2. **Squash merge** the changes. The `--squash` flag applies all upstream
   changes without importing their commit history. The
   `--allow-unrelated-histories` flag is needed because your project was created
   from a template, not forked:

   ```bash
   git merge upstream/main --allow-unrelated-histories --squash
   ```

3. **Restore your content from HEAD**, then resolve any remaining conflicts. A
   squash merge only flags conflicts when both sides modify the same file —
   files that exist upstream but not locally are added silently as staged
   additions. `git checkout HEAD --` will not unstage them (they are absent from
   HEAD), so first reset the index for those paths, then check out from HEAD,
   then clean the working tree:

   ```bash
   # Unstage upstream-only additions in your content paths
   git reset HEAD -- course/ evaluations/ sources/ 2>/dev/null || true

   # Restore your content and protected files from HEAD
   git checkout HEAD -- course/ evaluations/ sources/ \
     README.md AGENTS.md CLAUDE.md context/writing-style.md context/course-context.md \
     update-from-upstream.conf course.config.yml 2>/dev/null || true

   # Drop the now-untracked upstream-only files
   git clean -fd -- course/ evaluations/ sources/

   # For each remaining conflicted file, keep your version...
   git checkout HEAD -- path/to/conflicted-file
   # ...or take upstream's:
   git checkout --theirs -- path/to/conflicted-file

   # Stage everything
   git add -A
   ```

   The protected paths above mirror the defaults in `update-from-upstream.conf`;
   adjust the list to match your own config.

4. **Commit** the result:

   ```bash
   git commit -m "Import upstream updates from canvas-course-builder"
   ```

5. **Tag** the merge point for future reference:

   ```bash
   git tag -f last-upstream-merge upstream/main
   ```

6. **Install** updated dependencies and **push**:

   ```bash
   npm install
   git push
   ```

> [!TIP]
>
> If a merge gets too complicated, you can abort it and try again later:
>
> ```bash
> git merge --abort
> ```
