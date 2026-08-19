const { mock } = require('node:test');

/** A fake Response object compatible with the fetch API. */
function fakeResponse(body, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
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
  mock.method(global, 'fetch', async (url, opts) => {
    calls.push({
      url,
      method: opts.method,
      body: opts.body ? JSON.parse(opts.body) : null,
    });
    const index = remaining.findIndex(
      (route) => route.method === opts.method && url.includes(route.path),
    );
    if (index === -1) {
      return fakeResponse(
        { message: `unrouted ${opts.method} ${url}` },
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
