const log = require('../../cli/logger');

const RATE_LIMIT_THRESHOLD = 50;
const RATE_LIMIT_DELAY_MS = 1000;
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;
// Without a timeout a dead socket hangs the CLI forever; 60s is generous
// enough for Canvas's slowest endpoints.
const REQUEST_TIMEOUT_MS = 60000;
// A server's Retry-After is honoured but capped, so a confused server cannot
// park a sync run for an hour.
const RETRY_AFTER_CAP_MS = 60000;
const ERROR_BODY_SNIPPET_LENGTH = 300;

/**
 * A non-2xx answer from Canvas, carrying the failure as data — `status`,
 * `method`, `path` and a `body` snippet capped at ERROR_BODY_SNIPPET_LENGTH —
 * so callers can branch on `err.status` instead of parsing the message. The
 * message itself keeps the exact `Canvas API … failed with status <code>:
 * <body>` shape with the full body, because the external-tools probe still
 * JSON-parses the body back out of the message tail.
 */
class CanvasApiError extends Error {
  constructor({ method, path, status, body, describe = `${method} ${path}` }) {
    super(`Canvas API ${describe} failed with status ${status}: ${body}`);
    this.name = 'CanvasApiError';
    this.status = status;
    this.method = method;
    this.path = path;
    this.body = String(body).slice(0, ERROR_BODY_SNIPPET_LENGTH);
  }
}

/**
 * A 5xx: the server failed, and may or may not have executed the request
 * before it did.
 */
function isServerError(status) {
  return status >= 500 && status <= 599;
}

/**
 * Whether this 403 is Canvas throttling rather than a real permission error.
 * Canvas reports hitting the rate limit as 403 with the literal "Rate Limit
 * Exceeded" in the body (not as 429), and a drained quota header says the
 * same thing. Only that 403 is transient; a plain 403 will not get better by
 * asking again.
 */
function isThrottled403(status, errorBody, remaining) {
  if (status !== 403) return false;
  if (errorBody.includes('Rate Limit Exceeded')) return true;
  return (
    remaining !== null && remaining.trim() !== '' && Number(remaining) === 0
  );
}

/**
 * The wait the server asked for before retrying, in milliseconds, or null to
 * fall back to exponential backoff. Only the delta-seconds form of
 * `Retry-After` is honoured, capped at RETRY_AFTER_CAP_MS.
 */
function retryAfterMs(response) {
  const header = response.headers.get('retry-after');
  if (header === null || header.trim() === '') return null;
  const seconds = Number(header);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.min(seconds * 1000, RETRY_AFTER_CAP_MS);
}

/**
 * Sleep for the given number of milliseconds.
 */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * A Canvas base URL in the one shape `.env`, `.canvas-sync.json` and every
 * human-facing Canvas link are written in: no trailing slash, no `/api/v1`
 * suffix. `init` writes `.env` through here, so a value that came from `init`
 * already satisfies it; a hand-edited or hand-copied one may not.
 *
 * It lives here, in the Canvas layer, because what a Canvas address looks like
 * is Canvas knowledge and everything that needs it sits above: lib/sync/state.js
 * compares `.env` against the sync file, cli/init.js writes both,
 * lib/canvas/icons.js and src/plugins/remark-reference-item.js put it in front
 * of a site-root-relative path to get a link a human can click.
 *
 * `getConfig` below keeps its own, narrower trim rather than calling this: two
 * jobs on the same string. This one produces the canonical identity a stored URL
 * is compared against and a link is built from; `getConfig` only makes the
 * address safe to concatenate an API path onto, and leaving the two apart is
 * what keeps the HTTP client sending requests to the address it was given.
 *
 * @param {string} url - Any base URL, including a missing or empty one.
 * @returns {string} The normalised URL, or '' when there was nothing to
 *   normalise.
 */
function normaliseBaseUrl(url) {
  if (!url) return '';
  return String(url)
    .replace(/\/+$/, '')
    .replace(/\/api\/v1$/, '')
    .replace(/\/+$/, '');
}

function getConfig() {
  const apiUrl = process.env.CANVAS_API_URL;
  const apiToken = process.env.CANVAS_API_TOKEN;
  if (!apiUrl) throw new Error('CANVAS_API_URL is not set in environment');
  if (!apiToken) throw new Error('CANVAS_API_TOKEN is not set in environment');
  // Trailing slashes only, so `${apiUrl}${path}` cannot double one. Not
  // `normaliseBaseUrl`: an `/api/v1` left in `CANVAS_API_URL` makes every
  // request carry it twice and fail, which says a misconfigured `.env` out
  // loud instead of quietly calling an address nobody configured.
  return { apiUrl: apiUrl.replace(/\/+$/, ''), apiToken };
}

/**
 * Parse the Link header returned by Canvas to find the next page URL.
 * Format: <https://...?page=2&per_page=10>; rel="next", <...>; rel="last"
 *
 * Matched against the whole header rather than split on ',' first, because a
 * comma is legal inside a URL and splitting would cut the next link in half.
 */
function getNextUrl(linkHeader) {
  if (!linkHeader) return null;
  const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
  return match ? match[1] : null;
}

