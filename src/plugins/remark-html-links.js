const path = require('path');
const fs = require('fs');
const { getFileLoaderUtils, escapePath } = require('@docusaurus/utils');

const { requireAttributeValue } = require('./require-attribute');

/**
 * Extensions that Docusaurus's built-in `transformLinks` remark plugin refuses
 * to treat as downloadable assets. It assumes `.md`/`.mdx`/`.html` links point
 * at other pages, so a relative link like `[x](../_files/example.html)` is left
 * untouched and ends up broken (no such route). We only want to reclaim the
 * `.html` family — `.md`/`.mdx` really are page references and must stay routes.
 *
 * See node_modules/@docusaurus/mdx-loader/src/remark/transformLinks/index.ts
 * (the `/\.(?:mdx?|html)(?:#|$)/` exclusion).
 */
const HTML_EXTENSIONS = new Set(['.html', '.htm']);

/**
 * Split a link URL into its pathname and the `?query`/`#hash` suffix, so we can
 * inspect the extension without the fragment getting in the way.
 */
function splitUrl(url) {
  const match = /^([^?#]*)([?#].*)?$/.exec(url);
  return { pathname: match[1] || '', suffix: match[2] || '' };
}

/**
 * Collect every `link` node in the tree together with its parent and index, so
 * we can replace them afterwards without mutating the tree mid-walk.
 */
function collectLinks(node, parent, index, out) {
  if (node.type === 'link') out.push({ node, parent, index });
  if (Array.isArray(node.children)) {
    node.children.forEach((child, i) => collectLinks(child, node, i, out));
  }
}

/**
 * Remark plugin that makes relative links to local `.html` files work in the
 * Docusaurus preview. Docusaurus otherwise leaves such links broken (see
 * HTML_EXTENSIONS). We rewrite `[label](../_files/thing.html)` into an
 * `<a href={require(...)}>label</a>` so the file is bundled by webpack.
 *
 * By default the anchor gets `target="_blank"`, so the browser renders the
 * html file in a new tab. A page can opt into forced download instead with
 * `download: true` in its YAML frontmatter: the anchor then gets a
 * `download` attribute and the file is saved under its original name.
 *
 * Only relative links to files that actually exist on disk are touched;
 * external, absolute, `@site/`, anchor-only, and `mailto:` links are ignored,
 * as are non-`.html` extensions (which already work via `transformLinks`).
 */
function remarkHtmlLinks() {
  return (tree, vfile) => {
    if (!vfile.path) return;

    const frontMatter = (vfile.data && vfile.data.frontMatter) || {};
    const forceDownload = frontMatter.download === true;
    const isServer = vfile.data && vfile.data.compilerName === 'server';
    const fileLoader =
      getFileLoaderUtils(isServer).loaders.inlineMarkdownLinkFileLoader;
    const sourceDir = path.dirname(vfile.path);

    const links = [];
    collectLinks(tree, null, null, links);

    for (const { node, parent, index } of links) {
      const url = node.url;
      if (!url || parent == null || index == null) continue;
      // Skip external, protocol-relative, absolute, anchor-only, mailto, @site.
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|\/|#|@site\/)/i.test(url)) continue;

      const { pathname, suffix } = splitUrl(url);
      if (!pathname) continue;
      if (!HTML_EXTENSIONS.has(path.extname(pathname).toLowerCase())) continue;
      // A hash on an .html link means "jump to an anchor in that page" — that's
      // a navigation intent, not a download. Leave it alone.
      if (suffix.startsWith('#')) continue;

      const absPath = path.resolve(sourceDir, decodeURIComponent(pathname));
      if (!fs.existsSync(absPath)) continue;

      const relativeAssetPath = `./${escapePath(path.relative(sourceDir, absPath))}`;
      const requireString = `${fileLoader}${relativeAssetPath}${suffix}`;
      const fileName = path.basename(pathname);

      const attributes = [
        {
          type: 'mdxJsxAttribute',
          name: 'href',
          value: requireAttributeValue(requireString),
        },
        // Assets are required through webpack, not routes — don't flag them.
        {
          type: 'mdxJsxAttribute',
          name: 'data-noBrokenLinkCheck',
          value: 'true',
        },
      ];
      if (forceDownload) {
        // A named download forces the browser to save the file (rather than
        // render the HTML) and preserves the original filename instead of the
        // content-hashed one file-loader emits.
        attributes.push({
          type: 'mdxJsxAttribute',
          name: 'download',
          value: fileName,
        });
      } else {
        attributes.push(
          { type: 'mdxJsxAttribute', name: 'target', value: '_blank' },
          {
            type: 'mdxJsxAttribute',
            name: 'rel',
            value: 'noopener noreferrer',
          },
        );
      }
      if (node.title) {
        attributes.push({
          type: 'mdxJsxAttribute',
          name: 'title',
          value: node.title,
        });
      }

      parent.children[index] = {
        type: 'mdxJsxTextElement',
        name: 'a',
        attributes,
        children: node.children,
      };
    }
  };
}

module.exports = remarkHtmlLinks;
