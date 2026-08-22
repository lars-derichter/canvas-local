const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const REPO_CONFIG = path.join(REPO_ROOT, '.prettierrc.json');
const PRETTIER_CLI = path.join(
  REPO_ROOT,
  'node_modules',
  'prettier',
  'bin',
  'prettier.cjs',
);

/**
 * Give a temporary course tree the same Prettier configuration the repo has.
 *
 * Every local write this tool makes now goes through Prettier, resolved against
 * the path being written (`lib/convert/format-markdown.js`). A temp course
 * under `os.tmpdir()` is outside the repo, so `resolveConfig` finds nothing
 * there and the write falls back to Prettier's *defaults* — `proseWrap:
 * "preserve"`, `singleQuote: false` — which is not what a real course gets and
 * would leave the pull tests asserting against formatting production never
 * produces. It is also not a hypothetical: the difference already shows up as
 * a URL in frontmatter being re-quoted from `'…'` to `"…"`.
 *
 * The file is copied rather than written out, so the fixtures track
 * `.prettierrc.json` instead of holding a second copy of it that goes stale.
 */
function seedPrettierConfig(dir) {
  fs.copyFileSync(REPO_CONFIG, path.join(dir, '.prettierrc.json'));
  return dir;
}

/**
 * `prettier --check` on one file, run as a process from the tree that holds the
 * configuration.
 *
 * The point of shelling out is that this is the binary `npm run format` runs.
 * "The bytes this tool writes are the bytes `npm run format` would leave" is
 * the property the whole change rests on, and checking it with the same API
 * call that produced them would prove nothing. `node` runs the CLI's own entry
 * point rather than the `.bin` shim, so it does not depend on how npm linked
 * it.
 *
 * @returns {true|string} `true` when the file is already formatted, and
 *   Prettier's own complaint when it is not, so a failure says what is wrong.
 */
function prettierCheck(cwd, file) {
  const result = spawnSync(process.execPath, [PRETTIER_CLI, '--check', file], {
    cwd,
    encoding: 'utf8',
  });
  return result.status === 0 ? true : `${result.stdout}${result.stderr}`;
}

/**
 * What `npm run format` would leave in a file, obtained by actually running it.
 *
 * The file is copied aside first, so the caller's copy is left exactly as the
 * tool wrote it and the two can be compared byte for byte.
 */
function npmRunFormat(cwd, file) {
  const copy = path.join(
    path.dirname(file),
    `format-check-${path.basename(file)}`,
  );
  fs.copyFileSync(file, copy);
  const result = spawnSync(process.execPath, [PRETTIER_CLI, '--write', copy], {
    cwd,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(
      `prettier --write failed: ${result.stdout}${result.stderr}`,
    );
  }
  const formatted = fs.readFileSync(copy, 'utf8');
  fs.rmSync(copy);
  return formatted;
}

module.exports = {
  REPO_CONFIG,
  REPO_ROOT,
  npmRunFormat,
  prettierCheck,
  seedPrettierConfig,
};
