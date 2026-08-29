const fs = require('fs');
const path = require('path');

const { getFileLoaderUtils, escapePath } = require('@docusaurus/utils');

const { LABEL_SETS } = require('../../lib/config/labels');
const { mediaKind } = require('../../lib/convert/media-types');
const { requireAttributeValue } = require('./require-attribute');

/**
 * Remark plugin that replaces the content of file item pages with a
 * styled file card. File items are markdown wrappers around binary files
 * (PDF, SVG, etc.) pulled from Canvas. This plugin intercepts them and
 * shows a download link instead of an empty page. When the file is an
 * image, video or audio file, the media itself is embedded above the
 * card, so the page shows the content and not just a link to it.
 *
 * @param {{ siteDir?: string, label?: string }} [options] - `siteDir` (the
 *   Docusaurus site root) lets the link be emitted as a `@site/...` alias so
 *   Docusaurus's transformLinks plugin bundles the asset regardless of its
 *   extension. Pass `__dirname` from docusaurus.config.js. `label` overrides
 *   the card label (defaults to English; docusaurus.config.js passes the
 *   course language's `labels.cards.file`).
 */
function remarkFileItem(options = {}) {
  const { siteDir } = options;
  const labelText = options.label || LABEL_SETS.en.cards.file;

  return (tree, vfile) => {
    const frontMatter = vfile.data.frontMatter;
    if (!frontMatter) return;
    if (frontMatter.canvas_type !== 'file') return;
    if (!frontMatter.file_ref) return;

    const fileRef = frontMatter.file_ref;
    const fileName = fileRef.split('/').pop();

    // Emit a `@site/`-aliased URL when we know the site root. Docusaurus's
    // transformLinks plugin treats any `@site/` link as an asset to require()
    // through webpack — bypassing its extension heuristic, which otherwise
    // skips (and breaks) links to .html, .md, or extension-less files. The
    // bare relative fileRef is a fallback for when siteDir isn't configured
    // (e.g. unit tests); transformLinks resolves it relative to this .md file.
    let url = fileRef;
    let absPath = null;
    if (vfile.path) {
      absPath = path.resolve(path.dirname(vfile.path), fileRef);
      if (siteDir) {
        url =
          '@site/' + path.relative(siteDir, absPath).split(path.sep).join('/');
      }
    }

    const embed = buildEmbed(fileRef, fileName, url, absPath, vfile);

    // Build: <div class="file-item-card">
    //          <p class="file-item-label">File</p>
    //          <p class="file-item-link">[fileName](url)</p>
    //        </div>
    const linkNode = buildCardLink(fileRef, fileName, url, absPath, vfile);

    const label = {
      type: 'mdxJsxFlowElement',
      name: 'p',
      attributes: [
        {
          type: 'mdxJsxAttribute',
          name: 'className',
          value: 'file-item-label',
        },
      ],
      children: [{ type: 'text', value: labelText }],
    };

    const linkParagraph = {
      type: 'mdxJsxFlowElement',
      name: 'p',
      attributes: [
        { type: 'mdxJsxAttribute', name: 'className', value: 'file-item-link' },
      ],
      children: [linkNode],
    };

    const card = {
      type: 'mdxJsxFlowElement',
      name: 'div',
      attributes: [
        { type: 'mdxJsxAttribute', name: 'className', value: 'file-item-card' },
      ],
      children: [label, linkParagraph],
    };

    // Replace entire document body with the embed (if any) and the card
    const replacement = embed ? [embed, card] : [card];
    tree.children.splice(0, tree.children.length, ...replacement);
  };
}

/**
 * Extensions the docs plugin's markdown-link resolver claims for itself. It
 * reads any link URL ending in `.md`/`.mdx` as a reference to another doc,
 * `@site/`-aliased ones included, so a card link to a markdown binary never
 * matches a page and warns once per compile ("couldn't be resolved"), or
 * fails the build under `onBrokenMarkdownLinks: 'throw'`.
 */
const MARKDOWN_EXTENSIONS = new Set(['.md', '.mdx']);

/**
 * Build the JSX attribute value for a webpack `require()` of the referenced
 * binary, the construction Docusaurus's own mdx-loader uses for asset hrefs.
 * Shared by the media embed's `src` and the card link's `href`.
 */
