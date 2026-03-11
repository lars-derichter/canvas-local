const RATE_LIMIT_THRESHOLD = 50;
const RATE_LIMIT_DELAY_MS = 1000;

function getConfig() {
  const apiUrl = process.env.CANVAS_API_URL;
  const apiToken = process.env.CANVAS_API_TOKEN;
  if (!apiUrl) throw new Error("CANVAS_API_URL is not set in environment");
  if (!apiToken) throw new Error("CANVAS_API_TOKEN is not set in environment");
  return { apiUrl: apiUrl.replace(/\/+$/, ""), apiToken };
}

/**
 * Parse the Link header returned by Canvas to find the next page URL.
 * Format: <https://...?page=2&per_page=10>; rel="next", <...>; rel="last"
 */
function getNextUrl(linkHeader) {
  if (!linkHeader) return null;
  const parts = linkHeader.split(",");
  for (const part of parts) {
    const match = part.match(/<([^>]+)>;\s*rel="next"/);
    if (match) return match[1];
  }
  return null;
}

/**
 * Core request method for the Canvas LMS API.
 *
 * @param {string} method  - HTTP method (GET, POST, PUT, DELETE)
 * @param {string} path    - API path, e.g. "/api/v1/courses/123/modules"
 * @param {object} [body]  - Request body (will be sent as JSON)
 * @returns {Promise<any>}   Parsed JSON response (array results are auto-paginated)
 */
async function canvasRequest(method, path, body) {
  const { apiUrl, apiToken } = getConfig();

  const headers = {
    Authorization: `Bearer ${apiToken}`,
    Accept: "application/json",
  };

  const opts = { method, headers };

  if (body !== undefined && body !== null) {
    headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }

  const url = path.startsWith("http") ? path : `${apiUrl}${path}`;
  const response = await fetch(url, opts);

  // Rate-limit awareness: pause when we are running low on quota.
  const remaining = response.headers.get("x-rate-limit-remaining");
  if (remaining !== null && Number(remaining) < RATE_LIMIT_THRESHOLD) {
    await new Promise((r) => setTimeout(r, RATE_LIMIT_DELAY_MS));
  }

  if (!response.ok) {
    let errorBody;
    try {
      errorBody = await response.text();
    } catch {
      errorBody = "(unable to read response body)";
    }
    throw new Error(
      `Canvas API ${method} ${path} failed with status ${response.status}: ${errorBody}`
    );
  }

  // DELETE may return 204 No Content
  if (response.status === 204) return null;

  const data = await response.json();

  // Automatic pagination for list endpoints that return arrays.
  if (Array.isArray(data)) {
    let nextUrl = getNextUrl(response.headers.get("link"));
    let accumulated = data;
    while (nextUrl) {
      const nextResponse = await fetch(nextUrl, { method: "GET", headers });

      const nextRemaining = nextResponse.headers.get("x-rate-limit-remaining");
      if (nextRemaining !== null && Number(nextRemaining) < RATE_LIMIT_THRESHOLD) {
        await new Promise((r) => setTimeout(r, RATE_LIMIT_DELAY_MS));
      }

      if (!nextResponse.ok) {
        let errBody;
        try {
          errBody = await nextResponse.text();
        } catch {
          errBody = "(unable to read response body)";
        }
        throw new Error(
          `Canvas API pagination GET ${nextUrl} failed with status ${nextResponse.status}: ${errBody}`
        );
      }

      const nextData = await nextResponse.json();
      accumulated = accumulated.concat(nextData);
      nextUrl = getNextUrl(nextResponse.headers.get("link"));
    }
    return accumulated;
  }

  return data;
}

// Convenience wrappers

function get(path) {
  return canvasRequest("GET", path);
}

function post(path, body) {
  return canvasRequest("POST", path, body);
}

function put(path, body) {
  return canvasRequest("PUT", path, body);
}

function del(path) {
  return canvasRequest("DELETE", path);
}

module.exports = { canvasRequest, get, post, put, del };
