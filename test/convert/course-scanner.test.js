const {
  describe,
  it,
  before,
  after,
  beforeEach,
  afterEach,
  mock,
} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const log = require('../../cli/logger');
const {
  scanCourse,
  extractPosition,
  displayTitle,
} = require('../../lib/convert/course-scanner');

describe('extractPosition', () => {
  it('extracts numeric prefix from folder/file names', () => {
    assert.equal(extractPosition('01-introduction'), 1);
    assert.equal(extractPosition('99-appendix'), 99);
    assert.equal(extractPosition('10-chapter'), 10);
  });

  it('returns 0 for names without numeric prefix', () => {
    assert.equal(extractPosition('no-number'), 0);
    assert.equal(extractPosition('readme.md'), 0);
  });

  it('handles edge cases', () => {
    assert.equal(extractPosition('00-index'), 0);
    assert.equal(extractPosition('5-short'), 5);
    assert.equal(extractPosition('123-long-prefix'), 123);
  });
});

describe('displayTitle', () => {
  it('strips numeric prefix and capitalises the first word only', () => {
    assert.equal(displayTitle('01-welcome'), 'Welcome');
    assert.equal(displayTitle('02-getting-started'), 'Getting started');
  });

  it('handles names without numeric prefix', () => {
    assert.equal(displayTitle('introduction'), 'Introduction');
    assert.equal(displayTitle('deep-dive'), 'Deep dive');
  });

  it('replaces underscores with spaces', () => {
    assert.equal(displayTitle('01-my_page'), 'My page');
  });

  it('handles single-word names', () => {
    assert.equal(displayTitle('99-appendix'), 'Appendix');
    assert.equal(displayTitle('overview'), 'Overview');
  });

  it('leaves every word but the first as the author wrote it', () => {
    // Sentence case, not title case: title case belongs to one language, and
    // this derivation runs on courses in any of them. It also mangles a name
    // that is not a phrase. "15-e2e-sub" used to come out as "E2e Sub".
    assert.equal(displayTitle('15-e2e-sub'), 'E2e sub');
    assert.equal(displayTitle('03-de-eerste-les'), 'De eerste les');
    // Capitals the author typed survive, so an acronym keeps its shape.
    assert.equal(displayTitle('04-rest-API'), 'Rest API');
    // ASCII \b in the old regex fired inside accented words ("üBer Uns").
    assert.equal(displayTitle('01-über-uns'), 'Über uns');
  });

  it('returns an empty string for a name that is only a prefix', () => {
    assert.equal(displayTitle('01-'), '');
  });
});

