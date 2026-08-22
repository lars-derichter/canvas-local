const fs = require('fs');
const os = require('os');
const path = require('path');

const log = require('./logger');
const { PROJECT_ROOT } = require('./project-root');
const { COURSE_DIR } = require('./module-utils');
const { scanCourse, flattenItems } = require('../lib/convert/course-scanner');
const { preflight } = require('../lib/export/preflight');
const { resolveStyle } = require('../lib/export/style-resolver');
const { runPandoc, typstFontPaths } = require('../lib/export/pandoc');
const { buildCombinedMarkdown } = require('../lib/export/assemble');
const { parseToc, validateTocPaths } = require('../lib/export/toc');
const { loadCourseConfig } = require('../lib/config/course-config');
const { loadTheme, themeVariables } = require('../lib/config/theme');
const { getLabels, slugify } = require('../lib/config/labels');

const EXPORTS_DIR = path.join(PROJECT_ROOT, 'exports');

/** Normalize a path to forward slashes for stable comparisons and anchors. */
function toPosix(p) {
  return p.replace(/\\/g, '/');
}

/**
 * Parse repeatable `--var key=value` flags into an object. Used as a commander
 * collector.
 */
function collectVar(value, previous = {}) {
  const eq = value.indexOf('=');
  if (eq === -1) {
    throw new Error(`--var expects key=value, got "${value}"`);
  }
  const key = value.slice(0, eq).trim();
  const val = value.slice(eq + 1);
  return { ...previous, [key]: val };
}

/**
 * Load the Canvas link map (relativePath -> {canvasType, canvasId}) and course
 * id from .canvas-sync.json, used to footnote cross-links whose target falls
 * outside the export. Returns empty context when nothing has been synced.
 *
 * `skipEnvCheck` because the course-identity refusal in `loadState` exists to
 * stop a *write* reaching the wrong Canvas course, and export never writes to
 * Canvas. It reads the state for one thing: each item's Canvas id paired with
 * the course id recorded beside it, which is the only course those ids mean
 * anything in. What `.env` names does not enter into it, so a `.env` pointing
 * somewhere else is not export's problem to have an opinion about. Left to
 * throw, that refusal was swallowed by the catch below and the export came out
 * with every cross-course link silently unresolved — neither working nor
 * saying so.
 *
 * The catch stays, narrowed to what it was always for: a state file this
 * version cannot read. A schema from another version throws, an unreadable file
 * throws, and neither is worth failing a whole export over when the only thing
 * lost is a footnote.
 *
 * @param {object} [options]
 * @param {string} [options.file] - Injection point for tests, to `loadState`.
 * @param {object} [options.env]  - Injection point for tests, to `loadState`.
 */
function buildLinkContext({ file, env } = {}) {
  let loadState;
  let allItems;
  try {
    ({ loadState, allItems } = require('../lib/sync/state'));
  } catch {
    return {};
  }
  let state;
  try {
    state = loadState({ allowNull: true, skipEnvCheck: true, file, env });
  } catch {
    return {};
  }
  if (!state || !state.modules) return {};

  const linkMap = new Map();
  for (const { itemPath, entry } of allItems(state)) {
    if (entry.canvas_id == null) continue;
    linkMap.set(toPosix(itemPath), {
      canvasType: entry.canvas_type,
      canvasId: entry.canvas_id,
    });
  }
  // A state that does not say which course it describes cannot produce a Canvas
  // URL, and half of one is worse than none: `/courses/0/pages/77` is a link
  // that resolves nowhere, printed into a PDF as though it worked. Handing out
  // no id at all puts the footnote through the same door as a target the link
  // map has never heard of — `rewriteCrossLinks` guards on `courseId != null`
  // and falls back to unlinked plain text.
  //
  // Only skipping the env check makes this reachable. `assertStateMatchesEnv`
  // used to stamp the environment's id onto a state that claimed none, so a
  // `course_id: 0` never got this far. The test below is the same shape as the
  // `fileCourse` expression there, deliberately: both have to agree on what
  // counts as claiming no course, and 0 is how the state spells it.
  const claimsCourse = state.course_id != null && Number(state.course_id) !== 0;
  return { linkMap, courseId: claimsCourse ? state.course_id : undefined };
}

/**
 * Build a flat index of every markdown/file item in the course, tagged with its
 * owning module, plus the raw scanned modules (which retain subheaders).
 */
