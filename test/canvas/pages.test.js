const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { buildPageUrlToPageId } = require('../../lib/canvas/pages');

describe('buildPageUrlToPageId', () => {
  it('maps every slug to its numeric page id', async () => {
    const map = await buildPageUrlToPageId(45083, async () => [
      { url: 'welcome', page_id: 4242 },
      { url: 'setup', page_id: 4243 },
    ]);

    assert.equal(map.get('welcome'), 4242);
    assert.equal(map.get('setup'), 4243);
    assert.equal(map.size, 2);
  });

  it('skips a page missing either half of the pair', async () => {
    const map = await buildPageUrlToPageId(45083, async () => [
      { url: 'welcome' },
      { page_id: 4243 },
      { url: 'setup', page_id: 4244 },
    ]);

    assert.deepEqual([...map.keys()], ['setup']);
  });

  it('returns an empty map when the course has no pages', async () => {
    assert.equal((await buildPageUrlToPageId(45083, async () => null)).size, 0);
  });

  it('lets the caller decide what a failed lookup costs', async () => {
    await assert.rejects(
      buildPageUrlToPageId(45083, async () => {
        throw new Error('403 Forbidden');
      }),
      /403 Forbidden/,
    );
  });
});
