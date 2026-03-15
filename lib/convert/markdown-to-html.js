const { Marked } = require('marked');
const markedAlert = require('marked-alert');
const { parseFrontmatter } = require('./frontmatter');

/**
 * Admonition configuration: GFM type -> color, icon filename, Dutch title.
 */
const ADMONITION_CONFIG = {
  note:      { color: '#4bafe1', icon: 'info.svg',      title: 'Info' },
  tip:       { color: '#64c8c8', icon: 'tip.svg',       title: 'Tip' },
  important: { color: '#967dc8', icon: 'important.svg',  title: 'Belangrijk' },
  warning:   { color: '#ffc87d', icon: 'warning.svg',    title: 'Waarschuwing' },
  caution:   { color: '#fa6432', icon: 'caution.svg',    title: 'Opgelet' },
  check:     { color: '#00283c', icon: 'check.svg',      title: 'Check' },
};

/**
 * Convert a markdown string to Canvas-compatible HTML.
 *
 * Frontmatter is automatically stripped before conversion.
 *
 * @param {string} markdownContent - Raw markdown (may include frontmatter).
 * @param {object} [options] - Conversion options.
 * @param {string} [options.baseUrl] - Base URL for rewriting relative image paths.
 * @param {object} [options.iconUrls] - Map of admonition type to Canvas icon preview URL.
 * @param {Function} [options.linkResolver] - Callback `(href) => string|null` to resolve internal links.
 * @returns {string} HTML string suitable for Canvas.
 */
function markdownToHtml(markdownContent, options = {}) {
  // Strip frontmatter so it does not appear in the HTML output
  const { content: rawContent } = parseFrontmatter(markdownContent);

  // Map [!ATTENTION] to [!CAUTION] so marked-alert recognises it
  const content = rawContent.replace(/^(>\s*)\[!ATTENTION\]/gm, '$1[!CAUTION]');

  const marked = new Marked();

  // Keep output simple for Canvas compatibility
  marked.setOptions({
    gfm: true,
    breaks: false,
  });

  // Register GFM alert tokenisation via marked-alert, adding CHECK as a custom variant
  marked.use(markedAlert({
    variants: [
      { type: 'check', icon: '', title: 'Check' },
    ],
  }));

  // Override the alert renderer with Canvas-compatible inline-styled HTML
  const iconUrls = options.iconUrls || {};
  marked.use({
    extensions: [{
      name: 'alert',
      level: 'block',
      renderer({ meta, tokens = [] }) {
        const type = meta.variant;
        const cfg = ADMONITION_CONFIG[type] || ADMONITION_CONFIG.note;

        let imgHtml = '';
        const url = iconUrls[type];
        if (url) {
          imgHtml = `<img style="height: 0.8em; vertical-align: baseline;" src="${url}" alt="${cfg.icon}" /> `;
        }

        let html = `<div class="markdown-alert markdown-alert-${type}" style="border-left: .25em solid ${cfg.color}; padding-left: 1em;">\n`;
        html += `    <p class="markdown-alert-title" style="color: ${cfg.color}; font-size: 1.2em;">${imgHtml}${cfg.title}</p>\n`;
        html += `    ${this.parser.parse(tokens)}`;
        html += `</div>\n<p>&nbsp;</p>\n`;
        return html;
      },
    }],
  });

  // If a linkResolver is provided, rewrite internal markdown links to Canvas URLs
  if (options.linkResolver) {
    marked.use({
      renderer: {
        link({ href, title, tokens }) {
          const resolved = options.linkResolver(href);
          const finalHref = resolved || href;
          const titleAttr = title ? ` title="${title}"` : '';
          const text = this.parser.parseInline(tokens);
          return `<a href="${finalHref}"${titleAttr}>${text}</a>`;
        },
      },
    });
  }

  // If a baseUrl is provided, rewrite relative image src attributes
  if (options.baseUrl) {
    const baseUrl = options.baseUrl.replace(/\/+$/, '');

    marked.use({
      renderer: {
        image({ href, title, text }) {
          // Only rewrite relative paths (not absolute URLs or protocol-relative)
          let src = href;
          if (src && !src.match(/^https?:\/\//) && !src.startsWith('//')) {
            src = `${baseUrl}/${src.replace(/^\.\//, '')}`;
          }
          const titleAttr = title ? ` title="${title}"` : '';
          const alt = text || '';
          return `<img src="${src}" alt="${alt}"${titleAttr}>`;
        },
      },
    });
  }

  const html = marked.parse(content);
  return html;
}

module.exports = {
  markdownToHtml,
  ADMONITION_CONFIG,
};
