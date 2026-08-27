const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

/**
 * The command labels the documentation prints, against the ones the extension
 * declares.
 *
 * Every other guard in this directory holds the extension to its manifest. This
 * one holds the prose to it, which until now nothing did: `docs/vscode.md`
 * prints four tables of command titles and the tutorial pages print more, and a
 * title renamed in `package.json` left all of them quietly wrong. That is not
 * hypothetical. The docs pass this test arrived with found a stale icon claim,
 * a menu entry that had moved, four labels missing the `...` the manifest
 * carries, and a title-bar entry documented under a name no command has ever
 * had — none of which any test could see, because a false sentence compiles.
 *
 * Two rules, in both directions:
 *
 * 1. Every `Course:`-prefixed run of text in the documentation is a title some
 *    command declares, character for character.
 * 2. Every title the manifest declares is printed somewhere in the
 *    documentation, character for character.
 *
 * The second is the one that catches a command shipped without a word written
 * about it, which is how a feature ends up reachable and undiscovered.
 */

const ROOT = path.resolve(__dirname, '../..');
const MANIFEST = path.join(
  ROOT,
  '.vscode',
  'extensions',
  'course-manager',
  'package.json',
);

const titles = JSON.parse(
  fs.readFileSync(MANIFEST, 'utf-8'),
).contributes.commands.map((command) => command.title);

/**
 * Longest first, so a title that is a prefix of another cannot answer for it.
 * `Course: Push to Canvas` is a prefix of `Course: Push to Canvas (Dry Run)`,
 * and matching the short one first would let the docs drop the `(Dry Run)` from
 * a label and still pass.
 */
const byLength = [...titles].sort((a, b) => b.length - a.length);

/**
 * Every markdown file the project ships, asked of git rather than walked.
 *
 * A walk would have to skip `node_modules`, the downloaded editor, the build
 * output, `exports/` and the scratch notes under `tmp/`, and that skip list is
 * a hand-maintained thing that rots: the first ignored directory somebody adds
 * arrives here as a failure about labels in a file nobody ships. Git already
 * holds the answer to "what does this project consist of", and the scratch
 * notes are the case that proves the point — they quote the wrong labels
 * deliberately, being the record of what the labels used to be.
 */
function markdownFiles() {
  const listed = cp.execFileSync('git', ['ls-files', '-z', '--', '*.md'], {
    cwd: ROOT,
    encoding: 'utf-8',
    maxBuffer: 16 * 1024 * 1024,
  });
  return listed.split('\0').filter(Boolean).sort();
}

/**
 * The floor that says the file list is still a file list.
 *
 * The project carries well over a hundred tracked markdown files. A list that
 * comes back with a handful means git answered a narrower question than this
 * meant to ask, and both rules below would then pass over nothing and report
 * success, which is the one outcome a guard must never reach by accident.
 */
const MINIMUM_DOCS = 40;

/**
 * How many distinct titles the prose has to be found printing before the match
 * is believed.
 *
 * Rule 2 already requires all of them, so this looks redundant, and it is not:
 * if `flatten` below ever stops producing text these titles can be found in —
 * a markdown convention it does not know about, a change in how Prettier wraps
 * — then rule 1 sees no labels and passes vacuously while rule 2 fails with
 * thirty-nine confusing misses. The floor makes that failure say what it is.
 */
const MINIMUM_LABELS = 30;

/**
 * One markdown file as a single line of text a title can be found in.
 *
 * Prettier owns the wrapping in this project and wraps prose at 80 characters,
 * so a label longer than a few words is routinely split across a newline and
 * sometimes across a blockquote marker as well. Reading line by line finds
 * `Course: Export Course to` and reports a label no command declares, which is
 * a bug in the reader rather than in the prose. So: strip the callout markers,
 * join, drop the emphasis and code spans that bracket a label mid-sentence, and
 * collapse every run of whitespace to one space.
 */
function flatten(raw) {
  return raw
    .split('\n')
    .map((line) => line.replace(/^\s*>\s?/, ''))
    .join(' ')
    .replace(/\*\*|`/g, '')
    .replace(/\s+/g, ' ');
}

/**
 * The one thing in the docs that reads like a label and is not: the instruction
 * to type `Course:` into the palette to filter it. Both pages that give it
 * quote the string, so the exemption is a quote character rather than a list of
 * files, and it cannot widen to cover a real label: `Course: New Item` does not
 * have a quote after the colon.
 */
const FILTER_STRING = /^Course: ?["”'’]/;

const docs = markdownFiles().map((name) => ({
  name,
  text: flatten(fs.readFileSync(path.join(ROOT, ...name.split('/')), 'utf-8')),
}));

describe('VS Code extension: the labels the documentation prints', () => {
  it('walks the markdown it is meant to be checking', () => {
    assert.ok(
      docs.length >= MINIMUM_DOCS,
      `the walk found ${docs.length} markdown files, expected at least ` +
        `${MINIMUM_DOCS}; it has stopped descending`,
    );
    assert.ok(
      docs.some((doc) => doc.name === 'docs/vscode.md'),
      'docs/vscode.md is the page this rule exists for and the walk missed it',
    );
  });

  it('prints only labels a command actually declares', () => {
    const wrong = [];
    const matched = new Set();
    for (const doc of docs) {
      for (const found of doc.text.matchAll(/Course:/g)) {
        const at = found.index;
        const title = byLength.find((candidate) =>
          doc.text.startsWith(candidate, at),
        );
        if (title) {
          matched.add(title);
          continue;
        }
        if (FILTER_STRING.test(doc.text.slice(at, at + 12))) continue;
        wrong.push(`${doc.name}: ...${doc.text.slice(at, at + 60)}...`);
      }
    }

    assert.ok(
      matched.size >= MINIMUM_LABELS,
      `only ${matched.size} distinct titles were found printed anywhere, ` +
        `expected at least ${MINIMUM_LABELS}; the reader is not reading`,
    );
    assert.deepEqual(
      wrong,
      [],
      `the documentation prints ${wrong.length} label(s) no command declares. ` +
        'Copy the title from the extension manifest, including its trailing ' +
        `"...":\n  ${wrong.join('\n  ')}`,
    );
  });

  it('documents every command it declares', () => {
    const undocumented = titles.filter(
      (title) => !docs.some((doc) => doc.text.includes(title)),
    );
    assert.deepEqual(
      undocumented,
      [],
      `${undocumented.length} command(s) are declared and documented nowhere. ` +
        'A command nobody writes about is a command nobody finds:\n  ' +
        undocumented.join('\n  '),
    );
  });
});
