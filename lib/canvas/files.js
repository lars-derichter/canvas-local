const fs = require('fs');
const path = require('path');
const { get, post, del, canvasRequest } = require('./client');
const { MIME_TYPES, detectContentType } = require('../convert/media-types');

/**
 * Where a stored file is addressed from inside a course, as a site-root-relative
 * path: `/courses/42/files/7/preview`.
 *
 * The one place this shape is written down. It is not just how a link is built:
 * it is also the string `state.files[].canvas_url` holds and the needle pull
 * matches a Canvas HTML `<img src>` against, so a link written one way and
 * looked up another would quietly stop recognising files it had already
 * downloaded. `lib/canvas/icons.js` puts the course's base URL in front of it to
 * get an absolute one; the sync engine keeps it relative.
 *
 * @param {string|number} courseId
 * @param {string|number} fileId
 * @returns {string}
 */
function filePreviewPath(courseId, fileId) {
  return `/courses/${courseId}/files/${fileId}/preview`;
}

/**
 * List files in a course, optionally scoped to a folder.
 *
 * @param {string|number} courseId
 * @param {string|number} [folderId] - If provided, list files within this folder
 */
function listFiles(courseId, folderId) {
  if (folderId) {
    return get(`/api/v1/folders/${folderId}/files`);
  }
  return get(`/api/v1/courses/${courseId}/files`);
}

/**
 * Upload a file to a Canvas course using the three-step upload process.
 *
 * Step 1: Notify Canvas of the upload and get a target URL.
 * Step 2: POST the file data to the target URL.
 * Step 3: Confirm the upload (Canvas may redirect; we follow it).
 *
 * @param {string|number} courseId
 * @param {string} filePath - Local path to the file
 * @param {object} [options]
 * @param {string} [options.name]         - Override the filename
 * @param {string} [options.contentType]  - MIME type (defaults to application/octet-stream)
 * @param {string} [options.parentFolderPath] - Folder path in Canvas (e.g. "/images")
 * @param {string|number} [options.parentFolderId] - Folder id in Canvas
 * @param {string} [options.onDuplicate]  - "overwrite" or "rename" (default: "overwrite")
 */
async function uploadFile(courseId, filePath, options = {}) {
  const stat = fs.statSync(filePath);
  const fileName = options.name || path.basename(filePath);
  const contentType = options.contentType || detectContentType(filePath);

  // --- Step 1: Request an upload URL from Canvas ---
  const step1Body = {
    name: fileName,
    size: stat.size,
    content_type: contentType,
    on_duplicate: options.onDuplicate || 'overwrite',
  };
  if (options.parentFolderPath)
    step1Body.parent_folder_path = options.parentFolderPath;
  if (options.parentFolderId)
    step1Body.parent_folder_id = options.parentFolderId;

  const uploadGrant = await post(
    `/api/v1/courses/${courseId}/files`,
    step1Body,
  );

  const { upload_url, upload_params } = uploadGrant;
  if (!upload_url) {
    throw new Error('Canvas did not return an upload_url in step 1');
  }

  // --- Step 2: POST the file to the upload URL ---
  const formData = new FormData();

  // Canvas requires the params returned in step 1 to be sent as form fields.
  if (upload_params) {
    for (const [key, value] of Object.entries(upload_params)) {
      formData.append(key, String(value));
    }
  }

  const fileBuffer = fs.readFileSync(filePath);
  const blob = new Blob([fileBuffer], { type: contentType });
  formData.append('file', blob, fileName);

  const step2Response = await fetch(upload_url, {
    method: 'POST',
    body: formData,
    // Do not follow redirects automatically so we can handle step 3 explicitly.
    redirect: 'manual',
  });

  // Canvas may respond with a 3xx redirect to the confirmation URL.
  if (step2Response.status >= 300 && step2Response.status < 400) {
    const confirmUrl = step2Response.headers.get('location');
    if (!confirmUrl) {
      throw new Error(
        'Canvas step 2 returned a redirect but no Location header',
      );
    }

    // --- Step 3: Confirm the upload ---
    return canvasRequest('GET', confirmUrl);
  }

  // Some Canvas configurations return 201 directly with the file JSON.
  if (step2Response.ok) {
    return step2Response.json();
  }

  let errorBody;
  try {
    errorBody = await step2Response.text();
  } catch {
    errorBody = '(unable to read response body)';
  }
  throw new Error(
    `Canvas file upload step 2 failed with status ${step2Response.status}: ${errorBody}`,
  );
}

/**
 * Read a file's metadata, which is where its `display_name` lives.
 *
 * A Canvas file id is global rather than scoped to a course, so this takes no
 * course id — the same shape as `deleteFile` below.
 *
 * @param {string|number} fileId
 */
function getFile(fileId) {
  return get(`/api/v1/files/${fileId}`);
}

/**
 * Delete a file.
 *
 * @param {string|number} fileId
 */
function deleteFile(fileId) {
  return del(`/api/v1/files/${fileId}`);
}

/**
 * Download a file from Canvas to a local path.
 *
 * @param {string|number} fileId - The Canvas file ID.
 * @param {string} destPath - Local path to save the file.
 */
async function downloadFile(fileId, destPath) {
  // Get file metadata (includes the download URL)
  const fileMeta = await get(`/api/v1/files/${fileId}`);
  const downloadUrl = fileMeta.url;
  if (!downloadUrl) {
    throw new Error(`Canvas file ${fileId} has no download URL`);
  }

  // Download the file content
  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new Error(`Failed to download file ${fileId}: ${response.status}`);
  }

  // Ensure parent directory exists
  const dir = path.dirname(destPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(destPath, buffer);
}

module.exports = {
  listFiles,
  uploadFile,
  getFile,
  deleteFile,
  downloadFile,
  detectContentType,
  filePreviewPath,
  MIME_TYPES,
};
