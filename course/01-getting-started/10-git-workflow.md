---
title: Git Workflow
canvas_type: page
---

# Git Workflow

By now you have Git installed, a GitHub account, and a local copy of your course
project. This page shows you how to use Git as part of your daily workflow:
saving your work, backing it up to GitHub, and getting things back when you need
to.

If you still need to set up Git or GitHub, work through the git and GitHub guide
first (`docs/git-and-github.md` in your project folder, also readable on
GitHub).

## Saving Your Work (Terminal)

Every time you finish a piece of work (a new page, an updated assignment, a
reorganised module), you should save it in Git. The process has three steps:

```bash
# 1. Stage your changes (tell Git what to include)
git add .

# 2. Commit (create a save point with a short description)
git commit -m "Add introduction page to database module"

# 3. Push (upload to GitHub so it's backed up)
git push
```

That’s it. Stage, commit, push. You will do this dozens of times as you build
your course.

> [!TIP]
>
> Commit early and often. A commit after every meaningful change (added a page,
> fixed a typo, reorganised a module) is better than one giant commit at the end
> of the day. Small commits are easier to understand and easier to undo if
> something goes wrong.

### What Makes a Good Commit Message?

A commit message should describe _what_ you changed in a few words. Some
examples:

- `Add welcome page to intro module`
- `Fix typo in assignment instructions`
- `Reorganise module 3 into subsections`
- `Update due dates for week 5 assignments`

You are writing these for your future self, so make them clear enough that you
can scan a list of commits and find what you are looking for.

## Saving Your Work (VS Code)

If you prefer a visual approach, VS Code has a built-in Source Control panel
that handles everything without touching the terminal.

### Opening Source Control

Click the **Source Control** icon in the left sidebar. It looks like a branching
line with dots. You can also press **Ctrl+Shift+G** (Windows/Linux) or
**Cmd+Shift+G** (macOS).

The panel shows a list of all files you have changed since your last commit.

### Viewing Changes

Click any file in the Source Control panel to see a **diff**: a side-by-side
comparison showing exactly what you added, removed, or changed. Green lines are
additions, red lines are deletions.

This is a great way to review your work before saving it.

### Staging Changes

Before you can commit, you need to **stage** the files you want to include:

- To stage a single file, hover over it and click the **+** button
- To stage all changed files, click the **+** button next to the **Changes**
  heading

Staged files move to a **Staged Changes** section at the top of the panel.

> [!TIP]
>
> You do not have to stage everything at once. If you changed three files but
> only want to commit two of them right now, just stage those two.

### Committing

Once your files are staged:

1. Type a short commit message in the text box at the top of the Source Control
   panel (e.g. `Add lab instructions for week 3`)
2. Click the **Commit** button (or press **Ctrl+Enter** / **Cmd+Enter**)

Your changes are now saved locally in Git.

### Pushing to GitHub

After committing, you need to push your changes to GitHub so they are backed up
online:

- Click the **Sync Changes** button that appears in the Source Control panel
  after committing
- Or click the sync icon (circular arrows) in the bottom status bar

The first time you push, VS Code may ask you to sign in to GitHub. Follow the
prompts. After that it remembers your credentials.

### Pulling Changes

If you work on multiple computers or collaborate with someone, you may need to
pull changes that were pushed from elsewhere:

- Click **Sync Changes** in the Source Control panel: this both pushes your
  local commits and pulls any new commits from GitHub
- Or use the command palette (**Cmd+Shift+P** / **Ctrl+Shift+P**) and search for
  **Git: Pull**

## The Canvas Sync File

Your project holds one file you did not write: `.canvas-sync.json`, in the
project root. Coursewright creates it when you connect the project to a Canvas
course, and updates it on every push, pull and sync after that. It records which
Canvas page, assignment or discussion each of your markdown files became, and
nothing else in your project does.

Commit it. It is in the project on purpose and it is not ignored, so `git add .`
picks it up along with your markdown, and so does the **+** next to **Changes**
in the Source Control panel. What you must not do is add it to `.gitignore` to
get it out of the way.

A push, a pull or a sync leaves you two things to save: the content you wrote,
and the sync state that records where it landed. Commit them together, so the
record and the thing it records never drift apart in your history.

It matters as soon as there is a second copy of your project: a clone on another
laptop, a colleague’s checkout, or a fresh one you make after losing the
original. That copy needs to know which Canvas objects the course already owns.
With the file committed it does, and a push from it updates them. Without it,
the copy falls back on matching titles, and anything whose title no longer
matches is created a second time instead of updated.

