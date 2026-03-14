const { get, post, put, del } = require("./client");

/**
 * List all pages in a course.
 */
function listPages(courseId) {
  return get(`/api/v1/courses/${courseId}/pages`);
}

/**
 * Get a single page by URL slug or numeric id.
 *
 * @param {string|number} courseId
 * @param {string|number} urlOrId - The page URL slug (e.g. "welcome") or numeric id
 */
function getPage(courseId, urlOrId) {
  return get(`/api/v1/courses/${courseId}/pages/${urlOrId}`);
}

/**
 * Create a new wiki page.
 *
 * @param {string|number} courseId
 * @param {object} opts
 * @param {string} opts.title
 * @param {string} [opts.body]       - HTML content
 * @param {boolean} [opts.published]
 */
function createPage(courseId, { title, body, published } = {}) {
  const wiki_page = { title };
  if (body !== undefined) wiki_page.body = body;
  if (published !== undefined) wiki_page.published = published;
  return post(`/api/v1/courses/${courseId}/pages`, { wiki_page });
}

/**
 * Update an existing wiki page.
 *
 * @param {string|number} courseId
 * @param {string|number} urlOrId
 * @param {object} opts
 * @param {string} [opts.title]
 * @param {string} [opts.body]
 * @param {boolean} [opts.published]
 */
function updatePage(courseId, urlOrId, { title, body, published } = {}) {
  const wiki_page = {};
  if (title !== undefined) wiki_page.title = title;
  if (body !== undefined) wiki_page.body = body;
  if (published !== undefined) wiki_page.published = published;
  return put(`/api/v1/courses/${courseId}/pages/${urlOrId}`, { wiki_page });
}

/**
 * Delete a page.
 *
 * @param {string|number} courseId
 * @param {string|number} urlOrId - The page URL slug or numeric id
 */
function deletePage(courseId, urlOrId) {
  return del(`/api/v1/courses/${courseId}/pages/${urlOrId}`);
}

module.exports = { listPages, getPage, createPage, updatePage, deletePage };
