const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  resolveStyle,
  resolveAsset,
  resolveStyleDir,
  SHARED_ASSETS,
  STYLES_DIR,
} = require('../../lib/export/style-resolver');

// These run against the repo's own export-styles/ folder: the point is to catch
// a style that has been moved, renamed or left incomplete.
describe('resolveStyleDir', () => {
  it('treats a bare name as a built-in style', () => {
    assert.strictEqual(
      resolveStyleDir('generic'),
      path.join(STYLES_DIR, 'generic'),
    );
  });

  it('treats a path as relative to the project root', () => {
    assert.ok(
      resolveStyleDir('sources/mine').endsWith(path.join('sources', 'mine')),
    );
  });
});

describe('resolveAsset', () => {
  const styleDir = resolveStyleDir('thomas-more');

  it('resolves pipeline files at the root of export-styles/', () => {
    for (const filename of SHARED_ASSETS) {
      assert.strictEqual(
        resolveAsset(filename, undefined, styleDir),
        path.join(STYLES_DIR, filename),
      );
    }
  });

  it('resolves look files inside the selected style', () => {
    assert.strictEqual(
      resolveAsset('template.typ', undefined, styleDir),
      path.join(styleDir, 'template.typ'),
    );
  });

  it('lets an explicit override win', () => {
    // Absolute by the host's own reckoning: an override is resolved against the
    // cwd, and on Windows `/tmp/mine.typ` names no drive, so resolving it
    // returns a path with the cwd's drive grafted on rather than the string
    // passed in. A path the platform already calls complete comes back as is.
    const override = path.resolve('/tmp/mine.typ');
    assert.strictEqual(
      resolveAsset('template.typ', override, styleDir),
      override,
    );
  });
});

describe('resolveStyle', () => {
  it('resolves every shipped style to files that exist', () => {
    for (const name of ['generic', 'thomas-more']) {
      const style = resolveStyle({ style: name });
      assert.strictEqual(style.name, name);
      for (const key of [
        'template',
        'referenceDoc',
        'filter',
        'defaultsFile',
        'sample',
      ]) {
        assert.ok(
          fs.existsSync(style[key]),
          `${name}: missing ${key} at ${style[key]}`,
        );
      }
    }
  });

  it('ships a cover logo with every style', () => {
    for (const name of ['generic', 'thomas-more']) {
      const { logo } = resolveStyle({ style: name });
      assert.ok(logo && fs.existsSync(logo), `${name}: missing logo.png`);
    }
  });

  it('only bundles fonts where the style needs them', () => {
    assert.strictEqual(resolveStyle({ style: 'generic' }).fontsDir, null);
    assert.ok(resolveStyle({ style: 'thomas-more' }).fontsDir);
  });

  it('throws on an unknown style', () => {
    assert.throws(
      () => resolveStyle({ style: 'no-such-style' }),
      /Unknown export style/,
    );
  });
});
