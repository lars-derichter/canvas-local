const path = require('path');

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
    for (const [relativePath, itemData] of Object.entries(items)) {
      const { canvas_id, canvas_type, page_url } = itemData;
      if (!canvas_id) continue;

      // For pages, prefer the page_url slug for Canvas URLs, fall back to canvas_id
      // (Canvas accepts both slugs and numeric IDs in page URLs)
      const pageIdentifier = canvas_type === 'page' ? (page_url || canvas_id) : canvas_id;

      relativeToCanvas.set(relativePath, {
        canvasType: canvas_type,
        canvasId: pageIdentifier,
      });

      const canvasUrlPath = canvas_type === 'assignment'
        ? `/courses/${courseId}/assignments/${canvas_id}`
        : `/courses/${courseId}/pages/${pageIdentifier}`;

      canvasToRelative.set(canvasUrlPath, relativePath);
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

  const canvasUrl = entry.canvasType === 'assignment'
    ? `/courses/${courseId}/assignments/${entry.canvasId}${fragment}`
    : `/courses/${courseId}/pages/${entry.canvasId}${fragment}`;

  return { resolved: canvasUrl, wasInternal: false };
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
  if (!/\/courses\/\d+\/(pages|assignments)\//.test(pathPart)) {
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
 * Scan markdown content for relative file references (images and non-.md links).
 *
 * @param {string} markdownContent - Raw markdown content.
 * @param {string} currentFilePath - Relative path of the file being processed (e.g. "01-intro/01-welcome.md").
 * @returns {string[]} Array of resolved relative paths (from course/) for referenced files.
 */
function extractFileReferences(markdownContent, currentFilePath) {
  const currentDir = path.posix.dirname(currentFilePath);
  const refs = new Set();

  // Match ![alt](href) and [text](href) — captures the href part
  const linkPattern = /!?\[(?:[^\]]*)\]\(([^)]+)\)/g;
  let match;
  while ((match = linkPattern.exec(markdownContent)) !== null) {
    const href = match[1].split(/\s+/)[0]; // Strip title part if present

    // Skip external, protocol-relative, fragment-only, mailto, and .md links
    if (!href || /^(https?:\/\/|\/\/|#|mailto:)/.test(href)) continue;

    const hashIndex = href.indexOf('#');
    const pathPart = hashIndex >= 0 ? href.slice(0, hashIndex) : href;
    if (!pathPart || pathPart.endsWith('.md')) continue;

    const resolved = path.posix.normalize(path.posix.join(currentDir, pathPart));
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
  buildLinkMap,
  resolveRelativeLink,
  resolveCanvasLink,
  extractFileReferences,
  buildFileMap,
};
