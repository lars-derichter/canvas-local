const { get, post, put, del } = require('./client');

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

/**
 * Map every page slug in a Canvas course to its numeric page id.
 *
 * A module item names a page by its slug (`page_url`) and never by its id,
 * while the sync state holds the numeric id, because that is the half of the
 * pair a rename does not change. The course's page list is the only place the
 * two meet, so pull builds this map first to spot a page renamed on Canvas.
 * Push does not: it matches its own items against the live module item list,
 * where an id is compared to an id and a slug to a slug.
 *
 * One request answers it for a whole run. Failure is the caller's to handle —
 * a pull without the map only loses its rename detection.
 *
 * @param {string|number} courseId
 * @param {Function} [fetchPages] - Injection point for tests.
 * @returns {Promise<Map<string, number>>}
 */
async function buildPageUrlToPageId(courseId, fetchPages = listPages) {
  const map = new Map();
  for (const page of (await fetchPages(courseId)) || []) {
    if (page.url && page.page_id) map.set(page.url, page.page_id);
  }
  return map;
}

module.exports = {
  listPages,
  getPage,
  createPage,
  updatePage,
  deletePage,
  buildPageUrlToPageId,
};
