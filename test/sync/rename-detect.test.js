const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { detectRenames } = require('../../lib/sync/rename-detect');

/**
 * A base row as the sync state holds it, with only the fields rename detection
 * reads spelled out. `title` is optional on purpose — rows written before this
 * version store none, and the fallback to the Canvas title is a case worth
 * being able to build.
 */
function baseRow(itemPath, overrides = {}) {
  return {
    itemPath,
    row: {
      canvas_type: 'page',
      canvas_id: 1234,
      module_item_id: 5678,
      local_hash: 'hash-welcome',
      ...overrides,
    },
  };
}

/** An item as the working tree holds it. */
function localItem(itemPath, overrides = {}) {
  return {
    itemPath,
    title: 'Welcome',
    localHash: 'hash-welcome',
    ...overrides,
  };
}

/** Just the moves, as `from -> to (confidence)` strings, for readable asserts. */
function moves(result) {
  return result.renames.map((r) => `${r.from} -> ${r.to} (${r.confidence})`);
}

describe('detectRenames, step 1: identical content', () => {
  it('re-keys a plain rename inside one module', () => {
    const result = detectRenames({
      base: [baseRow('01-intro/01-welcome.md')],
      local: [localItem('01-intro/01-hello.md')],
    });

    assert.deepEqual(moves(result), [
      '01-intro/01-welcome.md -> 01-intro/01-hello.md (exact)',
    ]);
    assert.deepEqual(result.unmatchedBase, []);
    assert.deepEqual(result.unmatchedLocal, []);
  });

  it('follows a renumber', () => {
    const result = detectRenames({
      base: [baseRow('01-intro/01-welcome.md')],
      local: [localItem('01-intro/03-welcome.md')],
    });

    assert.deepEqual(moves(result), [
      '01-intro/01-welcome.md -> 01-intro/03-welcome.md (exact)',
    ]);
  });

  it('follows a file dragged into another module', () => {
    // The hash is strong enough to cross a directory, and this is the case the
    // per-module signature could not express at all.
    const result = detectRenames({
      base: [baseRow('01-intro/02-setup.md', { local_hash: 'hash-setup' })],
      local: [
        localItem('02-basics/01-setup.md', {
          title: 'Setup',
          localHash: 'hash-setup',
        }),
      ],
    });

    assert.deepEqual(moves(result), [
      '01-intro/02-setup.md -> 02-basics/01-setup.md (exact)',
    ]);
  });

  it('leaves a path that still has its file alone', () => {
    const result = detectRenames({
      base: [baseRow('01-intro/01-welcome.md')],
      local: [
        localItem('01-intro/01-welcome.md'),
        localItem('01-intro/09-copy.md'),
      ],
    });

    assert.deepEqual(moves(result), []);
    assert.deepEqual(
      result.unmatchedLocal,
      ['01-intro/09-copy.md'],
      'a second file with the same content is a new item, not a rename of one ' +
        'that never moved',
    );
  });

  it('ignores a row whose stored hash is missing', () => {
    const result = detectRenames({
      base: [baseRow('01-intro/01-welcome.md', { local_hash: undefined })],
      local: [localItem('01-intro/01-hello.md', { localHash: undefined })],
    });

    assert.deepEqual(
      moves(result),
      [],
      'two unknowns are not a match; matching them would be matching on silence',
    );
    assert.deepEqual(result.unmatchedBase, ['01-intro/01-welcome.md']);
    assert.deepEqual(result.unmatchedLocal, ['01-intro/01-hello.md']);
  });

  it('matches several renames in one pass', () => {
    const result = detectRenames({
      base: [
        baseRow('01-intro/01-welcome.md', { local_hash: 'hash-a' }),
        baseRow('01-intro/02-setup.md', { local_hash: 'hash-b' }),
      ],
      local: [
        localItem('01-intro/01-hello.md', { localHash: 'hash-a' }),
        localItem('01-intro/02-install.md', { localHash: 'hash-b' }),
      ],
    });

    assert.equal(result.renames.length, 2);
    assert.deepEqual(result.unmatchedBase, []);
    assert.deepEqual(result.unmatchedLocal, []);
  });

  it('reads a Windows path as the POSIX key it is stored under', () => {
    const result = detectRenames({
      base: [baseRow('01-intro\\01-welcome.md')],
      local: [localItem('01-intro\\01-hello.md')],
    });

    assert.deepEqual(moves(result), [
      '01-intro/01-welcome.md -> 01-intro/01-hello.md (exact)',
    ]);
  });
});

