const { get } = require('./client');

/**
 * List the external tools a course can launch.
 *
 * `include_parents=true` adds the tools installed on the account chain above
 * the course, which is where a school normally installs them: a course-level
 * install is the exception. The result is for reading aloud to a human, never
 * for deciding whether a launch URL works — see `findToolForUrl` for why.
 *
 * @param {string|number} courseId
 * @returns {Promise<object[]>} Canvas ExternalTool objects (`name`, `url`, `domain`).
 */
function listExternalTools(courseId) {
  return get(`/api/v1/courses/${courseId}/external_tools?include_parents=true`);
}

/**
 * The message a Canvas response body carries under `errors.external_tool`, or
 * null when it carries none. Only that field counts: a generic Canvas error
 * ("user not authorized") must not be read as "no tool matches this URL".
 */
function externalToolError(body) {
  if (!body || typeof body !== 'object' || !body.errors) return null;
  const raw = body.errors.external_tool;
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (typeof first === 'string') return first;
  if (first && typeof first.message === 'string') return first.message;
  return null;
}

/**
 * Dig the JSON body back out of the error the client throws on a non-2xx
 * response, whose message ends in `failed with status <code>: <body>`.
 * Returns null when there is no JSON to be had.
 */
function parseErrorBody(message) {
  const match = /failed with status \d+: ([\s\S]*)$/.exec(message || '');
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

/**
 * Ask Canvas whether any external tool in this course claims a launch URL.
 *
 * This has to be a probe rather than a lookup in `listExternalTools`, because
 * Canvas does not resolve a module item's tool by id. The controller treats
 * `module_item[content_id]` as no more than a *preferred* tool, honoured only
 * when its host matches the URL; what actually picks the tool is
 * `Lti::ToolFinder.from_url(external_url, context)`. When that finds nothing,
 * `ContextModule#add_item` substitutes a dummy unsaved tool and saves the item
 * anyway, so the POST returns 200 and a normal-looking module item. The failure
 * surfaces only when a student clicks it ("Couldn't find valid settings for
 * this link"). The sessionless-launch endpoint runs that same `ToolFinder`
 * against the same URL in the same context, so it is a faithful dry run of what
 * creating the item will resolve to.
 *
 * Listing the tools instead would be wrong in the other direction: for LTI 1.3
 * the list over-reports, because Canvas filters those further by context
 * controls that the list does not reflect.
 *
 * A probe that fails — network down, token without the right permission, an
 * endpoint the instance does not expose — is reported as `unknown`, never as a
 * match and never as a miss.
 *
 * @param {string|number} courseId
 * @param {string} launchUrl - The tool's launch URL, as it goes in `external_url`.
 * @returns {Promise<{status: 'resolves'|'no-match'|'unknown', toolId?: number,
 *   name?: string, launchUrl?: string, reason?: string}>}
 *   `resolves` — a tool claims the URL; `no-match` — none does, and a module
 *   item built on it would be born broken; `unknown` — the check could not be
 *   run, with `reason` saying why.
 */
async function findToolForUrl(courseId, launchUrl) {
  if (!launchUrl) {
    return { status: 'unknown', reason: 'no launch URL to check' };
  }

  const path =
    `/api/v1/courses/${courseId}/external_tools/sessionless_launch` +
    `?url=${encodeURIComponent(launchUrl)}`;

  let body;
  try {
    body = await get(path);
  } catch (err) {
    const errorBody = parseErrorBody(err.message);
    const toolError = externalToolError(errorBody);
    if (toolError) return { status: 'no-match', reason: toolError };
    return { status: 'unknown', reason: err.message };
  }

  // Canvas has also been known to answer 200 with an error body.
  const toolError = externalToolError(body);
  if (toolError) return { status: 'no-match', reason: toolError };

  if (body && body.url) {
    return {
      status: 'resolves',
      toolId: body.id != null ? body.id : null,
      name: body.name || null,
      launchUrl: body.url,
    };
  }

  return {
    status: 'unknown',
    reason: 'the sessionless launch response held no launch URL',
  };
}

/**
 * One clause naming the external tools a course can launch, for a warning that
 * has just said a launch URL matches none of them.
 *
 * @param {object[]} tools - Canvas ExternalTool objects, as listed.
 * @returns {string}
 */
function describeInstalledTools(tools) {
  const names = (tools || [])
    .map((tool) => tool && (tool.name || tool.domain))
    .filter(Boolean);
  if (names.length === 0) {
    return 'this course has no external tools installed at all';
  }
  return `the external tools installed here are: ${names.join(', ')}`;
}

module.exports = {
  listExternalTools,
  findToolForUrl,
  describeInstalledTools,
};