describe('scanCourse', () => {
  let tmpDir;

  before(() => {
    // Create a temporary course directory with fixture files
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'course-test-'));

    // Module 1 with two pages
    const mod1 = path.join(tmpDir, '01-intro');
    fs.mkdirSync(mod1);
    fs.writeFileSync(
      path.join(mod1, '01-welcome.md'),
      '---\ntitle: Welcome\ncanvas_type: page\n---\n\nHello!',
    );
    fs.writeFileSync(
      path.join(mod1, '02-setup.md'),
      '---\ntitle: Setup\n---\n\nSetup instructions.',
    );

    // Module 1 _files directory (should be skipped)
    fs.mkdirSync(path.join(mod1, '_files'));
    fs.writeFileSync(path.join(mod1, '_files', 'image.png'), 'fake-image');

    // Module 1 subfolder without _category_.json — exercises the
    // subheader fallback to displayTitle(folderName).
    const introSub = path.join(mod1, '03-recap');
    fs.mkdirSync(introSub);
    fs.writeFileSync(
      path.join(introSub, '01-summary.md'),
      '---\ntitle: Summary\n---\n\nRecap.',
    );

    // Module 2 with an assignment and a subfolder.
    // Has a _category_.json with a custom label that should win over the
    // folder-name-derived title.
    const mod2 = path.join(tmpDir, '02-advanced');
    fs.mkdirSync(mod2);
    fs.writeFileSync(
      path.join(mod2, '_category_.json'),
      JSON.stringify({ label: 'Advanced Topics', position: 2 }) + '\n',
    );
    fs.writeFileSync(
      path.join(mod2, '01-homework.md'),
      '---\ntitle: Homework\ncanvas_type: assignment\npoints_possible: 10\n---\n\nDo it.',
    );

    // Subfolder inside module 2 with a custom _category_.json label.
    const sub = path.join(mod2, '01-exercises');
    fs.mkdirSync(sub);
    fs.writeFileSync(
      path.join(sub, '_category_.json'),
      JSON.stringify({ label: 'Hands-on Practice', position: 1 }) + '\n',
    );
    fs.writeFileSync(
      path.join(sub, '01-exercise-a.md'),
      '---\ntitle: Exercise A\n---\n\nFirst exercise.',
    );

    // Module 2 with a non-markdown file
    fs.writeFileSync(path.join(mod2, '02-data.csv'), 'a,b,c');

    // Module 2 with a markdown file wrapper for a file item
    fs.writeFileSync(
      path.join(mod2, '03-diagram.md'),
      '---\ntitle: Diagram\ncanvas_type: file\ncanvas_id: 999\nfile_ref: _files/diagram.svg\n---\n',
    );

    // Module 2: frontmatter title that differs from the filename-derived title
    fs.writeFileSync(
      path.join(mod2, '04-api.md'),
      '---\ntitle: REST API Reference\n---\n\nAPI docs.',
    );
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('scans modules sorted by position', () => {
    const modules = scanCourse(tmpDir);
    assert.equal(modules.length, 2);
    assert.equal(modules[0].folderName, '01-intro');
    assert.equal(modules[1].folderName, '02-advanced');
  });

  it('derives module names from folder names when no _category_.json is present', () => {
    const modules = scanCourse(tmpDir);
    assert.equal(modules[0].moduleName, 'Intro');
  });

  it('prefers the _category_.json label over the folder-name-derived module name', () => {
    const modules = scanCourse(tmpDir);
    assert.equal(modules[1].moduleName, 'Advanced Topics');
  });

  it('assigns correct positions', () => {
    const modules = scanCourse(tmpDir);
    assert.equal(modules[0].position, 1);
    assert.equal(modules[1].position, 2);
  });

  it('scans markdown items with frontmatter', () => {
    const modules = scanCourse(tmpDir);
    const fileItems = modules[0].items.filter((i) => i.type === 'item');

    assert.equal(fileItems.length, 2);
    assert.equal(fileItems[0].title, 'Welcome');
    assert.equal(fileItems[0].canvasType, 'page');
    assert.equal(fileItems[1].title, 'Setup');
    assert.equal(fileItems[1].canvasType, 'page'); // defaults to page
  });

  it('skips underscore-prefixed entries', () => {
    const modules = scanCourse(tmpDir);
    const introItems = modules[0].items;

    // _files directory should not appear as an item
    const fileItem = introItems.find(
      (i) => i.title === 'Files' || (i.file && i.file.includes('_files')),
    );
    assert.equal(fileItem, undefined);
  });

  it('detects assignment type from frontmatter', () => {
    const modules = scanCourse(tmpDir);
    const advItems = modules[1].items;
    const hw = advItems.find(
      (i) => i.type === 'item' && i.canvasType === 'assignment',
    );
    assert.ok(hw);
    assert.equal(hw.title, 'Homework');
    assert.equal(hw.frontmatter.points_possible, 10);
  });

  it('handles subfolders as subheaders with nested items', () => {
    const modules = scanCourse(tmpDir);
    const advItems = modules[1].items;
    const subheader = advItems.find((i) => i.type === 'subheader');

    assert.ok(subheader);
    assert.equal(subheader.items.length, 1);
    assert.equal(subheader.items[0].title, 'Exercise A');
    assert.equal(subheader.items[0].indent, 1);
  });

  it('prefers the _category_.json label over the folder-name-derived subheader title', () => {
    const modules = scanCourse(tmpDir);
    const subheader = modules[1].items.find((i) => i.type === 'subheader');
    assert.ok(subheader);
    assert.equal(subheader.title, 'Hands-on Practice');
  });

  it('falls back to the folder-name-derived subheader title when no _category_.json is present', () => {
    const modules = scanCourse(tmpDir);
    const subheader = modules[0].items.find((i) => i.type === 'subheader');
    assert.ok(subheader);
    assert.equal(subheader.title, 'Recap');
  });

  it('treats non-markdown files as canvas_type file', () => {
    const modules = scanCourse(tmpDir);
    const advItems = modules[1].items;
    const csvItem = advItems.find((i) => i.file === '02-data.csv');

    assert.ok(csvItem);
    assert.equal(csvItem.canvasType, 'file');
  });

  it('treats markdown wrappers with canvas_type file as file items', () => {
    const modules = scanCourse(tmpDir);
    const advItems = modules[1].items;
    const fileWrapper = advItems.find(
      (i) => i.file === '03-diagram.md' && i.canvasType === 'file',
    );

    assert.ok(fileWrapper);
    assert.equal(fileWrapper.canvasType, 'file');
    assert.equal(fileWrapper.frontmatter.file_ref, '_files/diagram.svg');
  });

  it('prefers the frontmatter title over the filename-derived title', () => {
    const modules = scanCourse(tmpDir);
    const advItems = modules[1].items;
    const api = advItems.find((i) => i.file === '04-api.md');

    assert.ok(api);
    assert.equal(api.title, 'REST API Reference');
  });

  it('builds relative paths with forward slashes on every platform', () => {
    // Not path.join: the separator is part of the contract, not of the host.
    // This value is the key `.canvas-sync.json` stores item identity under and
    // the base every `path.posix` resolution downstream starts from (validate's
    // link check, the link resolver's `_files/` references, the exporter's image
    // and cross-link rewrites). A native `01-intro\01-welcome.md` reaches all of
    // them as a path with no directory part, so they resolve from the course
    // root instead of the item's folder.
    const modules = scanCourse(tmpDir);
    assert.equal(modules[0].items[0].relativePath, '01-intro/01-welcome.md');

    const subheader = modules[1].items.find((i) => i.type === 'subheader');
    assert.equal(
      subheader.items[0].relativePath,
      '02-advanced/01-exercises/01-exercise-a.md',
    );
  });
});

