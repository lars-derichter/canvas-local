#!/usr/bin/env bash
set -euo pipefail

# Update project from the upstream Coursewright template repository.
# Uses a squash merge so only one commit is added to your history.
# Content directories (course/, evaluations/, sources/) and the protected files
# (README.md, AGENTS.md, CLAUDE.md, context/writing-style.md,
# context/course-context.md) are always preserved. Conflicts in other files are
# resolved interactively (keep local / upstream / merge in the editor).

# --- Load configuration ---
#
# Settings live in an external file so per-repo customizations survive upstream
# updates (the file lists itself under protected_files). Format is `key = value`
# with space-separated lists; '#' begins a comment.

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/update-from-upstream.conf"

if [ ! -f "$CONFIG_FILE" ]; then
  cat > "$CONFIG_FILE" <<'EOF'
# Configuration for update-from-upstream.sh
# Lists are space-separated. Lines starting with # are comments.

# Directories whose local content is always kept (never overwritten by upstream).
protected_dirs = course evaluations sources

# Individual files always kept. Includes this config file itself so your
# customizations here survive future upstream updates.
protected_files = README.md AGENTS.md CLAUDE.md context/writing-style.md context/course-context.md update-from-upstream.conf course.config.yml

# Upstream git remote and branch to merge from.
upstream_remote = upstream
upstream_branch = main
EOF
  echo "Created default config at $CONFIG_FILE."
  echo "Review it, commit it, then run this script again."
  exit 0
fi

PROTECTED_DIRS=()
PROTECTED_FILES=()
UPSTREAM_REMOTE=""
UPSTREAM_BRANCH=""

while IFS= read -r line || [ -n "$line" ]; do
  line="${line%%#*}"                                   # strip comments
  [[ "$line" =~ ^[[:space:]]*$ ]] && continue          # skip blanks
  if [[ ! "$line" =~ ^[[:space:]]*([a-z_]+)[[:space:]]*=[[:space:]]*(.*)$ ]]; then
    echo "Warning: ignoring malformed config line: $line" >&2
    continue
  fi
  key="${BASH_REMATCH[1]}"
  value="${BASH_REMATCH[2]}"
  value="${value%"${value##*[![:space:]]}"}"           # trim trailing whitespace
  case "$key" in
    protected_dirs)  read -r -a PROTECTED_DIRS  <<< "$value" ;;
    protected_files) read -r -a PROTECTED_FILES <<< "$value" ;;
    upstream_remote) UPSTREAM_REMOTE="$value" ;;
    upstream_branch) UPSTREAM_BRANCH="$value" ;;
    *) echo "Warning: unknown config key '$key' in $CONFIG_FILE" >&2 ;;
  esac
done < "$CONFIG_FILE"

if [ -z "$UPSTREAM_REMOTE" ] || [ -z "$UPSTREAM_BRANCH" ]; then
  echo "Error: $CONFIG_FILE must set upstream_remote and upstream_branch."
  exit 1
fi

# Soft safeguard: warn if the config file isn't protecting itself.
case " ${PROTECTED_FILES[*]} " in
  *" $(basename "$CONFIG_FILE") "*) : ;;
  *) echo "Warning: $(basename "$CONFIG_FILE") is not in protected_files; upstream could overwrite it." >&2 ;;
esac

# --- Preflight checks ---

if [ -n "$(git status --porcelain)" ]; then
  echo "Error: working tree is not clean. Commit or stash your changes first."
  exit 1
fi

if ! git remote get-url "$UPSTREAM_REMOTE" &>/dev/null; then
  echo "Error: remote '$UPSTREAM_REMOTE' not found."
  echo "Run: git remote add $UPSTREAM_REMOTE https://github.com/lars-derichter/coursewright.git"
  exit 1
fi

# --- Fetch upstream ---

echo "Fetching $UPSTREAM_REMOTE..."
git fetch "$UPSTREAM_REMOTE"

