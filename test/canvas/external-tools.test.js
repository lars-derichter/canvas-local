const { describe, it, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');

// Set required env vars before requiring anything that loads the client.
process.env.CANVAS_API_URL = 'https://canvas.example.com';
process.env.CANVAS_API_TOKEN = 'test-token-123';

const {
  listExternalTools,
  findToolForUrl,
  describeInstalledTools,
} = require('../../lib/canvas/external-tools');

/**
 * The error Canvas returns from the sessionless-launch endpoint when no
 * installed tool claims the URL it was handed. `findToolForUrl` never compares
 * against it — it reports whatever `errors.external_tool` says — so the string
 * lives here, where the mock responses that carry it are built.
 */
const NO_MATCHING_TOOL = 'Unable to find a matching external tool';

/**
 * Helper: create a fake Response object compatible with the fetch API.
 */
function fakeResponse(body, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

/** Record every request and answer them all with the same body and status. */
function mockFetch(body = {}, { status = 200 } = {}) {
  const calls = [];
  mock.method(global, 'fetch', async (url, opts) => {
    calls.push({
      url,
      method: opts.method,
      body: opts.body ? JSON.parse(opts.body) : null,
    });
    return fakeResponse(body, { status });
  });
  return calls;
}

describe('listExternalTools', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it('lists the tools of a course, including the account chain', async () => {
    const calls = mockFetch([]);
    await listExternalTools(42);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'GET');
    assert.equal(
      calls[0].url,
      'https://canvas.example.com/api/v1/courses/42/external_tools?include_parents=true',
    );
  });
});

describe('findToolForUrl', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it('probes the sessionless launch endpoint with the URL-encoded launch URL', async () => {
    const calls = mockFetch({ id: 7, name: 'Codegrade', url: 'https://x/y' });
    await findToolForUrl(42, 'https://tool.example.com/launch?course=1');

    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'GET');
    assert.equal(
      calls[0].url,
      'https://canvas.example.com/api/v1/courses/42/external_tools/sessionless_launch' +
        '?url=https%3A%2F%2Ftool.example.com%2Flaunch%3Fcourse%3D1',
    );
  });

  it('reports a launch URL a tool answers as resolving', async () => {
    mockFetch({
      id: 7,
      name: 'Codegrade',
      url: 'https://canvas.example.com/courses/42/external_tools/sessionless_launch?verifier=abc',
    });

    const result = await findToolForUrl(42, 'https://tool.example.com/launch');

    assert.equal(result.status, 'resolves');
    assert.equal(result.toolId, 7);
    assert.equal(result.name, 'Codegrade');
  });

  it('reports a launch URL no tool answers as no-match', async () => {
    mockFetch({ errors: { external_tool: NO_MATCHING_TOOL } }, { status: 400 });

    const result = await findToolForUrl(42, 'https://typo.example.com/launch');

    assert.equal(result.status, 'no-match');
    assert.equal(result.reason, NO_MATCHING_TOOL);
  });

  it('reads the no-match error out of a 200 body too', async () => {
    mockFetch({ errors: { external_tool: NO_MATCHING_TOOL } });

    const result = await findToolForUrl(42, 'https://typo.example.com/launch');

    assert.equal(result.status, 'no-match');
  });

  it('reads a no-match error Canvas wrapped in a message object', async () => {
    mockFetch(
      { errors: { external_tool: [{ message: NO_MATCHING_TOOL }] } },
      { status: 400 },
    );

    const result = await findToolForUrl(42, 'https://typo.example.com/launch');

    assert.equal(result.status, 'no-match');
  });

  it('reports a permission failure as undetermined, never as resolving', async () => {
    mockFetch(
      { errors: [{ message: 'user not authorized to perform that action' }] },
      { status: 401 },
    );

    const result = await findToolForUrl(42, 'https://tool.example.com/launch');

    assert.equal(
      result.status,
      'unknown',
      'a probe that could not run must not read as a match',
    );
    assert.match(result.reason, /401/);
  });

  it('reports a body without a launch URL as undetermined', async () => {
    mockFetch({ id: 7, name: 'Codegrade' });

    const result = await findToolForUrl(42, 'https://tool.example.com/launch');

    assert.equal(result.status, 'unknown');
  });

  it('makes no request when there is no launch URL to check', async () => {
    const calls = mockFetch({});

    const result = await findToolForUrl(42, '');

    assert.equal(result.status, 'unknown');
    assert.equal(calls.length, 0);
  });
});

describe('describeInstalledTools', () => {
  it('names the installed tools', () => {
    const line = describeInstalledTools([
      { name: 'Codegrade' },
      { name: 'Panopto' },
    ]);

    assert.equal(
      line,
      'the external tools installed here are: Codegrade, Panopto',
    );
  });

  it('falls back to the domain when a tool has no name', () => {
    const line = describeInstalledTools([{ domain: 'tool.example.com' }]);
    assert.match(line, /tool\.example\.com/);
  });

  it('says so when the course has no tools at all', () => {
    assert.match(describeInstalledTools([]), /no external tools installed/);
    assert.match(describeInstalledTools(null), /no external tools installed/);
  });
});