describe('scanCourse nesting warnings', () => {
  let tmpDir;
  let warnMock;

  const write = (...parts) => {
    const file = path.join(tmpDir, ...parts);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '---\ntitle: Deep\n---\n\nBody.');
  };

  const warnings = () => warnMock.mock.calls.map((c) => c.arguments.join(' '));

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'course-nesting-'));
    // The logger, not console: what this pins is that the warning goes through
    // the sink `--quiet` and `--verbose` control. A console mock would pass
    // either way.
    warnMock = mock.method(log, 'warn', () => {});
  });

  afterEach(() => {
    warnMock.mock.restore();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('warns once, by name, about a folder nested inside a subfolder', () => {
    write('01-intro', '01-welcome.md');
    write('01-intro', '02-basics', '01-variables.md');
    write('01-intro', '02-basics', '03-deep', '01-buried.md');

    scanCourse(tmpDir);

    assert.equal(warnMock.mock.callCount(), 1);
    const [message] = warnings();
    assert.match(message, /01-intro\/02-basics\/03-deep\//);
    // Says what to do about it, not just that something went wrong.
    assert.match(message, /Move its files into 01-intro\/02-basics\//);
  });

  it('still drops the files inside it, warning or no warning', () => {
    // The warning is the whole change: what reaches Canvas is unchanged, so a
    // file two levels down is still invisible to every caller of the scan.
    write('01-intro', '02-basics', '01-variables.md');
    write('01-intro', '02-basics', '03-deep', '01-buried.md');

    const [module] = scanCourse(tmpDir);
    const subheader = module.items.find((i) => i.type === 'subheader');

    assert.equal(subheader.items.length, 1);
    assert.equal(subheader.items[0].file, '01-variables.md');
    assert.equal(
      subheader.items.find((i) => i.file === '01-buried.md'),
      undefined,
    );
  });

  it('stays silent about an underscore-prefixed folder at that depth', () => {
    // `_files/` inside a subfolder is internal by design. Warning about it
    // would fire on the layout the tool itself writes during a pull.
    write('01-intro', '02-basics', '01-variables.md');
    fs.mkdirSync(path.join(tmpDir, '01-intro', '02-basics', '_files'));
    fs.writeFileSync(
      path.join(tmpDir, '01-intro', '02-basics', '_files', 'diagram.png'),
      'fake-image',
    );

    scanCourse(tmpDir);

    assert.equal(warnMock.mock.callCount(), 0);
  });

  it('names the topmost dropped folder only, however deep the tree goes', () => {
    // The walk stops at the first folder it drops, so a four-deep tree is one
    // warning about the folder to fix, not one per level below it.
    write('01-intro', '02-basics', '03-deep', '04-deeper', '01-buried.md');

    scanCourse(tmpDir);

    assert.equal(warnMock.mock.callCount(), 1);
    assert.match(warnings()[0], /01-intro\/02-basics\/03-deep\//);
  });

  it('warns once per dropped folder when a subfolder holds several', () => {
    write('01-intro', '02-basics', '03-deep', '01-buried.md');
    write('01-intro', '02-basics', '04-also-deep', '01-buried.md');

    scanCourse(tmpDir);

    assert.equal(warnMock.mock.callCount(), 2);
    const messages = warnings();
    assert.equal(
      messages.filter((m) => m.includes('01-intro/02-basics/03-deep/')).length,
      1,
    );
    assert.equal(
      messages.filter((m) => m.includes('01-intro/02-basics/04-also-deep/'))
        .length,
      1,
    );
  });

  it('says nothing about a subfolder directly inside a module', () => {
    // One level of nesting is the supported layout; only deeper is a mistake.
    write('01-intro', '02-basics', '01-variables.md');

    scanCourse(tmpDir);

    assert.equal(warnMock.mock.callCount(), 0);
  });
});
