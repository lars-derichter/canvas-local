const fs = require('fs');
const path = require('path');

const log = require('./logger');
const { PROJECT_ROOT } = require('./project-root');
const { COURSE_DIR } = require('./module-utils');
const { scanCourse, flattenItems } = require('../lib/convert/course-scanner');
const { toPosixPath } = require('../lib/sync/state');

/**
 * Find the lines of `text` that contain `keyword`.
 *
 * Searches the raw file text (frontmatter included) so reported line numbers
 * match the file on disk. Matching is a plain substring test,
 * case-insensitive unless `caseSensitive` is set.
 *
 * @param {string} text - Full file content.
 * @param {string} keyword - Word or phrase to look for.
 * @param {{caseSensitive?: boolean}} [options]
 * @returns {{lines: string[], matchedLines: number[]}} The split lines and
 *   the sorted 1-based numbers of lines containing the keyword.
 */
function findMatches(text, keyword, { caseSensitive = false } = {}) {
  const lines = text.split(/\r?\n/);
  const needle = caseSensitive ? keyword : keyword.toLowerCase();
  const matchedLines = [];
  for (let i = 0; i < lines.length; i++) {
    const hay = caseSensitive ? lines[i] : lines[i].toLowerCase();
    if (hay.includes(needle)) matchedLines.push(i + 1);
  }
  return { lines, matchedLines };
}

/**
 * Turn match line numbers into display windows of `context` lines around
 * each match, clamped to the file and merged when they overlap or touch.
 *
 * @param {number[]} matchedLines - Sorted 1-based match line numbers.
 * @param {number} context - Lines of context before and after each match.
 * @param {number} totalLines - Total number of lines in the file.
 * @returns {Array<{start: number, end: number}>} Merged 1-based windows.
 */
function buildWindows(matchedLines, context, totalLines) {
  const windows = [];
  for (const m of matchedLines) {
    const start = Math.max(1, m - context);
    const end = Math.min(totalLines, m + context);
    const last = windows[windows.length - 1];
    if (last && start <= last.end + 1) {
      last.end = Math.max(last.end, end);
    } else {
      windows.push({ start, end });
    }
  }
  return windows;
}

/**
 * Render one file's results as output lines: the header, then each window's
 * lines with right-aligned line numbers (`:` marks a match line), with a
 * `--` separator between non-adjacent windows.
 *
 * @param {string} header - First line (path plus optional location label).
 * @param {string[]} lines - The file's lines.
 * @param {Array<{start: number, end: number}>} windows - From buildWindows.
 * @param {Set<number>} matchedSet - 1-based match line numbers.
 * @returns {string[]} Printable lines.
 */
function renderFileResult(header, lines, windows, matchedSet) {
  const out = [header];
  const width = windows.length
    ? String(windows[windows.length - 1].end).length
    : 0;
  windows.forEach((win, i) => {
    if (i > 0) out.push('  --');
    for (let n = win.start; n <= win.end; n++) {
      const marker = matchedSet.has(n) ? ':' : ' ';
      out.push(`  ${String(n).padStart(width)}${marker}   ${lines[n - 1]}`);
    }
  });
  return out;
}

/**
 * Recursively collect markdown files under `dir` (any depth), skipping
 * entries prefixed with `_` or `.`. Entries are sorted per directory for
 * deterministic output. Returns absolute paths; [] when `dir` is missing.
 */
function walkDir(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkDir(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(fullPath);
    }
  }
  return files;
}

/**
 * Build the ordered list of files to search: course items in course order
 * (with a "Module > Item" location label), then any opted-in extra
 * directories.
 */
function collectFiles(options) {
  const files = [];

  // Loose markdown at the top of course/ (e.g. index.md, the Docusaurus
  // landing page) is not part of any module, so the scanner skips it.
  for (const entry of fs
    .readdirSync(COURSE_DIR, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
    files.push({
      absPath: path.join(COURSE_DIR, entry.name),
      displayPath: 'course/' + entry.name,
      location: null,
    });
  }

  for (const mod of scanCourse(COURSE_DIR)) {
    for (const node of flattenItems(mod.items)) {
      if (node.type !== 'item') continue;
      if (!node.relativePath.endsWith('.md')) continue;
      files.push({
        absPath: path.join(COURSE_DIR, node.relativePath),
        displayPath: 'course/' + toPosixPath(node.relativePath),
        location: `${mod.moduleName} > ${node.title}`,
      });
    }
  }

  for (const dirName of ['evaluations', 'sources']) {
    if (!options[dirName]) continue;
    const dir = path.join(PROJECT_ROOT, dirName);
    if (!fs.existsSync(dir)) {
      log.warn(`[search] No ${dirName}/ directory found, skipping.`);
      continue;
    }
    for (const absPath of walkDir(dir)) {
      files.push({
        absPath,
        displayPath: toPosixPath(path.relative(PROJECT_ROOT, absPath)),
        location: null,
      });
    }
  }

  return files;
}

async function searchCmd(keyword, options = {}) {
  if (!keyword || !keyword.trim()) {
    log.error('[search] Please provide a word or phrase to search for.');
    process.exit(1);
  }

  const context = Number(options.context);
  if (!Number.isInteger(context) || context < 0) {
    log.error('[search] --context must be a whole number of lines, e.g. -C 3');
    process.exit(1);
  }

  if (!fs.existsSync(COURSE_DIR)) {
    log.error('[search] No course/ directory found.');
    process.exit(1);
  }

  const caseSensitive = Boolean(options.caseSensitive);
  const files = collectFiles(options);

  let scanned = 0;
  let matchingLines = 0;
  let matchedFiles = 0;

  for (const file of files) {
    let text;
    try {
      text = fs.readFileSync(file.absPath, 'utf8');
    } catch (err) {
      log.warn(`[search] Could not read ${file.displayPath}: ${err.message}`);
      continue;
    }
    scanned++;

    const { lines, matchedLines } = findMatches(text, keyword, {
      caseSensitive,
    });
    if (matchedLines.length === 0) continue;

    const windows = buildWindows(matchedLines, context, lines.length);
    const header = file.location
      ? `${file.displayPath}   [${file.location}]`
      : file.displayPath;

    // Results go through console.log (not log.info) so --quiet still shows
    // them; same convention as validate's findings.
    if (matchedFiles > 0) console.log('');
    for (const line of renderFileResult(
      header,
      lines,
      windows,
      new Set(matchedLines),
    )) {
      console.log(line);
    }

    matchedFiles++;
    matchingLines += matchedLines.length;
  }

  log.verbose(`[search] Scanned ${scanned} files.`);

  if (matchedFiles === 0) {
    console.log(`[search] No matches for "${keyword}".`);
    if (!options.evaluations && !options.sources) {
      log.info(
        '[search] Tip: add --evaluations or --sources to search more folders.',
      );
    }
    return;
  }

  console.log('');
  const lineWord = matchingLines === 1 ? 'matching line' : 'matching lines';
  const fileWord = matchedFiles === 1 ? 'file' : 'files';
  console.log(
    `[search] ${matchingLines} ${lineWord} in ${matchedFiles} ${fileWord}.`,
  );
}

module.exports = searchCmd;
// Exported for unit tests.
module.exports.findMatches = findMatches;
module.exports.buildWindows = buildWindows;
module.exports.renderFileResult = renderFileResult;
module.exports.walkDir = walkDir;
