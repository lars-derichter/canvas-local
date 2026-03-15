const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { markdownToHtml, ADMONITION_CONFIG } = require('../../lib/convert/markdown-to-html');

describe('markdownToHtml', () => {
  it('converts basic markdown to HTML', () => {
    const html = markdownToHtml('# Hello\n\nA paragraph.');
    assert.match(html, /<h1.*>Hello<\/h1>/);
    assert.match(html, /<p>A paragraph\.<\/p>/);
  });

  it('strips frontmatter before conversion', () => {
    const md = '---\ntitle: Test\ncanvas_type: page\n---\n\n# Title\n\nContent.';
    const html = markdownToHtml(md);
    assert.doesNotMatch(html, /title:/);
    assert.doesNotMatch(html, /canvas_type/);
    assert.match(html, /<h1.*>Title<\/h1>/);
  });

  it('converts GFM tables', () => {
    const md = '| A | B |\n|---|---|\n| 1 | 2 |';
    const html = markdownToHtml(md);
    assert.match(html, /<table>/);
    assert.match(html, /<td>1<\/td>/);
  });

  it('converts fenced code blocks', () => {
    const md = '```js\nconst x = 1;\n```';
    const html = markdownToHtml(md);
    assert.match(html, /<code/);
    assert.match(html, /const x = 1;/);
  });

  it('converts inline formatting', () => {
    const md = '**bold** and *italic* and `code`';
    const html = markdownToHtml(md);
    assert.match(html, /<strong>bold<\/strong>/);
    assert.match(html, /<em>italic<\/em>/);
    assert.match(html, /<code>code<\/code>/);
  });
});

describe('markdownToHtml admonitions', () => {
  it('converts NOTE admonition to styled div', () => {
    const md = '> [!NOTE]\n> This is a note.';
    const html = markdownToHtml(md);
    assert.match(html, /markdown-alert-note/);
    assert.match(html, /Info<\/p>/);
    assert.match(html, /This is a note\./);
  });

  it('converts TIP admonition', () => {
    const md = '> [!TIP]\n> A helpful tip.';
    const html = markdownToHtml(md);
    assert.match(html, /markdown-alert-tip/);
    assert.match(html, /Tip<\/p>/);
  });

  it('converts IMPORTANT admonition', () => {
    const md = '> [!IMPORTANT]\n> Very important.';
    const html = markdownToHtml(md);
    assert.match(html, /markdown-alert-important/);
    assert.match(html, /Belangrijk<\/p>/);
  });

  it('converts WARNING admonition', () => {
    const md = '> [!WARNING]\n> Be careful.';
    const html = markdownToHtml(md);
    assert.match(html, /markdown-alert-warning/);
    assert.match(html, /Waarschuwing<\/p>/);
  });

  it('converts ATTENTION admonition (mapped to caution)', () => {
    const md = '> [!ATTENTION]\n> Watch out!';
    const html = markdownToHtml(md);
    assert.match(html, /markdown-alert-caution/);
    assert.match(html, /Opgelet<\/p>/);
  });

  it('converts CHECK admonition', () => {
    const md = '> [!CHECK]\n> All good.';
    const html = markdownToHtml(md);
    assert.match(html, /markdown-alert-check/);
    assert.match(html, /Check<\/p>/);
  });

  it('includes icon when iconUrls are provided', () => {
    const md = '> [!NOTE]\n> With icon.';
    const html = markdownToHtml(md, {
      iconUrls: { note: 'https://canvas.example.com/icons/info.svg' },
    });
    assert.match(html, /<img.*info\.svg/);
  });

  it('adds spacer paragraph after admonition', () => {
    const md = '> [!TIP]\n> Tip content.';
    const html = markdownToHtml(md);
    assert.match(html, /<p>&nbsp;<\/p>/);
  });
});

describe('markdownToHtml link/file resolvers', () => {
  it('resolves internal .md links via linkResolver', () => {
    const md = '[Setup](./02-setup.md)';
    const html = markdownToHtml(md, {
      linkResolver: (href) => href === './02-setup.md' ? '/courses/42/pages/setup' : null,
    });
    assert.match(html, /href="\/courses\/42\/pages\/setup"/);
  });

  it('leaves unresolvable links unchanged', () => {
    const md = '[External](https://example.com)';
    const html = markdownToHtml(md, {
      linkResolver: () => null,
    });
    assert.match(html, /href="https:\/\/example\.com"/);
  });

  it('resolves image sources via fileResolver', () => {
    const md = '![diagram](./_files/diagram.png)';
    const html = markdownToHtml(md, {
      fileResolver: (href) => href === './_files/diagram.png'
        ? 'https://canvas.example.com/files/500/preview'
        : null,
    });
    assert.match(html, /src="https:\/\/canvas\.example\.com\/files\/500\/preview"/);
  });

  it('resolves file links via fileResolver', () => {
    const md = '[Download](./_files/guide.pdf)';
    const html = markdownToHtml(md, {
      fileResolver: (href) => href === './_files/guide.pdf'
        ? 'https://canvas.example.com/files/600/download'
        : null,
    });
    assert.match(html, /href="https:\/\/canvas\.example\.com\/files\/600\/download"/);
  });

  it('escapes quotes in link title attributes', () => {
    const md = '[Link](https://example.com "a \\"quoted\\" title")';
    const html = markdownToHtml(md, { linkResolver: () => null });
    assert.match(html, /title="a &quot;quoted&quot; title"/);
  });

  it('escapes special characters in image alt text', () => {
    const md = '![alt with "quotes" & <angle>](./_files/img.png)';
    const html = markdownToHtml(md, {
      fileResolver: () => null,
    });
    assert.match(html, /alt="alt with &quot;quotes&quot; &amp; &lt;angle&gt;"/);
  });
});

describe('ADMONITION_CONFIG', () => {
  it('has entries for all supported types', () => {
    const expectedTypes = ['note', 'tip', 'important', 'warning', 'caution', 'check'];
    for (const type of expectedTypes) {
      assert.ok(ADMONITION_CONFIG[type], `Missing config for type: ${type}`);
      assert.ok(ADMONITION_CONFIG[type].color, `Missing color for type: ${type}`);
      assert.ok(ADMONITION_CONFIG[type].icon, `Missing icon for type: ${type}`);
      assert.ok(ADMONITION_CONFIG[type].title, `Missing title for type: ${type}`);
    }
  });
});
