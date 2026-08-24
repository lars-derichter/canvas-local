const fs = require('fs');
const path = require('path');

const { LABEL_SETS } = require('../../lib/config/labels');
const { normaliseBaseUrl } = require('../../lib/sync/state');

/** This plugin runs inside the Docusaurus build, where the CLI's project
 *  root detection does not apply — resolve it from this file instead. */
const PROJECT_DIR = path.resolve(__dirname, '../..');

/** The Canvas types that carry no body of their own: the item is a reference
 *  to something that is authored and stored in Canvas. Each name doubles as
 *  the key of its label in the `cards` label group. */
const REFERENCE_TYPES = new Set(['quiz', 'external_tool']);

/** Cache per project dir: the sync state is read once per process. */
const locationCache = new Map();

/** Cache per project dir: the item rows of the same sync state. */
const itemCache = new Map();

/**
 * A Canvas address as this plugin's sources hand one over, trimmed down to the
 * site root so a `/api/v1` suffix (which `CANVAS_API_URL` is sometimes written
 * with) does not end up in a link a human is meant to click.
 *
 * The trimming is `normaliseBaseUrl` in lib/sync/state.js, which is the one
 * definition of the shape `.env` and `.canvas-sync.json` hold. The surrounding
 * `.trim()` is this plugin's own: it reads a raw environment variable and a raw
 * Docusaurus option, neither of which has been through `init`.
 */
function cleanBaseUrl(url) {
  return normaliseBaseUrl(String(url || '').trim());
}

/**
 * Where this course lives in Canvas: `{ baseUrl, courseId }`, or null when
 * nothing can say.
 *
 * The Docusaurus build does not load `.env` — only the CLI does — so the usual
 * source is `.canvas-sync.json`, which records the course's address and id
 * without holding a token. Both are best-effort: a preview built on a fresh
 * clone has neither, and the card then renders unlinked.
 */
function readCanvasLocation(projectDir) {
  const envBaseUrl = cleanBaseUrl(process.env.CANVAS_API_URL);
  const envCourseId = String(process.env.CANVAS_COURSE_ID || '').trim();
  if (envBaseUrl && envCourseId) {
    return { baseUrl: envBaseUrl, courseId: envCourseId };
  }

  try {
    const raw = fs.readFileSync(
      path.join(projectDir, '.canvas-sync.json'),
      'utf8',
    );
    const state = JSON.parse(raw);
    const baseUrl = cleanBaseUrl(state.canvas_base_url);
    const courseId = String(state.course_id || '').trim();
    // course_id 0 is the placeholder a sync file written without credentials
    // carries, and it addresses no course.
    if (baseUrl && courseId && courseId !== '0') return { baseUrl, courseId };
  } catch {
    // Missing, unreadable or corrupt sync state: no Canvas link, no crash.
  }
  return null;
}

/**
 * Every item row the sync state holds, keyed by its repo-relative path.
 *
 * A quiz has no id of its own in the markdown file any more — identity lives in
 * `.canvas-sync.json` alone, keyed by path — so the card has to look its id up
 * the way every other reader does. A course that has never been pushed has no
 * state and no ids, which is not an error: the card renders without its link.
 */
function readSyncItems(projectDir) {
  const rows = new Map();
  try {
    const raw = fs.readFileSync(
      path.join(projectDir, '.canvas-sync.json'),
      'utf8',
    );
    const state = JSON.parse(raw);
    for (const module of Object.values(state.modules || {})) {
      for (const [itemPath, row] of Object.entries(module.items || {})) {
        rows.set(itemPath, row);
      }
    }
  } catch {
    // Missing, unreadable or corrupt sync state: no ids, no crash.
  }
  return rows;
}

/**
 * The sync row for the file being rendered, or null.
 *
 * Docusaurus serves `course/` at the site root, so a vfile's path is absolute
 * and the sync key is what remains once the course directory is taken off the
 * front of it.
 */
function rowForFile(projectDir, vfile) {
  const filePath = vfile && (vfile.path || (vfile.history || [])[0]);
  if (!filePath) return null;
  const relative = path.relative(path.join(projectDir, 'course'), filePath);
  if (!relative || relative.startsWith('..')) return null;
  if (!itemCache.has(projectDir)) {
    itemCache.set(projectDir, readSyncItems(projectDir));
  }
  return itemCache.get(projectDir).get(relative.split(path.sep).join('/'));
}

/**
 * Resolve the Canvas location for one plugin instance. Explicit options win
 * (that is how the tests stay hermetic); otherwise the project is inspected
 * once and the answer cached.
 */
function resolveCanvasLocation(options) {
  if (options.canvasBaseUrl || options.courseId) {
    const baseUrl = cleanBaseUrl(options.canvasBaseUrl);
    const courseId = String(options.courseId || '').trim();
    return baseUrl && courseId ? { baseUrl, courseId } : null;
  }
  const dir = options.projectDir || PROJECT_DIR;
  if (!locationCache.has(dir)) locationCache.set(dir, readCanvasLocation(dir));
  return locationCache.get(dir);
}

