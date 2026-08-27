---
name: commit
description: Stage changes and create a git commit with a clear, consistent message. Use for "commit", "commit the changes", "commit this", "commit dit", "maak een commit".
---

# Commit

Create a git commit following the project's commit message conventions.

## Steps

1. Review all changes with `git status` (never `-uall`) and `git diff`.
2. **Before staging**, run `git remote get-url origin` to determine the mode:
   - Origin URL contains the upstream path `lars-derichter/coursewright` →
     **development mode**: this is the tool's own repository, so skip all
     changes inside `course/`, and `.canvas-sync.json` at the root along with
     them, unless the author explicitly asks to include them. They are typically
     temporary sync-test artifacts that should not reach git history or the
     remote. The sync state is committed rather than gitignored, so a sync test
     leaves it in `git status` carrying a test Canvas course's module and item
     ids. (Matching on the repository name alone is not enough: forks and
     template copies may keep the name, and their `course/` content is real
     course material.)
   - Otherwise → **production mode**: stage everything, `course/` changes
     included, normally.
3. Stage by name (`git add <file>...`), never `git add -A` or `git add .`.
4. Commit with the message in a HEREDOC, ending in the co-author trailer your
   harness specifies for the current assistant, if it defines one, never a
   hardcoded model or tool name; omit the trailer when your harness does not
   define one:
   ```bash
   git commit -m "$(cat <<'EOF'
   Message here

   <co-author trailer specified by your harness, if any>
   EOF
   )"
   ```

## Message Style

- Imperative, present tense, verb-first (Add, Fix, Update, Replace, Remove,
  Rewrite, …); no conventional-commit prefixes (`feat:`, `fix:`).
- A single-line summary focused on what and why, concise but clear without
  reading the diff. A blank line plus a short body only when the summary alone
  cannot carry the motivation.
- Examples from this project:
  ```
  Add reset-canvas command to wipe all content from a Canvas course
  Fix push failing to add pages/assignments to Canvas modules
  Replace example module with comprehensive Getting Started guide
  ```

## Rules

- **Language.** Commit messages are English, whatever language the course is
  written in. Reply in chat in the language the author writes in.
- Never push or amend unless explicitly asked.
- Never skip hooks (`--no-verify`). If a pre-commit hook fails, fix the issue,
  re-stage, and create a new commit. Do not amend.

$ARGUMENTS
