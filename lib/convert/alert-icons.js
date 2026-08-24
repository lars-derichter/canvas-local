const fs = require('fs');
const path = require('path');

/**
 * The two tables an alert is read through, in the order a marker travels them:
 * which spelling means which kind, and which icon that kind wears. Both are
 * about the alert vocabulary rather than about any one output format, which is
 * why they sit in the conversion layer instead of with any one reader — the
 * Canvas converter beside them, the icon upload in lib/canvas, the PDF export
 * in lib/export and the preview site's remark plugin all read from here.
 */

/**
 * Every GFM alert marker this project recognises, lower-cased, mapped to the
 * canonical kind it renders as. `attention` is an alias for `caution`; `check`
 * is a project-specific extra. Every value is one of the kinds in ALERT_KINDS
 * (lib/config/theme.js), which is where a kind gets its colour tokens.
 *
 * This is the single definition of the marker table. lib/export/preprocess.js
 * reads it to turn a `> [!NOTE]` blockquote into a pandoc div, and
 * src/plugins/remark-gfm-alerts.js derives both its upper-cased lookup and the
 * regex that matches a marker from these keys, so the PDF export and the
 * preview site cannot end up recognising different markers.
 *
 * A table is not the only way the `attention` alias is encoded, and the other
 * two are deliberately left out of this one. lib/convert/markdown-to-html.js
 * rewrites `[!ATTENTION]` to `[!CAUTION]` in the source text before parsing,
 * because the vocabulary there belongs to marked-alert — GFM's own markers plus
 * the `check` variant this project registers — and `attention` is not in it.
 * lib/convert/html-to-markdown.js maps the `caution` CSS class back to
 * `ATTENTION` on the way out, because that is the spelling this project writes.
 * Each is a one-way conversion against a vocabulary this table does not own, so
 * folding them in would make one map mean three different things.
 */
const ALERT_KIND_MAP = {
  note: 'note',
  tip: 'tip',
  important: 'important',
  warning: 'warning',
  caution: 'caution',
  attention: 'caution',
  check: 'check',
};

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

module.exports = { ALERT_KIND_MAP, ICON_FILES, readIconSvg };
