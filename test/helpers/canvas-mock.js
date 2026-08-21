const { mock } = require('node:test');

/** A fake Response object compatible with the fetch API. */
function fakeResponse(body, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body),
    // `downloadFile` reads the bytes rather than the JSON, so a route that
    // stands in for a binary hands its body over as a string or a Buffer and
    // gets those exact bytes written to disk.
    arrayBuffer: async () => {
      const buffer = Buffer.isBuffer(body)
        ? body
        : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
      return buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      );
    },
  };
}

/**
 * A recorded request body: the parsed JSON, or the raw value when it is not
 * JSON at all.
 *
 * Step 2 of a Canvas file upload posts `FormData` rather than a JSON string —
 * an icon upload, an embedded image, any binary — and `JSON.parse` on one
 * throws, which would fail the request instead of answering it. A test that
 * cares about a form post asserts on the URL; one that cares about a JSON body
 * gets it parsed exactly as before.
 */
function readBody(body) {
  if (!body) return null;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

/**
 * Answer Canvas requests from a route table of { method, path, body, status },
 * and record every request that was made. An unrouted request gets a 400, so a
 * missing route fails the test instead of hanging on the client's retries.
 *
 * A route is spliced out of the table once it matches, so the table doubles as
 * an expectation about the *sequence* of calls: a command that issues one
 * request twice runs out of routes and fails on the second. That is what makes
 * this the right tool for proving a request is gone — a no-op push has to leave
 * the DELETE and POST routes untouched.
 *
 * @param {Array<{method: string, path: string, body?: object, status?: number}>} routes
 * @returns {Array<{url: string, method: string, body: object|null}>} Every call, in order.
 */
function mockCanvas(routes) {
  const calls = [];
  const remaining = routes.map((route) => ({ ...route }));
  mock.method(global, 'fetch', async (url, opts = {}) => {
    // A bare `fetch(url)` carries no options at all — that is how `downloadFile`
    // pulls the bytes from the URL Canvas named — and its method is GET.
    const method = opts.method || 'GET';
    calls.push({ url, method, body: readBody(opts.body) });
    const index = remaining.findIndex(
      (route) => route.method === method && url.includes(route.path),
    );
    if (index === -1) {
      return fakeResponse(
        { message: `unrouted ${method} ${url}` },
        { status: 400 },
      );
    }
    const [route] = remaining.splice(index, 1);
    return fakeResponse(route.body, { status: route.status || 200 });
  });
  return calls;
}

/** Keep the command's own output out of the test report, and hand it back. */
function silence() {
  return {
    log: mock.method(console, 'log', () => {}),
    warn: mock.method(console, 'warn', () => {}),
    error: mock.method(console, 'error', () => {}),
  };
}

module.exports = { fakeResponse, mockCanvas, silence };
