const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const remarkFileItem = require('../../src/plugins/remark-file-item');

// The media embed only checks the disk when the wrapper's path is known, so
// media tests run against a real temporary fixture: a wrapper.md next to a
// _files/ folder holding one binary per media kind.
let fixtureDir;
let wrapperPath;

before(() => {
  fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-item-'));
  fs.mkdirSync(path.join(fixtureDir, '_files'));
  fs.writeFileSync(path.join(fixtureDir, '_files', 'pic.png'), 'png');
  fs.writeFileSync(path.join(fixtureDir, '_files', 'clip.mp4'), 'mp4');
  fs.writeFileSync(path.join(fixtureDir, '_files', 'track.mp3'), 'mp3');
  wrapperPath = path.join(fixtureDir, '03-wrapper.md');
});

after(() => {
  fs.rmSync(fixtureDir, { recursive: true, force: true });
});

/**
 * Helper: build a root tree with optional children.
 */
function makeTree(children = []) {
  return { type: 'root', children };
}

/**
 * Helper: build a minimal vfile with frontMatter data.
 */
function makeVfile(frontMatter) {
  return { data: { frontMatter } };
}

/**
 * Helper: run the plugin transform on a tree with given frontmatter.
 */
function transform(tree, frontMatter, options) {
  const plugin = remarkFileItem(options);
  plugin(tree, makeVfile(frontMatter));
  return tree;
}

/**
 * Helper: run the plugin with the fixture wrapper as the source file, so the
 * media embed's existence check runs against the real _files/ fixture.
 */
function transformAt(tree, frontMatter, options) {
  const plugin = remarkFileItem(options);
  plugin(tree, { path: wrapperPath, data: { frontMatter } });
  return tree;
}

/** Find an attribute by name on a JSX element node. */
function attr(node, name) {
  return node.attributes.find((a) => a.name === name);
}

