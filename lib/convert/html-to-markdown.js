const TurndownService = require('turndown');
const {
  strikethrough,
  tables,
  taskListItems,
} = require('@joplin/turndown-plugin-gfm');
const { serializeFrontmatter } = require('./frontmatter');
const { CANVAS_ITEM_URL_PATTERN } = require('./link-resolver');

/**
 * Reverse mapping from CSS class variant to GFM alert type.
 * caution -> ATTENTION because this project uses [!ATTENTION] not [!CAUTION].
 */
const ALERT_TYPE_MAP = {
  note: 'NOTE',
  tip: 'TIP',
  important: 'IMPORTANT',
  warning: 'WARNING',
  caution: 'ATTENTION',
  check: 'CHECK',
};

/**
 * A letter or a digit in any script, which is what CommonMark's flanking rules
 * for `_` count as a word character.
 */
const WORD_CHARACTER = /[\p{L}\p{N}]/u;

/**
 * An underscore CommonMark can only read as a literal character: one with a
 * word character on both sides. Built out of WORD_CHARACTER so this and the
 * emphasis rule below cannot drift apart — they are two halves of the same
 * flanking rule.
 */
const INTRAWORD_UNDERSCORE = new RegExp(
  `(?<=${WORD_CHARACTER.source})_(?=${WORD_CHARACTER.source})`,
  'gu',
);

/**
 * The stand-in an intraword underscore wears while turndown escapes the text
 * around it. See escapeKeepingIntrawordUnderscores below for why it is U+0000.
 */
const HIDDEN_UNDERSCORE = '\u0000';

/**
 * Escape markdown syntax in a text node the way turndown does, minus the
 * backslash it puts in front of an underscore markdown reads literally anyway.
 *
 * Turndown escapes every `_` it sees, so a pull brings `snake_case` back as
 * `snake\_case`. In a course about programming that noise is on most lines of a
 * pull diff and none of it means anything: an underscore with a word character
 * on both sides is preceded by an alphanumeric rather than by punctuation or
 * whitespace, so under CommonMark it can neither open nor close emphasis.
 * `snake_case` is literal text escaped or not.
 *
 * The invariant that makes this safe: every `_` that *could* delimit emphasis —
 * at either end of a word, against punctuation, alone between spaces, doubled
 * as in `__init__` — is still escaped, so no pair can form across the change.
 * Only `_` is let through. `*` stays escaped because CommonMark lets it delimit
 * emphasis intraword too; a backtick always opens a code span; `[` and `]` need
 * a parser to judge, because turndown escapes the text inside a link as well,
 * so an unescaped `]` there would cut the link in half.
 *
 * Rather than copy turndown's escape table into this repo minus its `_` row —
 * a dependency's internals to keep in step by hand — the intraword underscores
 * are swapped for a placeholder, turndown's own `escape` does all the work, and
 * the placeholder is swapped back. Turndown keeps owning what gets escaped, and
 * the restore pass can only touch the character this function put there itself.
 *
 * Two conditions hold that up, and it needs both of them (turndown 7.2.4,
 * escape table at `lib/turndown.cjs.js:52`):
 *
 *   1. No rule in that table matches U+0000, so the placeholder is neither
 *      escaped nor rewritten.
 *   2. No rule in it matches `_` either, bar the `_` rule being worked around.
 *      The swap is one character for one character at the same index, so to the
 *      other twelve rules the hidden string is the original string.
 *
 * The second is the easy one to leave out, and matching no rule is not enough
 * without it. Six of the thirteen rules are anchored to the start of the string
 * and read a prefix rather than a single character, so a swap those rules could
 * see — one that changed the length, or that took away a character their
 * prefixes match — would carry an escape off with it, and `-lead` that has lost
 * its backslash is a bullet on the next push rather than noise. Neither `_` nor
 * U+0000 appears in any of those prefixes, and the length never moves, so all
 * six fire or stay silent exactly as they would have. It is also why the trick
 * does not generalise: hiding a `-` or a `#` this way would suppress the very
 * rule it was hiding from.
 *
 * The test suite pins both conditions, so a turndown upgrade cannot break
 * either quietly.
 *
 * HTML parsing drops U+0000 before it can reach a text node, so the guard below
 * is belt and braces. If one ever did arrive, the text falls back to being
 * escaped in full, which is only noisy.
 *
 * @param {string} text - A text node's value.
 * @param {Function} escapeAll - Turndown's own `escape`.
 * @returns {string} The text with markdown syntax escaped.
 */
