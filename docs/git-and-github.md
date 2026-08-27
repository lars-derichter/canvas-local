# Git and GitHub

What git and GitHub are, why this project uses them, and the handful of commands
you need. No prior experience required.

This is the background reading. For the steps in order (install, create the
project, clone it, publish a module), follow
[Your first course, step by step](first-course.md), which installs git along the
way.

## What Are Git and GitHub?

**Git** is a version control tool that keeps track of every change you make to
your files. Think of it as an unlimited undo history for your entire project. If
you make a mistake or want to go back to an earlier version, Git makes that
easy.

**GitHub** is a website that hosts Git projects online. It lets you store a
backup of your work in the cloud, collaborate with others, and easily get
updates from the original Coursewright project.

## Creating a GitHub Account

If you already have a GitHub account, skip ahead to
[Installing Git](#installing-git).

1. Go to [github.com/signup](https://github.com/signup).
2. Follow the steps to create your account with an email address, password, and
   username.
3. Verify your email address when prompted.

That's it. You're ready to use GitHub.

## Installing Git

### Check If Git Is Already Installed

Open a terminal (on macOS: **Terminal**, on Windows: **Command Prompt** or
**PowerShell**) and run:

```bash
git --version
```

If you see a version number (e.g. `git version 2.43.0`), Git is already
installed and you can skip ahead to
[Template repositories](#template-repositories).

### Windows

Download and run the installer from
[git-scm.com/downloads](https://git-scm.com/downloads). The default settings
work fine. Just click through the installer.

After installing, open a new **Command Prompt** or **PowerShell** window and
verify with `git --version`.

### macOS

The easiest option is to open **Terminal** and run:

```bash
xcode-select --install
```

This installs Apple's Command Line Tools, which include Git. Follow the prompts
to complete the installation.

Alternatively, if you use [Homebrew](https://brew.sh/), run `brew install git`.

### Linux

Use your distribution's package manager. For example:

```bash
# Ubuntu / Debian
sudo apt install git

# Fedora
sudo dnf install git
```

> [!TIP]
>
> After installing Git for the first time, set your name and email. These appear
> in your change history:
>
> ```bash
> git config --global user.name "Your Name"
> git config --global user.email "your.email@example.com"
> ```

## Template Repositories

Coursewright is a **template repository**: you create your own independent copy
from it. Your project won't affect the original, and you can create as many
copies as you need, one per course. Later you can still pull in improvements to
the tooling without touching your content; see
[Updating your project](updating-your-project.md).

[Your first course](first-course.md#5-create-your-course-project) walks through
making that copy.

## Keeping Your Project Private

If you plan to store evaluation materials (exams, tests) in the `evaluations/`
folder, make sure your project is **private**. Otherwise students can find your
materials on GitHub.

You can change your project's visibility in GitHub under **Settings > General >
Danger Zone > Change repository visibility**.

Educators are eligible for a **free GitHub Pro account**, which includes
unlimited private repositories and other benefits. You can apply at
[GitHub Education](https://education.github.com/discount_requests/application).

You can keep your repository private and still publish a public website with
your course materials (without exposing `evaluations/`). See the
[hosting guide](hosting.md).

## Basic Git Workflow

As you work on your course materials, use these three commands to save your
changes:

1. **Stage your changes.** Tell Git which files to include in the next save
   point:

   ```bash
   git add .
   ```

   The `.` means "all changed files". You can also add specific files:
   `git add course/01-intro/01-welcome.md`

2. **Commit.** Create a save point with a short description of what you changed:

   ```bash
   git commit -m "Add welcome page to intro module"
   ```

3. **Push.** Upload your commit to GitHub so it's backed up online:

   ```bash
   git push
   ```

> [!TIP]
>
> Commit early and often. Small, frequent commits are easier to understand and
> undo than one large commit with many changes.

> [!IMPORTANT]
>
> Git backs up your markdown, not your Canvas course. Backing up what only
> exists in Canvas is a separate job: see
> [Backing up a Canvas course](backups.md).

### Commit the Canvas Sync File

Your project holds one file you did not write: `.canvas-sync.json`. Coursewright
writes it when you connect the project to a Canvas course, and updates it on
every push and pull after that. It records which Canvas page, assignment or
discussion each of your markdown files became, and nothing else in your project
does.

Commit it like any other file. `git add .` picks it up along with your markdown,
so the three commands above already do the right thing. What you must not do is
add it to `.gitignore` to get it out of the way.

It matters as soon as there is a second copy of your project: a clone on another
machine, a colleague's checkout, or a fresh one you make after losing the
original. With the file committed, that copy arrives already knowing which
Canvas objects the course owns, and a push from it updates those objects.
Without it, the copy falls back on matching titles, and anything whose title no
longer matches the one in Canvas is created a second time instead of updated.

One more thing about a copy that travels: `.canvas-sync.json` names the Canvas
course it was built against, and so does `.env`. If the two disagree, the sync
commands stop and name both courses rather than pushing one course's ids at the
other. A clone is the easy way to arrive there: point its `.env` at a course of
your own and the file still describes the original. Troubleshooting covers
[which of the two to change](troubleshooting.md#canvas-syncjson-describes-course-n).

## Next Steps

With git and GitHub set up, continue with
[Your first course, step by step](first-course.md).
