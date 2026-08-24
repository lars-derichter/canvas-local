const { describe, it, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { mockCanvas, silence } = require('../helpers/canvas-mock');

process.env.CANVAS_API_URL = 'https://canvas.example.com';
process.env.CANVAS_API_TOKEN = 'test-token-123';

const { ensureIcons } = require('../../lib/canvas/icons');
const { ICON_FILES } = require('../../lib/convert/alert-icons');

const COURSE_ID = 4242;
const ICON_TYPES = Object.keys(ICON_FILES);
const FIRST_FILE_ID = 900;

afterEach(() => mock.restoreAll());

/**
 * The two hops a Canvas file upload takes, per icon: the grant, then the form
 * post to the URL the grant named. One id per icon, counting up from
 * FIRST_FILE_ID in the order `ensureIcons` walks them.
 */
function uploadRoutes() {
  const routes = [];
  ICON_TYPES.forEach((type, index) => {
    routes.push({
      method: 'POST',
      path: `/courses/${COURSE_ID}/files`,
      body: {
        upload_url: `https://canvas.example.com/upload/${type}`,
        upload_params: {},
      },
    });
    routes.push({
      method: 'POST',
      path: `/upload/${type}`,
      body: { id: FIRST_FILE_ID + index, display_name: ICON_FILES[type] },
    });
  });
  return routes;
}

/** Upload every icon under one `CANVAS_API_URL`, and hand back the rows. */
async function uploadedIcons(apiUrl) {
  const original = process.env.CANVAS_API_URL;
  process.env.CANVAS_API_URL = apiUrl;
  try {
    silence();
    mockCanvas(uploadRoutes());
    const syncData = { icons: {} };
    await ensureIcons(COURSE_ID, syncData);
    return syncData.icons;
  } finally {
    process.env.CANVAS_API_URL = original;
  }
}

describe('ensureIcons', () => {
  const PREVIEW = `https://canvas.example.com/courses/${COURSE_ID}/files/${FIRST_FILE_ID}/preview`;

  // `preview_url` is stored, and it is what Canvas HTML points every alert
  // icon's <img> at, so a slash too many is not cosmetic: it is written into
  // the sync file and into every page pushed afterwards. `.env` written by
  // `init` cannot produce these forms; one typed or pasted by hand can, and two
  // of the five below — the bare trailing slash, and the doubled slash in front
  // of the suffix — did produce one before `normaliseBaseUrl` became the trim
  // used here.
  for (const written of [
    'https://canvas.example.com',
    'https://canvas.example.com/',
    'https://canvas.example.com/api/v1',
    'https://canvas.example.com/api/v1/',
    'https://canvas.example.com//api/v1',
  ]) {
    it(`builds one clean preview URL from CANVAS_API_URL=${written}`, async () => {
      const icons = await uploadedIcons(written);
      assert.equal(icons.note.preview_url, PREVIEW);
    });
  }

  it('records a preview URL for every icon', async () => {
    const icons = await uploadedIcons('https://canvas.example.com/');
    assert.deepEqual(Object.keys(icons), ICON_TYPES);
    for (const [index, type] of ICON_TYPES.entries()) {
      assert.equal(
        icons[type].preview_url,
        `https://canvas.example.com/courses/${COURSE_ID}/files/${FIRST_FILE_ID + index}/preview`,
      );
    }
  });
});