function assetRequireValue(fileRef, absPath, vfile) {
  const isServer = vfile.data && vfile.data.compilerName === 'server';
  const fileLoader =
    getFileLoaderUtils(isServer).loaders.inlineMarkdownLinkFileLoader;
  const relativeAssetPath = absPath
    ? `./${escapePath(path.relative(path.dirname(vfile.path), absPath))}`
    : `./${escapePath(fileRef)}`;
  return requireAttributeValue(`${fileLoader}${relativeAssetPath}`);
}

/**
 * Build the card's download link. Normally a plain mdast link node (not a JSX
 * `<a>`) so Docusaurus's transformLinks plugin rewrites it into a webpack asset
 * require() and adds target="_blank" itself.
 *
 * A markdown binary, say a study pack from `npx course export -f md`, cannot
 * take that route, because the docs plugin's link resolver treats the URL as a
 * page reference (see MARKDOWN_EXTENSIONS). For those we emit the anchor
 * ourselves, the way remark-html-links does for `.html` targets: an
 * `<a href={require(...)}>` the resolver never inspects, marked with
 * `data-noBrokenLinkCheck` so the broken-link checker skips it too. That needs
 * the wrapper's path to resolve the require() against, so a vfile without one
 * (unit tests) falls back to the plain link.
 */
function buildCardLink(fileRef, fileName, url, absPath, vfile) {
  const isMarkdown = MARKDOWN_EXTENSIONS.has(
    path.extname(fileName).toLowerCase(),
  );
  if (!isMarkdown || !vfile.path) {
    return {
      type: 'link',
      url,
      children: [{ type: 'text', value: fileName }],
    };
  }

  return {
    type: 'mdxJsxTextElement',
    name: 'a',
    attributes: [
      {
        type: 'mdxJsxAttribute',
        name: 'href',
        value: assetRequireValue(fileRef, absPath, vfile),
      },
      {
        type: 'mdxJsxAttribute',
        name: 'data-noBrokenLinkCheck',
        value: 'true',
      },
      { type: 'mdxJsxAttribute', name: 'target', value: '_blank' },
      { type: 'mdxJsxAttribute', name: 'rel', value: 'noopener noreferrer' },
    ],
    children: [{ type: 'text', value: fileName }],
  };
}

/**
 * Build the media embed for an image, video or audio file item: a
 * `div.file-item-embed` wrapping the media element, or null when the file is
 * not embeddable media. An image becomes a plain mdast image node with the
 * same URL the card link uses, so Docusaurus's transformImage plugin bundles
 * it. Video and audio have no mdast node type, so they become a JSX
 * `<video controls>` / `<audio controls>` whose src is a webpack require()
 * expression, the same construction remark-html-links uses for hrefs.
 *
 * When the wrapper's path is known and the binary is missing on disk, no
 * embed is emitted: transformImage fails the build on a missing asset, while
 * the card link merely warns — the card alone keeps that failure mode.
 */
function buildEmbed(fileRef, fileName, url, absPath, vfile) {
  const kind = mediaKind(fileName);
  if (!kind) return null;
  if (absPath && !fs.existsSync(absPath)) return null;

  let media;
  if (kind === 'image') {
    media = {
      type: 'paragraph',
      children: [
        {
          type: 'image',
          url,
          alt: vfile.data.frontMatter.title || fileName,
        },
      ],
    };
  } else {
    media = {
      type: 'mdxJsxFlowElement',
      name: kind,
      attributes: [
        { type: 'mdxJsxAttribute', name: 'controls', value: null },
        { type: 'mdxJsxAttribute', name: 'preload', value: 'metadata' },
        {
          type: 'mdxJsxAttribute',
          name: 'src',
          value: assetRequireValue(fileRef, absPath, vfile),
        },
      ],
      children: [],
    };
  }

  return {
    type: 'mdxJsxFlowElement',
    name: 'div',
    attributes: [
      { type: 'mdxJsxAttribute', name: 'className', value: 'file-item-embed' },
    ],
    children: [media],
  };
}

module.exports = remarkFileItem;
