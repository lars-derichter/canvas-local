const { describe, it, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const prettier = require('prettier');

const {
  formatMarkdown,
  writeMarkdown,
} = require('../../lib/convert/format-markdown');
const {
  prettierCheck,
  seedPrettierConfig,
} = require('../helpers/prettier-config');

afterEach(() => mock.restoreAll());

/** A tree with the repo's own Prettier configuration at its root. */
function configuredTree() {
  return seedPrettierConfig(
    fs.mkdtempSync(path.join(os.tmpdir(), 'format-markdown-test-')),
  );
}

/** The same tree, with a deliberately different configuration. */
function tree(config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'format-markdown-test-'));
  fs.writeFileSync(
    path.join(dir, '.prettierrc.json'),
    JSON.stringify(config),
    'utf8',
  );
  return dir;
}

const LONG =
  'Dit is een paragraaf die van Canvas komt en die turndown op één lange ' +
  'regel heeft gezet, ver over de tachtig tekens, zoals elke gepulde pagina ' +
  'eruitziet.\n';

// ---------------------------------------------------------------------------

describe('formatMarkdown', () => {
  it('wraps prose the way the repo configuration says to', async () => {
    // `proseWrap: "always"` is the whole reason this module exists: turndown
    // wraps nothing, so without it every pull left a file the next
    // `npm run format` would rewrite.
    const dir = configuredTree();
    const out = await formatMarkdown(path.join(dir, 'a.md'), LONG);
    assert.ok(
      out.split('\n').length > 2,
      `not wrapped: ${JSON.stringify(out)}`,
    );
    assert.ok(
      out.split('\n').every((line) => line.length <= 80),
      `a line ran over: ${JSON.stringify(out)}`,
    );
  });

  it('resolves the configuration, so a different tree formats differently', async () => {
    // The claim a hardcoded `{ proseWrap: 'always' }` would also satisfy the
    // test above. What it would not satisfy is this: the options come from
    // whatever configuration governs the path handed in, so the day
    // `.prettierrc.json` changes, the writes change with it instead of
    // drifting away from `npm run format`.
    const preserved = await formatMarkdown(
      path.join(tree({ proseWrap: 'preserve' }), 'a.md'),
      LONG,
    );
    assert.equal(preserved, LONG, 'proseWrap: preserve was not honoured');

    const wrapped = await formatMarkdown(
      path.join(tree({ proseWrap: 'always' }), 'a.md'),
      LONG,
    );
    assert.notEqual(wrapped, LONG);
  });

  it('applies the per-extension overrides a resolved config carries', async () => {
    // `.prettierrc.json` sets `singleQuote: true` and overrides it back to
    // false for YAML. `resolveConfig` applies the override for the path it is
    // asked about; a config read raw and spread would not.
    const dir = configuredTree();
    const quoted = "---\nexternal_url: 'https://example.com'\n---\n";
    assert.equal(
      await formatMarkdown(path.join(dir, 'a.md'), quoted),
      quoted,
      'the markdown side wants single quotes and must leave these alone',
    );
  });

  it('is idempotent, so a second run over its own output changes nothing', async () => {
    // The property the sync engine leans on. If formatting were not a fixed
    // point, the row recorded after a write would describe bytes the next
    // format would move off again.
    const dir = configuredTree();
    const once = await formatMarkdown(path.join(dir, 'a.md'), LONG);
    assert.equal(await formatMarkdown(path.join(dir, 'a.md'), once), once);
  });
});

describe('a formatting failure costs the formatting, never the write', () => {
  /**
   * Prettier is stubbed rather than fed input that really throws.
   *
   * The trigger this guard was written for — malformed YAML frontmatter — turns
   * out not to throw at all: Prettier's markdown parser hands unparseable
   * frontmatter straight back and formats the body around it, and
   * `embeddedLanguageFormatting: "off"` keeps a broken code fence from being
   * parsed either. What does throw is pathological nesting, and a list nested
   * deep enough to overflow the stack takes over four seconds to fail, which is
   * not a thing to put in a suite that runs on every commit. So the contract is
   * asserted where it lives: whatever Prettier throws, the content survives.
   */
  function prettierThrows(message = 'Maximum call stack size exceeded') {
    mock.method(prettier, 'format', async () => {
      throw new RangeError(message);
    });
  }

  it('writes the unformatted bytes and warns', async () => {
    const dir = configuredTree();
    const file = path.join(dir, 'a.md');
    const warnings = [];
    prettierThrows();

    const returned = await writeMarkdown(file, LONG, (m) => warnings.push(m));

    assert.equal(fs.readFileSync(file, 'utf8'), LONG, 'the write was lost');
    assert.equal(returned, LONG, 'the caller must hash what landed');
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /could not format/i);
    assert.match(warnings[0], /a\.md/);
  });

  it('survives a configuration that cannot be read', async () => {
    // The other half of the same failure: `resolveConfig` throws on a config
    // file that is not valid JSON. A course is not worth losing over one.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'format-markdown-test-'));
    fs.writeFileSync(path.join(dir, '.prettierrc.json'), '{ not json', 'utf8');
    const file = path.join(dir, 'a.md');
    const warnings = [];

    assert.equal(
      await writeMarkdown(file, LONG, (m) => warnings.push(m)),
      LONG,
    );
    assert.equal(fs.readFileSync(file, 'utf8'), LONG);
    assert.equal(warnings.length, 1);
  });
});

describe('writeMarkdown', () => {
  it('returns the bytes that landed, not the ones handed in', async () => {
    // The whole reason it returns anything. Every caller records a fingerprint
    // from this value, and the invariant in `lib/sync/apply.js` is that the row
    // describes what is on disk.
    const dir = configuredTree();
    const file = path.join(dir, 'a.md');
    const returned = await writeMarkdown(file, LONG);
    assert.notEqual(returned, LONG, 'nothing was formatted at all');
    assert.equal(returned, fs.readFileSync(file, 'utf8'));
  });

  it('leaves what it wrote clean under the real Prettier CLI', async () => {
    // Asserted against the binary `npm run format` runs, not against the API
    // this module calls, because "the bytes written are the bytes
    // `npm run format` would leave" is the property the whole change rests on
    // and checking it with the same call that produced them would prove
    // nothing.
    const dir = configuredTree();
    const file = path.join(dir, 'a.md');
    await writeMarkdown(file, `---\ntitle: X\n---\n\n${LONG}`);
    assert.equal(prettierCheck(dir, file), true);
  });
});
