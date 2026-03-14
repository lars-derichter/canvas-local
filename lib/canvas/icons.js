const fs = require('fs');
const path = require('path');
const { uploadFile } = require('./files');

/**
 * Mapping from admonition type to SVG filename in src/svg-icons/.
 */
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
 * Ensure all admonition icons are uploaded to Canvas.
 *
 * Checks syncData.icons for each type and uploads any missing icons.
 * Uploaded file IDs and preview URLs are stored in syncData.icons.
 *
 * @param {string|number} courseId
 * @param {object} syncData - The sync data object (mutated in place).
 */
async function ensureIcons(courseId, syncData) {
  if (!syncData.icons) {
    syncData.icons = {};
  }

  const baseUrl = (process.env.CANVAS_API_URL || '').replace(/\/api\/v1\/?$/, '');

  for (const [type, filename] of Object.entries(ICON_FILES)) {
    if (syncData.icons[type] && syncData.icons[type].canvas_file_id) {
      continue; // Already uploaded
    }

    const filePath = path.join(ICONS_DIR, filename);
    if (!fs.existsSync(filePath)) {
      console.warn(`[icons] Warning: icon file not found: ${filePath}`);
      continue;
    }

    console.log(`[icons] Uploading ${filename} to Canvas...`);
    const result = await uploadFile(courseId, filePath, {
      parentFolderPath: '/course-icons',
      onDuplicate: 'overwrite',
    });

    const fileId = result.id;
    const previewUrl = `${baseUrl}/courses/${courseId}/files/${fileId}/preview`;

    syncData.icons[type] = {
      canvas_file_id: fileId,
      preview_url: previewUrl,
    };

    console.log(`[icons] Uploaded ${filename} (id: ${fileId})`);
  }
}

/**
 * Build an iconUrls map from sync data for use with markdownToHtml.
 *
 * @param {object} syncData
 * @returns {object} Map of admonition type to Canvas preview URL.
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
