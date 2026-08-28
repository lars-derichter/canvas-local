# Contributing

Contributions are welcome: a bug report, a feature suggestion, or a pull request
with a fix. Everyone taking part is expected to follow the
[code of conduct](../CODE_OF_CONDUCT.md). For a technical overview of the
codebase (the three layers, the sync state, the reconcile engine the four sync
commands share, and link resolution), start at [architecture](architecture.md).

## Reporting an Issue

If something isn't working as expected, open an issue on GitHub:

1. Go to the **Issues** tab on
   [the original Coursewright project page.](https://github.com/lars-derichter/coursewright)
2. Click **New issue**.
3. Pick the form that fits (bug report, idea, or documentation problem) and fill
   it in. The forms ask for exactly what's listed below, so you don't have to
   remember it. "Open a blank issue" is still there for anything that fits none
   of them.

A good issue report includes:

- **A descriptive title**: e.g. "Push fails when module folder contains spaces"
  rather than "push broken"
- **What you expected** vs **what actually happened**
- **Steps to reproduce** the problem: what commands did you run, in what order?
- **Error messages or screenshots**: copy the full error output from the
  terminal if possible
- **Your environment**: operating system and Node.js version (`node --version`)
  if relevant

> [!TIP]
>
> Even if you're not sure whether something is a bug, feel free to open an
> issue. It might reveal a documentation gap or an edge case worth handling.

> [!WARNING]
>
> One exception: if what you found is a security vulnerability, don't open a
> public issue. Report it privately as described in the
> [security policy](../SECURITY.md). The same page explains how to handle your
> Canvas API token: never paste it into an issue or a log excerpt.

## Suggesting Improvements

For a new feature or a better workflow, open an issue the same way, but
describe:

- **What you'd like**: the feature or change you have in mind
- **Why it would help**: the use case or problem it solves
- **How you use Coursewright today**: this helps prioritise what matters most

Check the [ideas list](roadmap.md) first: your idea may already be there.

## Contributing with a Pull Request

If you'd like to contribute a fix or improvement yourself, follow these steps:

1. **Fork** the original Coursewright project. On the project page, click the
   **Fork** button in the top-right corner to create a copy under your account.

2. **Create a branch** for your change:

   ```bash
   git checkout -b fix-push-spaces
   ```

   Use a short, descriptive branch name that reflects what the change does.

3. **Make your changes** and commit them:

   ```bash
   git add .
   git commit -m "Fix push failing when module folder contains spaces"
   ```

4. **Test your changes** before submitting (see [Tests](tests.md) for details on
   the test setup and how to write new tests):

   ```bash
   npm start        # check the Docusaurus preview
   npm run build    # verify the production build succeeds
   npm test         # run the automated tests
   npm run lint     # report code defects
   npm run format   # apply Prettier
   ```

5. **Push** your branch to your fork:

   ```bash
   git push -u origin fix-push-spaces
   ```

6. **Open a pull request**. Go to your fork on GitHub, and you'll see a banner
   offering to create a pull request. Click **Compare & pull request**. The
   description comes prefilled with a short template; write over the prompts and
   tick the checklist.

### What Makes a Good Pull Request

- **Keep it focused**: one fix or feature per pull request. Smaller changes are
  easier to review and merge.
- **Write a clear title and description**: explain what the change does and why.
  If there's a related issue, mention it (e.g. "Fixes #12").
- **Test your changes**: make sure `npm run build`, `npm test` and
  `npm run lint` pass before submitting, and that `npm run format` leaves
  nothing to change. CI checks the last two.

> [!TIP]
>
> If you are not sure your idea is worth a pull request, open an issue first to
> discuss it. That way you won't spend time on something that might not fit the
> project direction.

The tooling is [MIT licensed](../LICENSE); by opening a pull request you agree
your contribution is released under the same licence.

## Contributing a Skill

Skills follow a shared template, described in
[Writing your own skills](writing-skills.md). A skill that would help other
courses is welcome as a pull request; the template's course-agnostic and
language-agnostic rules apply doubly to one meant for courses other than your
own.

If your change renames or removes a skill folder or a docs file, add the old
path as it exists in downstream projects (e.g. `.agents/skills/<old-name>`) to
`STALE_PATHS` in [update-from-upstream.sh](../update-from-upstream.sh), so
downstream projects prune it on their next update.

## Code Style

Prettier owns formatting and ESLint reports defects, so neither needs to come up
in review. Run `npm run format` before you commit; `npm run lint` and
`npm run format:check` both run in CI.

The Prettier config is deliberately small. The defaults already matched the
codebase, so only three options are set:

- `proseWrap: always` wraps prose at 80 characters, the rule the next section
  describes.
- `embeddedLanguageFormatting: off` keeps Prettier out of fenced code blocks. In
  this repo those blocks are instructional content: a deliberately indented YAML
  example in [Frontmatter](frontmatter.md), or a course code sample showing a
  particular style, has to render exactly as written. It switches off YAML
  frontmatter formatting too, which is what lets the CLI splice a line into a
  file's frontmatter without reformatting it and still pass `prettier --check`.
  Under `auto`, Prettier normalises key spacing and the whitespace inside an
  inline list, and moves a value onto its own line when that line also carries a
  comment.
- YAML keeps double quotes; everything else uses single.

`.prettierrc.json` is read at runtime as well as by `npm run format`. The CLI
formats every markdown file it writes into `course/` against the same resolved
config, which is why `prettier` is a runtime dependency and not a development
one: sync fingerprints files by their contents, so it needs a single canonical
form of each. Changing an option above changes what a pull writes.

One write is carved out of that. `writeTitleIfAbsent` in `lib/sync/apply.js`
splices a `title:` line into a file that declares none, through
`insertFrontmatterKey`, and formats nothing: the rest of the file is the
author's and the run had otherwise only read it, so reformatting it would put
changes they never made into their working tree. It costs nothing against
`prettier --check`, because the option above leaves frontmatter alone.

`.editorconfig` covers the file types Prettier cannot parse:
`update-from-upstream.sh`, `export-styles/filter.lua`, the Typst templates.

One repo-wide reformat is recorded in `.git-blame-ignore-revs`. GitHub skips it
automatically; to skip it locally too:

```bash
git config blame.ignoreRevsFile .git-blame-ignore-revs
```

## Documentation Style

Everything in this project is written in English, and every heading takes its
case from [`context/writing-style.md`](../context/writing-style.md): Chicago
title case, with the carve-out that guide defines for the sentence-case labels
the tooling generates.

The project's own docs (`docs/`, the README, and `AGENTS.md`) add UK spelling
(customise, colour), lines wrapped at 80 characters, and the
**colleague-facing** register from the same guide: direct and dry, no
readability cap, front-load the point, no trailing summaries, and a list of AI
tells to avoid. Write for a colleague who teaches, not for a student and not for
a compiler.

`course/` and `evaluations/` follow the guide in full, in its **student-facing**
register: warm, direct, second person, CEFR B2, with the page-title emoji and
callouts it defines for course pages. The getting-started module ships as a
course, it is what a new user reads first, and it doubles as the end-to-end
acceptance test for Canvas sync, so it has to keep exercising every content type
a repository can create on its own: pages, assignments, external URLs and file
items. The other three are not in it. A quiz and an external tool are references
to Canvas objects a fresh course does not have, so neither can ship as a working
example. A discussion could, and does not yet.

The per-course guides in `context/` govern course content. A course author is
free to rewrite them; the project's own docs are not theirs to restyle, because
an upstream update overwrites them.

Two sets of files are deliberate exceptions. The style baselines in `templates/`
are each written in the language and variety they prescribe, so two of the four
are in Dutch and one is in US English. And the Dutch course scaffolds
(`course-context-nl.md`, `README-course-nl.md`, `course-index-nl.md`) keep
sentence-case headings, because that is Dutch convention. Leave both sets that
way. Prettier does reflow their prose and normalise their list markers, but it
changes neither language nor heading case, so what the exception protects is
untouched.