function indexCourse() {
  const modules = scanCourse(COURSE_DIR);
  const byPath = new Map();
  for (const mod of modules) {
    for (const node of flattenItems(mod.items)) {
      if (node.type !== 'item') continue;
      byPath.set(toPosix(node.relativePath), {
        item: node,
        moduleFolder: mod.folderName,
        moduleName: mod.moduleName,
      });
    }
  }
  return { modules, byPath };
}

/** Group loose item entries by their module, in course/module order. */
function groupByModule(entries, modules) {
  const order = modules.map((m) => m.folderName);
  const byFolder = new Map();
  for (const e of entries) {
    if (!byFolder.has(e.moduleFolder)) {
      byFolder.set(e.moduleFolder, {
        moduleTitle: e.moduleName,
        moduleFolder: e.moduleFolder,
        items: [],
      });
    }
    byFolder.get(e.moduleFolder).items.push(e.item);
  }
  return order.filter((f) => byFolder.has(f)).map((f) => byFolder.get(f));
}

/** Collect the posix relativePaths of every markdown item in the groups. */
function collectIncludedPaths(groups) {
  const set = new Set();
  for (const group of groups) {
    for (const node of flattenItems(group.items)) {
      if (
        node.type === 'item' &&
        node.canvasType !== 'file' &&
        node.canvasType !== 'external_url'
      ) {
        set.add(toPosix(node.relativePath));
      }
    }
  }
  return set;
}

/**
 * Resolve a positional argument to either a module folder or an item path,
 * relative to course/. Accepts repo-relative, cwd-relative, and absolute paths.
 */