function escapeKeepingIntrawordUnderscores(text, escapeAll) {
  if (text.includes(HIDDEN_UNDERSCORE)) return escapeAll(text);
  const hidden = text.replace(INTRAWORD_UNDERSCORE, HIDDEN_UNDERSCORE);
  return escapeAll(hidden).split(HIDDEN_UNDERSCORE).join('_');
}

/**
 * A `<` that opens something rather than standing for itself: one with a
 * non-space character behind it, or one at the end of a text node, where the
 * character behind it belongs to a sibling this function cannot see.
 *
 * The negative lookahead is the whole rule, and it is drawn where MDX draws it
 * — see escapeOpeningAngleBrackets. `a < b` and `As a < type of user >` are
 * left alone, which is most of what a `<` is doing in course prose; `<tel nr>`,
 * `<3` and `x<y` are not.
 */
const OPENING_ANGLE_BRACKET = /<(?!\s)/g;

/**
 * Escape a `<` turndown hands back raw.
 *
 * Turndown's escape table has thirteen rules and no `<` among them, which is
 * defensible for CommonMark — `<div>` there is raw HTML, and passing it through
 * is the point. It is wrong for this project twice over.
 *
 * The preview is Docusaurus, so a page is MDX, and MDX reads `<` as the start
 * of a JSX element whenever the next character is not whitespace. A Canvas page
 * saying "text us on `&lt;tel nr&gt;`" comes back through turndown as a bare
 * `<tel nr>`, and `npm run build` then fails with "Expected a closing tag for
 * `<tel>`" — a page the author never wrote in markdown, breaking a build they
 * cannot obviously fix. `<[label](url)>` is the same fault with a different
 * message.
 *
 * The round trip is the second one, and it is the quieter of the two. Unescaped,
 * that `<tel nr>` goes back to Canvas on the next push as an HTML tag rather
 * than as the text it was, so the words disappear from the page. Escaped, marked
 * reads `\<` as the literal it is and writes `&lt;` — exactly what Canvas sent.
 *
 * Applied after turndown's own escape, never before: turndown's first rule
 * doubles every backslash it finds, so a `\<` inserted ahead of it would come
 * out as `\\<` — a literal backslash followed by an unescaped `<`, which is
 * both bugs at once.
 *
 * Only text nodes reach here. Real markup was parsed into elements long before
 * this, so a `<` at this point was `&lt;` in the Canvas HTML: content, not tags.
 *
 * @param {string} escaped - Text with turndown's escaping already applied.
 * @returns {string} The same, with opening angle brackets escaped.
 */
function escapeOpeningAngleBrackets(escaped) {
  return escaped.replace(OPENING_ANGLE_BRACKET, '\\<');
}

/**
 * The character of a sibling that sits against the node beside it: the last
 * character of the one before, the first character of the one after. A node at
 * the edge of its parent has no sibling on that side and gets an empty string,
 * which no rule below treats as a word character.
 *
 * @param {Node|null} sibling - `previousSibling` or `nextSibling`.
 * @param {'end'|'start'} edge - Which end of the sibling's text to read.
 * @returns {string} A single character, or `''`.
 */
function adjacentCharacter(sibling, edge) {
  const text = (sibling && sibling.textContent) || '';
  if (!text) return '';
  return edge === 'end' ? text[text.length - 1] : text[0];
}

/**
 * Convert an HTML string to markdown using Turndown.
 * @param {string} html - HTML content.
 * @param {object} [options] - Conversion options.
 * @param {Function} [options.linkResolver] - Callback `(href) => string|null` to resolve Canvas internal links back to relative paths.
 * @param {Function} [options.fileResolver] - Callback `(href) => string|null` to resolve Canvas file URLs back to relative paths.
 * @returns {string} Markdown string.
 */
