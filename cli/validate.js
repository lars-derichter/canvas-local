const fs = require('fs');
const path = require('path');
const { Lexer } = require('marked');

const { scanCourse, flattenItems } = require('../lib/convert/course-scanner');
const { parseFrontmatter } = require('../lib/convert/frontmatter');
const {
  extractFileReferences,
  maskCodeRegions,
} = require('../lib/convert/link-resolver');
const { COURSE_DIR } = require('./module-utils');
const { PROJECT_ROOT } = require('./project-root');

// A file reference written as an HTML tag rather than in markdown syntax. Only
// `src` on `<img>` and `href` on `<a>` are looked at, and only when the value
// names a `_files/` path: those are the two an author reaches for to embed
// something. Deliberately a regex over the text rather than an HTML parse,
// because the result is a warning about a shape, not a rewrite. Unquoted
// attribute values are not matched; nothing in this project writes them.
const RAW_HTML_FILE_REF =
  /<(img|a)\b[^>]*?\s(src|href)\s*=\s*(["'])([^"']*_files\/[^"']*)\3/gi;

// The label of a link reference definition, read back off the token's own raw
// text so the warning can quote the author's spelling. Marked normalises the
// label it keys the definition under — `[Diagram]` becomes `diagram` — and a
// warning that renames what is written in the file is a warning that is harder
// to find. Non-greedy up to the first `]:`, which is where the label ends.
const DEFINITION_LABEL = /^\s*\[([\s\S]*?)\]:/;

/**
 * Every link/image reference definition in a markdown body.
 *
 * Marked rather than a regex over the text, because the question is not "does
 * this line look like a definition" but "does this project's parser resolve a
 * reference through it", and the two answers differ in both directions. A line
 * that follows a paragraph line, or one indented four spaces, looks like a
 * definition and is not one; a definition inside a blockquote or a list item
 * does not look like a top-level line and is one, resolving references
 * anywhere in the file. Lexing is local and synchronous — no network, no HTML
 * conversion — so it keeps validate's character. `Lexer.lex` is the static
 * form, which builds a fresh lexer with default options rather than picking up
 * whatever extensions another module registered on a shared one.
 *
 * @param {string} body - Markdown with the frontmatter already stripped.
 * @returns {Array<object>} Marked's `def` tokens, outermost first.
 */
function referenceDefinitions(body) {
  const defs = [];
  const walk = (tokens) => {
    for (const token of tokens || []) {
      if (token.type === 'def') defs.push(token);
      walk(token.tokens);
      walk(token.items);
    }
  };
  walk(Lexer.lex(body));
  return defs;
}

const VALID_CANVAS_TYPES = new Set([
  'page',
  'assignment',
  'discussion',
  'quiz',
  'external_url',
  'external_tool',
  'file',
]);

/**
 * Validate scanned modules against the files on disk.
 * Collects messages instead of printing them, so it can be unit tested.
 *
 * @param {Array<object>} modules - Modules from scanCourse().
 * @param {string} courseDir - Absolute path to the scanned course directory.
 * @param {string} [projectRoot] - Repo root, which `quiz_ref` is resolved from.
 * @returns {{ errors: string[], warnings: string[] }}
 */
