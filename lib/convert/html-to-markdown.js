const TurndownService = require('turndown');
const { serializeFrontmatter } = require('./frontmatter');

/**
 * Convert an HTML string to markdown using Turndown.
 * @param {string} html - HTML content.
 * @returns {string} Markdown string.
 */
function htmlToMarkdown(html) {
  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  });

  return turndown.turndown(html || '');
}

/**
 * Convert a Canvas API response object into a full markdown file string with
 * YAML frontmatter.
 *
 * @param {object} canvasItem - A Canvas API response object (page, assignment, etc.).
 * @param {'page'|'assignment'|'external_url'} canvasType - The Canvas item type.
 * @returns {string} Complete markdown file content with frontmatter.
 */
function canvasItemToMarkdown(canvasItem, canvasType) {
  const frontmatter = buildFrontmatter(canvasItem, canvasType);
  const html = getBodyHtml(canvasItem, canvasType);
  const body = html ? htmlToMarkdown(html) : '';

  return serializeFrontmatter(frontmatter, body);
}

/**
 * Build frontmatter data from a Canvas API item based on its type.
 */
function buildFrontmatter(item, canvasType) {
  const data = {
    title: item.title || item.name || '',
    canvas_type: canvasType,
  };

  // Assign the Canvas ID depending on the type
  if (canvasType === 'page') {
    data.canvas_id = item.page_id || item.url || null;
  } else if (canvasType === 'assignment') {
    data.canvas_id = item.id || null;
  } else if (canvasType === 'external_url') {
    data.canvas_id = item.id || null;
  }

  // Type-specific fields
  if (canvasType === 'assignment') {
    if (item.points_possible != null) {
      data.points_possible = item.points_possible;
    }
    if (item.submission_types) {
      data.submission_types = item.submission_types;
    }
    if (item.due_at) {
      data.due_at = item.due_at;
    }
    if (item.lock_at) {
      data.lock_at = item.lock_at;
    }
    if (item.unlock_at) {
      data.unlock_at = item.unlock_at;
    }
    if (item.published != null) {
      data.published = item.published;
    }
  }

  if (canvasType === 'external_url') {
    if (item.external_url) {
      data.external_url = item.external_url;
    }
  }

  return data;
}

/**
 * Extract the HTML body from a Canvas API item based on its type.
 */
function getBodyHtml(item, canvasType) {
  if (canvasType === 'page') {
    return item.body || '';
  }
  if (canvasType === 'assignment') {
    return item.description || '';
  }
  // external_url items typically have no HTML body
  return '';
}

module.exports = {
  htmlToMarkdown,
  canvasItemToMarkdown,
};