function htmlToMarkdown(html, options = {}) {
  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',

    // An empty list item reaches turndown as `<li></li>`, which is blank by its
    // own test (`/^\s*$/` over textContent), so `rules.forNode` hands the node
    // to `blankRule` and the built-in `listItem` rule never runs. Turndown's
    // default blank replacement returns `''` for it and the item is gone: the
    // author's `- One`, `-`, `- Three` pulls back as a two-item list.
    //
    // The lost bullet is the visible half. The half that matters is that the
    // gap it leaves behind reads as a blank line, so `marked` re-reads the list
    // as loose on the next push and Canvas receives `<li><p>One</p></li>` where
    // it last received `<li>One</li>`. Push and pull then disagree about what
    // the page says, which is the round-trip invariant the converter suite
    // exists to hold.
    //
    // The item is handed to turndown's own `listItem` rule with empty content
    // instead. Delegating rather than rebuilding the prefix here keeps the
    // bullet marker, the `<ol start=…>` numbering offset and the trailing
    // newline in the one place that already owns them, so an empty item cannot
    // drift from a filled one across a turndown upgrade. The test suite pins
    // that `options.rules.listItem` is still where that rule lives.
    //
    // Every other blank node keeps turndown's default, byte for byte — the
    // `<p>&nbsp;</p>` spacer markdownToHtml emits after each alert included,
    // which is blank for the same reason and still collapses to nothing.
    blankReplacement(content, node, options) {
      if (node.nodeName === 'LI') {
        return options.rules.listItem.replacement('', node, options);
      }
      return node.isBlock ? '\n\n' : '';
    },
  });

  // Three of the five plugins @joplin/turndown-plugin-gfm exports, named one by
  // one rather than pulled in through its `gfm` bundle. Turndown's fallback for
  // a tag it has no rule for is to keep the text and drop the tag, so each of
  // these is content that a pull would otherwise silently lose:
  //
  //   tables         pipe tables (headerless Canvas RCE tables included)
  //   strikethrough  <del>, <s>, <strike> — the shape Canvas's editor emits
  //   taskListItems  <input type="checkbox"> in a list item, i.e. `- [ ]`
  //
  // The two left out: `highlightedCodeBlock` matches only GitHub's
  // `<div class="highlight-source-x"><pre>` wrapper, which nothing here or in
  // Canvas produces — the `<pre><code class="language-x">` that markdownToHtml
  // does emit is turndown's own built-in rule and round-trips unchanged. `gfm`
  // is the bundle of all four, so using it would drag that rule in as a side
  // effect.
  turndown.use(tables);
  turndown.use(strikethrough);
  turndown.use(taskListItems);

  // Text-node escaping, in two corrections to turndown's own. Minus its
  // blanket backslash in front of an underscore markdown reads literally
  // anyway — see escapeKeepingIntrawordUnderscores above — and plus the `<`
  // its table has no rule for, which MDX would read as a tag; see
  // escapeOpeningAngleBrackets, and note that it has to run last. `escape` is
  // a prototype method turndown calls as `self.escape(...)`, so an own
  // property here shadows it for this instance, the recursive
  // turndown.turndown() the alert rule makes included.
  const escapeAll = turndown.escape.bind(turndown);
  turndown.escape = (text) =>
    escapeOpeningAngleBrackets(
      escapeKeepingIntrawordUnderscores(text, escapeAll),
    );

  // Emphasis, with the delimiter chosen per node instead of fixed once by
  // turndown's `emDelimiter` option. `_` is the default because Prettier writes
  // `_` and because an unconditional `*` collapses `**_both_**` into
  // `***both***`, which CommonMark re-reads with the nesting inverted. `*` is
  // used against a word character because an underscore flanked by
  // alphanumerics can neither open nor close emphasis there, so a `<em>` inside
  // a word would come back as the literal text `2_3_4`.
  turndown.addRule('emphasis', {
    filter: ['em', 'i'],
    replacement(content, node) {
      // Turndown's own guard, kept: an empty <em> has nothing to wrap, and a
      // bare pair of delimiters would read as literal characters.
      if (!content.trim()) return '';
      const before = adjacentCharacter(node.previousSibling, 'end');
      const after = adjacentCharacter(node.nextSibling, 'start');
      const againstWord =
        WORD_CHARACTER.test(before) || WORD_CHARACTER.test(after);
      const delimiter = againstWord ? '*' : '_';
      return delimiter + content + delimiter;
    },
  });

  // Convert Canvas internal links back to relative markdown links
  if (options.linkResolver) {
    turndown.addRule('canvasInternalLink', {
      filter(node) {
        if (node.nodeName !== 'A') return false;
        const href = node.getAttribute('href') || '';
        return CANVAS_ITEM_URL_PATTERN.test(href);
      },
      replacement(content, node) {
        const href = node.getAttribute('href') || '';
        const resolved = options.linkResolver(href);
        const finalHref = resolved || href;
        const title = node.getAttribute('title');
        const titlePart = title ? ` "${title}"` : '';
        return `[${content}](${finalHref}${titlePart})`;
      },
    });
  }

  // Convert Canvas file URLs in images back to relative paths
  if (options.fileResolver) {
    turndown.addRule('canvasFileImage', {
      filter(node) {
        if (node.nodeName !== 'IMG') return false;
        const src = node.getAttribute('src') || '';
        return /\/courses\/\d+\/files\/\d+/.test(src);
      },
      replacement(content, node) {
        const src = node.getAttribute('src') || '';
        const resolved = options.fileResolver(src);
        const alt = node.getAttribute('alt') || '';
        const title = node.getAttribute('title');
        const titlePart = title ? ` "${title}"` : '';
        return `![${alt}](${resolved || src}${titlePart})`;
      },
    });

    turndown.addRule('canvasFileLink', {
      filter(node) {
        if (node.nodeName !== 'A') return false;
        const href = node.getAttribute('href') || '';
        // Match Canvas file URLs but not page/assignment/discussion URLs
        return (
          /\/courses\/\d+\/files\/\d+/.test(href) &&
          !CANVAS_ITEM_URL_PATTERN.test(href)
        );
      },
      replacement(content, node) {
        const href = node.getAttribute('href') || '';
        const resolved = options.fileResolver(href);
        const title = node.getAttribute('title');
        const titlePart = title ? ` "${title}"` : '';
        return `[${content}](${resolved || href}${titlePart})`;
      },
    });
  }

  // Convert alert divs back to GFM blockquote alert syntax
  turndown.addRule('gfmAlert', {
    filter(node) {
      return (
        node.nodeName === 'DIV' &&
        (node.getAttribute('class') || '').includes('markdown-alert')
      );
    },
    replacement(content, node) {
      // Extract type from class: "markdown-alert markdown-alert-note" -> "note"
      const classes = (node.getAttribute('class') || '').split(/\s+/);
      const typeClass = classes.find(
        (c) => c.startsWith('markdown-alert-') && c !== 'markdown-alert',
      );
      const variant = typeClass
        ? typeClass.replace('markdown-alert-', '')
        : 'note';
      const gfmType = ALERT_TYPE_MAP[variant] || variant.toUpperCase();

      // Collect body content, skipping the title paragraph
      const bodyParts = [];
      const childNodes = node.childNodes;
      for (let i = 0; i < childNodes.length; i++) {
        const child = childNodes[i];
        // Handle text nodes directly
        if (child.nodeType === 3) {
          const text = child.textContent.trim();
          if (text) bodyParts.push(text);
          continue;
        }
        if (child.nodeType !== 1) continue; // skip comment nodes
        const cls = child.getAttribute('class') || '';
        if (cls.includes('markdown-alert-title')) continue;
        const childMd = turndown.turndown(child.outerHTML).trim();
        if (childMd) {
          bodyParts.push(childMd);
        }
      }

      const body = bodyParts.join('\n\n');
      // Prefix each line with > for blockquote
      const quoted = body
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n');
      return `> [!${gfmType}]\n>\n${quoted}\n`;
    },
  });

  return turndown.turndown(html || '');
}