function validateModules(modules, courseDir, projectRoot = PROJECT_ROOT) {
  const errors = [];
  const warnings = [];

  // Build a set of all known relative paths for link validation
  const allPaths = new Set();
  for (const mod of modules) {
    const flatItems = flattenItems(mod.items);
    for (const item of flatItems) {
      if (item.relativePath) {
        allPaths.add(item.relativePath);
      }
    }
  }

  for (const mod of modules) {
    // Check module naming convention
    if (!mod.folderName.match(/^\d{2}-/)) {
      warnings.push(
        `${mod.folderName}: folder name should start with a two-digit prefix (e.g. 01-)`,
      );
    }

    const flatItems = flattenItems(mod.items);

    for (const item of flatItems) {
      if (item.type === 'subheader') continue;
      // Raw binaries dropped in a module folder: no frontmatter, no body,
      // nothing to validate. Markdown wrappers (canvas_type: file) are
      // validated like any other item.
      if (item.canvasType === 'file' && !item.file.endsWith('.md')) continue;

      const filePath = path.resolve(courseDir, item.relativePath);

      // Check naming convention
      if (!item.file.match(/^\d{2}-/)) {
        warnings.push(
          `${item.relativePath}: filename should start with a two-digit prefix`,
        );
      }

      // Validate frontmatter
      let raw;
      try {
        raw = fs.readFileSync(filePath, 'utf8');
      } catch (err) {
        errors.push(`${item.relativePath}: cannot read file: ${err.message}`);
        continue;
      }

      let data;
      let body;
      try {
        ({ data, content: body } = parseFrontmatter(raw));
      } catch (err) {
        errors.push(
          `${item.relativePath}: invalid frontmatter YAML: ${err.message}`,
        );
        continue;
      }

      // Check canvas_type
      if (data.canvas_type && !VALID_CANVAS_TYPES.has(data.canvas_type)) {
        errors.push(
          `${item.relativePath}: unknown canvas_type "${data.canvas_type}" (expected: ${[...VALID_CANVAS_TYPES].join(', ')})`,
        );
      }

      // Check external_url has a URL
      if (data.canvas_type === 'external_url' && !data.external_url) {
        errors.push(
          `${item.relativePath}: external_url type requires an external_url field`,
        );
      }

      // An LTI link is nothing without its launch URL: that URL, not a tool id,
      // is what Canvas resolves the tool from.
      if (data.canvas_type === 'external_tool' && !data.external_url) {
        errors.push(
          `${item.relativePath}: external_tool type requires an external_url field (the tool's launch URL)`,
        );
      }

      // A quiz item is a reference, not a source: the questions live in the QTI
      // package it names and in Canvas, never in this file. The path is relative
      // to the repo root, because the zip lives under evaluations/, outside
      // course/.
      //
      // A missing quiz_ref is a warning, not an error. A quiz pulled from Canvas
      // has never had one — Canvas does not know the zip exists — so erroring
      // would make every pull of a Canvas-authored quiz produce a tree that
      // fails validation. It is still worth saying out loud, because a quiz with
      // no local package is exactly the one a rollover cannot rebuild.
      //
      // A quiz_ref that names a file which is not there is a different thing: a
      // reference the author wrote and the repo cannot honour. That is an error.
      if (data.canvas_type === 'quiz') {
        if (!data.quiz_ref || typeof data.quiz_ref !== 'string') {
          warnings.push(
            `${item.relativePath}: quiz has no quiz_ref, so a rollover to a fresh Canvas course cannot rebuild it. Point quiz_ref at the QTI zip (relative to the repo root) once you have one.`,
          );
        } else {
          const refPath = path.resolve(projectRoot, data.quiz_ref);
          if (!fs.existsSync(refPath)) {
            errors.push(
              `${item.relativePath}: quiz_ref not found: ${data.quiz_ref} (resolved from the repo root)`,
            );
          }
        }
      }

      // Check file wrapper has a file_ref pointing at a file on disk
      if (data.canvas_type === 'file') {
        if (!data.file_ref || typeof data.file_ref !== 'string') {
          errors.push(
            `${item.relativePath}: file type requires a file_ref field`,
          );
        } else {
          const refPath = path.resolve(path.dirname(filePath), data.file_ref);
          if (!fs.existsSync(refPath)) {
            errors.push(
              `${item.relativePath}: file_ref not found: ${data.file_ref}`,
            );
          }
        }
      }

      // Validate external_url format
      if (data.external_url) {
        try {
          new URL(data.external_url);
        } catch {
          errors.push(
            `${item.relativePath}: invalid external_url "${data.external_url}"`,
          );
        }
      }

      // Check internal links. Mask code blocks and inline code first so
      // example links in documentation snippets don't count as broken.
      const scannable = maskCodeRegions(raw);
      const linkRegex = /\[([^\]]*)\]\(([^)]+)\)/g;
      let match;
      while ((match = linkRegex.exec(scannable)) !== null) {
        const href = match[2].split(/\s+/)[0]; // Strip title
        if (
          href.startsWith('http://') ||
          href.startsWith('https://') ||
          href.startsWith('#') ||
          href.startsWith('//')
        ) {
          continue;
        }
        if (!href.endsWith('.md')) continue;

        // Resolve relative to the item's directory
        const itemDir = path.dirname(item.relativePath);
        const resolved = path.posix.normalize(
          path.posix.join(itemDir, href.split('#')[0]),
        );

        if (!allPaths.has(resolved)) {
          errors.push(
            `${item.relativePath}: broken link to "${href}" (resolved: ${resolved})`,
          );
        }
      }

      // Check file references exist on disk
      try {
        const refs = extractFileReferences(raw, item.relativePath);
        for (const ref of refs) {
          const refPath = path.resolve(courseDir, ref);
          if (!fs.existsSync(refPath)) {
            errors.push(
              `${item.relativePath}: referenced file not found: ${ref}`,
            );
          }
        }
      } catch {
        // extractFileReferences may fail on unusual content
      }

      // Check for file references written as raw HTML. Push only uploads and
      // rewrites what extractFileReferences finds, and that is markdown syntax
      // only, so an HTML tag reaches Canvas with the relative path intact and
      // nothing behind it. The same masked copy is used, so an example inside a
      // fence or a code span does not count.
      const seenRawRefs = new Set();
      RAW_HTML_FILE_REF.lastIndex = 0;
      let rawMatch;
      while ((rawMatch = RAW_HTML_FILE_REF.exec(scannable)) !== null) {
        const [, tag, attr, , href] = rawMatch;
        // An absolute or protocol URL that happens to contain "_files/" points
        // somewhere real; only a relative path is the broken case.
        if (/^(https?:\/\/|\/\/|\/|data:|mailto:)/i.test(href)) continue;

        const key = `${tag.toLowerCase()} ${attr.toLowerCase()} ${href}`;
        if (seenRawRefs.has(key)) continue;
        seenRawRefs.add(key);

        const suggestion =
          tag.toLowerCase() === 'img' ? `![alt](${href})` : `[text](${href})`;
        warnings.push(
          `${item.relativePath}: raw HTML <${tag.toLowerCase()} ${attr.toLowerCase()}="${href}"> will not sync. Push uploads and rewrites inline markdown references only, so this one reaches Canvas as a dead relative path. Write it as ${suggestion} instead.`,
        );
      }

      // Check for file references written reference-style. The same gap, one
      // syntax over: `![diagram][d]` with `[d]: _files/diagram.png` at the
      // bottom renders fine locally, but the extractor only ever sees inline
      // `(...)` destinations, so the file is never uploaded and the `<img>`
      // marked renders keeps the relative path. The definition is what is
      // warned about rather than each reference to it, because it is the one
      // line to fix however many times it is used. A definition nothing
      // references yet is warned about too: it is one reference away from
      // being the same broken page.
      const seenDefs = new Set();
      let definitions = [];
      try {
        definitions = referenceDefinitions(body);
      } catch {
        // Lexing may fail on unusual content
      }
      for (const def of definitions) {
        const dest = def.href || '';
        if (!dest.includes('_files/')) continue;
        // Same skip as above: only a relative path is the broken case.
        if (/^(https?:\/\/|\/\/|\/|data:|mailto:)/i.test(dest)) continue;

        const labelMatch = DEFINITION_LABEL.exec(def.raw);
        const label = (labelMatch ? labelMatch[1] : def.tag)
          .replace(/\s+/g, ' ')
          .trim();

        const key = `${label} ${dest}`;
        if (seenDefs.has(key)) continue;
        seenDefs.add(key);

        warnings.push(
          `${item.relativePath}: reference-style definition [${label}]: ${dest} will not sync. Push uploads and rewrites inline markdown references only, so this one reaches Canvas as a dead relative path. Write the reference inline as ![alt](${dest}) or [text](${dest}) instead.`,
        );
      }
    }
  }

  return { errors, warnings };
}

async function validate() {
  if (!fs.existsSync(COURSE_DIR)) {
    console.error('[validate] No course/ directory found.');
    process.exit(1);
  }

  const modules = scanCourse(COURSE_DIR);

  console.log(`[validate] Checking ${modules.length} module(s)...\n`);

  const { errors, warnings } = validateModules(modules, COURSE_DIR);

  // Report results
  if (warnings.length > 0) {
    console.log(`Warnings (${warnings.length}):`);
    for (const w of warnings) {
      console.log(`  ⚠ ${w}`);
    }
    console.log();
  }

  if (errors.length > 0) {
    console.log(`Errors (${errors.length}):`);
    for (const e of errors) {
      console.log(`  ✗ ${e}`);
    }
    console.log();
    console.log(
      `[validate] Found ${errors.length} error(s) and ${warnings.length} warning(s).`,
    );
    process.exit(1);
  }

  if (warnings.length > 0) {
    console.log(`[validate] No errors. ${warnings.length} warning(s).`);
  } else {
    console.log('[validate] All checks passed.');
  }
}

module.exports = validate;
module.exports._validateModules = validateModules;
