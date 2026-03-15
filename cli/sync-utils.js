const fs = require('fs');
const path = require('path');

const SYNC_FILE = path.resolve(process.cwd(), '.canvas-sync.json');

/**
 * Load the sync state file. Returns the parsed object, or a default empty
 * structure when the file is missing or corrupt.  Pass `{ allowNull: true }`
 * to return null instead of the default (used by status to detect first run).
 */
function loadSyncFile(options) {
  if (fs.existsSync(SYNC_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(SYNC_FILE, 'utf8'));
    } catch (_) {
      // Fall through
    }
  }

  if (options && options.allowNull) return null;

  return {
    schema_version: 2,
    canvas_base_url: process.env.CANVAS_API_URL || '',
    course_id: Number(process.env.CANVAS_COURSE_ID) || 0,
    modules: {},
    last_sync: null,
  };
}

/**
 * Write the sync state file atomically (write to .tmp, then rename).
 */
function saveSyncFile(syncData) {
  const tmpFile = SYNC_FILE + '.tmp';
  fs.writeFileSync(tmpFile, JSON.stringify(syncData, null, 2) + '\n', 'utf8');
  fs.renameSync(tmpFile, SYNC_FILE);
}

module.exports = { SYNC_FILE, loadSyncFile, saveSyncFile };