function resolvePositional(p, byPath) {
  const abs = path.resolve(process.cwd(), p);
  let stat;
  try {
    stat = fs.statSync(abs);
  } catch {
    throw new Error(`Path not found: ${p}`);
  }
  const rel = toPosix(path.relative(COURSE_DIR, abs));
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Path is outside course/: ${p}`);
  }
  if (stat.isDirectory()) {
    // A directory directly under course/ is a module; deeper is unsupported.
    if (rel.includes('/')) {
      throw new Error(`Only whole modules can be exported by folder: ${p}`);
    }
    return { kind: 'module', folder: rel };
  }
  if (!byPath.has(rel)) {
    throw new Error(`Not a course item: ${p}`);
  }
  return { kind: 'item', entry: byPath.get(rel) };
}

/**
 * Output-filename slug for a whole-course export. Never empty and never absurdly
 * long: slugify strips everything outside [a-z0-9], so a title written in a
 * non-Latin script slugs to '' and would land in a hidden `exports/.pdf`, and an
 * essay-length title would exceed the filesystem's name limit. The label
 * fallback can itself be empty, because it is overridable, hence the literal.
 */
function exportSlug(title, labels) {
  const slug =
    slugify(title) || slugify(labels.export.course_title) || 'course';
  return slug.slice(0, 100).replace(/-+$/, '');
}

/**
 * Resolve the export mode into { groups, regime, defaultSlug, defaultTitle }.
 * `labels` supplies the localized default titles/slugs (en when omitted), and
 * `course` the course's own name from course.config.yml, which titles any export
 * covering the whole course.
 */
function resolveMode(paths, options, index, labels = getLabels(), course = {}) {
  const { modules, byPath } = index;
  const courseTitle = course.title || labels.export.course_title;
  // The tagline describes the course, so it only subtitles a document actually
  // titled after the course. A module export gets the course name instead.
  const courseSubtitle = course.tagline || undefined;
  const flagged = (entry) =>
    !options.flagged ||
    (entry.item.frontmatter && entry.item.frontmatter.export === true);

  // --toc <file>: export exactly the items listed in a TOC file, in order.
  if (options.toc) {
    let text;
    try {
      text = fs.readFileSync(path.resolve(process.cwd(), options.toc), 'utf8');
    } catch {
      throw new Error(`Could not read TOC file: ${options.toc}`);
    }
    const { meta, paths: tocPaths } = parseToc(text);
    const { valid, missing } = validateTocPaths(tocPaths, byPath);
    for (const m of missing)
      log.warn(`[export] TOC path not found, skipping: ${m}`);
    if (valid.length === 0)
      throw new Error('The TOC file lists no valid course items.');

    let entries = valid.map((p) => byPath.get(p));
    if (options.flagged) entries = entries.filter(flagged);
    if (entries.length === 0)
      throw new Error('No TOC items matched the export.');

    const groups = groupByModule(entries, modules);
    return {
      groups,
      regime: groups.length > 1 ? 'course' : 'flat',
      defaultSlug: 'toc',
      defaultTitle: meta.title || courseTitle,
      defaultSubtitle: meta.subtitle || courseSubtitle,
    };
  }

  // -m <folder> or a single directory positional -> whole module.
  let moduleFolder = options.module;
  if (!moduleFolder && paths.length === 1) {
    const resolved = resolvePositional(paths[0], byPath);
    if (resolved.kind === 'module') moduleFolder = resolved.folder;
  }
  if (moduleFolder) {
    const mod = modules.find((m) => m.folderName === moduleFolder);
    if (!mod) throw new Error(`Module not found: ${moduleFolder}`);
    let items = mod.items;
    if (options.flagged) {
      items = flattenItems(items).filter(
        (n) =>
          n.type === 'item' && n.frontmatter && n.frontmatter.export === true,
      );
    }
    if (flattenItems(items).every((n) => n.type !== 'item')) {
      throw new Error(`No items to export in module ${moduleFolder}.`);
    }
    return {
      groups: [
        { moduleTitle: mod.moduleName, moduleFolder: mod.folderName, items },
      ],
      regime: 'flat',
      defaultSlug: mod.folderName,
      defaultTitle: mod.moduleName,
    };
  }

  // Explicit item paths -> single item or ad-hoc selection.
  if (paths.length > 0) {
    const entries = [];
    for (const p of paths) {
      const resolved = resolvePositional(p, byPath);
      if (resolved.kind === 'module') {
        throw new Error(`Cannot mix a module folder with item paths: ${p}`);
      }
      if (flagged(resolved.entry)) entries.push(resolved.entry);
    }
    if (entries.length === 0) throw new Error('No items matched the export.');

    if (entries.length === 1 && !options.flagged) {
      const e = entries[0];
      return {
        groups: [
          {
            moduleTitle: e.moduleName,
            moduleFolder: e.moduleFolder,
            items: [e.item],
          },
        ],
        regime: 'bare',
        defaultSlug: path.basename(e.item.relativePath).replace(/\.md$/i, ''),
        defaultTitle: e.item.title,
      };
    }

    const groups = groupByModule(entries, modules);
    return {
      groups,
      regime: groups.length > 1 ? 'course' : 'flat',
      defaultSlug: slugify(labels.export.selection_title),
      defaultTitle: options.title || labels.export.selection_title,
    };
  }

  // Nothing specified -> full course (optionally filtered by --flagged).
  let entries = [...byPath.values()];
  if (options.flagged) {
    entries = entries.filter(
      (e) => e.item.frontmatter && e.item.frontmatter.export === true,
    );
  }
  if (entries.length === 0) {
    throw new Error(
      options.flagged
        ? 'No items are flagged with export: true.'
        : 'No course items found.',
    );
  }

  if (options.flagged) {
    const groups = groupByModule(entries, modules);
    return {
      groups,
      regime: groups.length > 1 ? 'course' : 'flat',
      defaultSlug: 'flagged',
      defaultTitle: options.title || courseTitle,
      defaultSubtitle: courseSubtitle,
    };
  }

  // Full course: keep each module's original items (subheaders intact).
  const groups = modules
    .filter((m) => flattenItems(m.items).some((n) => n.type === 'item'))
    .map((m) => ({
      moduleTitle: m.moduleName,
      moduleFolder: m.folderName,
      items: m.items,
    }));
  return {
    groups,
    regime: 'course',
    defaultSlug: exportSlug(options.title || courseTitle, labels),
    defaultTitle: options.title || courseTitle,
    defaultSubtitle: courseSubtitle,
  };
}

/**
 * Export course materials to PDF or DOCX.
 */
async function exportCmd(paths = [], options = {}) {
  const format = (options.format || 'pdf').toLowerCase();
  if (format !== 'pdf' && format !== 'docx') {
    log.error(`[export] Unknown format "${format}". Use pdf or docx.`);
    process.exit(1);
  }

  try {
    const versions = await preflight({ format });
    log.verbose(
      `[export] pandoc ${versions.pandoc}` +
        (versions.typst ? `, typst ${versions.typst}` : ''),
    );
  } catch (err) {
    log.error(`[export] ${err.message}`);
    process.exit(1);
  }

  // The export style decides the layout, the theme the colours. Both can fail
  // on a bad name or a missing file; report that as a CLI error, not a stack.
  let style;
  let theme;
  try {
    style = resolveStyle({
      style: options.style,
      template: options.template,
      referenceDoc: options.referenceDoc,
    });
    theme = loadTheme();
  } catch (err) {
    log.error(`[export] ${err.message}`);
    process.exit(1);
  }
  log.verbose(`[export] style ${style.name}, theme ${theme.name}`);
  if (format === 'pdf') {
    const fontPaths = typstFontPaths(style.fontsDir);
    log.verbose(
      `[export] font paths: ${fontPaths.join(path.delimiter) || '(system only)'}`,
    );
  }

  fs.mkdirSync(EXPORTS_DIR, { recursive: true });

  // --sample: render the shipped kitchen-sink document. The sample is shared by
  // every style, so pandoc needs both its own directory and the selected
  // style's on the resource path to find `![](logo.png)`.
  if (options.sample) {
    const output =
      options.output || path.join(EXPORTS_DIR, `style-sample.${format}`);
    const resourcePath = [path.dirname(style.sample), style.dir].join(
      path.delimiter,
    );
    await run(
      style,
      theme,
      style.sample,
      output,
      format,
      options,
      resourcePath,
    );
    log.info(`[export] Wrote ${path.relative(process.cwd(), output)}`);
    return;
  }

  const { title, tagline, language, labels } = loadCourseConfig();

  let mode;
  try {
    mode = resolveMode(paths, options, indexCourse(), labels, {
      title,
      tagline,
    });
  } catch (err) {
    log.error(`[export] ${err.message}`);
    process.exit(1);
  }

  const now = new Date();
  const localDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
  const meta = {
    regime: mode.regime,
    lang: language,
    date: localDate,
    // Rendered labels travel as pandoc metadata so filter.lua and template.typ
    // pick them up without hardcoding any language themselves.
    labels: { ...labels.alerts, attachment: labels.export.attachment },
  };
  if (mode.regime !== 'bare') {
    meta.title = options.title || mode.defaultTitle;
    const subtitle = options.subtitle || mode.defaultSubtitle;
    if (subtitle) meta.subtitle = subtitle;
    meta.toc = true;
    // The cover prints `course` under the document title, so a module or a
    // selection says which course it was cut from. Skipped when the document is
    // already titled after the course, which would print the name twice. No
    // title means no cover at all (template.typ gates the whole block on it).
    if (meta.title !== title) meta.course = title;
  }

  const { linkMap, courseId } = buildLinkContext();
  const combined = buildCombinedMarkdown(mode.groups, meta, {
    courseDir: COURSE_DIR,
    includedPaths: collectIncludedPaths(mode.groups),
    linkMap,
    courseId,
    labels,
    onlineLabel: labels.export.online,
  });

  const slug = mode.defaultSlug;
  const output = options.output || path.join(EXPORTS_DIR, `${slug}.${format}`);

  // Write the combined markdown to a working file. When --keep-markdown is set
  // it lands in exports/ for inspection (as `<slug>.combined.md`, distinct from
  // any input such as a TOC file); otherwise it goes to a temp file.
  const mdPath = options.keepMarkdown
    ? path.join(EXPORTS_DIR, `${slug}.combined.md`)
    : path.join(os.tmpdir(), `course-export-${process.pid}-${Date.now()}.md`);
  fs.writeFileSync(mdPath, combined, 'utf8');

  try {
    await run(style, theme, mdPath, output, format, options, COURSE_DIR);
  } finally {
    if (!options.keepMarkdown) {
      try {
        fs.unlinkSync(mdPath);
      } catch {
        /* ignore */
      }
    }
  }

  log.info(`[export] Wrote ${path.relative(process.cwd(), output)}`);
  if (options.keepMarkdown) {
    log.info(
      `[export] Kept combined markdown at ${path.relative(process.cwd(), mdPath)}`,
    );
  }
}

/** Run pandoc for one input file with the resolved style assets and theme. */
async function run(style, theme, input, output, format, options, resourcePath) {
  try {
    await runPandoc({
      input,
      output,
      format,
      filter: style.filter,
      defaultsFile: style.defaultsFile,
      template: style.template,
      referenceDoc: style.referenceDoc,
      resourcePath,
      // Theme colours travel as pandoc variables so template.typ reads them
      // instead of hardcoding a palette. An explicit --var still wins.
      variables: { ...themeVariables(theme), ...(options.var || {}) },
      logo: style.logo,
      fontsDir: style.fontsDir,
    });
  } catch (err) {
    log.error(`[export] ${err.message}`);
    process.exit(1);
  }
}

module.exports = exportCmd;
module.exports.buildLinkContext = buildLinkContext;
module.exports.collectVar = collectVar;
module.exports.exportSlug = exportSlug;
module.exports.resolveMode = resolveMode;
