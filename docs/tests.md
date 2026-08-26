# Tests

The project uses the built-in
[Node.js test runner](https://nodejs.org/api/test.html) (`node:test` +
`node:assert`): no extra dependencies required.

## Running Tests

```bash
npm test
```

The glob in that script is double-quoted (`"test/**/*.test.js"`), and it has to
stay that way. npm runs scripts through `cmd.exe` on Windows, and cmd does not
strip single quotes the way `sh` does, so the single-quoted form arrives at
`node --test` with its quote characters still attached and matches nothing. Node
does not call that an error: its guard for a run that matched no files is
skipped whenever the pattern contains glob magic, and the `*` still counts as
magic inside quotes that have made the whole string literal. So the suite
reports `tests 0`, exits 0, and passes on Windows without running a single test.
Both shells strip double quotes, which is what makes that form the portable one.

`scripts/check-test-glob.js` runs as `pretest` and holds the line: it globs the
same pattern, checks that the `test` and `pretest` scripts still spell it
identically, and fails the run when the pattern matches implausibly few files.
The mistake is loud instead of silent, on a developer's machine as well as in
CI.

## Test Structure

Tests live in `test/` and mirror the layout of the source directories they
cover: `test/canvas/` for `lib/canvas/`, `test/cli/` for `cli/`, `test/config/`
for `lib/config/`, `test/convert/` for `lib/convert/`, `test/export/` for
`lib/export/`, `test/sync/` for `lib/sync/`, `test/plugins/` for `src/plugins/`,
and `test/vscode/` for the bundled VS Code extension. Each file is named after
what it covers, e.g. `test/convert/course-scanner.test.js` or
`test/cli/push-helpers.test.js`.

Two directories break that pattern. `test/helpers/` holds no tests: it is the
shared `canvas-mock.js`, which stands in for the Canvas API over `fetch`, and
`prettier-config.js`, which gives a temporary course tree the same Prettier
settings the repo has, so a write in a test formats the way it does in
production. And `test/source-hygiene.test.js` sits at the root because it covers
the whole source tree rather than one directory.

Coverage spans the config layer (`lib/config/`), the conversion layer
(`lib/convert/`), the export layer (`lib/export/`), the reconcile engine
(`lib/sync/`), the Canvas HTTP client and helpers (`lib/canvas/`), CLI command
helpers (`cli/`), the Docusaurus remark plugins (`src/plugins/`), and the local
VS Code extension (`.vscode/extensions/course-manager/`). `test/sync/` is the
largest of these, with one file per stage of the engine: `gather`,
`fingerprint`, `plan`, `apply-plan`, `canvas-write`, `local-write`,
`rename-detect` and `state`, plus `apply-embedded-files` and `apply-file-items`
for the two write paths that need a filesystem. Tests that exercise filesystem
behaviour (`course-scanner`, `merge-items`, `split-item`, `renumber`,
`pull-command`) create a temporary directory with fixture files and clean it up
afterwards. The export tests stay CI-safe by never spawning pandoc or Typst:
`preflight` takes an injectable exec, and the rest operate on strings.

## Manual End-to-End Checks

Some paths need the real pandoc/Typst toolchain (and, for the sidebar, VS Code),
so they are verified by hand rather than in the automated suite:

- `npx course export --sample -f pdf` and `-f docx`: the style sample renders.
- `npx course export --sample -f pdf --style thomas-more`, then the same with
  `theme: thomas-more` in `course.config.yml`: style and theme change the output
  independently.
- `npx course export -m 01-getting-started`: a module with alerts, an SVG file
  item, an external URL, and a subfolder renders as one document.
- The two-step TOC flow: `npx course export-toc`, delete some lines, then
  `npx course export --toc exports/toc.md`.
- `npx course export --flagged` after setting `export: true` on a few items.
- VS Code: multi-select several items in the sidebar and export them together.
- The `/export-style-init` and `/export-style-update` skills: derive or tweak a
  style and confirm the regenerated sample reflects it.

## Manual Sync End-to-End Checklist

> [!WARNING]
>
> Every step here writes to a real Canvas course, and several of them delete
> content Canvas cannot bring back. Use a disposable course with no students in
> it, and read [Backing up a Canvas course](backups.md) before you start.

The checks above are one command each. This one is a sequence: it walks the
reconcile engine end to end against a live Canvas instance, and each step leaves
the course in the state the next one assumes. Point `.env` at the disposable
course, and run it from a scratch clone so its `.canvas-sync.json` never lands
in the real tree.

"Clean" below means the run planned no actions and exited 0. It does not mean
`.canvas-sync.json` came out byte-identical: `sync`, `push` and `pull` stamp
`last_sync` even on a run with nothing to do, and only `status` writes nothing
at all.

1. **Empty both sides.** `npx course reset-canvas --dry-run`, then
   `npx course reset-canvas`, then `npx course reset-sync-state`. The dry run
   counts what it would delete (so many modules, pages, assignments and files)
   and deletes nothing; the only content it names one by one is the quiz-backed
   assignments it is skipping, the New Quizzes it is not, and any assignment
   carrying submissions or whose submission state Canvas would not say. The real
   run empties the course and exits 0; a declined confirmation, or an input
   stream that ends without answering, deletes nothing and exits 1, while a
   piped `y` confirms like a typed one. `reset-canvas` leaves
   `.canvas-sync.json` alone, which is why the third command is not optional.
2. **First push.** `npx course push`. Every module and item is created, and
   `.canvas-sync.json` comes back with a row per item. No first-push
   confirmation appears: that question only fires on a course that already holds
   content.
