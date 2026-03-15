const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const remarkGfmAlerts = require('../../src/plugins/remark-gfm-alerts');

/**
 * Helper: build a minimal mdast blockquote node that represents a GFM alert.
 * The structure mirrors what remark-parse produces for:
 *   > [!TYPE]
 *   > body text
 */
function makeAlertBlockquote(type, bodyText) {
  return {
    type: 'blockquote',
    children: [
      {
        type: 'paragraph',
        children: [
          { type: 'text', value: `[!${type}]\n${bodyText}` },
        ],
      },
    ],
  };
}

/**
 * Helper: build a root tree containing a single blockquote alert.
 */
function makeTree(blockquote) {
  return { type: 'root', children: [blockquote] };
}

/**
 * Helper: run the plugin transform on a tree and return the tree.
 */
function transform(tree) {
  const plugin = remarkGfmAlerts();
  plugin(tree);
  return tree;
}

/**
 * Helper: assert the wrapper div structure produced by the plugin.
 */
function assertAlertDiv(node, expectedCssType, expectedTitle) {
  assert.equal(node.type, 'mdxJsxFlowElement');
  assert.equal(node.name, 'div');

  // Check className attribute
  const classAttr = node.attributes.find((a) => a.name === 'className');
  assert.ok(classAttr, 'wrapper div should have className attribute');
  assert.equal(classAttr.value, `markdown-alert markdown-alert-${expectedCssType}`);

  // First child should be the title paragraph
  const titleP = node.children[0];
  assert.equal(titleP.type, 'mdxJsxFlowElement');
  assert.equal(titleP.name, 'p');
  const titleClass = titleP.attributes.find((a) => a.name === 'className');
  assert.equal(titleClass.value, 'markdown-alert-title');

  // Title paragraph contains icon img + text
  const iconImg = titleP.children[0];
  assert.equal(iconImg.type, 'mdxJsxTextElement');
  assert.equal(iconImg.name, 'img');
  const srcAttr = iconImg.attributes.find((a) => a.name === 'src');
  assert.ok(srcAttr.value.startsWith('data:image/svg+xml,'), 'icon src should be a data URI');

  const titleText = titleP.children[1];
  assert.equal(titleText.type, 'text');
  assert.equal(titleText.value, ` ${expectedTitle}`);
}

