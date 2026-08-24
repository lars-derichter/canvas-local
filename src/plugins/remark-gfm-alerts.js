/**
 * Custom remark plugin that transforms GFM blockquote alerts (> [!NOTE], etc.)
 * into styled HTML divs for Docusaurus rendering.
 *
 * Produces <div class="markdown-alert markdown-alert-{type}">, matching the
 * Canvas HTML output styling via CSS classes. Titles default to English and
 * follow the course language when docusaurus.config.js passes
 * `{ titles: labels.alerts }` from lib/config/course-config.js.
 */
const path = require('path');

const { LABEL_SETS } = require('../../lib/config/labels');
const { ALERT_KINDS, loadTheme } = require('../../lib/config/theme');
const {
  ALERT_KIND_MAP,
  readIconSvg,
} = require('../../lib/convert/alert-icons');

/** This plugin runs inside the Docusaurus build, where the CLI's project
 *  root detection does not apply — resolve it from this file instead. */
const PROJECT_DIR = path.resolve(__dirname, '../..');

/**
 * Simple tree walker for mdast nodes of a given type.
 * Visits nodes depth-first, calling visitor(node, index, parent).
 */
function visit(tree, type, visitor) {
  function walk(node) {
    if (!node.children) return;
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      if (child.type === type) {
        const result = visitor(child, i, node);
        // If the visitor returns a number, continue from that index
        if (typeof result === 'number') {
          i = result - 1; // -1 because the loop will increment
          continue;
        }
      }
      walk(child);
    }
  }
  walk(tree);
}

/**
 * The alert markers, as they are written in markdown, mapped to the CSS variant
 * each renders as. Derived from ALERT_KIND_MAP in lib/convert/alert-icons.js so
 * the preview site and the PDF export recognise exactly the same set, aliases
 * (`ATTENTION` for `CAUTION`) included.
 */
const ALERT_TYPES = Object.fromEntries(
  Object.entries(ALERT_KIND_MAP).map(([marker, cssType]) => [
    marker.toUpperCase(),
    { cssType },
  ]),
);

const ALERT_PATTERN = new RegExp(
  `^\\[!(${Object.keys(ALERT_TYPES).join('|')})\\]\\s*\\n?`,
);

/**
 * SVG icons per type as data URIs for MDX-compatible img elements.
 *
 * Read from src/svg-icons/ and painted in the active theme's colour for each
 * kind, so the site, Canvas and PDF exports all use one set of files and one
 * source of colour.
 */
function svgToDataUri(svg) {
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

const ICON_DATA_URIS = Object.fromEntries(
  ALERT_KINDS.map((kind) => [
    kind,
    svgToDataUri(readIconSvg(kind, loadTheme(PROJECT_DIR).alerts[kind].fg)),
  ]),
);

/**
 * @param {{ titles?: object }} [options] - `titles` maps alert cssType to the
 *   displayed title, merged over the built-in English titles.
 */
function remarkGfmAlerts(options = {}) {
  const titles = { ...LABEL_SETS.en.alerts, ...options.titles };

  return (tree) => {
    visit(tree, 'blockquote', (node, index, parent) => {
      // Extract the raw text from the first child to check for alert pattern
      const firstChild = node.children && node.children[0];
      if (!firstChild) return;

      let firstText = '';
      if (firstChild.type === 'paragraph' && firstChild.children) {
        const textNode = firstChild.children[0];
        if (textNode && textNode.type === 'text') {
          firstText = textNode.value;
        }
      }

      const match = firstText.match(ALERT_PATTERN);
      if (!match) return;

      const alertKey = match[1];
      const alertDef = ALERT_TYPES[alertKey];
      if (!alertDef) return;

      const { cssType } = alertDef;
      const title = titles[cssType];
      const iconDataUri = ICON_DATA_URIS[cssType];

      // Remove the [!TYPE] marker from the first text node
      const textNode = firstChild.children[0];
      textNode.value = textNode.value.replace(ALERT_PATTERN, '');

      // If the text node is now empty, remove it
      if (!textNode.value) {
        firstChild.children.shift();
        // Also remove a leading line break if present
        if (firstChild.children[0] && firstChild.children[0].type === 'break') {
          firstChild.children.shift();
        }
      }

      // If the first paragraph is now empty, remove it entirely
      if (firstChild.children && firstChild.children.length === 0) {
        node.children.shift();
      }

      // Build the icon as an MDX-compatible img element
      const iconImg = {
        type: 'mdxJsxTextElement',
        name: 'img',
        attributes: [
          { type: 'mdxJsxAttribute', name: 'src', value: iconDataUri },
          { type: 'mdxJsxAttribute', name: 'alt', value: '' },
          {
            type: 'mdxJsxAttribute',
            name: 'className',
            value: 'markdown-alert-icon',
          },
          { type: 'mdxJsxAttribute', name: 'width', value: '16' },
          { type: 'mdxJsxAttribute', name: 'height', value: '16' },
        ],
        children: [],
      };

      // Build the title as an MDX paragraph element
      const titleParagraph = {
        type: 'mdxJsxFlowElement',
        name: 'p',
        attributes: [
          {
            type: 'mdxJsxAttribute',
            name: 'className',
            value: 'markdown-alert-title',
          },
        ],
        children: [iconImg, { type: 'text', value: ` ${title}` }],
      };

      // Build the replacement wrapper div as an mdxJsxFlowElement
      const wrapperDiv = {
        type: 'mdxJsxFlowElement',
        name: 'div',
        attributes: [
          {
            type: 'mdxJsxAttribute',
            name: 'className',
            value: `markdown-alert markdown-alert-${cssType}`,
          },
        ],
        children: [titleParagraph, ...node.children],
      };

      // Replace the blockquote with the wrapper div
      parent.children.splice(index, 1, wrapperDiv);

      // Return the index to revisit since we changed the tree
      return index;
    });
  };
}

module.exports = remarkGfmAlerts;
