const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { htmlToMarkdown, canvasItemToMarkdown } = require('../../lib/convert/html-to-markdown');

describe('htmlToMarkdown', () => {
  it('converts basic HTML to markdown', () => {
    const md = htmlToMarkdown('<h1>Title</h1><p>Paragraph.</p>');
    assert.match(md, /# Title/);
    assert.match(md, /Paragraph\./);
  });

  it('converts headings at different levels', () => {
    const md = htmlToMarkdown('<h2>Sub</h2><h3>SubSub</h3>');
    assert.match(md, /## Sub/);
    assert.match(md, /### SubSub/);
  });

  it('converts bold and italic', () => {
    const md = htmlToMarkdown('<p><strong>bold</strong> and <em>italic</em></p>');
    assert.ok(md.includes('**bold**'), 'Expected bold markdown');
    assert.ok(md.includes('_italic_'), 'Expected italic markdown');
  });

  it('converts code blocks', () => {
    const md = htmlToMarkdown('<pre><code>const x = 1;</code></pre>');
    assert.match(md, /```/);
    assert.match(md, /const x = 1;/);
  });

  it('converts unordered lists', () => {
    const md = htmlToMarkdown('<ul><li>Item A</li><li>Item B</li></ul>');
    assert.ok(md.includes('Item A'), 'Expected Item A');
    assert.ok(md.includes('Item B'), 'Expected Item B');
    assert.match(md, /^-/m, 'Expected bullet list markers');
  });

  it('converts links', () => {
    const md = htmlToMarkdown('<a href="https://example.com">Link</a>');
    assert.match(md, /\[Link\]\(https:\/\/example\.com\)/);
  });

  it('converts images', () => {
    const md = htmlToMarkdown('<img src="image.png" alt="Photo">');
    assert.match(md, /!\[Photo\]\(image\.png\)/);
  });

  it('handles empty input', () => {
    assert.equal(htmlToMarkdown(''), '');
    assert.equal(htmlToMarkdown(null), '');
  });
});

describe('htmlToMarkdown admonitions', () => {
  const admonitionHtml = (type, title, body) =>
    `<div class="markdown-alert markdown-alert-${type}" style="border-left: .25em solid #ccc; padding-left: 1em;">
      <p class="markdown-alert-title" style="font-size: 1.2em;">${title}</p>
      <p>${body}</p>
    </div><p>\u00a0</p>`;

  it('converts NOTE admonition back to GFM syntax', () => {
    const md = htmlToMarkdown(admonitionHtml('note', 'Info', 'This is a note.'));
    assert.match(md, /\[!NOTE\]/);
    assert.match(md, /This is a note\./);
  });

  it('converts CAUTION back to ATTENTION', () => {
    const md = htmlToMarkdown(admonitionHtml('caution', 'Opgelet', 'Watch out!'));
    assert.match(md, /\[!ATTENTION\]/);
    assert.match(md, /Watch out!/);
  });

  it('converts TIP admonition', () => {
    const md = htmlToMarkdown(admonitionHtml('tip', 'Tip', 'A tip.'));
    assert.match(md, /\[!TIP\]/);
  });

  it('converts CHECK admonition', () => {
    const md = htmlToMarkdown(admonitionHtml('check', 'Check', 'All good.'));
    assert.match(md, /\[!CHECK\]/);
  });

  it('preserves plain text nodes inside admonitions', () => {
    const html = `<div class="markdown-alert markdown-alert-note" style="border-left: .25em solid #ccc; padding-left: 1em;">
      <p class="markdown-alert-title" style="font-size: 1.2em;">Info</p>
      Some plain text without a wrapper element.
    </div>`;
    const md = htmlToMarkdown(html);
    assert.match(md, /\[!NOTE\]/);
    assert.match(md, /Some plain text without a wrapper element\./);
  });

  it('strips spacer paragraphs after admonitions', () => {
    const html = admonitionHtml('note', 'Info', 'Content.');
    const md = htmlToMarkdown(html);
    assert.doesNotMatch(md, /\u00a0/);
  });
});

describe('htmlToMarkdown link resolution', () => {
  it('resolves Canvas page links via linkResolver', () => {
    const html = '<a href="/courses/42/pages/welcome">Welcome</a>';
    const md = htmlToMarkdown(html, {
      linkResolver: (href) => href === '/courses/42/pages/welcome' ? './01-welcome.md' : null,
    });
    assert.match(md, /\[Welcome\]\(.\/01-welcome\.md\)/);
  });

  it('resolves Canvas assignment links', () => {
    const html = '<a href="/courses/42/assignments/300">Assignment</a>';
    const md = htmlToMarkdown(html, {
      linkResolver: (href) => href === '/courses/42/assignments/300' ? '../02-mod/01-hw.md' : null,
    });
    assert.match(md, /\[Assignment\]\(\.\.\/02-mod\/01-hw\.md\)/);
  });

  it('leaves non-Canvas links unchanged', () => {
    const html = '<a href="https://example.com">External</a>';
    const md = htmlToMarkdown(html, {
      linkResolver: () => null,
    });
    assert.match(md, /\[External\]\(https:\/\/example\.com\)/);
  });
});

describe('htmlToMarkdown file resolution', () => {
  it('resolves Canvas file images via fileResolver', () => {
    const html = '<img src="/courses/42/files/500/preview" alt="diagram">';
    const md = htmlToMarkdown(html, {
      fileResolver: (src) => src === '/courses/42/files/500/preview' ? './_files/diagram.png' : null,
    });
    assert.match(md, /!\[diagram\]\(\.\/\_files\/diagram\.png\)/);
  });

  it('resolves Canvas file links via fileResolver', () => {
    const html = '<a href="/courses/42/files/600/download">PDF</a>';
    const md = htmlToMarkdown(html, {
      fileResolver: (href) => href === '/courses/42/files/600/download' ? './_files/guide.pdf' : null,
    });
    assert.match(md, /\[PDF\]\(\.\/\_files\/guide\.pdf\)/);
  });
});

describe('canvasItemToMarkdown', () => {
  it('converts a Canvas page to markdown with frontmatter', () => {
    const item = {
      title: 'Welcome',
      page_id: 100,
      url: 'welcome',
      body: '<p>Hello world.</p>',
    };
    const md = canvasItemToMarkdown(item, 'page');

    assert.match(md, /title: Welcome/);
    assert.match(md, /canvas_type: page/);
    assert.match(md, /canvas_id: 100/);
    assert.match(md, /Hello world\./);
  });

  it('converts a Canvas assignment with metadata', () => {
    const item = {
      name: 'Homework 1',
      id: 300,
      description: '<p>Do this assignment.</p>',
      points_possible: 10,
      submission_types: ['online_upload'],
      due_at: '2025-03-15T23:59:00Z',
      published: true,
    };
    const md = canvasItemToMarkdown(item, 'assignment');

    assert.match(md, /title: Homework 1/);
    assert.match(md, /canvas_type: assignment/);
    assert.match(md, /canvas_id: 300/);
    assert.match(md, /points_possible: 10/);
    assert.match(md, /Do this assignment\./);
  });

  it('converts an external URL item', () => {
    const item = {
      title: 'Resource',
      id: 400,
      external_url: 'https://example.com/resource',
    };
    const md = canvasItemToMarkdown(item, 'external_url');

    assert.match(md, /title: Resource/);
    assert.match(md, /canvas_type: external_url/);
    assert.ok(md.includes('external_url:'), 'Expected external_url in frontmatter');
    assert.ok(md.includes('https://example.com/resource'), 'Expected URL in frontmatter');
  });

  it('handles items with no body', () => {
    const item = { title: 'Empty', page_id: 999, url: 'empty', body: '' };
    const md = canvasItemToMarkdown(item, 'page');
    assert.match(md, /title: Empty/);
    assert.match(md, /canvas_type: page/);
  });
});
