const path = require('path');

/**
 * Canvas URL path segment per synced content type. A type missing here has no
 * content URL of its own — `file` items are addressed through the file map, and
 * `external_url` and `external_tool` items exist only as module items — so they
 * keep falling back to the page shape.
 */
const CANVAS_URL_SEGMENTS = {
  page: 'pages',
  assignment: 'assignments',
  discussion: 'discussion_topics',
  quiz: 'quizzes',
};

/**
 * Build the Canvas URL path for a synced item.
 *
 * @param {string|number} courseId - The Canvas course ID.
 * @param {string} canvasType - The item's canvas_type.
 * @param {string|number} canvasId - Numeric ID, or page slug for pages.
 * @returns {string} Canvas URL path, e.g. "/courses/42/discussion_topics/77".
 */
function canvasItemUrl(courseId, canvasType, canvasId) {
  const segment = CANVAS_URL_SEGMENTS[canvasType] || CANVAS_URL_SEGMENTS.page;
  return `/courses/${courseId}/${segment}/${canvasId}`;
}

/**
 * Matches the Canvas URL paths that can resolve back to a course item. Derived
 * from CANVAS_URL_SEGMENTS so a new content type only has to be added there.
 */
const CANVAS_ITEM_URL_PATTERN = new RegExp(
  `/courses/\\d+/(?:${Object.values(CANVAS_URL_SEGMENTS).join('|')})/`,
);

/**
 * Build bidirectional link maps from sync data.
 *
 * @param {object} syncData - The .canvas-sync.json data.
 * @returns {{ relativeToCanvas: Map<string, {canvasType: string, canvasId: string|number}>, canvasToRelative: Map<string, string> }}
 */
function buildLinkMap(syncData) {
  const courseId = syncData.course_id;
  const modules = syncData.modules || {};

  // relativePath -> { canvasType, canvasId }
  const relativeToCanvas = new Map();
  // Canvas URL path -> relativePath
  const canvasToRelative = new Map();

  for (const modData of Object.values(modules)) {
    const items = modData.items || {};
    // The repo-relative path is the key of a sync row, not a field on it.
    for (const [relativePath, itemData] of Object.entries(items)) {
      const { canvas_id, canvas_type, page_url } = itemData;
      if (!canvas_id || !relativePath) continue;

      // For pages, prefer the page_url slug for Canvas URLs, fall back to canvas_id
      // (Canvas accepts both slugs and numeric IDs in page URLs)
      const pageIdentifier =
        canvas_type === 'page' ? page_url || canvas_id : canvas_id;

      relativeToCanvas.set(relativePath, {
        canvasType: canvas_type,
        canvasId: pageIdentifier,
      });

      canvasToRelative.set(
        canvasItemUrl(courseId, canvas_type, pageIdentifier),
        relativePath,
      );
    }
  }

  return { relativeToCanvas, canvasToRelative };
}

/**
 * Resolve a relative markdown link to a Canvas internal URL.
 *
 * @param {string} href - The href from the markdown link.
 * @param {string} currentFilePath - Relative path of the file being processed (e.g. "01-intro/01-welcome.md").
 * @param {Map} linkMap - The relativeToCanvas map.
 * @param {string|number} courseId - The Canvas course ID.
 * @returns {{ resolved: string|null, wasInternal: boolean }} resolved URL or null if unchanged; wasInternal true if this looked like an internal .md link.
 */