UPSTREAM_REF="$UPSTREAM_REMOTE/$UPSTREAM_BRANCH"
UPSTREAM_HASH=$(git rev-parse --short "$UPSTREAM_REF")

# --- Squash merge ---

echo "Merging $UPSTREAM_REF ($UPSTREAM_HASH) with --squash..."
# Conflicts are expected and handled below; don't let `set -e` abort the script.
git merge "$UPSTREAM_REF" --allow-unrelated-histories --squash || true

# --- Protect local content unconditionally ---
#
# `git merge --squash` only flags conflicts when both sides modify the same
# tracked file. Files that exist upstream but not locally (or vice versa) are
# staged silently with no conflict. So restoring protected paths only inside a
# conflict branch is not enough — we always restore them from HEAD.

echo "Protecting local content: ${PROTECTED_DIRS[*]} ${PROTECTED_FILES[*]}"

for dir in "${PROTECTED_DIRS[@]}"; do
  # Reset index entries under this path back to HEAD. `git checkout HEAD --`
  # alone would leave upstream-only files staged because the squash merge
  # silently added them and they are absent from HEAD's tree.
  git reset HEAD -- "$dir" >/dev/null 2>&1 || true
  if git cat-file -e "HEAD:$dir" 2>/dev/null; then
    git checkout HEAD -- "$dir"
  fi
  # Drop the upstream-only files that are now untracked in the working tree.
  if [ -d "$dir" ]; then
    git clean -fd -- "$dir" >/dev/null
  fi
done

for file in "${PROTECTED_FILES[@]}"; do
  if git cat-file -e "HEAD:$file" 2>/dev/null; then
    git checkout HEAD -- "$file"
  elif [ -f "$file" ]; then
    git rm -f --cached --ignore-unmatch -- "$file" >/dev/null
    rm -f -- "$file"
  fi
done

# --- Prune paths renamed or removed upstream ---
#
# A squash merge never deletes files that exist only locally, so a folder
# that upstream renamed would linger here under its old name next to the new
# one. Upstream lists old paths here when a rename happens. Removal is safe:
# git history keeps the old content, and the renamed successor arrives in
# the same update.
#
# The list is empty as of 1.0.0: every path it used to hold was renamed before
# the first release, so nothing that could still be carrying one exists. Add a
# path here on the update that renames it.

STALE_PATHS=()

# `[@]+"[@]"` is the set -u-safe way to iterate a possibly-empty array on bash
# 3.2, which is what macOS ships and what an empty STALE_PATHS would otherwise
# stop dead.
for path in ${STALE_PATHS[@]+"${STALE_PATHS[@]}"}; do
  if [ -e "$path" ]; then
    echo "Removing stale path (renamed upstream): $path"
    git rm -r -q --cached --ignore-unmatch -- "$path" >/dev/null 2>&1 || true
    rm -rf -- "$path"
  fi
done

# --- Resolve any remaining (non-protected) conflicts interactively ---
#
# Each conflicted file exists on both sides with differing content. For each one,
# prompt: keep local, keep upstream, open the conflict-marked file in the editor
# to merge by hand, or always keep local (which also adds the file to
# protected_files so it stops conflicting on future updates). The default is
# whichever side was committed most recently. With no terminal available, the
# default is applied automatically.

apply_choice() {
  local file="$1" side="$2"
  case "$side" in
    local)    git checkout HEAD -- "$file";      echo "  kept local:   $file" ;;
    upstream) git checkout --theirs -- "$file";  echo "  used upstream: $file" ;;
  esac
  git add -- "$file"
}

