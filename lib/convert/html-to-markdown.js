const TurndownService = require('turndown');
const { tables } = require('@joplin/turndown-plugin-gfm');
const { serializeFrontmatter } = require('./frontmatter');
const { CANVAS_ITEM_URL_PATTERN } = require('./link-resolver');

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
 * @param {Function} [options.fileResolver] - Callback `(href) => string|null` to resolve Canvas file URLs back to relative paths.
 * @returns {string} Markdown string.
 */
function htmlToMarkdown(html, options = {}) {
  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  });

  // GFM pipe tables (handles headerless Canvas RCE tables too)
  turndown.use(tables);

  // Convert Canvas internal links back to relative markdown links
  if (options.linkResolver) {
    turndown.addRule('canvasInternalLink', {
      filter(node) {
        if (node.nodeName !== 'A') return false;
        const href = node.getAttribute('href') || '';
        return CANVAS_ITEM_URL_PATTERN.test(href);
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

  // Convert Canvas file URLs in images back to relative paths
  if (options.fileResolver) {
    turndown.addRule('canvasFileImage', {
      filter(node) {
        if (node.nodeName !== 'IMG') return false;
        const src = node.getAttribute('src') || '';
        return /\/courses\/\d+\/files\/\d+/.test(src);
      },
      replacement(content, node) {
        const src = node.getAttribute('src') || '';
        const resolved = options.fileResolver(src);
        const alt = node.getAttribute('alt') || '';
        const title = node.getAttribute('title');
        const titlePart = title ? ` "${title}"` : '';
        return `![${alt}](${resolved || src}${titlePart})`;
      },
    });

    turndown.addRule('canvasFileLink', {
      filter(node) {
        if (node.nodeName !== 'A') return false;
        const href = node.getAttribute('href') || '';
        // Match Canvas file URLs but not page/assignment/discussion URLs
        return (
          /\/courses\/\d+\/files\/\d+/.test(href) &&
          !CANVAS_ITEM_URL_PATTERN.test(href)
        );
      },
      replacement(content, node) {
        const href = node.getAttribute('href') || '';
        const resolved = options.fileResolver(href);
        const title = node.getAttribute('title');
        const titlePart = title ? ` "${title}"` : '';
        return `[${content}](${resolved || href}${titlePart})`;
      },
    });
  }

  // Strip <p>&nbsp;</p> spacers that follow alert divs
  turndown.addRule('alertSpacer', {
    filter(node) {
      if (node.nodeName !== 'P') return false;
      const text = node.textContent || '';
      // Match &nbsp; (non-breaking space) or empty
      if (text.trim() !== '' && text !== '\u00a0') return false;
      // Check if previous sibling is an alert div
      const prev = node.previousElementSibling;
      return (
        prev &&
        prev.nodeName === 'DIV' &&
        (prev.getAttribute('class') || '').includes('markdown-alert')
      );
    },
    replacement() {
      return '';
    },
  });

  // Convert alert divs back to GFM blockquote alert syntax
  turndown.addRule('gfmAlert', {
    filter(node) {
      return (
        node.nodeName === 'DIV' &&
        (node.getAttribute('class') || '').includes('markdown-alert')
      );
    },
    replacement(content, node) {
      // Extract type from class: "markdown-alert markdown-alert-note" -> "note"
      const classes = (node.getAttribute('class') || '').split(/\s+/);
      const typeClass = classes.find(
        (c) => c.startsWith('markdown-alert-') && c !== 'markdown-alert',
      );
      const variant = typeClass
        ? typeClass.replace('markdown-alert-', '')
        : 'note';
      const gfmType = ALERT_TYPE_MAP[variant] || variant.toUpperCase();

      // Collect body content, skipping the title paragraph
      const bodyParts = [];
      const childNodes = node.childNodes;
      for (let i = 0; i < childNodes.length; i++) {
        const child = childNodes[i];
        // Handle text nodes directly
        if (child.nodeType === 3) {
          const text = child.textContent.trim();
          if (text) bodyParts.push(text);
          continue;
        }
        if (child.nodeType !== 1) continue; // skip comment nodes
        const cls = child.getAttribute('class') || '';
        if (cls.includes('markdown-alert-title')) continue;
        const childMd = turndown.turndown(child.outerHTML).trim();
        if (childMd) {
          bodyParts.push(childMd);
        }
      }

      const body = bodyParts.join('\n\n');
      // Prefix each line with > for blockquote
      const quoted = body
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n');
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
 * @param {'page'|'assignment'|'discussion'|'quiz'|'external_url'|'external_tool'} canvasType - The Canvas item type.
 * @param {object} [options] - Conversion options (forwarded to htmlToMarkdown).
 * @param {Function} [options.linkResolver] - Callback to resolve Canvas internal links.
 * @param {Function} [options.fileResolver] - Callback to resolve Canvas file URLs.
 * @param {object} [options.existingFrontmatter] - Frontmatter of the local file
 *   being overwritten. Keys Canvas owns are taken from the Canvas item; every
 *   other key is carried over, so local-only fields such as `export` or
 *   `lesson` survive a pull.
 * @returns {string} Complete markdown file content with frontmatter.
 */
function canvasItemToMarkdown(canvasItem, canvasType, options = {}) {
  const frontmatter = buildFrontmatter(
    canvasItem,
    canvasType,
    options.existingFrontmatter,
  );
  const html = getBodyHtml(canvasItem, canvasType);
  const body = html ? htmlToMarkdown(html, options) : '';

  return serializeFrontmatter(frontmatter, body);
}

/**
 * Frontmatter keys Canvas is authoritative for, per type. A key listed here is
 * always taken from the Canvas item — including when Canvas has no value for
 * it, so clearing a due date in Canvas clears it locally too. Anything not
 * listed belongs to the author and is preserved verbatim.
 *
 * `canvas_id` is listed and never given a value, which is how the key gets
 * cleared: it is owned, so it is not carried over from the local file, and
 * nothing below writes one back. Which Canvas object a file is belongs to
 * `.canvas-sync.json`, keyed by the file's path, and an id an older version
 * left in the frontmatter is exactly the second answer this schema exists to
 * end — leaving it in place would let it drift from the row for good.
 * `canvas_type` stays and keeps its value: that one is the author's declaration
 * of what the file should become, which Canvas confirms rather than decides.
 */
const CANVAS_OWNED_KEYS = {
  common: ['title', 'canvas_type', 'canvas_id'],
  page: [],
  assignment: [
    'points_possible',
    'submission_types',
    'due_at',
    'lock_at',
    'unlock_at',
    'published',
  ],
  discussion: [
    'discussion_type',
    'require_initial_post',
    'published',
    'delayed_post_at',
    'lock_at',
  ],
  // Canvas owns nothing on a quiz beyond the common keys. `quiz_ref` names the
  // QTI package the quiz was imported from, which Canvas has never heard of, so
  // it has to survive every pull.
  quiz: [],
  external_url: ['external_url'],
  external_tool: ['external_url', 'new_tab'],
};

/**
 * Build frontmatter data from a Canvas API item based on its type.
 *
 * @param {object} item - Canvas API response object.
 * @param {'page'|'assignment'|'discussion'|'quiz'|'external_url'|'external_tool'} canvasType
 * @param {object} [existingFrontmatter] - Local frontmatter to carry forward.
 */
function buildFrontmatter(item, canvasType, existingFrontmatter) {
  const data = {
    title: item.title || item.name || '',
    canvas_type: canvasType,
  };

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

  if (canvasType === 'discussion') {
    if (item.discussion_type) {
      data.discussion_type = item.discussion_type;
    }
    if (item.require_initial_post != null) {
      data.require_initial_post = item.require_initial_post;
    }
    if (item.published != null) {
      data.published = item.published;
    }
    if (item.delayed_post_at) {
      data.delayed_post_at = item.delayed_post_at;
    }
    if (item.lock_at) {
      data.lock_at = item.lock_at;
    }
  }

  if (canvasType === 'external_url') {
    if (item.external_url) {
      data.external_url = item.external_url;
    }
  }

  // The launch URL is the whole identity of an LTI link: Canvas resolves which
  // tool answers it from the URL, so this is what has to come back down.
  if (canvasType === 'external_tool') {
    if (item.external_url) {
      data.external_url = item.external_url;
    }
    if (item.new_tab != null) {
      data.new_tab = item.new_tab;
    }
  }

  // Carry over the author's own keys. Canvas-owned keys are skipped so a value
  // Canvas no longer has does not linger locally.
  if (existingFrontmatter) {
    const owned = new Set([
      ...CANVAS_OWNED_KEYS.common,
      ...(CANVAS_OWNED_KEYS[canvasType] || []),
    ]);
    for (const [key, value] of Object.entries(existingFrontmatter)) {
      if (owned.has(key)) continue;
      data[key] = value;
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
  if (canvasType === 'discussion') {
    return item.message || '';
  }
  // A quiz has no body of its own either: what a reader would call its content
  // is a list of questions that lives in Canvas and in the QTI package, and is
  // not markdown this project can hold. external_url and external_tool items
  // are links, with nothing behind them at all.
  return '';
}

module.exports = {
  htmlToMarkdown,
  canvasItemToMarkdown,
};