describe('detectRenames, step 2: renamed and edited', () => {
  it('reports a same-directory, same-title match as probable', () => {
    const result = detectRenames({
      base: [baseRow('01-intro/01-welcome.md', { title: 'Welcome' })],
      local: [localItem('01-intro/01-hello.md', { localHash: 'hash-edited' })],
    });

    assert.deepEqual(moves(result), [
      '01-intro/01-welcome.md -> 01-intro/01-hello.md (probable)',
    ]);
    assert.deepEqual(result.unmatchedBase, []);
    assert.deepEqual(result.unmatchedLocal, []);
  });

  it('falls back to the Canvas title when the row stores none', () => {
    const result = detectRenames({
      base: [baseRow('01-intro/01-welcome.md')],
      local: [localItem('01-intro/01-hello.md', { localHash: 'hash-edited' })],
      canvas: [
        {
          moduleItemId: 5678,
          canvasType: 'page',
          canvasId: 1234,
          title: 'Welcome',
        },
      ],
    });

    assert.deepEqual(moves(result), [
      '01-intro/01-welcome.md -> 01-intro/01-hello.md (probable)',
    ]);
  });

  it('finds the Canvas title through the content id as well', () => {
    const result = detectRenames({
      base: [baseRow('01-intro/01-welcome.md', { module_item_id: null })],
      local: [localItem('01-intro/01-hello.md', { localHash: 'hash-edited' })],
      canvas: [{ canvasType: 'page', canvasId: 1234, title: 'Welcome' }],
    });

    assert.deepEqual(moves(result), [
      '01-intro/01-welcome.md -> 01-intro/01-hello.md (probable)',
    ]);
  });

  it('will not cross a directory on a title alone', () => {
    const result = detectRenames({
      base: [baseRow('01-intro/09-summary.md', { title: 'Summary' })],
      local: [
        localItem('02-basics/09-summary.md', {
          title: 'Summary',
          localHash: 'hash-edited',
        }),
      ],
    });

    assert.deepEqual(
      moves(result),
      [],
      'every module has a Summary; a title is not evidence of a move',
    );
    assert.deepEqual(result.unmatchedBase, ['01-intro/09-summary.md']);
    assert.deepEqual(result.unmatchedLocal, ['02-basics/09-summary.md']);
  });

  it('will not match two rows that both name no title', () => {
    const result = detectRenames({
      base: [baseRow('01-intro/01-welcome.md')],
      local: [
        localItem('01-intro/01-hello.md', {
          title: undefined,
          localHash: 'hash-edited',
        }),
      ],
    });

    assert.deepEqual(moves(result), []);
  });

  it('treats a blank title as no title', () => {
    const result = detectRenames({
      base: [baseRow('01-intro/01-welcome.md', { title: '   ' })],
      local: [
        localItem('01-intro/01-hello.md', {
          title: '',
          localHash: 'hash-edited',
        }),
      ],
    });

    assert.deepEqual(moves(result), []);
  });

  it('compares titles trimmed', () => {
    const result = detectRenames({
      base: [baseRow('01-intro/01-welcome.md', { title: 'Welcome ' })],
      local: [
        localItem('01-intro/01-hello.md', {
          title: ' Welcome',
          localHash: 'hash-edited',
        }),
      ],
    });

    assert.deepEqual(moves(result), [
      '01-intro/01-welcome.md -> 01-intro/01-hello.md (probable)',
    ]);
  });

  it('prefers the hash match and leaves the title match for the leftovers', () => {
    const result = detectRenames({
      base: [
        baseRow('01-intro/01-welcome.md', {
          title: 'Welcome',
          local_hash: 'hash-a',
        }),
        baseRow('01-intro/02-setup.md', {
          title: 'Setup',
          local_hash: 'hash-b',
        }),
      ],
      local: [
        localItem('01-intro/01-hello.md', {
          title: 'Welcome',
          localHash: 'hash-a',
        }),
        localItem('01-intro/02-install.md', {
          title: 'Setup',
          localHash: 'hash-edited',
        }),
      ],
    });

    assert.deepEqual(moves(result), [
      '01-intro/01-welcome.md -> 01-intro/01-hello.md (exact)',
      '01-intro/02-setup.md -> 01-intro/02-install.md (probable)',
    ]);
  });
});

