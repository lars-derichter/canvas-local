const matter = require('gray-matter');
const fs = require('fs');
const path = require('path');

/**
 * Parse YAML frontmatter from a file content string.
 * @param {string} fileContent - Raw file content with optional YAML frontmatter.
 * @returns {{ data: object, content: string }} Parsed frontmatter data and body content.
 */
function parseFrontmatter(fileContent) {
  const result = matter(fileContent);
  return { data: result.data, content: result.content };
}

/**
 * Serialize frontmatter data and body content back into a full file string.
 * @param {object} data - Frontmatter key-value pairs.
 * @param {string} content - Markdown body content.
 * @returns {string} Full file string with YAML frontmatter block.
 */
function serializeFrontmatter(data, content) {
  // gray-matter.stringify adds frontmatter fences and joins with content
  return matter.stringify(content, data);
}

/**
 * Serialise one key the way `serializeFrontmatter` would, without its fences.
 *
 * The point is the escaping. A value holding a colon, a `#`, a quote, padding,
 * or one of YAML 1.1's spellings of true (`Yes`, `On`) has to come back out of
 * `parseFrontmatter` as the string that went in, and the writer that already
 * gets that right is the one this file uses everywhere else. So the key is
 * rendered as a whole one-key document and the two `---` lines are dropped
 * again. A value with a newline in it renders as a block scalar, which is
 * several lines rather than one — hence a string of lines rather than a line.
 *
 * @returns {string} The key's YAML lines, with no trailing newline.
 */
function renderFrontmatterKey(key, value) {
  const lines = serializeFrontmatter({ [key]: value }, '').split('\n');
  // Everything between the two fences. Found by searching rather than counted
  // from the end, because `matter.stringify` pads a document with no body: the
  // last line is not reliably the closing fence. A rendered value never *is* a
  // fence — a block scalar's continuation lines are indented — so the first
  // `---` after the opening one is the closing one.
  return lines.slice(1, lines.indexOf('---', 1)).join('\n');
}

/**
 * The offset a key can be spliced in at, and the newline the file is written
 * with — or null when there is no frontmatter block to splice into.
 *
 * An opening `---` with no closing one is deliberately not a block. gray-matter
 * reads such a file as YAML all the way to the end, so a key put in "after the
 * opening fence" would land in the middle of the author's prose.
 */
function locateFrontmatterBlock(text) {
  const bom = text.startsWith('\uFEFF') ? 1 : 0;
  const open = /^---[^\S\r\n]*(\r?\n)/.exec(text.slice(bom));
  if (!open) return null;
  const offset = bom + open[0].length;
  if (!/^---[^\S\r\n]*(\r?\n|$)/m.test(text.slice(offset))) return null;
  return { offset, newline: open[1] };
}

/**
 * Whether gray-matter will read the top of this file as frontmatter.
 *
 * The question only matters once `locateFrontmatterBlock` has said no: a file
 * gray-matter reads frontmatter out of, but whose fences cannot be found, has
 * to be left alone. Adding a block above one would demote the author's keys
 * into the body, which is the corruption the refusal exists to prevent.
 *
 * **Asked of the text rather than of gray-matter, and that is the point.** The
 * obvious version — call `matter(text)` and look at `.matter` — is wrong in
 * production and right in a unit test, which is the worst way to be wrong.
 * `matter()` caches by input string and returns `Object.assign({}, cached)` on
 * a hit, and `.matter` is a *non-enumerable* own property, so the copy does not
 * carry it (`orig` is non-enumerable too and is restored by hand on the next
 * line; `matter` is not). Every caller here arrives on a second call for the
 * same string, because `writeTitleIfAbsent` parses the file before it inserts
 * into it — so `.matter` was always `undefined`, the refusal never fired, and a
 * unit test calling this on a fresh string watched it fire every time.
 *
 * The rule is mirrored from `parseMatter` in `gray-matter/index.js` instead,
 * where it is two lines and has not moved: the delimiter is `---` at the start
 * of the BOM-stripped text, and a fourth `-` after it makes the line a
 * thematic break rather than a delimiter. gray-matter's third condition \u2014 the
 * empty string is never frontmatter \u2014 needs no line of its own here, because
 * the empty string does not start with `---` either.
 */