describe('remarkGfmAlerts', () => {
  it('transforms > [!NOTE] into a styled note element', () => {
    const bq = makeAlertBlockquote('NOTE', 'Some info.');
    const tree = transform(makeTree(bq));

    assert.equal(tree.children.length, 1);
    assertAlertDiv(tree.children[0], 'note', 'Info');
  });

  it('transforms > [!TIP] into a styled tip element', () => {
    const bq = makeAlertBlockquote('TIP', 'A helpful tip.');
    const tree = transform(makeTree(bq));

    assertAlertDiv(tree.children[0], 'tip', 'Tip');
  });

  it('transforms > [!WARNING] into a styled warning element', () => {
    const bq = makeAlertBlockquote('WARNING', 'Be careful.');
    const tree = transform(makeTree(bq));

    assertAlertDiv(tree.children[0], 'warning', 'Waarschuwing');
  });

  it('transforms > [!IMPORTANT] into a styled important element', () => {
    const bq = makeAlertBlockquote('IMPORTANT', 'Critical info.');
    const tree = transform(makeTree(bq));

    assertAlertDiv(tree.children[0], 'important', 'Belangrijk');
  });

  it('transforms > [!ATTENTION] mapping to caution type', () => {
    const bq = makeAlertBlockquote('ATTENTION', 'Watch out.');
    const tree = transform(makeTree(bq));

    assertAlertDiv(tree.children[0], 'caution', 'Opgelet');
  });

  it('transforms > [!CHECK] into a styled check element', () => {
    const bq = makeAlertBlockquote('CHECK', 'Verified.');
    const tree = transform(makeTree(bq));

    assertAlertDiv(tree.children[0], 'check', 'Check');
  });

  it('leaves regular blockquotes unchanged', () => {
    const bq = {
      type: 'blockquote',
      children: [
        {
          type: 'paragraph',
          children: [{ type: 'text', value: 'Just a normal quote.' }],
        },
      ],
    };
    const tree = transform(makeTree(bq));

    assert.equal(tree.children.length, 1);
    assert.equal(tree.children[0].type, 'blockquote');
    assert.equal(tree.children[0].children[0].children[0].value, 'Just a normal quote.');
  });

  it('preserves body content inside the alert', () => {
    const bq = makeAlertBlockquote('NOTE', 'This is important content.');
    const tree = transform(makeTree(bq));

    const div = tree.children[0];
    // The body paragraph should be the second child (after the title)
    const bodyParagraph = div.children[1];
    assert.equal(bodyParagraph.type, 'paragraph');

    const bodyText = bodyParagraph.children[0];
    assert.equal(bodyText.type, 'text');
    assert.equal(bodyText.value, 'This is important content.');
  });

  it('handles alert with empty body after marker', () => {
    const bq = {
      type: 'blockquote',
      children: [
        {
          type: 'paragraph',
          children: [{ type: 'text', value: '[!TIP]\n' }],
        },
      ],
    };
    const tree = transform(makeTree(bq));

    const div = tree.children[0];
    assert.equal(div.type, 'mdxJsxFlowElement');
    assertAlertDiv(div, 'tip', 'Tip');
  });

  it('handles alert with multiple paragraphs', () => {
    const bq = {
      type: 'blockquote',
      children: [
        {
          type: 'paragraph',
          children: [{ type: 'text', value: '[!WARNING]\nFirst paragraph.' }],
        },
        {
          type: 'paragraph',
          children: [{ type: 'text', value: 'Second paragraph.' }],
        },
      ],
    };
    const tree = transform(makeTree(bq));

    const div = tree.children[0];
    assertAlertDiv(div, 'warning', 'Waarschuwing');

    // Title + 2 body paragraphs
    assert.equal(div.children.length, 3);
    assert.equal(div.children[2].children[0].value, 'Second paragraph.');
  });

  it('does not transform blockquote with non-text first child', () => {
    const bq = {
      type: 'blockquote',
      children: [
        {
          type: 'paragraph',
          children: [{ type: 'emphasis', children: [{ type: 'text', value: 'italic' }] }],
        },
      ],
    };
    const tree = transform(makeTree(bq));

    assert.equal(tree.children[0].type, 'blockquote');
  });

  it('does not transform blockquote with empty first paragraph', () => {
    const bq = {
      type: 'blockquote',
      children: [
        { type: 'paragraph', children: [] },
      ],
    };
    const tree = transform(makeTree(bq));

    assert.equal(tree.children[0].type, 'blockquote');
  });

  it('transforms multiple alerts in the same tree', () => {
    const tree = {
      type: 'root',
      children: [
        makeAlertBlockquote('NOTE', 'Note text.'),
        makeAlertBlockquote('TIP', 'Tip text.'),
      ],
    };
    transform(tree);

    assert.equal(tree.children.length, 2);
    assertAlertDiv(tree.children[0], 'note', 'Info');
    assertAlertDiv(tree.children[1], 'tip', 'Tip');
  });

  it('transforms > [!CAUTION] into a styled caution element', () => {
    const bq = makeAlertBlockquote('CAUTION', 'Danger ahead.');
    const tree = transform(makeTree(bq));

    assertAlertDiv(tree.children[0], 'caution', 'Opgelet');
  });

  it('icon img element has expected attributes', () => {
    const bq = makeAlertBlockquote('NOTE', 'Text.');
    const tree = transform(makeTree(bq));

    const titleP = tree.children[0].children[0];
    const iconImg = titleP.children[0];

    const attrs = Object.fromEntries(iconImg.attributes.map((a) => [a.name, a.value]));
    assert.equal(attrs.alt, '');
    assert.equal(attrs.className, 'markdown-alert-icon');
    assert.equal(attrs.width, '16');
    assert.equal(attrs.height, '16');
    assert.ok(attrs.src.startsWith('data:image/svg+xml,'));
  });
});
