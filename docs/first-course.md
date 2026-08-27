# Your First Course, Step by Step

This guide takes you from a computer with nothing installed to a course module
published in Canvas. It assumes no experience with VS Code, the command line, or
git. Every command is one you copy and paste.

Set aside about an hour for the first run. You do most of it once and never
again.

If a step fails, [Troubleshooting](troubleshooting.md) covers the common
failures. If you would rather read what the tool does before installing it, the
[user guide](user-guide.md) is the reference and [limitations](limitations.md)
is the honest list of what it will not do.

## What You Will Install

Three programs, all free, all standard:

- **[VS Code](https://code.visualstudio.com/)**: the editor you will write in.
- **[Node.js](https://nodejs.org/)**: the engine the tool runs on. You will
  never use it directly.
- **[Git](https://git-scm.com/downloads)**: keeps the history of your course and
  syncs it with GitHub.

And one account: **[GitHub](https://github.com/signup)**, where your course
lives online.

## 1. Install VS Code

Go to [code.visualstudio.com](https://code.visualstudio.com/), download the
version for your system, and run the installer. The defaults are fine.

On Windows, one checkbox in the installer is worth ticking: **Add to PATH**. It
is on by default. On macOS, drag the app to your Applications folder, then open
VS Code and do this once:

1. Press **Cmd+Shift+P** to open the command palette, a search box for
   everything VS Code can do. You will use it a lot.
2. Type `shell command` and choose **Shell Command: Install 'code' command in
   PATH**.

That step lets the bundled VS Code extension install itself later. Skip it and
you will hit a confusing error in step 9.

## 2. Install Node.js

Go to [nodejs.org](https://nodejs.org/) and download the **LTS** version, as
long as it is 24 or higher. Run the installer and accept the defaults.

## 3. Install Git

**Windows:** download the installer from
[git-scm.com/downloads](https://git-scm.com/downloads) and click through it. The
defaults are fine.

**macOS:** open VS Code, then open its built-in terminal with **Ctrl+`** (the
backtick key, top-left on most keyboards). Type this and press Enter:

```bash
xcode-select --install
```

**Linux:** `sudo apt install git` on Ubuntu or Debian, `sudo dnf install git` on
Fedora.

Then tell git who you are. This name appears in your course history:

```bash
git config --global user.name "Your Name"
git config --global user.email "your.email@example.com"
```

> [!NOTE]
>
> **The terminal** is the panel where you type commands instead of clicking. VS
> Code has one built in: **Ctrl+`** opens and closes it. Everything in this
> guide happens there, so you never need to find a separate terminal
> application. You type a command, press Enter, and wait for the prompt to come
> back before typing the next one.

## 4. Create Your GitHub Account

If you do not have one, sign up at
[github.com/signup](https://github.com/signup) and verify your email address.

GitHub is where your course files live online. It is your backup, your history,
and the way you will pull in improvements to the tooling later.

## 5. Create Your Course Project

Coursewright is a **template**: you make your own copy, and your copy is yours.
Changes you make never affect the original, and you can make one copy per
course.

1. Open the
   [Coursewright project page](https://github.com/lars-derichter/coursewright).
2. Click **Use this template** at the top right, then **Create a new
   repository**.
3. Give it a name that says which course it is: `course-web-development`,
   `course-databases`. You will thank yourself when you have four of them.
4. Choose **Private** or **Public**, and click **Create repository**.

> [!WARNING]
>
> If you will keep exams or tests in the `evaluations/` folder, make the
> repository **private**. A public repository is public: students can find it.
> You can change this later under **Settings > General > Danger Zone**, and
> educators can get a free GitHub Pro account with unlimited private
> repositories through
> [GitHub Education](https://education.github.com/discount_requests/application).

Check the page header now says `github.com/YOUR-USERNAME/your-project-name`
before continuing.

## 6. Download It to Your Computer

**Cloning** means downloading your project so you can work on it locally.

1. On your project's GitHub page, click the green **Code** button and copy the
   HTTPS URL.
2. Open VS Code. From the **File** menu choose **Open Folder**, and pick (or
   create) a folder where you keep your work: `Documents`, for example.
3. Open the terminal with
   **Ctrl+`** and run this, pasting your own URL after `git clone`:

   ```bash
   git clone https://github.com/YOUR-USERNAME/your-project-name.git
   ```

4. Now open the project itself: **File > Open Folder**, and choose the folder
   git just created. VS Code reloads with your course in the sidebar.

From here on, every command goes in VS Code's terminal, with this folder open.

## 7. Install and Preview

Two commands. The first downloads what the tool needs; it takes a minute or two
and prints a lot of text.

```bash
npm install
```

The second starts a preview of your course as a website:

```bash
npm start
```

Your browser opens at `localhost:3000` showing the built-in **Getting Started**
module. Leave it running. It updates as you write.

> [!NOTE]
>
> `npm start` keeps the terminal busy while the preview is open. Press
> **Ctrl+C** to stop it, or open a second terminal for other commands with the
> **+** button at the top right of the terminal panel.

Read the Getting Started module in the preview. It teaches markdown, the folder
layout, and the daily commands, and it is a working example of everything this
tool can publish.

## 8. Make It Your Course

The template ships as a working example. One command turns it into yours:

```bash
npx course setup
```

It asks for your course name, the language of the labels students see, the look
of the site and the exports, and whether to remove the built-in tutorial module.
Answer, and it writes the configuration for you.

> [!TIP]
>
> `npx` runs a tool that came with the project: nothing extra to install. Every
> command in this project starts with `npx course`, and `npx course --help`
> lists them all.

[Customization](customization.md) explains every choice and how to change it
later. If you work with an AI assistant, the `/course-setup` skill walks the
same ground and writes the prose the command cannot; see
[AI assistants](ai-assistants.md).

## 9. Install the VS Code Extension

This puts every command in the command palette and the everyday ones in a
sidebar, so day-to-day work needs no typing:

```bash
npm run vscode:install
```

Then reload VS Code (**Cmd/Ctrl+Shift+P**, type `reload window`). A book icon
appears in the left-hand bar: that is the **Course Manager** panel, showing your
modules and items as a tree. Right-click anything for the actions that apply to
it. The panel deliberately carries no destructive command: `reset-canvas`,
`reset-sync-state` and `build-glossary` are reachable from the palette only, and
[Advanced commands](advanced-commands.md) covers what they do.

If this step fails with a message about `code` not being found, go back to step
1 and install the shell command.

[VS Code integration](vscode.md) is the full reference for the panel.

## 10. Back up the Canvas Course

Before you connect Canvas, read [Backing up a Canvas course](backups.md). It
takes five minutes and it is the one step in this guide you cannot undo by
retrying.

If your Canvas course already has content in it, export it first. If you can get
an empty sandbox course, point the tool at that until you trust it. The tool
does warn you before its first push to a course that already holds content, but
a warning is not a backup.

## 11. Connect Canvas

```bash
npx course init
```

It asks for three things: your Canvas web address, an access token, and the
course ID. [Canvas setup](canvas-setup.md) shows where to find each one. They go
into a `.env` file that stays on your computer and is never committed.

## 12. Write Something and Publish It

Create a module:

```bash
npx course new-module
```

It asks for a name and a position and creates the folder. Add a page to it:

```bash
npx course new-item
```

Write in the file that appears, watch it in the preview, then check what would
happen on Canvas before anything happens:

```bash
npx course push --dry-run
```

Read that output. When it says what you expect:

```bash
npx course push
```

Open the course in Canvas. Your module is there.

## 13. Save Your Work

Committing is how you keep a version you can return to. Three commands:

```bash
git add .
git commit -m "Add the first module"
git push
```

`add` selects the changes, `commit` records them with a message, and `push`
uploads them to GitHub. Do this at the end of every writing session. Small,
frequent commits are far easier to undo than one big one.

[Git and GitHub](git-and-github.md) explains what is actually happening here.

## Where to Go Next

- **[User guide](user-guide.md)**: the course structure, every command, and the
  export to PDF or Word.
- **[Markdown guide](markdown.md)**: the formatting syntax, links, images, and
  the coloured alert boxes.
- **[Lesson workflow](lesson-workflow.md)**: designing a course with an AI
  assistant, starting from what students should be able to do.
- **[Limitations](limitations.md)**: what the tool will not do, and what to do
  instead.
- **[Hosting](hosting.md)**: publish the preview as a free public website.
