const { get, post, put, del } = require("./client");

/**
 * List all modules in a course.
 */
function listModules(courseId) {
  return get(`/api/v1/courses/${courseId}/modules`);
}

/**
 * Create a new module.
 *
 * @param {string|number} courseId
 * @param {object} opts
 * @param {string} opts.name
 * @param {number} [opts.position]
 */
function createModule(courseId, { name, position } = {}) {
  const module = { name };
  if (position !== undefined) module.position = position;
  return post(`/api/v1/courses/${courseId}/modules`, { module });
}

/**
 * Update an existing module.
 *
 * @param {string|number} courseId
 * @param {string|number} moduleId
 * @param {object} opts
 * @param {string} [opts.name]
 * @param {number} [opts.position]
 */
function updateModule(courseId, moduleId, { name, position } = {}) {
  const module = {};
  if (name !== undefined) module.name = name;
  if (position !== undefined) module.position = position;
  return put(`/api/v1/courses/${courseId}/modules/${moduleId}`, { module });
}

/**
 * Delete a module.
 */
function deleteModule(courseId, moduleId) {
  return del(`/api/v1/courses/${courseId}/modules/${moduleId}`);
}

/**
 * List all items in a module.
 */
function listModuleItems(courseId, moduleId) {
  return get(`/api/v1/courses/${courseId}/modules/${moduleId}/items`);
}

/**
 * Create a new item inside a module.
 *
 * @param {string|number} courseId
 * @param {string|number} moduleId
 * @param {object} opts
 * @param {string} opts.title
 * @param {string} opts.type - One of: File, Page, Discussion, Assignment, Quiz,
 *                              SubHeader, ExternalUrl, ExternalTool
 * @param {string|number} [opts.contentId] - The id of the content item (page id, assignment id, etc.)
 * @param {number} [opts.position]
 * @param {number} [opts.indent] - 0-5
 * @param {string} [opts.externalUrl]
 * @param {boolean} [opts.newTab]
 */
function createModuleItem(
  courseId,
  moduleId,
  { title, type, contentId, position, indent, externalUrl, newTab } = {}
) {
  const module_item = { title, type };
  if (contentId !== undefined) module_item.content_id = contentId;
  if (position !== undefined) module_item.position = position;
  if (indent !== undefined) module_item.indent = indent;
  if (externalUrl !== undefined) module_item.external_url = externalUrl;
  if (newTab !== undefined) module_item.new_tab = newTab;
  return post(`/api/v1/courses/${courseId}/modules/${moduleId}/items`, {
    module_item,
  });
}

/**
 * Update an existing module item.
 *
 * @param {string|number} courseId
 * @param {string|number} moduleId
 * @param {string|number} itemId
 * @param {object} updates - Fields to update (title, position, indent, external_url, new_tab, etc.)
 */
function updateModuleItem(courseId, moduleId, itemId, updates = {}) {
  const module_item = {};
  if (updates.title !== undefined) module_item.title = updates.title;
  if (updates.position !== undefined) module_item.position = updates.position;
  if (updates.indent !== undefined) module_item.indent = updates.indent;
  if (updates.externalUrl !== undefined) module_item.external_url = updates.externalUrl;
  if (updates.newTab !== undefined) module_item.new_tab = updates.newTab;
  if (updates.published !== undefined) module_item.published = updates.published;
  return put(
    `/api/v1/courses/${courseId}/modules/${moduleId}/items/${itemId}`,
    { module_item }
  );
}

module.exports = {
  listModules,
  createModule,
  updateModule,
  deleteModule,
  listModuleItems,
  createModuleItem,
  updateModuleItem,
};
