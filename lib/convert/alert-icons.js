const fs = require('fs');
const path = require('path');

/** Alert type -> SVG filename in src/svg-icons/. The keys are the six alert
 *  kinds, and lib/convert/markdown-to-html.js reads this map for them alone, so
 *  they have to stay in step with ALERT_KINDS in lib/config/theme.js — which is
 *  where an added kind gets its colour tokens. */
const ICON_FILES = {
  note: 'info.svg',
  tip: 'tip.svg',
  important: 'important.svg',
  warning: 'warning.svg',
  caution: 'caution.svg',
  check: 'check.svg',
};

const ICONS_DIR = path.resolve(__dirname, '../../src/svg-icons');

/**
 * Read an alert icon and paint it in the theme's colour for that kind.
 *
 * The files on disk carry `fill="currentColor"` so they stay valid SVGs and
 * inherit colour when inlined. Canvas renders them as <img>, where
 * `currentColor` resolves to nothing useful, so the colour is substituted
 * before the icon is uploaded or turned into a data URI.
 *
 * @param {string} kind - Alert kind, e.g. 'note'.
 * @param {string} color - Any CSS colour, normally theme.alerts[kind].fg.
 * @returns {string} The SVG source.
 */
function readIconSvg(kind, color) {
  const filename = ICON_FILES[kind];
  if (!filename) throw new Error(`No alert icon for kind "${kind}"`);
  const svg = fs.readFileSync(path.join(ICONS_DIR, filename), 'utf8');
  return svg.replace(/currentColor/g, color);
}

module.exports = { ICON_FILES, readIconSvg };
