const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  htmlToMarkdown,
  canvasItemToMarkdown,
} = require('../../lib/convert/html-to-markdown');

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
    const md = htmlToMarkdown(
      '<p><strong>bold</strong> and <em>italic</em></p>',
    );
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

describe('htmlToMarkdown tables', () => {
  it('converts a table with a header row to a GFM pipe table', () => {
    const html =
      '<table><thead><tr><th>Name</th><th>Score</th></tr></thead>' +
      '<tbody><tr><td>Alice</td><td>10</td></tr></tbody></table>';
    const md = htmlToMarkdown(html);
    assert.match(md, /\| Name \| Score \|/);
    assert.match(md, /\| ---/, 'Expected header separator row');
    assert.match(md, /\| Alice \| 10\s+\|/);
  });

  it('converts a headerless table (Canvas RCE style)', () => {
    const html =
      '<table style="border-collapse: collapse;"><tbody>' +
      '<tr><td><p>a</p></td><td><p>b</p></td></tr>' +
      '<tr><td>1</td><td>2</td></tr></tbody></table>';
    const md = htmlToMarkdown(html);
    assert.match(md, /\| a\s+\| b\s+\|/);
    assert.match(md, /\| ---/, 'Expected header separator row');
    assert.match(md, /\| 1\s+\| 2\s+\|/);
  });

  it('round-trips a pipe table through push and pull conversion', () => {
    const { markdownToHtml } = require('../../lib/convert/markdown-to-html');
    const source =
      '| Name | Score |\n| --- | --- |\n| Alice | 10 |\n| Bob | 7 |';
    const md = htmlToMarkdown(markdownToHtml(source));
    assert.match(md, /\| Name \| Score \|/);
    assert.match(md, /\| ---/, 'Expected header separator row');
    assert.match(md, /\| Alice \| 10\s+\|/);
    assert.match(md, /\| Bob\s+\| 7\s+\|/);
  });

  it('resolves Canvas links inside table cells', () => {
    const html =
      '<table><thead><tr><th>Link</th></tr></thead><tbody><tr>' +
      '<td><a href="/courses/42/pages/welcome">Welcome</a></td>' +
      '</tr></tbody></table>';
    const md = htmlToMarkdown(html, {
      linkResolver: (href) =>
        href === '/courses/42/pages/welcome' ? './01-welcome.md' : null,
    });
    assert.match(md, /\[Welcome\]\(.\/01-welcome\.md\)/);
    assert.match(md, /\| Link \|/);
  });
});

describe('htmlToMarkdown alerts', () => {
  const alertHtml = (type, title, body) =>
    `<div class="markdown-alert markdown-alert-${type}" style="border-left: .25em solid #ccc; padding-left: 1em;">
      <p class="markdown-alert-title" style="font-size: 1.2em;">${title}</p>
      <p>${body}</p>
    </div><p>\u00a0</p>`;

  it('converts NOTE alert back to GFM syntax', () => {
    const md = htmlToMarkdown(alertHtml('note', 'Info', 'This is a note.'));
    assert.match(md, /\[!NOTE\]/);
    assert.match(md, /This is a note\./);
  });

  it('converts CAUTION back to ATTENTION', () => {
    const md = htmlToMarkdown(alertHtml('caution', 'Opgelet', 'Watch out!'));
    assert.match(md, /\[!ATTENTION\]/);
    assert.match(md, /Watch out!/);
  });

  it('converts TIP alert', () => {
    const md = htmlToMarkdown(alertHtml('tip', 'Tip', 'A tip.'));
    assert.match(md, /\[!TIP\]/);
  });

  it('converts CHECK alert', () => {
    const md = htmlToMarkdown(alertHtml('check', 'Check', 'All good.'));
    assert.match(md, /\[!CHECK\]/);
  });

  it('preserves plain text nodes inside alerts', () => {
    const html = `<div class="markdown-alert markdown-alert-note" style="border-left: .25em solid #ccc; padding-left: 1em;">
      <p class="markdown-alert-title" style="font-size: 1.2em;">Info</p>
      Some plain text without a wrapper element.
    </div>`;
    const md = htmlToMarkdown(html);
    assert.match(md, /\[!NOTE\]/);
    assert.match(md, /Some plain text without a wrapper element\./);
  });

  it('strips spacer paragraphs after alerts', () => {
    const html = alertHtml('note', 'Info', 'Content.');
    const md = htmlToMarkdown(html);
    assert.doesNotMatch(md, /\u00a0/);
  });
});

