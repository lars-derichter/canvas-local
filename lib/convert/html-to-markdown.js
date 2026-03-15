const TurndownService = require('turndown');
const { serializeFrontmatter } = require('./frontmatter');

/**
 * Reverse mapping from CSS class variant to GFM alert type.
 * caution -> ATTENTION because this project uses [!ATTENTION] not [!CAUTION].
 */
const ALERT_TYPE_MAP = {
  note: 'NOTE',
  tip: 'TIP',
  important: 'IMPORTANT',
  warning: 'WARNING',
  caution: 'ATTENTION',
  check: 'CHECK',
};

/**
 * Convert an HTML string to markdown using Turndown.
 * @param {string} html - HTML content.
 * @param {object} [options] - Conversion options.
 * @param {Function} [options.linkResolver] - Callback `(href) => string|null` to resolve Canvas internal links back to relative paths.
 * @returns {string} Markdown string.
 */
function htmlToMarkdown(html, options = {}) {
  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  });

  // Convert Canvas internal links back to relative markdown links
  if (options.linkResolver) {
    turndown.addRule('canvasInternalLink', {
      filter(node) {
        if (node.nodeName !== 'A') return false;
        const href = node.getAttribute('href') || '';
        return /\/courses\/\d+\/(pages|assignments)\//.test(href);
      },
      replacement(content, node) {
        const href = node.getAttribute('href') || '';
        const resolved = options.linkResolver(href);
        const finalHref = resolved || href;
        const title = node.getAttribute('title');
        const titlePart = title ? ` "${title}"` : '';
        return `[${content}](${finalHref}${titlePart})`;
      },
    });
  }

  // Strip <p>&nbsp;</p> spacers that follow admonition divs
  turndown.addRule('alertSpacer', {
    filter(node) {
      if (node.nodeName !== 'P') return false;
      const text = node.textContent || '';
      // Match &nbsp; (non-breaking space) or empty
      if (text.trim() !== '' && text !== '\u00a0') return false;
      // Check if previous sibling is an admonition div
      const prev = node.previousElementSibling;
      return prev && prev.nodeName === 'DIV' && (prev.getAttribute('class') || '').includes('markdown-alert');
    },
    replacement() {
      return '';
    },
  });

  // Convert admonition divs back to GFM blockquote alert syntax
  turndown.addRule('gfmAlert', {
    filter(node) {
      return node.nodeName === 'DIV'
        && (node.getAttribute('class') || '').includes('markdown-alert');
    },
    replacement(content, node) {
      // Extract type from class: "markdown-alert markdown-alert-note" -> "note"
      const classes = (node.getAttribute('class') || '').split(/\s+/);
      const typeClass = classes.find(c => c.startsWith('markdown-alert-') && c !== 'markdown-alert');
      const variant = typeClass ? typeClass.replace('markdown-alert-', '') : 'note';
      const gfmType = ALERT_TYPE_MAP[variant] || variant.toUpperCase();

      // Collect body content, skipping the title paragraph
      const bodyParts = [];
      const childNodes = node.childNodes;
      for (let i = 0; i < childNodes.length; i++) {
        const child = childNodes[i];
        if (child.nodeType !== 1) continue; // skip text/comment nodes
        const cls = child.getAttribute('class') || '';
        if (cls.includes('markdown-alert-title')) continue;
        const childMd = turndown.turndown(child.outerHTML).trim();
        if (childMd) {
          bodyParts.push(childMd);
        }
      }

      const body = bodyParts.join('\n\n');
      // Prefix each line with > for blockquote
      const quoted = body.split('\n').map(line => `> ${line}`).join('\n');
      return `> [!${gfmType}]\n>\n${quoted}\n`;
    },
  });

  return turndown.turndown(html || '');
}

/**
 * Convert a Canvas API response object into a full markdown file string with
 * YAML frontmatter.
 *
 * @param {object} canvasItem - A Canvas API response object (page, assignment, etc.).
 * @param {'page'|'assignment'|'external_url'} canvasType - The Canvas item type.
 * @param {object} [options] - Conversion options (forwarded to htmlToMarkdown).
 * @param {Function} [options.linkResolver] - Callback to resolve Canvas internal links.
 * @returns {string} Complete markdown file content with frontmatter.
 */
function canvasItemToMarkdown(canvasItem, canvasType, options = {}) {
  const frontmatter = buildFrontmatter(canvasItem, canvasType);
  const html = getBodyHtml(canvasItem, canvasType);
  const body = html ? htmlToMarkdown(html, options) : '';

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
