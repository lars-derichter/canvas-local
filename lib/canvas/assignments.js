const { get, post, put, del } = require('./client');

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
 * @param {string} [opts.unlockAt]            - ISO 8601 date string
 * @param {string} [opts.lockAt]              - ISO 8601 date string
 * @param {boolean} [opts.published]
 */
function createAssignment(
  courseId,
  {
    name,
    description,
    pointsPossible,
    submissionTypes,
    dueAt,
    unlockAt,
    lockAt,
    published,
  } = {},
) {
  const assignment = { name };
  if (description !== undefined) assignment.description = description;
  if (pointsPossible !== undefined) assignment.points_possible = pointsPossible;
  if (submissionTypes !== undefined)
    assignment.submission_types = submissionTypes;
  if (dueAt !== undefined) assignment.due_at = dueAt;
  if (unlockAt !== undefined) assignment.unlock_at = unlockAt;
  if (lockAt !== undefined) assignment.lock_at = lockAt;
  if (published !== undefined) assignment.published = published;
  return post(`/api/v1/courses/${courseId}/assignments`, { assignment });
}

/**
 * Update an existing assignment.
 *
 * @param {string|number} courseId
 * @param {string|number} id
 * @param {object} updates - camelCase fields: name, description, pointsPossible,
 *                           submissionTypes, dueAt, unlockAt, lockAt,
 *                           published, etc.
 */
function updateAssignment(courseId, id, updates = {}) {
  const assignment = {};
  if (updates.name !== undefined) assignment.name = updates.name;
  if (updates.description !== undefined)
    assignment.description = updates.description;
  if (updates.pointsPossible !== undefined)
    assignment.points_possible = updates.pointsPossible;
  if (updates.submissionTypes !== undefined)
    assignment.submission_types = updates.submissionTypes;
  if (updates.dueAt !== undefined) assignment.due_at = updates.dueAt;
  if (updates.unlockAt !== undefined) assignment.unlock_at = updates.unlockAt;
  if (updates.lockAt !== undefined) assignment.lock_at = updates.lockAt;
  if (updates.published !== undefined) assignment.published = updates.published;
  return put(`/api/v1/courses/${courseId}/assignments/${id}`, { assignment });
}

/**
 * Delete an assignment.
 *
 * @param {string|number} courseId
 * @param {string|number} id
 */
function deleteAssignment(courseId, id) {
  return del(`/api/v1/courses/${courseId}/assignments/${id}`);
}

/**
 * Whether this Assignment is the gradebook half of a Classic Quiz.
 *
 * A graded Classic Quiz (`quiz_type: "assignment"`) is two objects in Canvas:
 * the Quiz that holds the questions, and an Assignment that holds its column in
 * the gradebook. The second one is returned by
 * `GET /courses/:id/assignments` alongside the real assignments, flagged
 * `is_quiz_assignment: true`, carrying the quiz's id in `quiz_id` and
 * `submission_types: ["online_quiz"]`.
 *
 * Deleting that assignment deletes the quiz — not its gradebook column alone,
 * but the quiz object, its questions and every submission on it. Verified
 * against a live course: the `DELETE` came back `workflow_state: "deleted"` and
 * left the course with no quizzes at all. So anything that deletes assignments
 * in bulk has to ask this question first. A quiz has no markdown source here
 * (see `lib/canvas/quizzes.js`): it came from a QTI package imported by hand,
 * and nothing in this project could rebuild one.
 *
 * A practice quiz (`quiz_type: "practice_quiz"`) has no gradebook column, never
 * appears in the assignments list, and is therefore never at risk from this.
 *
 * New Quizzes are deliberately not covered. A New Quiz is genuinely an
 * assignment — one that launches an LTI tool
 * (`submission_types: ["external_tool"]`, flagged `is_quiz_lti_assignment`)
 * rather than shadowing a separate Quiz object — so it carries neither field
 * read here, and there is no second object behind it for this to protect.
 * Nothing in this project handles New Quizzes as a type either: `canvas_type:
 * quiz` means the Classic kind, resolved against the course's quiz list by id
 * or title, so a New Quiz is content the tool never made and cannot tell apart
 * from an ordinary assignment. Deleting one is therefore allowed — and costly,
 * which is what `isNewQuizAssignment` is for.
 *
 * @param {object} assignment - A Canvas Assignment object.
 * @returns {boolean}
 */