describe('htmlToMarkdown link resolution', () => {
  it('resolves Canvas page links via linkResolver', () => {
    const html = '<a href="/courses/42/pages/welcome">Welcome</a>';
    const md = htmlToMarkdown(html, {
      linkResolver: (href) =>
        href === '/courses/42/pages/welcome' ? './01-welcome.md' : null,
    });
    assert.match(md, /\[Welcome\]\(.\/01-welcome\.md\)/);
  });

  it('resolves Canvas assignment links', () => {
    const html = '<a href="/courses/42/assignments/300">Assignment</a>';
    const md = htmlToMarkdown(html, {
      linkResolver: (href) =>
        href === '/courses/42/assignments/300' ? '../02-mod/01-hw.md' : null,
    });
    assert.match(md, /\[Assignment\]\(\.\.\/02-mod\/01-hw\.md\)/);
  });

  it('resolves Canvas discussion links', () => {
    const html = '<a href="/courses/42/discussion_topics/77">Debate</a>';
    const md = htmlToMarkdown(html, {
      linkResolver: (href) =>
        href === '/courses/42/discussion_topics/77' ? './03-debate.md' : null,
    });
    assert.match(md, /\[Debate\]\(\.\/03-debate\.md\)/);
  });

  it('leaves an unresolvable Canvas discussion link as-is', () => {
    const html = '<a href="/courses/42/discussion_topics/999">Gone</a>';
    const md = htmlToMarkdown(html, { linkResolver: () => null });
    assert.match(md, /\[Gone\]\(\/courses\/42\/discussion_topics\/999\)/);
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
      fileResolver: (src) =>
        src === '/courses/42/files/500/preview' ? './_files/diagram.png' : null,
    });
    assert.match(md, /!\[diagram\]\(\.\/_files\/diagram\.png\)/);
  });

  it('resolves Canvas file links via fileResolver', () => {
    const html = '<a href="/courses/42/files/600/download">PDF</a>';
    const md = htmlToMarkdown(html, {
      fileResolver: (href) =>
        href === '/courses/42/files/600/download' ? './_files/guide.pdf' : null,
    });
    assert.match(md, /\[PDF\]\(\.\/_files\/guide\.pdf\)/);
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
    assert.ok(
      !md.includes('canvas_id'),
      'which Canvas page this is belongs to the sync state, keyed by path',
    );
    assert.match(md, /Hello world\./);
  });

  it('writes title and canvas_type and no identity at all', () => {
    // The whole of what a pull puts in the frontmatter about identity: what the
    // file is called, and what kind of Canvas object it should be. Which object
    // is in `.canvas-sync.json`, keyed by this file's path.
    const md = canvasItemToMarkdown(
      { title: 'Welcome', page_id: 100, url: 'welcome', body: '<p>Hi.</p>' },
      'page',
    );
    const frontmatter = md.split('---')[1];

    assert.deepEqual(
      frontmatter
        .split('\n')
        .filter(Boolean)
        .map((line) => line.split(':')[0]),
      ['title', 'canvas_type'],
    );
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
    assert.ok(!md.includes('canvas_id'));
    assert.match(md, /points_possible: 10/);
    assert.match(md, /Do this assignment\./);
  });

  it('converts a Canvas discussion with its metadata', () => {
    const item = {
      title: 'Week 1 debate',
      id: 77,
      message: '<p>Say something.</p>',
      discussion_type: 'threaded',
      require_initial_post: true,
      published: true,
      delayed_post_at: '2026-03-01T08:00:00Z',
      lock_at: '2026-03-08T23:59:00Z',
    };
    const md = canvasItemToMarkdown(item, 'discussion');

    assert.match(md, /title: Week 1 debate/);
    assert.match(md, /canvas_type: discussion/);
    assert.ok(!md.includes('canvas_id'));
    assert.match(md, /discussion_type: threaded/);
    assert.match(md, /require_initial_post: true/);
    assert.match(md, /published: true/);
    assert.ok(md.includes('delayed_post_at:'), 'Expected delayed_post_at');
    assert.ok(md.includes('lock_at:'), 'Expected lock_at');
    assert.match(md, /Say something\./);
  });

  it('writes the discussion message as the markdown body', () => {
    const item = {
      title: 'Week 1 debate',
      id: 77,
      message: '<h2>Prompt</h2><p>What do you think?</p>',
    };
    const md = canvasItemToMarkdown(item, 'discussion');

    assert.match(md, /## Prompt/);
    assert.match(md, /What do you think\?/);
  });

  it('drops a discussion field the Canvas topic no longer has', () => {
    const item = { title: 'Week 1 debate', id: 77, message: '<p>Hi.</p>' };
    const md = canvasItemToMarkdown(item, 'discussion', {
      existingFrontmatter: {
        discussion_type: 'threaded',
        lock_at: '2026-03-08T23:59:00Z',
        lesson: 3,
      },
    });

    assert.ok(
      !md.includes('discussion_type'),
      'Expected a threading change in Canvas to reach the file',
    );
    assert.ok(!md.includes('lock_at'), 'Expected the same for lock_at');
    assert.match(md, /lesson: 3/);
  });

  it('writes a quiz reference file from a module item', () => {
    const item = { title: 'Test 1', id: 800, content_id: 12 };
    const md = canvasItemToMarkdown(item, 'quiz');

    assert.match(md, /title: Test 1/);
    assert.match(md, /canvas_type: quiz/);
    assert.ok(
      !md.includes('canvas_id'),
      'the stub says what the file is, never which Canvas object it points at',
    );
  });

  it('gives a quiz no body, since its questions are not held here', () => {
    const md = canvasItemToMarkdown(
      { title: 'Test 1', content_id: 12, description: '<p>Read this.</p>' },
      'quiz',
    );

    assert.ok(!md.includes('Read this.'), 'Expected a frontmatter-only file');
  });

  it('keeps the quiz_ref a pull found in the local file', () => {
    const md = canvasItemToMarkdown(
      { title: 'Test 1', content_id: 12 },
      'quiz',
      {
        existingFrontmatter: {
          quiz_ref: 'evaluations/2526/test-1/test-1-qti.zip',
        },
      },
    );

    assert.match(md, /quiz_ref: evaluations\/2526\/test-1\/test-1-qti\.zip/);
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
    assert.ok(
      md.includes('external_url:'),
      'Expected external_url in frontmatter',
    );
    assert.ok(
      md.includes('https://example.com/resource'),
      'Expected URL in frontmatter',
    );
  });

  it('handles items with no body', () => {
    const item = { title: 'Empty', page_id: 999, url: 'empty', body: '' };
    const md = canvasItemToMarkdown(item, 'page');
    assert.match(md, /title: Empty/);
    assert.match(md, /canvas_type: page/);
  });

  it('carries over frontmatter keys Canvas knows nothing about', () => {
    const item = {
      title: 'Welcome',
      page_id: 100,
      url: 'welcome',
      body: '<p>Hello.</p>',
    };
    const md = canvasItemToMarkdown(item, 'page', {
      existingFrontmatter: {
        title: 'Stale local title',
        canvas_type: 'page',
        canvas_id: 100,
        export: true,
        lesson: 3,
        anything_at_all: 'kept',
      },
    });

    assert.match(md, /export: true/);
    assert.match(md, /lesson: 3/);
    assert.match(md, /anything_at_all: kept/);
    // Canvas stays authoritative for the keys it owns.
    assert.match(md, /title: Welcome/);
    assert.ok(
      !md.includes('Stale local title'),
      'Expected the Canvas title to win',
    );
    // A `canvas_id` an older version wrote is cleared, not carried over. It
    // is a Canvas-owned key with no value any more, so it goes the way any
    // owned key with no value goes — leaving it would leave a stale id in the
    // file to drift from the sync row for good.
    assert.ok(!md.includes('canvas_id'));
  });

  it('drops a Canvas-owned field the Canvas item no longer has', () => {
    const item = {
      name: 'Homework 1',
      id: 300,
      description: '<p>Do this.</p>',
      points_possible: 10,
    };
    const md = canvasItemToMarkdown(item, 'assignment', {
      existingFrontmatter: {
        due_at: '2025-03-15T23:59:00Z',
        lock_at: '2025-03-22T23:59:00Z',
        export: true,
      },
    });

    assert.ok(
      !md.includes('due_at'),
      'Expected a due date cleared in Canvas to clear locally',
    );
    assert.ok(!md.includes('lock_at'), 'Expected the same for lock_at');
    assert.match(md, /export: true/);
  });
});
