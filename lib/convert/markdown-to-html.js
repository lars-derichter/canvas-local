const { Marked } = require('marked');
const { parseFrontmatter } = require('./frontmatter');

/**
 * Convert a markdown string to Canvas-compatible HTML.
 *
 * Frontmatter is automatically stripped before conversion.
 *
 * @param {string} markdownContent - Raw markdown (may include frontmatter).
 * @param {object} [options] - Conversion options.
 * @param {string} [options.baseUrl] - Base URL for rewriting relative image paths.
 * @returns {string} HTML string suitable for Canvas.
 */
function markdownToHtml(markdownContent, options = {}) {
  // Strip frontmatter so it does not appear in the HTML output
  const { content } = parseFrontmatter(markdownContent);

  const marked = new Marked();

  // Keep output simple for Canvas compatibility
  marked.setOptions({
    gfm: true,
    breaks: false,
  });

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
};