function isQuizBackedAssignment(assignment) {
  if (!assignment) return false;
  return assignment.is_quiz_assignment === true || assignment.quiz_id != null;
}

/**
 * Whether this Assignment is a New Quiz.
 *
 * Canvas flags a New Quiz `is_quiz_lti_assignment: true`. It is an assignment
 * that launches the Quizzes.Next LTI tool, so it carries neither
 * `is_quiz_assignment` nor `quiz_id`, and `isQuizBackedAssignment` rightly says
 * no: there is no separate Quiz object to protect.
 *
 * This is not a reason to skip one. A New Quiz is an assignment, this project
 * treats it as an assignment, and a command that deletes assignments deletes
 * it. It is a reason to say so out loud: the `DELETE` takes the quiz's
 * questions and every submission on it, and nothing in this project could
 * rebuild the questions — they have no markdown source here, unlike an
 * assignment body.
 *
 * @param {object} assignment - A Canvas Assignment object.
 * @returns {boolean}
 */
function isNewQuizAssignment(assignment) {
  if (!assignment) return false;
  return assignment.is_quiz_lti_assignment === true;
}

/**
 * Whether a Canvas Assignment already holds student submissions.
 *
 * Canvas puts `has_submitted_submissions` on every Assignment object it
 * returns, in list responses as well as single fetches, so a caller that
 * already holds the object needs no extra request.
 *
 * Returns null when the field is missing — a trimmed response, an older
 * Canvas — because "could not tell" must never be reported as "no grades at
 * stake".
 *
 * @param {object} assignment - A Canvas Assignment object.
 * @returns {boolean|null} true, false, or null when it cannot be determined.
 */
function hasStudentSubmissions(assignment) {
  if (!assignment || typeof assignment.has_submitted_submissions !== 'boolean')
    return null;
  return assignment.has_submitted_submissions;
}

/**
 * What a caller has to know before deleting an assignment, for every assignment
 * in a course, keyed by String(id).
 *
 * One list request answers the question for the whole course, because the
 * Assignment objects a list returns already carry the flag. Looking up N ids
 * therefore costs one call, not N.
 *
 * An id absent from the map is not in the course at all — already deleted on
 * Canvas — which is a different answer from an id mapped to a null
 * `hasSubmissions` (present, but its submission state could not be read).
 *
 * The record carries `isNewQuiz` beside `hasSubmissions` because the same list
 * response already holds whole Assignment objects, so the flag is free here and
 * would cost a second pass over the course anywhere else. A prune needs it: a
 * New Quiz among its deletes has to be named as one, since deleting it takes
 * questions nothing in this project could rebuild.
 *
 * @param {string|number} courseId
 * @returns {Promise<Map<string, {hasSubmissions: boolean|null, isNewQuiz: boolean}>>}
 */
async function getSubmissionStates(courseId) {
  const assignments = await listAssignments(courseId);
  const states = new Map();
  for (const assignment of assignments || []) {
    states.set(String(assignment.id), {
      hasSubmissions: hasStudentSubmissions(assignment),
      isNewQuiz: isNewQuizAssignment(assignment),
    });
  }
  return states;
}

module.exports = {
  listAssignments,
  getAssignment,
  createAssignment,
  updateAssignment,
  deleteAssignment,
  isQuizBackedAssignment,
  isNewQuizAssignment,
  hasStudentSubmissions,
  getSubmissionStates,
};
