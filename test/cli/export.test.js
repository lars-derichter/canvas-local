const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildLinkContext, exportSlug } = require('../../cli/export');
const { getLabels } = require('../../lib/config/labels');
const { rewriteCrossLinks } = require('../../lib/export/preprocess');
const { SCHEMA_VERSION } = require('../../lib/sync/state');

describe('exportSlug', () => {
  const labels = getLabels('en');

  it('slugs a course title', () => {
    assert.equal(
      exportSlug('Programming Fundamentals', labels),
      'programming-fundamentals',
    );
  });

  it('strips accents and punctuation', () => {
    assert.equal(
      exportSlug('Résumé du cours (2526)', labels),
      'resume-du-cours-2526',
    );
  });

  it('falls back to the course label when the title slugs to nothing', () => {
    // slugify keeps only [a-z0-9], so a non-Latin title has nothing to keep.
    assert.equal(exportSlug('数据结构', labels), 'course');
    assert.equal(exportSlug('🎓', getLabels('nl')), 'cursus');
  });

  it('falls back to a literal when the label is overridden to nothing', () => {
    const odd = getLabels('en', { export: { course_title: '📘' } });
    assert.equal(exportSlug('🎓', odd), 'course');
  });

  it('caps a long title without leaving a trailing hyphen', () => {
    const slug = exportSlug('word '.repeat(100), labels);
    assert.ok(slug.length <= 100, `too long: ${slug.length}`);
    assert.doesNotMatch(slug, /-$/);
  });
});

describe('export label wiring', () => {
  // buildCombinedMarkdown falls back to getLabels(meta.lang) when the caller
  // passes no label set, which resolves the language but silently drops any
  // per-label override from course.config.yml. Overrides then show in the
  // preview and not in the PDF. Running the real export needs pandoc, so pin
  // the wiring at the source, as the VS Code extension tests do.
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', 'cli', 'export.js'),
    'utf8',
  );

  it('hands the resolved labels to buildCombinedMarkdown', () => {
    const call = source.slice(
      source.indexOf('buildCombinedMarkdown(mode.groups'),
    );
    const ctx = call.slice(0, call.indexOf('});'));
    assert.match(ctx, /^\s*labels,$/m);
  });
});

describe('buildLinkContext', () => {
  // Export reads .canvas-sync.json for one thing: the Canvas id of every item,
  // so a cross-link whose target falls outside the export can be footnoted with
  // a URL instead of silently going flat. It writes nothing to Canvas.
  const BASE_URL = 'https://school.instructure.com';
  const state = (courseId) => ({
    schema_version: SCHEMA_VERSION,
    canvas_base_url: BASE_URL,
    course_id: courseId,
    last_sync: null,
    modules: {
      '01-intro': {
        canvas_module_id: 9,
        name: 'Intro',
        position: 1,
        item_order: ['01-intro/01-welcome.md'],
        items: {
          '01-intro/01-welcome.md': { canvas_type: 'page', canvas_id: 77 },
        },
      },
    },
    icons: {},
    files: {},
  });

  let dir;
  let file;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-export-'));
    file = path.join(dir, '.canvas-sync.json');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function write(data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
  }

  it('builds the link map from a matching state', () => {
    write(state(4242));
    const ctx = buildLinkContext({
      file,
      env: { CANVAS_COURSE_ID: '4242', CANVAS_API_URL: BASE_URL },
    });
    assert.equal(ctx.courseId, 4242);
    assert.deepEqual(ctx.linkMap.get('01-intro/01-welcome.md'), {
      canvasType: 'page',
      canvasId: 77,
    });
  });

  it('builds it just the same when `.env` names another course', () => {
    // loadState refuses a state describing a different Canvas course, because
    // the ids in it would let a push delete objects in the course they came
    // from. Export makes no writes, so that refusal is not its to inherit —
    // and being caught rather than skipped, it used to turn an export into one
    // with every cross-link quietly unresolved rather than either working or
    // saying anything.
    write(state(4242));
    const ctx = buildLinkContext({
      file,
      env: { CANVAS_COURSE_ID: '9999', CANVAS_API_URL: BASE_URL },
    });
    assert.ok(ctx.linkMap, 'A mismatched `.env` emptied the link map');
    assert.deepEqual(ctx.linkMap.get('01-intro/01-welcome.md'), {
      canvasType: 'page',
      canvasId: 77,
    });
  });

  it('takes the course id from the state, not the environment', () => {
    // Which id the footnote URL is built from decides whether it resolves at
    // all: `canvas_id` 77 is a page in course 4242 and means nothing in 9999,
    // so the two halves of /courses/:id/pages/:id have to come from one place.
    write(state(4242));
    const ctx = buildLinkContext({
      file,
      env: { CANVAS_COURSE_ID: '9999', CANVAS_API_URL: BASE_URL },
    });
    assert.equal(ctx.courseId, 4242);
  });

  it('hands out no course id when the state claims no course', () => {
    // `course_id: 0` is how the state spells "no course named" — emptyState
    // writes it when CANVAS_COURSE_ID is unset, and a hand-repaired file is a
    // documented way to arrive at one. Until export skipped the env check,
    // assertStateMatchesEnv stamped the environment's id on the way through and
    // this shape never reached the link map.
    write(state(0));
    const ctx = buildLinkContext({
      file,
      env: { CANVAS_COURSE_ID: '4242', CANVAS_API_URL: BASE_URL },
    });
    assert.equal(
      ctx.courseId,
      undefined,
      'A course id of 0 footnotes /courses/0/… , which resolves nowhere',
    );
    // The rows themselves are still known; it is only the course that is not.
    assert.ok(ctx.linkMap.get('01-intro/01-welcome.md'));
  });

  it('degrades to plain text rather than footnoting a course-less URL', () => {
    // The consequence the guard above exists for, through the real consumer:
    // no course id means rewriteCrossLinks unlinks the target, exactly as it
    // does for one the link map has never heard of.
    write(state(0));
    const ctx = buildLinkContext({
      file,
      env: { CANVAS_COURSE_ID: '4242', CANVAS_API_URL: BASE_URL },
    });
    const out = rewriteCrossLinks('[Welcome](01-welcome.md)', '01-intro/x.md', {
      includedPaths: new Set(),
      anchorFor: (p) => p,
      linkMap: ctx.linkMap,
      courseId: ctx.courseId,
    });
    assert.equal(out, 'Welcome');
    assert.doesNotMatch(out, /courses\/0\//);
  });

  it('still swallows a state file this version cannot read', () => {
    // What the try/catch was always for. An export is worth finishing without
    // footnotes; it is not worth failing over a schema it cannot parse.
    write({ ...state(4242), schema_version: SCHEMA_VERSION + 1 });
    assert.deepEqual(
      buildLinkContext({ file, env: { CANVAS_COURSE_ID: '4242' } }),
      {},
    );
  });

  it('returns empty context when nothing has been synced', () => {
    assert.deepEqual(
      buildLinkContext({ file, env: { CANVAS_COURSE_ID: '4242' } }),
      {},
    );
  });
});