3. **The no-op quartet.** `npx course push`, then `status`, `sync` and `pull`.
   All four clean, nothing written on either side, `git status` quiet under
   `course/`. This is the round-trip drift check: what Canvas's own editor
   rewrites on the way in has to be absorbed by the fingerprint rather than
   reported as a change.
4. **Exact rename.** Rename one item's file by hand, leaving its bytes
   untouched, then `npx course sync`. One `rekey-base`, no Canvas write, the
   module item id unchanged.
5. **Probable rename.** Rename a second item's file _and_ edit its body, keeping
   its `title:`, then `npx course sync`. Non-interactively the pair is reported
   and parked: nothing deleted, nothing created, exit 0. Answering `y` in a
   terminal re-keys the row and pushes the edit in the same run.
6. **Conflict, once per policy.** Edit one page here and the same page in
   Canvas, sync, then make the pair of edits again before each following run.
   - `--conflict newest`: both timestamps are printed and the newer side wins.
   - `--conflict local` and `--conflict canvas`: the named side wins, unasked.
   - `--conflict ask -y`: the item is skipped, the report names the remedy, and
     the run exits 1.
7. **Embedded files.** Starting from a page that embeds `_files/x.png`:
   - **Add**: `npx course push` uploads the binary and repoints the reference at
     the Canvas file.
   - **Edit**: change the binary's bytes in place. The push runs off the binary
     alone, with no edit to the page, and the run after it is clean. Whether
     Canvas keeps the file id or hands back a new one is Canvas's business:
     nothing here bets on either, so do not fail the step on the id.
   - **Share**: add a file item whose binary is byte-identical to the embedded
     one and goes up under the same name, which is what Canvas deduplicates on,
     so both state rows end up carrying one file id. Delete the file item and
     run `npx course --verbose push --prune-canvas`: the module item goes, the
     Canvas file stays, and the verbose log names the row still holding it (the
     ordinary report does not). Drop the page's reference too, and the next
     whole-course prune sweeps the file and removes its row.
8. **Kill recovery.** Add six new pages, then
   `node cli/index.js sync & sleep 8; kill -9 $!` (kill node itself, not an
   `npx` wrapper). Rerun `npx course sync`: it duplicates at most the one action
   that was in flight when the kill landed. Every action that completed was
   saved as it landed, so its Canvas object is recognised instead of created a
   second time, while `last_sync` still reads as the previous completed run left
   it, because no run since has finished.
9. **Reset the state, then adopt.** `npx course reset-sync-state`, then
   `npx course status`, then `npx course push`. `status` (like `sync`) refuses
   each module holding items on both sides and exits 1. `push` pins a direction
   instead: it adopts every item by type and title, compared trimmed and
   case-folded rather than byte for byte, and the Canvas page and assignment
   counts come out unchanged. A duplicate here is an adoption bug.
10. **Restore.** Put the disposable course back to whatever it is meant to hold,
    and confirm the real repository is untouched.

## Writing New Tests

- Create a `*.test.js` file in the matching `test/` subdirectory.
- Use `describe`/`it` from `node:test` and assertions from `node:assert/strict`.
- The test runner discovers all `test/**/*.test.js` files automatically.

`test/vscode/extension.test.js` is the odd one out: the extension cannot be
loaded outside VS Code, so it reads its source as text and matches patterns
against it. It walks the extension directory rather than naming files, so a new
one is covered the day it is added, and most assertions run over every source
joined together — which of the extension's files a line lives in is not what
they are about. Prettier decides where those lines wrap, so any pattern there
has to span newlines: use `[\s\S]*?` rather than `.*` or `[^\n]*`, and allow for
a trailing comma inside a wrapped call. Assert on what the extension does, never
on how it is laid out.

## The Extension and CLI Contract Test

`test/vscode/cli-contract.test.js` is the guard between the two halves of this
project. It reads every `npx course` command line and every `runCli` argv the
extension builds, reads the commands commander actually registers in
`cli/index.js`, and fails when the two disagree. A flag renamed on one side used
to be found by whoever clicked the button in VS Code; this finds it on the next
`npm test`.

It checks two things and nothing more: the subcommand exists, and every flag
exists on that subcommand (or on the program, since commander accepts
`--verbose` and its three siblings anywhere). It deliberately does not check the
values flags are given, how many positional arguments a command line carries, or
a flag hidden inside a runtime value. The reverse direction is not asserted
either: a CLI flag the extension never uses is ordinary, and the test only
reports it.

Two things about it surprise people the first time.

**It fails on a shape it cannot read, rather than skipping it.** A scan that
quietly ignored what it did not understand would report a green contract over an
unchecked command line, so an argv that is reassigned, spliced, written by
index, spread, or handed to another function is refused by name and line.
Reading the array is fine and needs no ceremony: `args.length`,
`args.join(' ')`, `args.includes(...)`, `args.slice(...)` and `args[0]` are all
accepted, as is a `push` whose first value is a literal flag. If you are
refused, the message names the shape and, where one exists, the list to add to.
The three lists live at the top of the file: `RUNNERS` (functions that hand a
command to the CLI), `NOT_RUNNERS` (helpers that take a list of strings and are
not runners), and `READ_ONLY_CALLEES` (functions that receive an argv array and
only read it).

**It has floors, and they are the point.** A static scan whose pattern stops
matching finds nothing and passes forever, which is the failure
`scripts/check-test-glob.js` exists to prevent elsewhere in this repo. So the
test asserts a minimum number of invocations, per construction shape, and a
minimum number of subcommand+flag pairs. If you genuinely remove commands from
the extension, lower the floor in the same commit, and only then.

Adding a runner is the one change that needs the test edited: put its name in
`RUNNERS`, or everything it runs goes unchecked. The test says so itself when it
sees an argv-shaped array going somewhere it does not recognise.
