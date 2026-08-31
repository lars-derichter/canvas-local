const path = require('path');

const { toSlug, truncateSlug } = require('./module-utils');

/**
 * Create a numbered folder name from a module name and position.
 * "Introduction" at position 1 -> "01-introduction"
 */
function toFolderName(name, position) {
  const prefix = String(position).padStart(2, '0');
  return `${prefix}-${toSlug(name)}`;
}

/**
 * Create a numbered file name from an item title and position.
 * "Welcome" at position 1 -> "01-welcome.md"
 */
function toFileName(title, position) {
  const prefix = String(position).padStart(2, '0');
  return `${prefix}-${toSlug(title)}.md`;
}

/**
 * Slugify a filename while preserving its extension.
 * Unlike toSlug, dots are kept so the extension survives.
 * "diagram.svg" -> "diagram.svg", "My File.PDF" -> "my-file.pdf"
 *
 * The length cap `toSlug` applies is applied here too, but to the stem alone:
 * a truncated extension is a file the operating system opens with the wrong
 * application, which is a worse outcome than a long name. `path.extname`
 * decides where the stem ends, so a dotfile — which it reports as having no
 * extension — is capped whole.
 */
function toFileSlug(name) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const ext = path.extname(slug);
  const stem = ext ? slug.slice(0, -ext.length) : slug;
  return truncateSlug(stem) + ext;
}

/**
 * Compute the posix-style relative path for a file within a module folder.
 * e.g. "01-intro/02-welcome.md"
 */
function computeRelativePath(folderName, filePath, courseDir) {
  return path.posix.join(
    folderName,
    path
      .relative(path.join(courseDir, folderName), filePath)
      .split(path.sep)
      .join('/'),
  );
}

module.exports = { toFolderName, toFileName, toFileSlug, computeRelativePath };
