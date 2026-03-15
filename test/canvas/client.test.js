const { describe, it, mock, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

// Set required env vars before requiring client
process.env.CANVAS_API_URL = 'https://canvas.example.com';
process.env.CANVAS_API_TOKEN = 'test-token-123';

const { canvasRequest, get, post, put, del } = require('../../lib/canvas/client');

/**
 * Helper: create a fake Response object compatible with the fetch API.
 */
function fakeResponse(body, { status = 200, headers = {} } = {}) {
  const headerMap = new Map(Object.entries(headers));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name) => headerMap.get(name.toLowerCase()) ?? null,
    },
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

describe('canvasRequest', () => {
  let fetchMock;

  beforeEach(() => {
    // Suppress console.log from retry messages
    mock.method(console, 'log', () => {});
  });

  afterEach(() => {
    mock.restoreAll();
  });

  describe('successful requests', () => {
    it('makes a GET request with correct URL and headers', async () => {
      fetchMock = mock.method(global, 'fetch', async () =>
        fakeResponse({ id: 1, name: 'Test' })
      );

      const result = await canvasRequest('GET', '/api/v1/courses/42');

      assert.deepEqual(result, { id: 1, name: 'Test' });
      assert.equal(fetchMock.mock.calls.length, 1);

      const [url, opts] = fetchMock.mock.calls[0].arguments;
      assert.equal(url, 'https://canvas.example.com/api/v1/courses/42');
      assert.equal(opts.method, 'GET');
      assert.equal(opts.headers.Authorization, 'Bearer test-token-123');
      assert.equal(opts.headers.Accept, 'application/json');
      assert.equal(opts.headers['Content-Type'], undefined);
      assert.equal(opts.body, undefined);
    });

    it('makes a POST request with JSON body', async () => {
      fetchMock = mock.method(global, 'fetch', async () =>
        fakeResponse({ id: 99, title: 'New Page' }, { status: 201 })
      );

      const body = { wiki_page: { title: 'New Page', body: '<p>Hello</p>' } };
      const result = await canvasRequest('POST', '/api/v1/courses/42/pages', body);

      assert.deepEqual(result, { id: 99, title: 'New Page' });
      assert.equal(fetchMock.mock.calls.length, 1);

      const [, opts] = fetchMock.mock.calls[0].arguments;
      assert.equal(opts.method, 'POST');
      assert.equal(opts.headers['Content-Type'], 'application/json');
      assert.equal(opts.body, JSON.stringify(body));
    });

    it('makes a PUT request with JSON body', async () => {
      fetchMock = mock.method(global, 'fetch', async () =>
        fakeResponse({ id: 99, title: 'Updated' })
      );

      const result = await put('/api/v1/courses/42/pages/slug', { wiki_page: { title: 'Updated' } });
      assert.deepEqual(result, { id: 99, title: 'Updated' });

      const [, opts] = fetchMock.mock.calls[0].arguments;
      assert.equal(opts.method, 'PUT');
    });

    it('returns null for 204 No Content (DELETE)', async () => {
      fetchMock = mock.method(global, 'fetch', async () =>
        fakeResponse(null, { status: 204 })
      );

      const result = await del('/api/v1/courses/42/pages/slug');
      assert.equal(result, null);
    });

    it('uses full URL when path starts with http', async () => {
      fetchMock = mock.method(global, 'fetch', async () =>
        fakeResponse({ id: 1 })
      );

      await canvasRequest('GET', 'https://other.example.com/api/v1/courses/1');

      const [url] = fetchMock.mock.calls[0].arguments;
      assert.equal(url, 'https://other.example.com/api/v1/courses/1');
    });
  });

  describe('retry on 429', () => {
    it('retries on 429 and succeeds on second attempt', async () => {
      let callCount = 0;
      fetchMock = mock.method(global, 'fetch', async () => {
        callCount++;
        if (callCount === 1) {
          return fakeResponse('rate limited', { status: 429 });
        }
        return fakeResponse({ id: 1 });
      });

      const result = await canvasRequest('GET', '/api/v1/courses/42');
      assert.deepEqual(result, { id: 1 });
      assert.equal(fetchMock.mock.calls.length, 2);
    });
  });

  describe('retry on 5xx', () => {
    it('retries on 500 and succeeds on second attempt', async () => {
      let callCount = 0;
      fetchMock = mock.method(global, 'fetch', async () => {
        callCount++;
        if (callCount === 1) {
          return fakeResponse('Internal Server Error', { status: 500 });
        }
        return fakeResponse({ id: 1 });
      });

      const result = await canvasRequest('GET', '/api/v1/courses/42');
      assert.deepEqual(result, { id: 1 });
      assert.equal(fetchMock.mock.calls.length, 2);
    });

    it('retries on 502 and succeeds on third attempt', async () => {
      let callCount = 0;
      fetchMock = mock.method(global, 'fetch', async () => {
        callCount++;
        if (callCount <= 2) {
          return fakeResponse('Bad Gateway', { status: 502 });
        }
        return fakeResponse({ ok: true });
      });

      const result = await canvasRequest('GET', '/api/v1/test');
      assert.deepEqual(result, { ok: true });
      assert.equal(fetchMock.mock.calls.length, 3);
    });
  });

  describe('max retries exceeded', () => {
    it('throws after exhausting all retry attempts on 5xx', async () => {
      fetchMock = mock.method(global, 'fetch', async () =>
        fakeResponse('Service Unavailable', { status: 503 })
      );

      await assert.rejects(
        () => canvasRequest('GET', '/api/v1/courses/42'),
        (err) => {
          assert.match(err.message, /failed with status 503/);
          return true;
        }
      );
      // 1 initial + 3 retries = 4 attempts
      assert.equal(fetchMock.mock.calls.length, 4);
    });

    it('throws after exhausting all retry attempts on 429', async () => {
      fetchMock = mock.method(global, 'fetch', async () =>
        fakeResponse('Too Many Requests', { status: 429 })
      );

      await assert.rejects(
        () => canvasRequest('GET', '/api/v1/courses/42'),
        (err) => {
          assert.match(err.message, /failed with status 429/);
          return true;
        }
      );
      assert.equal(fetchMock.mock.calls.length, 4);
    });

    it('throws after exhausting retries on network error', async () => {
      fetchMock = mock.method(global, 'fetch', async () => {
        throw new Error('ECONNRESET');
      });

      await assert.rejects(
        () => canvasRequest('GET', '/api/v1/courses/42'),
        (err) => {
          assert.match(err.message, /failed after 4 attempts/);
          assert.match(err.message, /ECONNRESET/);
          return true;
        }
      );
      assert.equal(fetchMock.mock.calls.length, 4);
    });
  });

  describe('non-retryable errors', () => {
    it('throws immediately on 404', async () => {
      fetchMock = mock.method(global, 'fetch', async () =>
        fakeResponse('Not Found', { status: 404 })
      );

      await assert.rejects(
        () => canvasRequest('GET', '/api/v1/courses/42'),
        (err) => {
          assert.match(err.message, /failed with status 404/);
          return true;
        }
      );
      // No retries for 404
      assert.equal(fetchMock.mock.calls.length, 1);
    });

    it('throws immediately on 401', async () => {
      fetchMock = mock.method(global, 'fetch', async () =>
        fakeResponse('Unauthorized', { status: 401 })
      );

      await assert.rejects(
        () => canvasRequest('GET', '/api/v1/courses/42'),
        (err) => {
          assert.match(err.message, /failed with status 401/);
          return true;
        }
      );
      assert.equal(fetchMock.mock.calls.length, 1);
    });
  });

  describe('pagination', () => {
    it('follows Link header to fetch all pages', async () => {
      let callCount = 0;
      fetchMock = mock.method(global, 'fetch', async (url) => {
        callCount++;
        if (callCount === 1) {
          return fakeResponse([{ id: 1 }, { id: 2 }], {
            headers: {
              link: '<https://canvas.example.com/api/v1/courses/42/modules?page=2&per_page=2>; rel="next", <https://canvas.example.com/api/v1/courses/42/modules?page=3&per_page=2>; rel="last"',
            },
          });
        }
        if (callCount === 2) {
          return fakeResponse([{ id: 3 }, { id: 4 }], {
            headers: {
              link: '<https://canvas.example.com/api/v1/courses/42/modules?page=3&per_page=2>; rel="next", <https://canvas.example.com/api/v1/courses/42/modules?page=3&per_page=2>; rel="last"',
            },
          });
        }
        // Last page — no next link
        return fakeResponse([{ id: 5 }]);
      });

      const result = await canvasRequest('GET', '/api/v1/courses/42/modules');
      assert.deepEqual(result, [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }]);
      assert.equal(fetchMock.mock.calls.length, 3);
    });

    it('does not paginate when response is not an array', async () => {
      fetchMock = mock.method(global, 'fetch', async () =>
        fakeResponse({ id: 1, name: 'Single Object' }, {
          headers: {
            link: '<https://canvas.example.com/api/v1/next>; rel="next"',
          },
        })
      );

      const result = await canvasRequest('GET', '/api/v1/courses/42/pages/slug');
      assert.deepEqual(result, { id: 1, name: 'Single Object' });
      // Only 1 call — no pagination for non-array responses
      assert.equal(fetchMock.mock.calls.length, 1);
    });

    it('does not paginate when no Link header is present', async () => {
      fetchMock = mock.method(global, 'fetch', async () =>
        fakeResponse([{ id: 1 }])
      );

      const result = await canvasRequest('GET', '/api/v1/courses/42/modules');
      assert.deepEqual(result, [{ id: 1 }]);
      assert.equal(fetchMock.mock.calls.length, 1);
    });

    it('retries on 5xx during pagination', async () => {
      let callCount = 0;
      fetchMock = mock.method(global, 'fetch', async () => {
        callCount++;
        if (callCount === 1) {
          return fakeResponse([{ id: 1 }], {
            headers: {
              link: '<https://canvas.example.com/api/v1/courses/42/modules?page=2>; rel="next"',
            },
          });
        }
        if (callCount === 2) {
          // First attempt at page 2 fails
          return fakeResponse('Server Error', { status: 500 });
        }
        // Retry succeeds
        return fakeResponse([{ id: 2 }]);
      });

      const result = await canvasRequest('GET', '/api/v1/courses/42/modules');
      assert.deepEqual(result, [{ id: 1 }, { id: 2 }]);
      assert.equal(fetchMock.mock.calls.length, 3);
    });
  });

  describe('rate limit awareness', () => {
    it('does not delay when rate limit remaining is above threshold', async () => {
      fetchMock = mock.method(global, 'fetch', async () =>
        fakeResponse({ id: 1 }, {
          headers: { 'x-rate-limit-remaining': '100' },
        })
      );

      const start = Date.now();
      await canvasRequest('GET', '/api/v1/courses/42');
      const elapsed = Date.now() - start;

      // Should complete quickly (no rate limit sleep)
      assert.ok(elapsed < 500, `Expected fast response but took ${elapsed}ms`);
    });

    it('delays when rate limit remaining is below threshold', async () => {
      fetchMock = mock.method(global, 'fetch', async () =>
        fakeResponse({ id: 1 }, {
          headers: { 'x-rate-limit-remaining': '10' },
        })
      );

      const start = Date.now();
      await canvasRequest('GET', '/api/v1/courses/42');
      const elapsed = Date.now() - start;

      // Should have slept ~1000ms due to rate limit
      assert.ok(elapsed >= 900, `Expected rate limit delay but only took ${elapsed}ms`);
    });
  });

  describe('convenience wrappers', () => {
    it('get() calls canvasRequest with GET', async () => {
      fetchMock = mock.method(global, 'fetch', async () =>
        fakeResponse({ id: 1 })
      );

      const result = await get('/api/v1/courses/42');
      assert.deepEqual(result, { id: 1 });

      const [, opts] = fetchMock.mock.calls[0].arguments;
      assert.equal(opts.method, 'GET');
    });

    it('post() calls canvasRequest with POST', async () => {
      fetchMock = mock.method(global, 'fetch', async () =>
        fakeResponse({ id: 1 })
      );

      await post('/api/v1/courses/42/pages', { title: 'Test' });

      const [, opts] = fetchMock.mock.calls[0].arguments;
      assert.equal(opts.method, 'POST');
      assert.equal(opts.body, JSON.stringify({ title: 'Test' }));
    });

    it('del() calls canvasRequest with DELETE', async () => {
      fetchMock = mock.method(global, 'fetch', async () =>
        fakeResponse(null, { status: 204 })
      );

      const result = await del('/api/v1/courses/42/pages/slug');
      assert.equal(result, null);

      const [, opts] = fetchMock.mock.calls[0].arguments;
      assert.equal(opts.method, 'DELETE');
    });
  });

  describe('environment configuration', () => {
    it('strips trailing slashes from API URL', async () => {
      const originalUrl = process.env.CANVAS_API_URL;
      process.env.CANVAS_API_URL = 'https://canvas.example.com///';

      fetchMock = mock.method(global, 'fetch', async () =>
        fakeResponse({ id: 1 })
      );

      await canvasRequest('GET', '/api/v1/courses/42');

      const [url] = fetchMock.mock.calls[0].arguments;
      assert.equal(url, 'https://canvas.example.com/api/v1/courses/42');

      process.env.CANVAS_API_URL = originalUrl;
    });
  });
});
