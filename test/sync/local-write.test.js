const { describe, it, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { mockCanvas, silence } = require('../helpers/canvas-mock');

// Set required env vars before requiring anything that loads the client.
process.env.CANVAS_API_URL = 'https://canvas.example.com';
process.env.CANVAS_API_TOKEN = 'test-token-123';

const localWrite = require('../../lib/sync/local-write');

const { createPullFileResolver, downloadReferencedFiles } = localWrite;

afterEach(() => mock.restoreAll());

describe('createPullFileResolver', () => {
  it('resolves a Canvas file URL to a relative path', () => {
    const canvasToLocal = new Map([
      ['/courses/1/files/100/preview', '01-mod/_files/image.png'],
    ]);
    const resolver = createPullFileResolver(
      1,
      '01-mod/01-page.md',
      canvasToLocal,
    );
    const result = resolver('/courses/1/files/100/preview');
    assert.equal(result, './_files/image.png');
  });

  it('returns null for non-Canvas URLs', () => {
    const resolver = createPullFileResolver(1, '01-mod/01-page.md', new Map());
    assert.equal(resolver('https://example.com/image.png'), null);
  });

  it('returns null for unknown file IDs', () => {
    const resolver = createPullFileResolver(1, '01-mod/01-page.md', new Map());
    assert.equal(resolver('/courses/1/files/999/preview'), null);
  });

  it('returns null for empty href', () => {
    const resolver = createPullFileResolver(1, '01-mod/01-page.md', new Map());
    assert.equal(resolver(''), null);
    assert.equal(resolver(null), null);
  });

  it('handles absolute Canvas URLs with domain', () => {
    const canvasToLocal = new Map([
      ['/courses/1/files/50/preview', '01-mod/_files/doc.pdf'],
    ]);
    const resolver = createPullFileResolver(
      1,
      '01-mod/01-page.md',
      canvasToLocal,
    );
    const result = resolver(
      'https://canvas.example.com/courses/1/files/50/download?wrap=1',
    );
    assert.equal(result, './_files/doc.pdf');
  });

  it('resolves a foreign-course href through the mapped entry', () => {
    // The map decides, not the href's course id: `downloadReferencedFiles`
    // keys a foreign-course embed under this course's preview pattern (and
    // withholds its row), and the resolver derives that same pattern from any
    // href's file id. That is what turns a source-course URL into the
    // `_files/` link the next push uploads from.
    const canvasToLocal = new Map([
      ['/courses/1/files/100/preview', '01-mod/_files/image.png'],
    ]);
    const resolver = createPullFileResolver(
      1,
      '01-mod/01-page.md',
      canvasToLocal,
    );
    assert.equal(
      resolver('/courses/9999/files/100/preview'),
      './_files/image.png',
    );
  });

  it('resolves cross-directory file references', () => {
    const canvasToLocal = new Map([
      ['/courses/1/files/10/preview', '02-other/_files/shared.png'],
    ]);
    const resolver = createPullFileResolver(
      1,
      '01-mod/01-page.md',
      canvasToLocal,
    );
    const result = resolver('/courses/1/files/10/preview');
    assert.equal(result, '../02-other/_files/shared.png');
  });
});

describe('downloadReferencedFiles', () => {
  // An alert's icon is not an embedded file. `markdownToHtml` puts it in the
  // title paragraph and `htmlToMarkdown` drops that paragraph whole, so a copy
  // downloaded into `_files/` is an orphan the moment it lands: no markdown
  // names it, no `state.files` row records it, and the scanner never looks
  // inside `_files/` to find it again. The exclusion used to be a list of the
  // icon ids the state file holds, which is empty on a first pull and never
  // holds another course's ids, so both cases below wrote icons into the tree.

  const COURSE_ID = 4242;
  const ICON_ID = 777;
  const IMAGE_ID = 500;

  /** An alert with the icon in its title and a real image in its body. */
  function alertHtml(iconSrc) {
    return (
      `<div class="markdown-alert markdown-alert-caution" style="border-left: .25em solid #fa6432;">\n` +
      `    <p class="markdown-alert-title" style="color: #fa6432; font-size: 1.2em;">` +
      `<img style="height: 0.8em; vertical-align: baseline;" src="${iconSrc}" alt="" /> Let op</p>\n` +
      `    <p><img src="/courses/${COURSE_ID}/files/${IMAGE_ID}/preview" alt="Diagram"></p>\n` +
      `</div>`
    );
  }

  /** The three calls one downloaded file makes: meta, meta again, bytes. */
  function routesForImage() {
    const meta = {
      id: IMAGE_ID,
      display_name: 'diagram.png',
      url: 'https://files.example.com/diagram.png',
    };
    return [
      { method: 'GET', path: `/api/v1/files/${IMAGE_ID}`, body: meta },
      { method: 'GET', path: `/api/v1/files/${IMAGE_ID}`, body: meta },
      {
        method: 'GET',
        path: 'https://files.example.com/diagram.png',
        body: 'PNG',
      },
    ];
  }

  async function pull(iconSrc, syncData) {
    const courseDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'local-write-test-'),
    );
    silence();
    const calls = mockCanvas(routesForImage());
    await downloadReferencedFiles(
      COURSE_ID,
      alertHtml(iconSrc),
      '01-mod',
      syncData,
      new Map(),
      courseDir,
      { gitDirty: { available: true, paths: new Set() } },
    );
    return { calls, courseDir };
  }

  it('leaves the alert icon alone when the state has no icon rows', async () => {
    // A first pull, or one into a state that was reset: `icons` is empty, so
    // there is no id to exclude and the icon has to be recognised by its place
    // in the markup instead.
    const syncData = { icons: {}, files: {} };
    const { calls, courseDir } = await pull(
      `https://canvas.example.com/courses/${COURSE_ID}/files/${ICON_ID}/preview`,
      syncData,
    );

    assert.ok(
      !calls.some((call) => call.url.includes(`/files/${ICON_ID}`)),
      'the icon was fetched from Canvas',
    );
    assert.deepEqual(Object.keys(syncData.files), [
      '01-mod/_files/diagram.png',
    ]);
    assert.deepEqual(fs.readdirSync(path.join(courseDir, '01-mod', '_files')), [
      'diagram.png',
    ]);
  });

  it('leaves an alert icon embedded from another course alone', async () => {
    // Content copied between Canvas courses keeps the source course's icon
    // ids, which this course's state can never hold. Those downloads got no
    // `state.files` row either, so nothing would ever clean them up.
    const syncData = {
      icons: { caution: { canvas_file_id: 111 } },
      files: {},
    };
    const { calls, courseDir } = await pull(
      `https://canvas.example.com/courses/9999/files/${ICON_ID}/preview`,
      syncData,
    );

    assert.ok(
      !calls.some((call) => call.url.includes(`/files/${ICON_ID}`)),
      'the foreign-course icon was fetched from Canvas',
    );
    assert.deepEqual(fs.readdirSync(path.join(courseDir, '01-mod', '_files')), [
      'diagram.png',
    ]);
  });

  it('still downloads a file this course owns by id', async () => {
    // The other half of the guard: cutting the title paragraph out must not
    // cost the alert's body its images.
    const syncData = { icons: {}, files: {} };
    await pull(
      `https://canvas.example.com/courses/${COURSE_ID}/files/${ICON_ID}/preview`,
      syncData,
    );
    assert.equal(
      syncData.files['01-mod/_files/diagram.png'].canvas_file_id,
      IMAGE_ID,
    );
  });
});

describe('what lib/sync/apply.js calls', () => {
  // The engine destructures these three by name, and a CommonJS destructure of
  // a name that is not exported is silent until the call. So a rename here is
  // still a runtime failure there rather than a build one. Three names, pinned.
  it('keeps the three helpers the engine calls by name', () => {
    assert.equal(typeof localWrite.writeCategoryFile, 'function');
    assert.equal(typeof localWrite.downloadReferencedFiles, 'function');
    assert.equal(typeof localWrite.createPullFileResolver, 'function');
  });
});
