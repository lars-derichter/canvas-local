const fs = require('fs');
const os = require('os');
const path = require('path');
const { filePreviewPath, uploadFile } = require('./files');
const { ICON_FILES, readIconSvg } = require('../convert/alert-icons');
const { loadTheme, themeFingerprint } = require('../config/theme');

/**
 * Ensure all alert icons are uploaded to Canvas, painted in the theme's colours.
 *
 * Checks syncData.icons for each type and uploads any icon that is missing or
 * was uploaded under a different theme. Uploaded file IDs, preview URLs and the
 * theme fingerprint are stored in syncData.icons.
 *
 * @param {string|number} courseId
 * @param {object} syncData - The sync data object (mutated in place).
 */
async function ensureIcons(courseId, syncData) {
  if (!syncData.icons) {
    syncData.icons = {};
  }

  // Its own copy of the `/api/v1` trim rather than `normaliseBaseUrl` from
  // lib/sync/state.js, which is the definition everywhere else uses: that module
  // sits a layer above this one, and lib/canvas must not reach up into lib/sync.
  // The two do not agree on a bare trailing slash, which this leaves in place —
  // harmless in practice because `init` writes `.env` already normalised, and a
  // difference to settle by moving the helper down a layer, not by copying it.
  const baseUrl = (process.env.CANVAS_API_URL || '').replace(
    /\/api\/v1\/?$/,
    '',
  );
  const theme = loadTheme();
  const fingerprint = themeFingerprint(theme);

  for (const [type, filename] of Object.entries(ICON_FILES)) {
    const current = syncData.icons[type];
    if (current && current.canvas_file_id && current.theme === fingerprint) {
      continue; // Already uploaded in the current theme's colours
    }

    let svg;
    try {
      svg = readIconSvg(type, theme.alerts[type].fg);
    } catch (err) {
      console.warn(
        `[icons] Warning: cannot read icon for "${type}": ${err.message}`,
      );
      continue;
    }

    // Canvas renders the icon as an <img>, so the colour has to be baked into
    // the file. Upload a coloured copy from a temp file rather than editing the
    // source SVG, which stays theme-neutral.
    const tmpPath = path.join(
      os.tmpdir(),
      `course-icon-${process.pid}-${filename}`,
    );
    fs.writeFileSync(tmpPath, svg, 'utf8');

    console.log(`[icons] Uploading ${filename} to Canvas...`);
    try {
      const result = await uploadFile(courseId, tmpPath, {
        parentFolderPath: '/course-icons',
        onDuplicate: 'overwrite',
      });

      const fileId = result.id;
      syncData.icons[type] = {
        canvas_file_id: fileId,
        preview_url: `${baseUrl}${filePreviewPath(courseId, fileId)}`,
        theme: fingerprint,
      };

      console.log(`[icons] Uploaded ${filename} (id: ${fileId})`);
    } finally {
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * Build an iconUrls map from sync data for use with markdownToHtml.
 *
 * @param {object} syncData
 * @returns {object} Map of alert type to Canvas preview URL.
 */
function getIconUrls(syncData) {
  const urls = {};
  if (syncData.icons) {
    for (const [type, data] of Object.entries(syncData.icons)) {
      if (data.preview_url) {
        urls[type] = data.preview_url;
      }
    }
  }
  return urls;
}

module.exports = { ensureIcons, getIconUrls };