/**
 * Convert a Canvas API response object into a full markdown file string with
 * YAML frontmatter.
 *
 * @param {object} canvasItem - A Canvas API response object (page, assignment, etc.).
 * @param {'page'|'assignment'|'discussion'|'quiz'|'external_url'|'external_tool'} canvasType - The Canvas item type.
 * @param {object} [options] - Conversion options (forwarded to htmlToMarkdown).
 * @param {Function} [options.linkResolver] - Callback to resolve Canvas internal links.
 * @param {Function} [options.fileResolver] - Callback to resolve Canvas file URLs.
 * @param {object} [options.existingFrontmatter] - Frontmatter of the local file
 *   being overwritten. Keys Canvas owns are taken from the Canvas item; every
 *   other key is carried over, so local-only fields such as `export` or
 *   `lesson` survive a pull.
 * @returns {string} Complete markdown file content with frontmatter.
 */
function canvasItemToMarkdown(canvasItem, canvasType, options = {}) {
  const frontmatter = buildFrontmatter(
    canvasItem,
    canvasType,
    options.existingFrontmatter,
  );
  const html = getBodyHtml(canvasItem, canvasType);
  const body = html ? htmlToMarkdown(html, options) : '';

  return serializeFrontmatter(frontmatter, body);
}

/**
 * Frontmatter keys Canvas is authoritative for, per type. A key listed here is
 * always taken from the Canvas item — including when Canvas has no value for
 * it, so clearing a due date in Canvas clears it locally too. Anything not
 * listed belongs to the author and is preserved verbatim.
 *
 * `canvas_id` is listed and never given a value, which is how the key gets
 * cleared: it is owned, so it is not carried over from the local file, and
 * nothing below writes one back. It is not part of the frontmatter format at
 * all — which Canvas object a file is belongs to `.canvas-sync.json`, keyed by
 * the file's path — so one written into a file by hand is a second answer to a
 * question that has one, and leaving it in place would let it drift from the
 * row for good. `canvas_type` stays and keeps its value: that one is the
 * author's declaration of what the file should become, which Canvas confirms
 * rather than decides.
 */
