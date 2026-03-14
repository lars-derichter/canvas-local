---
name: commit
description: Stage changes and create a git commit with a clear, consistent message.
---

# Commit

Create a git commit following the project's commit message conventions.

## Steps

1. Run `git status` (never use `-uall`) and `git diff` to review all changes.
2. **Before staging**, check for course files where `canvas_id` is the only
   change. These are instance-specific sync artifacts and must NOT be staged or
   committed. Run `git diff course/` and inspect each modified file — if the
   diff only adds or changes a `canvas_id` frontmatter field, skip that file.
3. Stage the appropriate files by name. Prefer `git add <file>...` over
   `git add -A` or `git add .`.
4. Write a commit message and commit. Pass the message via a HEREDOC:
   ```bash
   git commit -m "$(cat <<'EOF'
   Message here

   Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
   EOF
   )"
   ```
5. Run `git status` to verify the commit succeeded.

## Commit message style

- **Imperative, present tense, verb-first.** Start with a verb like Add, Fix,
  Update, Replace, Remove, Rename, Move, Rewrite, Extract, Correct, Upload.
- **Single line summary** — no conventional-commit prefixes (no `feat:`,
  `fix:`, etc.).
- **Focus on what and why**, not implementation details.
- Keep it concise but descriptive enough to understand the change without
  reading the diff.
- Add a blank line and a short body only when the summary alone is not enough
  to explain the motivation.

### Examples from this project

```
Add reset-canvas command to wipe all content from a Canvas course
Fix push failing to add pages/assignments to Canvas modules
Upload files to module-named Canvas folder instead of unfiled
Add instruction to exclude instance-specific canvas_id from commits
Replace example module with comprehensive Getting Started guide
```

## Rules

- Never push to the remote unless explicitly asked.
- Never amend an existing commit unless explicitly asked.
- Never skip hooks (`--no-verify`).
- If a pre-commit hook fails, fix the issue, re-stage, and create a **new**
  commit (do not amend).

$ARGUMENTS
