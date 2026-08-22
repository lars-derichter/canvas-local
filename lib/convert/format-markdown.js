const fs = require('fs');

const log = require('../../cli/logger');

/**
 * Write markdown the way `npm run format` would leave it.
 *
 * Prettier owns the formatting of every file in this repo, the markdown under
 * `course/` included, and `.prettierrc.json` sets `proseWrap: "always"`.
 * Turndown wraps
 * nothing. So without this, every pull wrote markdown that the next
 * `npm run format` would immediately rewrap — and rewrapping it moves the
 * file's `local_hash` off the row the pull had just recorded. The next sync
 * then read the file as changed locally and pushed it straight back, producing
 * byte-identical HTML on Canvas and a phantom local change in every report
 * until someone pushed. "Format your code" and "sync your course" fought.
 *
 * The fix is not to teach the converter to wrap. It is to run the same
 * formatter the repo runs, over the bytes on their way to disk, so that there
 * is only ever one canonical form of a file and both tools already agree on it.
 *
 * Three properties make that true, and each one is load-bearing:
 *
 * 1. **The configuration is resolved, never hardcoded.** `resolveConfig` reads
 *    the config that governs *this path* — the repo's `.prettierrc.json` for
 *    anything under `course/`, `overrides` applied — so the output tracks
 *    `.prettierrc.json` instead of drifting from it the day someone edits it.
 *    A `{ proseWrap: 'always' }` written out here would be a second, silent
 *    copy of the settings, and the defect would be back the moment the two
 *    disagreed. Passing `filepath` is what picks the markdown parser and what
 *    lets `resolveConfig`'s per-extension overrides apply.
 *
 * 2. **The bytes written are returned.** Every caller that records a
 *    fingerprint has to hash what landed, not what it was about to write —
 *    that is the invariant `lib/sync/apply.js` opens with. Handing the
 *    formatted string back means a caller cannot hash the wrong one without
 *    going out of its way: format first, hash second, off one value.
 *
 * 3. **A formatting failure costs the formatting, never the write.** The
 *    content is the thing that matters; a page that could not be formatted is
 *    still a page the author asked for. Prettier's markdown parser is hard to
 *    provoke — malformed YAML frontmatter does *not* throw, it comes back
 *    untouched, and `embeddedLanguageFormatting: "off"` keeps a broken code
 *    fence from being parsed at all — but pathological input can still reach
 *    it (a Canvas page nesting lists thousands deep overflows the stack), and
 *    losing a pulled page to it would be far worse than leaving it unwrapped.
 *    So a throw falls back to the raw bytes and says so.
 *
 * **No ignore file is consulted, and that is a decision rather than an
 * oversight.** This formats what it is given, always. Which files get routed
 * here is the caller's choice, and the callers were chosen: everything that
 * writes into `course/` calls this, and the two writers that target the
 * Prettier-ignored `exports/` — `cli/export-toc.js` and the combined markdown
 * in `cli/export.js` — deliberately do not, because formatting those would be
 * the same divergence pointing the other way.
 *
 * The one case it leaves open is a course that has put `course/` into its own
 * `.prettierignore`, which `docs/user-guide.md` offers as a way to keep
 * Prettier out of your writing. For that course `npm run format` leaves the
 * tree alone while this still formats every file the tool writes, so the two
 * no longer agree. The trade is deliberate: sync needs one canonical form of a
 * file to fingerprint, and "sometimes formatted, depending on a file the
 * engine would have to go looking for" is not one.
 */

/**
 * Format `text` as the markdown file at `filePath`, or return it unchanged.
 *
 * `prettier` is required here rather than at the top of the file: loading it
 * costs about 40 ms, which is a sixth of this CLI's entire startup, and most
 * commands never write a markdown file at all. Node caches the module, so
 * every call after the first is a lookup.
 *
 * @param {string} filePath - Absolute path the text is destined for. Only its
 *   name and location are read; the file need not exist yet.
 * @param {string} text - The markdown to format.
 * @param {(message: string) => void} [warn] - Where a formatting failure is
 *   reported. Defaults to the shared CLI logger.
 * @returns {Promise<string>} The formatted markdown, or `text` if Prettier
 *   could not format it.
 */
async function formatMarkdown(filePath, text, warn = log.warn) {
  const prettier = require('prettier');
  try {
    const config = await prettier.resolveConfig(filePath);
    return await prettier.format(text, { ...config, filepath: filePath });
  } catch (err) {
    warn(
      `  [format] Could not format ${filePath}, wrote it unformatted: ` +
        `${err.message}`,
    );
    return text;
  }
}

/**
 * Format `text` and write it to `filePath`.
 *
 * The write itself stays synchronous, so it is still one call that either
 * leaves the whole file or leaves none of it.
 *
 * @returns {Promise<string>} The bytes that landed on disk — hash these, not
 *   the string that was passed in.
 */
async function writeMarkdown(filePath, text, warn = log.warn) {
  const formatted = await formatMarkdown(filePath, text, warn);
  fs.writeFileSync(filePath, formatted, 'utf8');
  return formatted;
}

module.exports = { formatMarkdown, writeMarkdown };
