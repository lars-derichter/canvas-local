const { get, post, put } = require("./client");

/**
 * List all assignments in a course.
 */
function listAssignments(courseId) {
  return get(`/api/v1/courses/${courseId}/assignments`);
}

/**
 * Get a single assignment.
 *
 * @param {string|number} courseId
 * @param {string|number} id
 */
function getAssignment(courseId, id) {
  return get(`/api/v1/courses/${courseId}/assignments/${id}`);
}

/**
 * Create a new assignment.
 *
 * @param {string|number} courseId
 * @param {object} opts
 * @param {string} opts.name
 * @param {string} [opts.description]         - HTML description
 * @param {number} [opts.pointsPossible]
 * @param {string[]} [opts.submissionTypes]   - e.g. ["online_upload", "online_text_entry"]
 * @param {string} [opts.dueAt]              - ISO 8601 date string
 * @param {boolean} [opts.published]
 */
function createAssignment(
  courseId,
  { name, description, pointsPossible, submissionTypes, dueAt, published } = {}
) {
  const assignment = { name };
  if (description !== undefined) assignment.description = description;
  if (pointsPossible !== undefined) assignment.points_possible = pointsPossible;
  if (submissionTypes !== undefined) assignment.submission_types = submissionTypes;
  if (dueAt !== undefined) assignment.due_at = dueAt;
  if (published !== undefined) assignment.published = published;
  return post(`/api/v1/courses/${courseId}/assignments`, { assignment });
}

/**
 * Update an existing assignment.
 *
 * @param {string|number} courseId
 * @param {string|number} id
 * @param {object} updates - camelCase fields: name, description, pointsPossible,
 *                           submissionTypes, dueAt, published, etc.
 */
function updateAssignment(courseId, id, updates = {}) {
  const assignment = {};
  if (updates.name !== undefined) assignment.name = updates.name;
  if (updates.description !== undefined) assignment.description = updates.description;
  if (updates.pointsPossible !== undefined) assignment.points_possible = updates.pointsPossible;
  if (updates.submissionTypes !== undefined) assignment.submission_types = updates.submissionTypes;
  if (updates.dueAt !== undefined) assignment.due_at = updates.dueAt;
  if (updates.published !== undefined) assignment.published = updates.published;
  return put(`/api/v1/courses/${courseId}/assignments/${id}`, { assignment });
}

module.exports = { listAssignments, getAssignment, createAssignment, updateAssignment };