/** A non-empty trimmed string, or null. */
function cleanString(value) {
  if (typeof value === 'number') return String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * The link the card should carry, as `{ url, text }`, or null when there is
 * nothing safe to point at.
 *
 * A quiz links to its Canvas page, which needs both the course address and the
 * id the sync state records for this file; an external tool links to its own
 * launch URL, which is in the frontmatter. Missing either leaves the card
 * unlinked rather than guessing an address.
 *
 * The quiz id is read from the sync row rather than the frontmatter because
 * identity no longer lives in the file. A `canvas_id` left in an older file is
 * deliberately not consulted: it is exactly the stale copy that made the two
 * disagree, and pull strips it on the next run.
 */
function resolveLink(frontMatter, canvas, referenceLabels, syncRow) {
  if (frontMatter.canvas_type === 'external_tool') {
    const url = cleanString(frontMatter.external_url);
    return url ? { url, text: url } : null;
  }

  const quizId = cleanString(syncRow && syncRow.canvas_id);
  if (!canvas || !quizId) return null;
  return {
    url: `${canvas.baseUrl}/courses/${canvas.courseId}/quizzes/${quizId}`,
    text: referenceLabels.open,
  };
}

/** `<p className="...">` around the given children. */
function paragraph(className, children) {
  return {
    type: 'mdxJsxFlowElement',
    name: 'p',
    attributes: [
      { type: 'mdxJsxAttribute', name: 'className', value: className },
    ],
    children,
  };
}

/**
 * Remark plugin that gives quiz and external tool pages a body in the local
 * preview. Both types are references: the thing itself is authored in Canvas
 * (a Classic Quiz, an LTI tool), and the markdown file only records that it
 * belongs in this module, at this position. Docusaurus would otherwise render
 * a blank page.
 *
 * The page gets a card naming the type, mirroring the external link and file
 * cards, and a notice saying where the item is actually edited.
 *
 * Unlike its sibling plugins, this one does not require a companion frontmatter
 * field: the type card is worth showing on its own, so an item whose link
 * cannot be resolved renders unlinked instead of falling back to a blank page.
 * `new_tab` is ignored here — it governs how Canvas launches the tool, and the
 * preview always opens an external link in a new tab.
 *
 * @param {{ cards?: object, reference?: object, canvasBaseUrl?: string,
 *   courseId?: string|number, projectDir?: string }} [options] - `cards` and
 *   `reference` override the built-in English label groups;
 *   docusaurus.config.js passes the course language's. `canvasBaseUrl` and
 *   `courseId` pin the Canvas address instead of reading it from the
 *   environment or `.canvas-sync.json` under `projectDir`.
 */
function remarkReferenceItem(options = {}) {
  const cards = { ...LABEL_SETS.en.cards, ...options.cards };
  const reference = { ...LABEL_SETS.en.reference, ...options.reference };
  const canvas = resolveCanvasLocation(options);
  const projectDir = options.projectDir || PROJECT_DIR;

  return (tree, vfile) => {
    const frontMatter = vfile.data.frontMatter;
    if (!frontMatter) return;
    if (!REFERENCE_TYPES.has(frontMatter.canvas_type)) return;

    // Build: <div class="reference-item-card">
    //          <p class="reference-item-label">Quiz</p>
    //          <p class="reference-item-link"><a …>Open in Canvas</a></p>
    //        </div>
    //        <p class="reference-item-notice">This item is managed in Canvas…</p>
    const children = [
      paragraph('reference-item-label', [
        { type: 'text', value: cards[frontMatter.canvas_type] },
      ]),
    ];

    const link = resolveLink(
      frontMatter,
      canvas,
      reference,
      rowForFile(projectDir, vfile),
    );
    if (link) {
      // A JSX <a> rather than an mdast link: these addresses are absolute and
      // external, and Docusaurus's link processing has nothing to add to them.
      children.push(
        paragraph('reference-item-link', [
          {
            type: 'mdxJsxTextElement',
            name: 'a',
            attributes: [
              { type: 'mdxJsxAttribute', name: 'href', value: link.url },
              { type: 'mdxJsxAttribute', name: 'target', value: '_blank' },
              {
                type: 'mdxJsxAttribute',
                name: 'rel',
                value: 'noopener noreferrer',
              },
            ],
            children: [{ type: 'text', value: link.text }],
          },
        ]),
      );
    }

    const card = {
      type: 'mdxJsxFlowElement',
      name: 'div',
      attributes: [
        {
          type: 'mdxJsxAttribute',
          name: 'className',
          value: 'reference-item-card',
        },
      ],
      children,
    };

    const notice = paragraph('reference-item-notice', [
      { type: 'text', value: reference.notice },
    ]);

    // Replace entire document body with the card and its notice
    tree.children.splice(0, tree.children.length, card, notice);
  };
}

/** Test hook: forget the cached Canvas location and item rows per project dir. */
function _clearCache() {
  itemCache.clear();
  locationCache.clear();
}

module.exports = remarkReferenceItem;
module.exports._clearCache = _clearCache;