describe('remarkFileItem', () => {
  it('replaces document body with a file card for file items', () => {
    const tree = makeTree([
      {
        type: 'paragraph',
        children: [{ type: 'text', value: 'Some body text.' }],
      },
    ]);
    transform(tree, {
      canvas_type: 'file',
      file_ref: '_files/report.pdf',
    });

    assert.equal(tree.children.length, 1);
    const card = tree.children[0];
    assert.equal(card.type, 'mdxJsxFlowElement');
    assert.equal(card.name, 'div');
    assert.equal(attr(card, 'className').value, 'file-item-card');
  });

  it('renders the label as "File" by default', () => {
    const tree = makeTree([]);
    transform(tree, {
      canvas_type: 'file',
      file_ref: '_files/report.pdf',
    });

    const label = tree.children[0].children[0];
    assert.equal(label.type, 'mdxJsxFlowElement');
    assert.equal(label.name, 'p');
    assert.equal(attr(label, 'className').value, 'file-item-label');
    assert.equal(label.children[0].value, 'File');
  });

  it('renders options.label when provided', () => {
    const tree = makeTree([]);
    transform(
      tree,
      { canvas_type: 'file', file_ref: '_files/report.pdf' },
      { label: 'Bestand' },
    );

    assert.equal(tree.children[0].children[0].children[0].value, 'Bestand');
  });

  it('renders an mdast link node with file_ref as url and filename as text', () => {
    const fileRef = '_files/annual-report.pdf';
    const tree = makeTree([]);
    transform(tree, {
      canvas_type: 'file',
      file_ref: fileRef,
    });

    const linkP = tree.children[0].children[1];
    assert.equal(linkP.type, 'mdxJsxFlowElement');
    assert.equal(linkP.name, 'p');
    assert.equal(attr(linkP, 'className').value, 'file-item-link');

    // A plain mdast link node (not a JSX <a>) so Docusaurus's transformLinks
    // plugin rewrites it into a webpack asset require() at build time and adds
    // target="_blank" itself.
    const link = linkP.children[0];
    assert.equal(link.type, 'link');
    assert.equal(link.url, fileRef);

    // Link text shows just the filename, not the full path
    assert.equal(link.children[0].value, 'annual-report.pdf');
  });

  it('emits a @site/-aliased url when siteDir and vfile.path are available', () => {
    const tree = makeTree([]);
    const plugin = remarkFileItem({ siteDir: '/site' });
    plugin(tree, {
      path: '/site/course/01-getting-started/05-workflow-diagram.md',
      data: {
        frontMatter: { canvas_type: 'file', file_ref: '_files/example.html' },
      },
    });

    const link = tree.children[0].children[1].children[0];
    assert.equal(link.type, 'link');
    // @site/ aliasing makes transformLinks bundle the asset regardless of
    // extension (.html, .md, extension-less), bypassing its extension heuristic.
    assert.equal(
      link.url,
      '@site/course/01-getting-started/_files/example.html',
    );
    assert.equal(link.children[0].value, 'example.html');
  });

  it('leaves non-file pages unchanged', () => {
    const body = {
      type: 'paragraph',
      children: [{ type: 'text', value: 'Hello.' }],
    };
    const tree = makeTree([body]);
    transform(tree, { canvas_type: 'page' });

    assert.equal(tree.children.length, 1);
    assert.equal(tree.children[0].type, 'paragraph');
    assert.equal(tree.children[0].children[0].value, 'Hello.');
  });

  it('leaves pages without canvas_type unchanged', () => {
    const body = {
      type: 'paragraph',
      children: [{ type: 'text', value: 'Hello.' }],
    };
    const tree = makeTree([body]);
    transform(tree, { title: 'Some page' });

    assert.equal(tree.children.length, 1);
    assert.equal(tree.children[0].type, 'paragraph');
  });

  it('leaves pages without frontmatter unchanged', () => {
    const body = {
      type: 'paragraph',
      children: [{ type: 'text', value: 'Hello.' }],
    };
    const tree = makeTree([body]);

    const plugin = remarkFileItem();
    plugin(tree, { data: {} });

    assert.equal(tree.children.length, 1);
    assert.equal(tree.children[0].type, 'paragraph');
  });

  it('skips file pages missing the file_ref field', () => {
    const body = {
      type: 'paragraph',
      children: [{ type: 'text', value: 'Hello.' }],
    };
    const tree = makeTree([body]);
    transform(tree, { canvas_type: 'file' });

    assert.equal(tree.children.length, 1);
    assert.equal(tree.children[0].type, 'paragraph');
  });

  it('removes all existing body content', () => {
    const tree = makeTree([
      { type: 'paragraph', children: [{ type: 'text', value: 'First.' }] },
      { type: 'paragraph', children: [{ type: 'text', value: 'Second.' }] },
      {
        type: 'heading',
        depth: 2,
        children: [{ type: 'text', value: 'Heading' }],
      },
    ]);
    transform(tree, {
      canvas_type: 'file',
      file_ref: '_files/report.pdf',
    });

    assert.equal(tree.children.length, 1);
    assert.equal(tree.children[0].name, 'div');
  });

  describe('media embeds', () => {
    it('embeds an image above the card as a plain mdast image node', () => {
      const tree = makeTree([]);
      transform(tree, {
        title: 'Workflow Diagram',
        canvas_type: 'file',
        file_ref: '_files/diagram.svg',
      });

      assert.equal(tree.children.length, 2);

      const embed = tree.children[0];
      assert.equal(embed.type, 'mdxJsxFlowElement');
      assert.equal(embed.name, 'div');
      assert.equal(attr(embed, 'className').value, 'file-item-embed');

      // A plain mdast image node so Docusaurus's transformImage plugin
      // bundles the asset, the same mechanism as the card's link node.
      const image = embed.children[0].children[0];
      assert.equal(image.type, 'image');
      assert.equal(image.url, '_files/diagram.svg');
      assert.equal(image.alt, 'Workflow Diagram');

      const card = tree.children[1];
      assert.equal(attr(card, 'className').value, 'file-item-card');
    });

    it('falls back to the filename as image alt when title is absent', () => {
      const tree = makeTree([]);
      transform(tree, {
        canvas_type: 'file',
        file_ref: '_files/diagram.svg',
      });

      assert.equal(tree.children[0].children[0].children[0].alt, 'diagram.svg');
    });

    it('embeds the image with the same @site/ url as the card link', () => {
      const tree = makeTree([]);
      transformAt(
        tree,
        { canvas_type: 'file', file_ref: '_files/pic.png' },
        { siteDir: fixtureDir },
      );

      const image = tree.children[0].children[0].children[0];
      assert.equal(image.url, '@site/_files/pic.png');
      const link = tree.children[1].children[1].children[0];
      assert.equal(link.url, '@site/_files/pic.png');
    });

    it('embeds a video as <video controls> with a webpack require src', () => {
      const tree = makeTree([]);
      transformAt(tree, { canvas_type: 'file', file_ref: '_files/clip.mp4' });

      const media = tree.children[0].children[0];
      assert.equal(media.type, 'mdxJsxFlowElement');
      assert.equal(media.name, 'video');
      assert.equal(attr(media, 'controls').value, null);
      assert.equal(attr(media, 'preload').value, 'metadata');

      const src = attr(media, 'src').value;
      assert.equal(src.type, 'mdxJsxAttributeValueExpression');
      assert.match(src.value, /^require\(".*clip\.mp4"\)\.default$/);
      assert.ok(src.data.estree);
    });

    it('embeds audio as <audio controls>', () => {
      const tree = makeTree([]);
      transformAt(tree, { canvas_type: 'file', file_ref: '_files/track.mp3' });

      const media = tree.children[0].children[0];
      assert.equal(media.name, 'audio');
      assert.equal(attr(media, 'controls').value, null);
      assert.match(attr(media, 'src').value.value, /track\.mp3/);
    });

    it('emits the card alone when the media file is missing on disk', () => {
      const tree = makeTree([]);
      transformAt(tree, { canvas_type: 'file', file_ref: '_files/gone.png' });

      assert.equal(tree.children.length, 1);
      assert.equal(attr(tree.children[0], 'className').value, 'file-item-card');
    });

    it('emits the card alone for non-media files', () => {
      const tree = makeTree([]);
      transform(tree, {
        canvas_type: 'file',
        file_ref: '_files/archive.zip',
      });

      assert.equal(tree.children.length, 1);
      assert.equal(attr(tree.children[0], 'className').value, 'file-item-card');
    });
  });
});