const CANVAS_OWNED_KEYS = {
  common: ['title', 'canvas_type', 'canvas_id'],
  page: [],
  assignment: [
    'points_possible',
    'submission_types',
    'due_at',
    'lock_at',
    'unlock_at',
    'published',
  ],
  discussion: [
    'discussion_type',
    'require_initial_post',
    'published',
    'delayed_post_at',
    'lock_at',
  ],
  // Canvas owns nothing on a quiz beyond the common keys. `quiz_ref` names the
  // QTI package the quiz was imported from, which Canvas has never heard of, so
  // it has to survive every pull.
  quiz: [],
  external_url: ['external_url'],
  external_tool: ['external_url', 'new_tab'],
};

/**
 * Build frontmatter data from a Canvas API item based on its type.
 *
 * @param {object} item - Canvas API response object.
 * @param {'page'|'assignment'|'discussion'|'quiz'|'external_url'|'external_tool'} canvasType
 * @param {object} [existingFrontmatter] - Local frontmatter to carry forward.
 */
function buildFrontmatter(item, canvasType, existingFrontmatter) {
  const data = {
    title: item.title || item.name || '',
    canvas_type: canvasType,
  };

  // Type-specific fields
  if (canvasType === 'assignment') {
    if (item.points_possible != null) {
      data.points_possible = item.points_possible;
    }
    if (item.submission_types) {
      data.submission_types = item.submission_types;
    }
    if (item.due_at) {
      data.due_at = item.due_at;
    }
    if (item.lock_at) {
      data.lock_at = item.lock_at;
    }
    if (item.unlock_at) {
      data.unlock_at = item.unlock_at;
    }
    if (item.published != null) {
      data.published = item.published;
    }
  }

  if (canvasType === 'discussion') {
    if (item.discussion_type) {
      data.discussion_type = item.discussion_type;
    }
    if (item.require_initial_post != null) {
      data.require_initial_post = item.require_initial_post;
    }
    if (item.published != null) {
      data.published = item.published;
    }
    if (item.delayed_post_at) {
      data.delayed_post_at = item.delayed_post_at;
    }
    if (item.lock_at) {
      data.lock_at = item.lock_at;
    }
  }

  if (canvasType === 'external_url') {
    if (item.external_url) {
      data.external_url = item.external_url;
    }
  }

  // The launch URL is the whole identity of an LTI link: Canvas resolves which
  // tool answers it from the URL, so this is what has to come back down.
  if (canvasType === 'external_tool') {
    if (item.external_url) {
      data.external_url = item.external_url;
    }
    if (item.new_tab != null) {
      data.new_tab = item.new_tab;
    }
  }

  // Carry over the author's own keys. Canvas-owned keys are skipped so a value
  // Canvas no longer has does not linger locally.
  if (existingFrontmatter) {
    const owned = new Set([
      ...CANVAS_OWNED_KEYS.common,
      ...(CANVAS_OWNED_KEYS[canvasType] || []),
    ]);
    for (const [key, value] of Object.entries(existingFrontmatter)) {
      if (owned.has(key)) continue;
      data[key] = value;
    }
  }

  return data;
}

/**
 * Extract the HTML body from a Canvas API item based on its type.
 */
function getBodyHtml(item, canvasType) {
  if (canvasType === 'page') {
    return item.body || '';
  }
  if (canvasType === 'assignment') {
    return item.description || '';
  }
  if (canvasType === 'discussion') {
    return item.message || '';
  }
  // A quiz has no body of its own either: what a reader would call its content
  // is a list of questions that lives in Canvas and in the QTI package, and is
  // not markdown this project can hold. external_url and external_tool items
  // are links, with nothing behind them at all.
  return '';
}

module.exports = {
  htmlToMarkdown,
  canvasItemToMarkdown,
};