function resolveRelativeLink(href, currentFilePath, linkMap, courseId) {
  // Skip external, protocol-relative, fragment-only, and mailto links
  if (!href || /^(https?:\/\/|\/\/|#|mailto:)/.test(href)) {
    return { resolved: null, wasInternal: false };
  }

  // Split off fragment
  const hashIndex = href.indexOf('#');
  const pathPart = hashIndex >= 0 ? href.slice(0, hashIndex) : href;
  const fragment = hashIndex >= 0 ? href.slice(hashIndex) : '';

  // Only resolve links to markdown files
  if (!pathPart.endsWith('.md')) {
    return { resolved: null, wasInternal: false };
  }

  // Resolve relative to the current file's directory
  const currentDir = path.posix.dirname(currentFilePath);
  const resolved = path.posix.normalize(path.posix.join(currentDir, pathPart));

  const entry = linkMap.get(resolved);
  if (!entry) {
    return { resolved: null, wasInternal: true };
  }

  const canvasUrl = canvasItemUrl(courseId, entry.canvasType, entry.canvasId);

  return { resolved: canvasUrl + fragment, wasInternal: false };
}

/**
 * Resolve a Canvas internal URL back to a relative markdown link.
 *
 * @param {string} href - The href from Canvas HTML.
 * @param {string} currentFilePath - Relative path of the file being written.
 * @param {Map} reverseMap - The canvasToRelative map.
 * @returns {string|null} Relative markdown path or null if not an internal link.
 */
function resolveCanvasLink(href, currentFilePath, reverseMap) {
  if (!href) return null;

  // Strip the domain if present (Canvas may use absolute URLs)
  let urlPath = href;
  let fragment = '';
  try {
    const url = new URL(href, 'https://placeholder.com');
    urlPath = url.pathname;
    fragment = url.hash || '';
  } catch {
    // href might already be a path — split fragment manually
    const hashIndex = urlPath.indexOf('#');
    if (hashIndex >= 0) {
      fragment = urlPath.slice(hashIndex);
      urlPath = urlPath.slice(0, hashIndex);
    }
  }

  const pathPart = urlPath;

  // Only process Canvas internal links
  if (!CANVAS_ITEM_URL_PATTERN.test(pathPart)) {
    return null;
  }

  const targetRelativePath = reverseMap.get(pathPart);
  if (!targetRelativePath) return null;

  // Compute relative path from current file to target
  const currentDir = path.posix.dirname(currentFilePath);
  let relative = path.posix.relative(currentDir, targetRelativePath);

  // Ensure the path starts with ./ for same-directory or child references
  if (!relative.startsWith('.') && !relative.startsWith('/')) {
    relative = './' + relative;
  }

  return relative + fragment;
}

/**
 * Blank out the contents of markdown code regions so link-detection regexes
 * can't match example syntax (e.g. `[text](url)`) inside them. Both fenced code
 * blocks and inline code spans are masked. Characters are replaced with spaces
 * so the string length and line structure are preserved.
 *
 * @param {string} markdown - Raw markdown content.
 * @returns {string} Markdown with code-region contents replaced by spaces.
 */
function maskCodeRegions(markdown) {
  let inFence = false;
  let fenceMarker = '';

  return markdown
    .split('\n')
    .map((line) => {
      const fence = line.match(/^\s*(`{3,}|~{3,})/);

      if (inFence) {
        // Closing fence must use the same character, at least as long.
        if (
          fence &&
          fence[1][0] === fenceMarker[0] &&
          fence[1].length >= fenceMarker.length
        ) {
          inFence = false;
          fenceMarker = '';
        }
        return ' '.repeat(line.length);
      }

      if (fence) {
        inFence = true;
        fenceMarker = fence[1];
        return ' '.repeat(line.length);
      }

      // Mask inline code spans: a run of N backticks closed by a run of N.
      return line.replace(/(`+)(?:.+?)\1/g, (span) => ' '.repeat(span.length));
    })
    .join('\n');
}

/**
 * Scan markdown content for relative file references (images and non-.md links).
 *
 * @param {string} markdownContent - Raw markdown content.
 * @param {string} currentFilePath - Relative path of the file being processed (e.g. "01-intro/01-welcome.md").
 * @returns {string[]} Array of resolved relative paths (from course/) for referenced files.
 */
function extractFileReferences(markdownContent, currentFilePath) {
  const currentDir = path.posix.dirname(currentFilePath);
  const refs = new Set();

  // Ignore links/images that only appear inside code blocks or inline code —
  // those are documentation examples, not real references.
  const scannable = maskCodeRegions(markdownContent);

  // Match ![alt](href) and [text](href) — captures the href part
  const linkPattern = /!?\[(?:[^\]]*)\]\(([^)]+)\)/g;
  let match;
  while ((match = linkPattern.exec(scannable)) !== null) {
    const href = match[1].split(/\s+/)[0]; // Strip title part if present

    // Skip external, protocol-relative, fragment-only, mailto, and .md links
    if (!href || /^(https?:\/\/|\/\/|#|mailto:)/.test(href)) continue;

    const hashIndex = href.indexOf('#');
    const pathPart = hashIndex >= 0 ? href.slice(0, hashIndex) : href;
    if (!pathPart || pathPart.endsWith('.md')) continue;

    const resolved = path.posix.normalize(
      path.posix.join(currentDir, pathPart),
    );
    refs.add(resolved);
  }

  return [...refs];
}

/**
 * Build bidirectional file maps from sync data.
 *
 * @param {object} syncData - The .canvas-sync.json data.
 * @returns {{ localToCanvas: Map<string, {canvas_file_id: number, canvas_url: string}>, canvasToLocal: Map<string, string> }}
 */
function buildFileMap(syncData) {
  const files = syncData.files || {};
  const localToCanvas = new Map();
  const canvasToLocal = new Map();

  for (const [localPath, data] of Object.entries(files)) {
    localToCanvas.set(localPath, data);
    if (data.canvas_url) {
      canvasToLocal.set(data.canvas_url, localPath);
    }
  }

  return { localToCanvas, canvasToLocal };
}

module.exports = {
  CANVAS_URL_SEGMENTS,
  CANVAS_ITEM_URL_PATTERN,
  canvasItemUrl,
  buildLinkMap,
  resolveRelativeLink,
  resolveCanvasLink,
  extractFileReferences,
  maskCodeRegions,
  buildFileMap,
};
