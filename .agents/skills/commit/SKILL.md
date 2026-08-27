---
name: commit
description: Stage changes and create a git commit with a clear, consistent message. Use for "commit", "commit the changes", "commit this", "commit dit", "maak een commit".
---

# Commit

Create a git commit following the project's commit message conventions.

## Input

`$ARGUMENTS` may hold a hint: which changes to include, or the gist of the
message. Empty means commit the reviewed changes with a message you write.

## Steps

1. Review all changes with `git status` (never `-uall`) and `git diff`.
2. **Before staging**, run `git remote get-url origin` to determine the mode:
   - Origin URL contains the upstream path `lars-derichter/coursewright` →
     **development mode**: skip all changes inside `course/` and the root
     `.canvas-sync.json`, unless the author explicitly asks to include them.
     This is the tool's own repository, so those are typically sync-test
     artifacts: the sync state is committed rather than gitignored, and a test
     run leaves it carrying a test Canvas course's module and item ids.
     (Matching on the repository name alone is not enough: forks and template
     copies may keep the name, and their `course/` content is real course
     material.)
   - Otherwise → **production mode**: `course/` changes and the sync state are
     real course material; include them like anything else.
3. Stage the intended files by name (`git add <file>...`), never `git add -A` or
   `git add .`.
4. Commit with the message in a HEREDOC, ending in the co-author trailer your
   harness specifies, if it defines one; never hardcode a model or tool name:
   ```bash
   git commit -m "$(cat <<'EOF'
   Message here

   <co-author trailer specified by your harness, if any>
   EOF
   )"
   ```

## Rules

- **Language.** Commit messages are English, whatever language the course is
  written in. Reply in chat in the language the author writes in.
- Imperative, present tense, verb-first (Add, Fix, Update, Replace, Remove,
  Rewrite, …); no conventional-commit prefixes (`feat:`, `fix:`).
- A single-line summary focused on what and why, concise but clear without
  reading the diff. A blank line plus a short body only when the summary alone
  cannot carry the motivation. Examples from this project:
  ```
  Add reset-canvas command to wipe all content from a Canvas course
  Fix push failing to add pages/assignments to Canvas modules
  Replace example module with comprehensive Getting Started guide
  ```
- Never push or amend unless explicitly asked.
- Never skip hooks (`--no-verify`). If a pre-commit hook fails, fix the issue,
  re-stage, and commit again.

$ARGUMENTS