describe('detectRenames, step 3: genuine adds and deletes', () => {
  it('reports an unrelated delete and create as exactly that', () => {
    const result = detectRenames({
      base: [baseRow('01-intro/01-welcome.md', { title: 'Welcome' })],
      local: [
        localItem('01-intro/05-loops.md', {
          title: 'Loops',
          localHash: 'hash-loops',
        }),
      ],
    });

    assert.deepEqual(moves(result), []);
    assert.deepEqual(result.unmatchedBase, ['01-intro/01-welcome.md']);
    assert.deepEqual(result.unmatchedLocal, ['01-intro/05-loops.md']);
  });

  it('reports a pure deletion', () => {
    const result = detectRenames({
      base: [baseRow('01-intro/01-welcome.md')],
      local: [],
    });

    assert.deepEqual(result.unmatchedBase, ['01-intro/01-welcome.md']);
    assert.deepEqual(result.unmatchedLocal, []);
  });

  it('reports a pure addition', () => {
    const result = detectRenames({
      base: [],
      local: [localItem('01-intro/01-welcome.md')],
    });

    assert.deepEqual(result.unmatchedBase, []);
    assert.deepEqual(result.unmatchedLocal, ['01-intro/01-welcome.md']);
  });

  it('says nothing about a course where nothing moved', () => {
    const result = detectRenames({
      base: [baseRow('01-intro/01-welcome.md')],
      local: [localItem('01-intro/01-welcome.md')],
    });

    assert.deepEqual(result, {
      renames: [],
      unmatchedBase: [],
      unmatchedLocal: [],
    });
  });

  it('copes with being handed nothing at all', () => {
    assert.deepEqual(detectRenames(), {
      renames: [],
      unmatchedBase: [],
      unmatchedLocal: [],
    });
    assert.deepEqual(detectRenames({}), {
      renames: [],
      unmatchedBase: [],
      unmatchedLocal: [],
    });
  });
});

describe('detectRenames refuses ambiguity', () => {
  it('matches nothing when two untracked files share a hash', () => {
    // Two files with identical content genuinely are indistinguishable.
    const result = detectRenames({
      base: [baseRow('01-intro/01-welcome.md')],
      local: [
        localItem('01-intro/01-hello.md'),
        localItem('01-intro/02-hello-again.md'),
      ],
    });

    assert.deepEqual(moves(result), []);
    assert.deepEqual(result.unmatchedBase, ['01-intro/01-welcome.md']);
    assert.deepEqual(result.unmatchedLocal, [
      '01-intro/01-hello.md',
      '01-intro/02-hello-again.md',
    ]);
  });

  it('matches nothing when two base rows share a hash', () => {
    const result = detectRenames({
      base: [
        baseRow('01-intro/01-welcome.md'),
        baseRow('01-intro/02-welcome-copy.md', { canvas_id: 1235 }),
      ],
      local: [localItem('01-intro/01-hello.md')],
    });

    assert.deepEqual(moves(result), []);
    assert.deepEqual(result.unmatchedBase, [
      '01-intro/01-welcome.md',
      '01-intro/02-welcome-copy.md',
    ]);
    assert.deepEqual(result.unmatchedLocal, ['01-intro/01-hello.md']);
  });

  it('matches nothing when two untracked files share a directory and title', () => {
    const result = detectRenames({
      base: [baseRow('01-intro/01-welcome.md', { title: 'Welcome' })],
      local: [
        localItem('01-intro/01-hello.md', { localHash: 'hash-x' }),
        localItem('01-intro/02-hi.md', { localHash: 'hash-y' }),
      ],
    });

    assert.deepEqual(moves(result), []);
  });

  it('matches nothing when two base rows share a directory and title', () => {
    const result = detectRenames({
      base: [
        baseRow('01-intro/01-welcome.md', { title: 'Welcome' }),
        baseRow('01-intro/02-welcome-again.md', {
          title: 'Welcome',
          canvas_id: 1235,
          local_hash: 'hash-other',
        }),
      ],
      local: [localItem('01-intro/01-hello.md', { localHash: 'hash-edited' })],
    });

    assert.deepEqual(moves(result), []);
    assert.deepEqual(result.unmatchedLocal, ['01-intro/01-hello.md']);
  });

  it('still matches the unambiguous pair beside an ambiguous one', () => {
    const result = detectRenames({
      base: [
        baseRow('01-intro/01-welcome.md', { local_hash: 'hash-dup' }),
        baseRow('01-intro/02-copy.md', { local_hash: 'hash-dup' }),
        baseRow('01-intro/03-setup.md', { local_hash: 'hash-setup' }),
      ],
      local: [
        localItem('01-intro/01-hello.md', { localHash: 'hash-dup' }),
        localItem('01-intro/02-hello-copy.md', { localHash: 'hash-dup' }),
        localItem('01-intro/03-install.md', { localHash: 'hash-setup' }),
      ],
    });

    assert.deepEqual(moves(result), [
      '01-intro/03-setup.md -> 01-intro/03-install.md (exact)',
    ]);
    assert.deepEqual(result.unmatchedBase, [
      '01-intro/01-welcome.md',
      '01-intro/02-copy.md',
    ]);
    assert.deepEqual(result.unmatchedLocal, [
      '01-intro/01-hello.md',
      '01-intro/02-hello-copy.md',
    ]);
  });
});