### If Git Reports a Conflict in It

Push from two checkouts, or from a laptop and a desktop, and git can end up with
two versions of the file and no way to choose. Do not merge the JSON by hand.
Keep one side whole, mark the conflict resolved, and finish the merge:

```bash
# take one side of the file; either will do
git checkout --ours -- .canvas-sync.json
git add .canvas-sync.json
```

Then run `npx course push`. Which side you kept barely matters: push compares
your files against Canvas, claims each object back by its type and title, and
writes the rows again.

> [!WARNING]
>
> Never commit the file with the conflict markers still in it. The file stops
> being readable, and until you repair it, `push`, `pull` and `sync` refuse to
> run: each one names the file and tells you the markers are still there.
> Resolve the merge as above and they run again. The troubleshooting guide
> (`docs/troubleshooting.md` in your project folder, also readable on GitHub)
> covers the repair under “Corrupted .canvas-sync.json”.

## Viewing History and Getting Things Back

One of the biggest benefits of Git is that nothing is ever truly lost. Every
commit is a snapshot of your entire project that you can go back to at any time.

### Browsing History on GitHub

The easiest way to explore your project’s history is on GitHub:

1. Go to your repository on GitHub (e.g.
   `github.com/YOUR-USERNAME/YOUR-COURSE-NAME`)
2. Click on the **commits** link near the top of the page. You will see a list
   of all your commits, newest first
3. Click on any commit to see exactly what changed in that commit

### Viewing an Older Version of a File

If you want to see what a file looked like at an earlier point in time:

1. Navigate to the file on GitHub
2. Click the **History** button in the top-right corner to see all commits that
   touched that file
3. Click on a commit, then click **View file** to see the complete file as it
   was at that moment

### Restoring a Previous Version

If you made a mistake and want to get back an older version of a file:

1. Find the version you want on GitHub (using the steps above)
2. Click the **Raw** button to see the plain text
3. Copy the content and paste it into your local file
4. Stage, commit, and push the restored version

From the terminal, you can also restore a specific file from a previous commit:

```bash
# See your recent commits
git log --oneline

# Restore a file from a specific commit
git checkout abc1234 -- course/01-getting-started/03-writing-your-pages/01-markdown-basics.md
```

Replace `abc1234` with the commit hash from `git log`. After restoring, stage
and commit the change as usual.

> [!NOTE]
>
> You do not need to memorise these recovery commands. The GitHub web interface
> is often the quickest way to find and restore old content, especially if you
> are not comfortable with the terminal.

## Keep Your Repository Private

> [!WARNING]
>
> If you use the `evaluations/` folder to store exams, tests, or other
> assessment materials, make sure your GitHub repository is set to **private**.
> A public repository means anyone, including students, can see everything in
> it.

You can change your repository’s visibility in GitHub under **Settings >
General > Danger Zone > Change repository visibility**.

Educators are eligible for a **free GitHub Pro account**, which includes
unlimited private repositories and other benefits. You can apply at
[GitHub Education](https://education.github.com/discount_requests/application).

## Publishing Your Course Online

Since your repository is on GitHub anyway, you can also publish the Docusaurus
site for free with GitHub Pages. Go to **Settings > Pages** and set **Source**
to **GitHub Actions**. That is the whole setup: from then on, GitHub rebuilds
and republishes the site every time you push. To serve it on your own domain
instead of the default `github.io` address, enter that domain on the same
settings page.

> [!WARNING]
>
> The published site is public, even if the repository itself is private. Only
> `course/` is served (`evaluations/` and `sources/` are not part of the site),
> but make sure you are comfortable with your course content being readable by
> anyone before enabling this.

## Learning Resources

Want to learn more about Git and GitHub? These tutorials are designed to be
beginner-friendly:

- [GitHub Skills](https://skills.github.com/): free interactive courses by
  GitHub, learn by doing in real repositories
- [Git Handbook](https://docs.github.com/en/get-started/using-git/about-git): a
  short, clear overview of Git concepts from the GitHub documentation
- [Atlassian Git Tutorials](https://www.atlassian.com/git/tutorials):
  well-written guides covering everything from basics to advanced topics
- [Oh My Git!](https://ohmygit.org/): a fun, visual game that teaches Git
  concepts through puzzles
