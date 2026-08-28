const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  COMMAND_SYNC_STATE_POLICY,
  GUARD,
  NEVER_OPENS,
  READS_ANY_COURSE,
} = require('../../cli/sync-state-guard');

/**
 * The mismatch guard's three-way split is documented in prose, and the prose
 * enumerates commands by name. Nothing ties those sentences to
 * `COMMAND_SYNC_STATE_POLICY` at runtime, so this file does: it reads the
 * docs, pulls the command names out of the load-bearing sentences, and holds
 * them against the table. A command that changes class in the table fails
 * here until the prose moves with it.
 *
 * The canonical list lives in one place, `docs/troubleshooting.md` under
 * ".canvas-sync.json describes course N". The other pages defer to it and
 * repeat only the facts their own steps turn on, and those repeats are
 * checked too.
 */

const DOCS = path.join(__dirname, '..', '..', 'docs');

function readDoc(name) {
  return fs.readFileSync(path.join(DOCS, name), 'utf8');
}

/** A regex for a prose fragment that prettier may rewrap at any space. */
function wrapped(fragment) {
  return new RegExp(
    fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+'),
  );
}

/** Every command of one policy class, sorted. */
function ofClass(cls) {
  return Object.keys(COMMAND_SYNC_STATE_POLICY)
    .filter((name) => COMMAND_SYNC_STATE_POLICY[name] === cls)
    .sort();
}

/**
 * The registered commands a passage names in backticks. `npx course X` and a
 * command quoted with flags (`push --prune-canvas`) both count as naming X;
 * backticked things that are not commands (`.env`, file paths) fall out on
 * the policy-table lookup.
 */
function commandsNamedIn(text) {
  const names = new Set();
  for (const match of text.matchAll(/`([^`]+)`/g)) {
    const first = match[1].replace(/^npx course /, '').split(/[\s=]/)[0];
    if (first in COMMAND_SYNC_STATE_POLICY) names.add(first);
  }
  return [...names].sort();
}

describe('the mismatch-guard split, as the docs tell it', () => {
  const troubleshooting = readDoc('troubleshooting.md');
  const sectionMatch = troubleshooting.match(
    /### "\.canvas-sync\.json describes course N"\n([\s\S]*?)(?=\n### )/,
  );

  it('troubleshooting.md still has the canonical section', () => {
    assert.ok(
      sectionMatch,
      'docs/troubleshooting.md no longer has the section ' +
        '".canvas-sync.json describes course N" — the canonical list of ' +
        'guarded and unguarded commands lived there, and ' +
        'cli/sync-state-guard.js points authors at it.',
    );
  });

  const section = sectionMatch ? sectionMatch[1] : '';
  const paragraphs = section.split('\n\n');

  it('the pass-through paragraph names exactly the unguarded commands', () => {
    const para = paragraphs.find((p) =>
      p.startsWith('Do not read the refusal as a guard on everything.'),
    );
    assert.ok(
      para,
      'The paragraph opening "Do not read the refusal as a guard on ' +
        'everything." is gone from the section — it is where the unguarded ' +
        'commands are enumerated.',
    );
    assert.deepEqual(
      commandsNamedIn(para),
      [...ofClass(READS_ANY_COURSE), ...ofClass(NEVER_OPENS)].sort(),
      'The unguarded commands the paragraph names have drifted from ' +
        'COMMAND_SYNC_STATE_POLICY in cli/sync-state-guard.js. Update ' +
        'whichever side is behind.',
    );
  });

  it('the refusal paragraph names only guarded commands', () => {
    const named = commandsNamedIn(paragraphs[0]);
    const unguarded = named.filter(
      (name) => COMMAND_SYNC_STATE_POLICY[name] !== GUARD,
    );
    assert.deepEqual(
      unguarded,
      [],
      'The opening paragraph, which lists the commands the mismatch stops, ' +
        `names commands the policy table does not guard: ${unguarded}.`,
    );
  });

  it('the guarded class is the shape the prose describes', () => {
    // The paragraph compresses the list to "`sync`, `push`, `pull`,
    // `status`, the item commands and all four module commands". That
    // wording is only true while the guarded class is exactly those groups.
    const moduleCommands = ofClass(GUARD).filter((name) =>
      name.endsWith('-module'),
    );
    const itemCommands = ofClass(GUARD).filter(
      (name) => name.endsWith('-item') || name.endsWith('-items'),
    );
    assert.equal(
      moduleCommands.length,
      4,
      '"all four module commands" in docs/troubleshooting.md is no longer ' +
        `four: ${moduleCommands}.`,
    );
    assert.deepEqual(
      ofClass(GUARD),
      [
        ...moduleCommands,
        ...itemCommands,
        'pull',
        'push',
        'status',
        'sync',
      ].sort(),
      'A guarded command fits none of the groups the paragraph names ' +
        '(the four reconcile commands, the item commands, the module ' +
        'commands) — the prose has to name it.',
    );
  });

  it('new-academic-year.md repeats only facts the table still holds', () => {
    const doc = readDoc('new-academic-year.md');
    assert.match(
      doc,
      wrapped('`reset-canvas` never opens the sync state'),
      'docs/new-academic-year.md no longer says `reset-canvas` never opens ' +
        'the sync state; step 3 of the rollover leans on that fact.',
    );
    assert.equal(COMMAND_SYNC_STATE_POLICY['reset-canvas'], NEVER_OPENS);
    assert.match(
      doc,
      wrapped('`new-module` is among the commands that refuse'),
      'docs/new-academic-year.md no longer says `new-module` refuses during ' +
        'the mismatch window; the "lay out modules after step 5" advice ' +
        'leans on that fact.',
    );
    assert.equal(COMMAND_SYNC_STATE_POLICY['new-module'], GUARD);
  });

  it('advanced-commands.md defers to the canonical list', () => {
    assert.match(
      readDoc('advanced-commands.md'),
      /troubleshooting\.md#canvas-syncjson-describes-course-n/,
      'docs/advanced-commands.md no longer links the canonical list in ' +
        'troubleshooting.md — it must defer rather than keep a copy.',
    );
  });
});