/**
 * One HTTP request with the client's whole resilience policy: a timeout on
 * every attempt, retries with Retry-After or exponential backoff, rate-limit
 * pauses, and typed errors. The single-request path and the pagination loop
 * both go through here, so the two cannot drift apart.
 *
 * @param {string} method - HTTP method; drives which failures are retried.
 * @param {string} url    - Absolute URL to fetch.
 * @param {object} opts   - fetch options (headers, body); the abort signal is
 *                          owned here.
 * @param {{path: string, describe: string}} context - `path` lands on the
 *   thrown CanvasApiError; `describe` names the request in messages
 *   ("GET /api/…" or "pagination GET https://…").
 * @returns {Promise<Response>} The successful (2xx) response.
 */
async function fetchWithRetry(method, url, opts, { path, describe }) {
  // Set by a retryable response for the wait before the next attempt; null
  // means exponential backoff.
  let retryAfter = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay =
        retryAfter ?? INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
      log.info(
        `[canvas] Retrying ${describe} (attempt ${attempt + 1}/${MAX_RETRIES + 1}) after ${delay}ms...`,
      );
      await sleep(delay);
      retryAfter = null;
    }

    let response;
    try {
      // A fresh signal per attempt: AbortSignal.timeout starts its clock at
      // creation, so a shared signal would count the backoff sleeps against
      // the request's own budget.
      response = await fetch(url, {
        ...opts,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      // Network error (ECONNRESET, DNS, etc.) or timeout. Either way the
      // connection died without an answer, which leaves it unknown whether
      // the server processed the request, so non-idempotent POSTs are not
      // retried — a duplicate page or assignment is worse than a clean
      // failure.
      if (method !== 'POST' && attempt < MAX_RETRIES) continue;
      const reason =
        err.name === 'TimeoutError'
          ? `request timed out after ${REQUEST_TIMEOUT_MS}ms`
          : err.message;
      throw new Error(
        `Canvas API ${describe} failed after ${attempt + 1} attempt(s): ${reason}`,
        { cause: err },
      );
    }

    // Rate-limit awareness: pause when we are running low on quota.
    const remaining = response.headers.get('x-rate-limit-remaining');
    if (remaining !== null && Number(remaining) < RATE_LIMIT_THRESHOLD) {
      await sleep(RATE_LIMIT_DELAY_MS);
    }

    if (response.ok) return response;

    // The body is needed twice over: a 403 cannot be classified without it,
    // and a final failure reports it. Reading a body is one-shot, so read it
    // once here for every failed response.
    let errorBody;
    try {
      errorBody = await response.text();
    } catch {
      errorBody = '(unable to read response body)';
    }

    // What is retryable depends on the method, and the line runs through
    // whether Canvas can have executed the request. A 429 or a throttled 403
    // means Canvas refused the request before running it, so repeating it is
    // safe for any method, POST included. A 5xx may have executed before
    // failing, so — like the network-error case above — a POST is not
    // retried there. Everything else (404, 401, a plain permission 403…) is
    // a real answer, not a transient fault.
    const refusedBeforeExecuting =
      response.status === 429 ||
      isThrottled403(response.status, errorBody, remaining);
    const retryable =
      refusedBeforeExecuting ||
      (isServerError(response.status) && method !== 'POST');

    if (retryable && attempt < MAX_RETRIES) {
      retryAfter = retryAfterMs(response);
      continue;
    }

    throw new CanvasApiError({
      method,
      path,
      status: response.status,
      body: errorBody,
      describe,
    });
  }
}

/**
 * Core request method for the Canvas LMS API.
 *
 * @param {string} method  - HTTP method (GET, POST, PUT, DELETE)
 * @param {string} path    - API path, e.g. "/api/v1/courses/123/modules"
 * @param {object} [body]  - Request body (will be sent as JSON)
 * @returns {Promise<any>}   Parsed JSON response (array results are auto-paginated)
 * @throws {CanvasApiError}  When Canvas answers with a non-2xx status.
 */
async function canvasRequest(method, path, body) {
  const { apiUrl, apiToken } = getConfig();

  const headers = {
    Authorization: `Bearer ${apiToken}`,
    Accept: 'application/json',
  };

  const opts = { method, headers };

  if (body !== undefined && body !== null) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }

  const url = path.startsWith('http') ? path : `${apiUrl}${path}`;
  log.verbose(`${method} ${url}`);

  const response = await fetchWithRetry(method, url, opts, {
    path,
    describe: `${method} ${path}`,
  });

  // DELETE may return 204 No Content
  if (response.status === 204) return null;

  const data = await response.json();

  // Automatic pagination for list endpoints that return arrays.
  if (Array.isArray(data)) {
    let nextUrl = getNextUrl(response.headers.get('link'));
    let accumulated = data;
    while (nextUrl) {
      const nextResponse = await fetchWithRetry(
        'GET',
        nextUrl,
        { method: 'GET', headers },
        { path: nextUrl, describe: `pagination GET ${nextUrl}` },
      );
      const nextData = await nextResponse.json();
      accumulated = accumulated.concat(nextData);
      nextUrl = getNextUrl(nextResponse.headers.get('link'));
    }
    return accumulated;
  }

  return data;
}

// Convenience wrappers

function get(path) {
  return canvasRequest('GET', path);
}

function post(path, body) {
  return canvasRequest('POST', path, body);
}

function put(path, body) {
  return canvasRequest('PUT', path, body);
}

function del(path) {
  return canvasRequest('DELETE', path);
}

module.exports = {
  canvasRequest,
  get,
  post,
  put,
  del,
  normaliseBaseUrl,
  CanvasApiError,
};
