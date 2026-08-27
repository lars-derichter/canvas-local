const path = require('path');

/**
 * What kind of file an extension names. This is vocabulary rather than the
 * property of any one output format, which is why it sits in the conversion
 * layer instead of with any one reader — the Canvas upload in lib/canvas
 * stamps its content type from here, and the preview site's remark plugin
 * decides from here whether a file item gets an inline preview.
 */

/**
 * Common MIME types by file extension.
 */
const MIME_TYPES = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx':
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx':
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.zip': 'application/zip',
  '.gz': 'application/gzip',
  '.tar': 'application/x-tar',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.py': 'text/x-python',
  '.java': 'text/x-java-source',
  '.c': 'text/x-c',
  '.cpp': 'text/x-c++src',
  '.rb': 'text/x-ruby',
};

/**
 * Detect MIME type from file extension.
 */
function detectContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

/**
 * Classify a filename as embeddable media by its extension: 'image', 'video'
 * or 'audio', or null for everything else (including unknown extensions).
 */
function mediaKind(filePath) {
  const type = MIME_TYPES[path.extname(filePath).toLowerCase()];
  if (!type) return null;
  const prefix = type.split('/', 1)[0];
  return prefix === 'image' || prefix === 'video' || prefix === 'audio'
    ? prefix
    : null;
}

module.exports = {
  MIME_TYPES,
  detectContentType,
  mediaKind,
};
