const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  markdownToHtml,
  getAlertConfig,
} = require('../../lib/convert/markdown-to-html');

describe('markdownToHtml', () => {
  it('converts basic markdown to HTML', () => {
    const html = markdownToHtml('# Hello\n\nA paragraph.');
    assert.match(html, /<h1.*>Hello<\/h1>/);
    assert.match(html, /<p>A paragraph\.<\/p>/);
  });

  it('strips frontmatter before conversion', () => {
    const md =
      '---\ntitle: Test\ncanvas_type: page\n---\n\n# Title\n\nContent.';
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

describe('markdownToHtml alerts', () => {
  it('converts NOTE alert to styled div', () => {
    const md = '> [!NOTE]\n> This is a note.';
    const html = markdownToHtml(md);
    assert.match(html, /markdown-alert-note/);
    assert.match(html, /Note<\/p>/);
    assert.match(html, /This is a note\./);
  });

  it('converts TIP alert', () => {
    const md = '> [!TIP]\n> A helpful tip.';
    const html = markdownToHtml(md);
    assert.match(html, /markdown-alert-tip/);
    assert.match(html, /Tip<\/p>/);
  });

  it('converts IMPORTANT alert', () => {
    const md = '> [!IMPORTANT]\n> Very important.';
    const html = markdownToHtml(md);
    assert.match(html, /markdown-alert-important/);
    assert.match(html, /Important<\/p>/);
  });

  it('converts WARNING alert', () => {
    const md = '> [!WARNING]\n> Be careful.';
    const html = markdownToHtml(md);
    assert.match(html, /markdown-alert-warning/);
    assert.match(html, /Warning<\/p>/);
  });

  it('converts ATTENTION alert (mapped to caution)', () => {
    const md = '> [!ATTENTION]\n> Watch out!';
    const html = markdownToHtml(md);
    assert.match(html, /markdown-alert-caution/);
    assert.match(html, /Caution<\/p>/);
  });

  it('converts CHECK alert', () => {
    const md = '> [!CHECK]\n> All good.';
    const html = markdownToHtml(md);
    assert.match(html, /markdown-alert-check/);
    assert.match(html, /Check<\/p>/);
  });

  it('renders titles from options.alertTitles', () => {
    const alertTitles = {
      note: 'Info',
      important: 'Belangrijk',
      warning: 'Waarschuwing',
      caution: 'Opgelet',
      check: 'Checklist',
    };
    const cases = [
      ['> [!NOTE]\n> x', /Info<\/p>/],
      ['> [!IMPORTANT]\n> x', /Belangrijk<\/p>/],
      ['> [!WARNING]\n> x', /Waarschuwing<\/p>/],
      ['> [!ATTENTION]\n> x', /Opgelet<\/p>/],
      ['> [!CHECK]\n> x', /Checklist<\/p>/],
    ];
    for (const [md, expected] of cases) {
      assert.match(markdownToHtml(md, { alertTitles }), expected);
    }
  });

  it('keeps English defaults for types missing from alertTitles', () => {
    const html = markdownToHtml('> [!TIP]\n> x', {
      alertTitles: { note: 'Info' },
    });
    assert.match(html, /Tip<\/p>/);
  });

  it('includes icon when iconUrls are provided', () => {
    const md = '> [!NOTE]\n> With icon.';
    const html = markdownToHtml(md, {
      iconUrls: { note: 'https://canvas.example.com/icons/info.svg' },
    });
    assert.match(
      html,
      /<img[^>]*src="https:\/\/canvas\.example\.com\/icons\/info\.svg"/,
    );
  });

  it('gives the alert icon an empty alt', () => {
    // The icon is decorative: the title says the same thing in words, right
    // beside it. Naming the file here had a screenreader read "info.svg Note".
    const html = markdownToHtml('> [!NOTE]\n> With icon.', {
      iconUrls: { note: 'https://canvas.example.com/icons/info.svg' },
    });
    assert.match(html, /<img[^>]*alt=""/);
    assert.doesNotMatch(html, /alt="[^"]*\.svg"/);
  });

  it('escapes the icon URL it writes into the src', () => {
    const html = markdownToHtml('> [!NOTE]\n> With icon.', {
      iconUrls: {
        note: 'https://canvas.example.com/courses/1/files/9/preview?verifier=a&b=2',
      },
    });
    assert.match(html, /src="[^"]*\?verifier=a&amp;b=2"/);
  });

  it('adds spacer paragraph after alert', () => {
    const md = '> [!TIP]\n> Tip content.';
    const html = markdownToHtml(md);
    assert.match(html, /<p>&nbsp;<\/p>/);
  });
});

describe('markdownToHtml link/file resolvers', () => {
  it('resolves internal .md links via linkResolver', () => {
    const md = '[Setup](./02-setup.md)';
    const html = markdownToHtml(md, {
      linkResolver: (href) =>
        href === './02-setup.md' ? '/courses/42/pages/setup' : null,
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
      fileResolver: (href) =>
        href === './_files/diagram.png'
          ? 'https://canvas.example.com/files/500/preview'
          : null,
    });
    assert.match(
      html,
      /src="https:\/\/canvas\.example\.com\/files\/500\/preview"/,
    );
  });

  it('resolves file links via fileResolver', () => {
    const md = '[Download](./_files/guide.pdf)';
    const html = markdownToHtml(md, {
      fileResolver: (href) =>
        href === './_files/guide.pdf'
          ? 'https://canvas.example.com/files/600/download'
          : null,
    });
    assert.match(
      html,
      /href="https:\/\/canvas\.example\.com\/files\/600\/download"/,
    );
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

  it('escapes an ampersand in a link href', () => {
    const md = '[Search](https://example.com/s?q=one&r=two)';
    const html = markdownToHtml(md, { linkResolver: () => null });
    assert.match(html, /href="https:\/\/example\.com\/s\?q=one&amp;r=two"/);
  });

  it('escapes an ampersand in a resolved link href', () => {
    // The resolved URL is escaped too, not just the one the author typed: a
    // Canvas file URL carries a `?verifier=…` query string of its own.
    const md = '[Handout](./_files/handout.pdf)';
    const html = markdownToHtml(md, {
      fileResolver: () => '/courses/42/files/600/download?verifier=ab12&wrap=1',
    });
    assert.match(
      html,
      /href="\/courses\/42\/files\/600\/download\?verifier=ab12&amp;wrap=1"/,
    );
  });

  it('escapes a quote in a link href instead of ending the attribute', () => {
    const md = '[Search](https://example.com/s?q=a"b)';
    const html = markdownToHtml(md, { linkResolver: () => null });
    // The whole tag, not just the href: unescaped, the quote closed the
    // attribute and `b"` became a second attribute on the anchor.
    assert.ok(
      html.includes('<a href="https://example.com/s?q=a&quot;b">Search</a>'),
      `Expected the URL to stay inside one attribute, got:\n${html}`,
    );
  });

  it('escapes a quote and an ampersand in an image src', () => {
    const md = '![Cheese](./_files/say"cheese&co.png)';
    const html = markdownToHtml(md, { fileResolver: () => null });
    assert.match(html, /src="\.\/_files\/say&quot;cheese&amp;co\.png"/);
  });

  it('escapes angle brackets in an image src', () => {
    const md = '![Odd](./_files/a<b>c.png)';
    const html = markdownToHtml(md, { fileResolver: () => null });
    assert.match(html, /src="\.\/_files\/a&lt;b&gt;c\.png"/);
  });
});

describe('markdownToHtml destinations already carrying entities', () => {
  // marked hands the renderer the destination as raw source text, entities
  // undecoded, so an escape on its own would encode the `&` of an entity the
  // author had already written. The trigger is ordinary: a URL copied out of a
  // page's HTML source arrives spelled `&amp;`.

  it('does not double-escape an entity in a link href', () => {
    const md = '[Search](https://example.com/s?a=1&amp;b=2)';
    const html = markdownToHtml(md, { linkResolver: () => null });
    assert.match(html, /href="https:\/\/example\.com\/s\?a=1&amp;b=2"/);
    // `&amp;amp;` would have Canvas serve a query parameter named `amp;b`.
    assert.doesNotMatch(html, /&amp;amp;/);
  });

  it('spells both forms of the same URL the same way', () => {
    // What the fix is for: CommonMark reads these two as one URL, so Canvas
    // has to be handed one attribute value.
    const plain = markdownToHtml('[S](https://example.com/s?a=1&b=2)', {
      linkResolver: () => null,
    });
    const encoded = markdownToHtml('[S](https://example.com/s?a=1&amp;b=2)', {
      linkResolver: () => null,
    });
    assert.equal(encoded, plain);
  });

  it('does not double-escape an entity in an image src', () => {
    const md = '![Cheese](./_files/say&amp;co.png)';
    const html = markdownToHtml(md, { fileResolver: () => null });
    assert.match(html, /src="\.\/_files\/say&amp;co\.png"/);
    assert.doesNotMatch(html, /&amp;amp;/);
  });

  it('decodes a numeric character reference', () => {
    const decimal = markdownToHtml('[S](https://example.com/s?a=&#38;b)', {
      linkResolver: () => null,
    });
    const hex = markdownToHtml('[S](https://example.com/s?a=&#x26;b)', {
      linkResolver: () => null,
    });
    assert.match(decimal, /href="https:\/\/example\.com\/s\?a=&amp;b"/);
    assert.equal(hex, decimal);
  });

  it('leaves a code point that is not one as literal text', () => {
    // A lone surrogate and `&#0;` are not decoded: the range check refuses
    // both, since neither belongs in a URL.
    for (const ref of ['&#xD800;', '&#0;', '&#99999999;']) {
      const html = markdownToHtml(`[S](https://example.com/s?a=${ref})`, {
        linkResolver: () => null,
      });
      assert.match(html, new RegExp(`\\?a=&amp;${ref.slice(1)}"`));
    }
  });

  it('leaves a named entity outside the escaper set as literal text', () => {
    // The deliberate gap: decoding the full HTML5 table needs a dependency, so
    // `&copy;` stays the six characters the author typed rather than becoming
    // ©. Harmless direction, and stable across a round trip.
    const md = '[S](https://example.com/s?a=&copy;b)';
    const html = markdownToHtml(md, { linkResolver: () => null });
    assert.match(html, /href="https:\/\/example\.com\/s\?a=&amp;copy;b"/);
  });

  it('escapes what a resolver hands back without decoding it', () => {
    // The asymmetry is deliberate. A resolver's URL is assembled from ids in
    // .canvas-sync.json, never parsed out of HTML, so there is no encoding to
    // undo — and a path that really does contain `&amp;` must survive as those
    // five characters.
    const html = markdownToHtml('[Handout](./_files/handout.pdf)', {
      fileResolver: () => '/courses/42/files/600/download?v=a&amp;b',
    });
    assert.match(
      html,
      /href="\/courses\/42\/files\/600\/download\?v=a&amp;amp;b"/,
    );
  });

  it('leaves the alt and title double-escape alone', () => {
    // Known gap, older than the href fix and not part of it: alt text and link
    // titles reach the renderer as raw source text too, and are escaped
    // without a decode, so `&amp;` in either goes out as `&amp;amp;` and
    // Canvas displays the entity rather than the `&`. Pinned so the next
    // change to this file is a decision rather than an accident.
    const image = markdownToHtml('![a &amp; b](./_files/x.png)', {
      fileResolver: () => null,
    });
    assert.match(image, /alt="a &amp;amp; b"/);

    const link = markdownToHtml('[L](https://example.com "a &amp; b")', {
      linkResolver: () => null,
    });
    assert.match(link, /title="a &amp;amp; b"/);
  });
});

describe('getAlertConfig', () => {
  it('has entries for all supported types', () => {
    const config = getAlertConfig();
    const expectedTypes = [
      'note',
      'tip',
      'important',
      'warning',
      'caution',
      'check',
    ];
    for (const type of expectedTypes) {
      assert.ok(config[type], `Missing config for type: ${type}`);
      assert.ok(config[type].color, `Missing color for type: ${type}`);
      assert.ok(
        config[type].background,
        `Missing background for type: ${type}`,
      );
      assert.ok(config[type].icon, `Missing icon for type: ${type}`);
    }
  });

  it('takes its colours from the active theme', () => {
    const { loadTheme } = require('../../lib/config/theme');
    const theme = loadTheme();
    const config = getAlertConfig();
    assert.strictEqual(config.note.color, theme.alerts.note.fg);
    assert.strictEqual(config.note.background, theme.alerts.note.bg);
  });
});