add_to_protected_files() {
  local file="$1" line tmp added=0 p
  # Defensive: protected files don't reach the resolver, so this should be a
  # no-op, but guard against double-adding anyway. The `[@]+"[@]"` form is the
  # set -u-safe way to iterate a possibly-empty array on bash 3.2 (macOS).
  for p in ${PROTECTED_FILES[@]+"${PROTECTED_FILES[@]}"}; do
    [ "$p" = "$file" ] && return
  done
  PROTECTED_FILES+=("$file")

  tmp=$(mktemp)
  while IFS= read -r line || [ -n "$line" ]; do
    if [ "$added" -eq 0 ] && [[ "$line" =~ ^[[:space:]]*protected_files[[:space:]]*= ]]; then
      printf '%s %s\n' "${line%"${line##*[![:space:]]}"}" "$file"   # trim trailing ws, append
      added=1
    else
      printf '%s\n' "$line"
    fi
  done < "$CONFIG_FILE" > "$tmp"
  [ "$added" -eq 0 ] && printf 'protected_files = %s\n' "$file" >> "$tmp"
  mv "$tmp" "$CONFIG_FILE"
}

resolve_conflict() {
  local file="$1" local_ts upstream_ts local_date upstream_date default answer
  local_ts=$(git log -1 --format=%ct HEAD -- "$file" 2>/dev/null || echo 0)
  upstream_ts=$(git log -1 --format=%ct "$UPSTREAM_REF" -- "$file" 2>/dev/null || echo 0)
  local_date=$(git log -1 --format=%cs HEAD -- "$file" 2>/dev/null || echo "unknown")
  upstream_date=$(git log -1 --format=%cs "$UPSTREAM_REF" -- "$file" 2>/dev/null || echo "unknown")
  if [ "${local_ts:-0}" -gt "${upstream_ts:-0}" ]; then
    default="local"
  else
    default="upstream"   # ties go to upstream: pulling upstream is the point
  fi

  if [ ! -r /dev/tty ]; then
    echo "  $file -> $default (no terminal; using default)"
    apply_choice "$file" "$default"
    return
  fi

  while true; do
    printf '\nConflict: %s\n' "$file"
    printf '  local last commit:    %s\n' "$local_date"
    printf '  upstream last commit: %s\n' "$upstream_date"
    printf '  [l]ocal  [u]pstream  [m]erge in editor  [a]lways keep local   (default: %s = most recent)\n> ' "$default"
    read -r answer < /dev/tty || answer=""
    case "${answer:-}" in
      l|L) apply_choice "$file" local;    return ;;
      u|U) apply_choice "$file" upstream; return ;;
      a|A)
        apply_choice "$file" local
        add_to_protected_files "$file"
        echo "  added to protected_files in config: $file"
        return ;;
      "")  apply_choice "$file" "$default"; return ;;
      m|M)
        # The working-tree file still has conflict markers from the squash merge.
        # Hand it to the editor git would use (code --wait here) and wait.
        eval "$editor_cmd \"\$file\"" < /dev/tty || true
        if grep -qE '^(<{7}|={7}|>{7})' "$file"; then
          echo "  Conflict markers remain in $file — choose again."
          continue
        fi
        git add -- "$file"
        echo "  merged:       $file"
        return ;;
      *) echo "  Please answer l, u, m, a, or press Enter for the default." ;;
    esac
  done
}

CONFLICTED=$(git diff --name-only --diff-filter=U)
if [ -n "$CONFLICTED" ]; then
  echo "Resolving conflicts in non-protected files present on both sides..."
  editor_cmd=$(git var GIT_EDITOR)   # resolves to 'code --wait' here
  while read -r file; do
    [ -n "$file" ] && resolve_conflict "$file"
  done <<< "$CONFLICTED"
fi

git add -A

# --- Commit (skip if nothing changed) ---

if git diff --cached --quiet; then
  echo "Nothing to update — already at upstream $UPSTREAM_HASH."
  git tag -f last-upstream-merge "$UPSTREAM_REF" >/dev/null
  exit 0
fi

git commit -m "Import upstream updates from coursewright ($UPSTREAM_HASH)"

# --- Tag for future reference ---

git tag -f last-upstream-merge "$UPSTREAM_REF"
echo "Tagged last-upstream-merge at $UPSTREAM_HASH."

# --- Done ---

echo ""
echo "Done! Review the changes with: git diff HEAD~1 HEAD --stat"
echo "Then run: npm install"
