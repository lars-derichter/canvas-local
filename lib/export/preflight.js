const { execFile } = require('child_process');

/**
 * Minimum pandoc version. The Typst writer and reliable fenced-div handling
 * need pandoc 3.x; we require 3.1 as a safe floor.
 */
const MIN_PANDOC = { major: 3, minor: 1 };

const INSTALL_HINTS = {
  pandoc:
    'Install pandoc. It ships an installer you double-click, so this needs no\n' +
    'terminal. Download yours from https://pandoc.org/installing.html\n' +
    '  macOS:   the .pkg for your chip (arm64 for Apple Silicon, x86_64 for Intel)\n' +
    '  Windows: the .msi, which adds pandoc to your PATH for you\n' +
    '  Linux:   the .deb on Debian or Ubuntu; elsewhere your package manager',
  typst:
    'Install Typst. It ships no double-click installer, on any platform, so it\n' +
    'comes from a package manager:\n' +
    '  macOS:   brew install typst  (Homebrew, from https://brew.sh)\n' +
    '  Windows: winget install --id Typst.Typst  (winget comes with Windows 11)\n' +
    '  Linux:   sudo snap install typst  (it is in neither apt nor dnf)\n' +
    '  Docs:    https://github.com/typst/typst#installation',
};

/**
 * Promisified execFile that resolves with stdout, or rejects on failure
 * (including "command not found").
 */
function defaultExec(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

/**
 * Parse the major.minor version from `pandoc --version` output.
 * @param {string} stdout
 * @returns {{ major: number, minor: number, raw: string } | null}
 */
function parsePandocVersion(stdout) {
  const m = /pandoc(?:\.exe)?\s+(\d+)\.(\d+)(?:\.(\d+))?/i.exec(stdout);
  if (!m) return null;
  return { major: parseInt(m[1], 10), minor: parseInt(m[2], 10), raw: m[0] };
}

/**
 * Parse the Typst version from `typst --version` output.
 * @param {string} stdout
 * @returns {string | null}
 */
function parseTypstVersion(stdout) {
  const m = /typst\s+(\d+\.\d+\.\d+)/i.exec(stdout);
  return m ? m[1] : null;
}

function versionAtLeast(v, min) {
  return v.major > min.major || (v.major === min.major && v.minor >= min.minor);
}

/**
 * Verify the external tools needed for an export are installed and recent
 * enough. Throws an Error with friendly install instructions otherwise.
 *
 * @param {object} options
 * @param {string} [options.format] - 'pdf' (default) or 'docx'. Typst is only
 *   required for PDF.
 * @param {Function} [options.exec] - Injectable `(cmd, args) => Promise<stdout>`
 *   for tests.
 * @returns {Promise<{ pandoc: string, typst: string | null }>} Detected versions.
 */
async function preflight({ format = 'pdf', exec = defaultExec } = {}) {
  let pandocOut;
  try {
    pandocOut = await exec('pandoc', ['--version']);
  } catch {
    throw new Error(
      `pandoc was not found on your PATH.\n\n${INSTALL_HINTS.pandoc}`,
    );
  }
  const pandocVersion = parsePandocVersion(pandocOut);
  if (!pandocVersion) {
    throw new Error(
      `Could not read the pandoc version from its output.\n\n${INSTALL_HINTS.pandoc}`,
    );
  }
  if (!versionAtLeast(pandocVersion, MIN_PANDOC)) {
    throw new Error(
      `pandoc ${pandocVersion.major}.${pandocVersion.minor} is too old; ` +
        `export needs at least ${MIN_PANDOC.major}.${MIN_PANDOC.minor}.\n\n${INSTALL_HINTS.pandoc}`,
    );
  }

  let typstVersion = null;
  if (format === 'pdf') {
    let typstOut;
    try {
      typstOut = await exec('typst', ['--version']);
    } catch {
      throw new Error(
        `typst was not found on your PATH (needed for PDF export; DOCX export does not need it).\n\n${INSTALL_HINTS.typst}`,
      );
    }
    typstVersion = parseTypstVersion(typstOut);
  }

  return {
    pandoc: `${pandocVersion.major}.${pandocVersion.minor}`,
    typst: typstVersion,
  };
}

module.exports = {
  preflight,
  parsePandocVersion,
  parseTypstVersion,
  MIN_PANDOC,
  INSTALL_HINTS,
};