function opensFrontmatterBlock(text) {
  const body = text.startsWith('\uFEFF') ? text.slice(1) : text;
  return body.startsWith('---') && body.charAt(3) !== '-';
}

/**
 * Add one key to a file's frontmatter, leaving every other byte where it was.
 *
 * `serializeFrontmatter` cannot do this, and the difference is not cosmetic. It
 * hands the *parsed* object to `matter.stringify`, so what comes back is YAML's
 * rendering of that object rather than the author's block: a `# comment` is
 * gone, `canvas_type:   assignment` loses its spacing, and
 * `tags: [ intro , welcome ]` becomes a two-line list. Those are the author's
 * bytes, and a write whose whole job is to add a line has no business touching
 * them.
 *
 * So the key is spliced in as text, immediately after the opening `---` — the
 * front of the block, because the key this exists to add is the one an author
 * reads first — and everything else in the file is treated as an opaque string.
 * Nothing is reformatted, which is also what keeps the result honest against
 * `prettier --check`: `.prettierrc.json` sets `embeddedLanguageFormatting:
 * "off"`, so Prettier does not touch frontmatter at all, and a file that was
 * clean before this stays clean while a file that was not stays exactly as
 * unclean as its author left it.
 *
 * A file with no frontmatter gets a block, followed by the blank line
 * Prettier's markdown printer puts there. An empty file gets the block alone,
 * because there a trailing blank line is the one thing Prettier would strip.
 *
 * @param {string} text - The whole file.
 * @param {string} key - The key to add. The caller has already established that
 *   the file does not declare it.
 * @param {*} value - Its value, escaped by `renderFrontmatterKey`.
 * @returns {string|null} The new file text, or null when the frontmatter is
 *   shaped in a way no key can be placed in safely — an unterminated block, or
 *   one of gray-matter's non-YAML languages (`---js`). Guessing at either would
 *   rewrite the file into something its author did not write.
 */
function insertFrontmatterKey(text, key, value) {
  const rendered = renderFrontmatterKey(key, value);
  const block = locateFrontmatterBlock(text);

  if (block) {
    // Rendered with `\n`, written with whatever the file already uses: one
    // added line is no reason to give a file two kinds of line ending.
    const lines = rendered.split('\n').join(block.newline);
    return (
      text.slice(0, block.offset) +
      lines +
      block.newline +
      text.slice(block.offset)
    );
  }

  // No fences this can find. Either there is no frontmatter, in which case a
  // block is the right thing to add, or gray-matter can see one that this
  // cannot — and then the honest answer is to add nothing.
  if (opensFrontmatterBlock(text)) return null;

  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = rendered.split('\n').join(newline);
  const fenced = `---${newline}${lines}${newline}---${newline}`;
  if (text === '') return fenced;
  return `${fenced}${text.startsWith(newline) ? '' : newline}${text}`;
}

/**
 * Read a file, merge updates into its frontmatter, and write it back.
 * @param {string} filePath - Absolute or relative path to the markdown file.
 * @param {object} updates - Key-value pairs to merge into existing frontmatter.
 */
function updateFrontmatter(filePath, updates) {
  const resolved = path.resolve(filePath);
  const raw = fs.readFileSync(resolved, 'utf8');
  const { data, content } = parseFrontmatter(raw);

  const merged = { ...data, ...updates };
  const output = serializeFrontmatter(merged, content);

  fs.writeFileSync(resolved, output, 'utf8');
}

module.exports = {
  insertFrontmatterKey,
  parseFrontmatter,
  serializeFrontmatter,
  updateFrontmatter,
};
