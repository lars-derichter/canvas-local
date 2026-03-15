const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { scanCourse, extractPosition, displayTitle } = require('../../lib/convert/course-scanner');

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
  it('strips numeric prefix and title-cases', () => {
    assert.equal(displayTitle('01-welcome'), 'Welcome');
    assert.equal(displayTitle('02-getting-started'), 'Getting Started');
  });

  it('handles names without numeric prefix', () => {
    assert.equal(displayTitle('introduction'), 'Introduction');
    assert.equal(displayTitle('deep-dive'), 'Deep Dive');
  });

  it('replaces underscores with spaces', () => {
    assert.equal(displayTitle('01-my_page'), 'My Page');
  });

  it('handles single-word names', () => {
    assert.equal(displayTitle('99-appendix'), 'Appendix');
    assert.equal(displayTitle('overview'), 'Overview');
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
      '---\ntitle: Welcome\ncanvas_type: page\n---\n\nHello!'
    );
    fs.writeFileSync(
      path.join(mod1, '02-setup.md'),
      '---\ntitle: Setup\n---\n\nSetup instructions.'
    );

    // Module 1 _files directory (should be skipped)
    fs.mkdirSync(path.join(mod1, '_files'));
    fs.writeFileSync(path.join(mod1, '_files', 'image.png'), 'fake-image');

    // Module 2 with an assignment and a subfolder
    const mod2 = path.join(tmpDir, '02-advanced');
    fs.mkdirSync(mod2);
    fs.writeFileSync(
      path.join(mod2, '01-homework.md'),
      '---\ntitle: Homework\ncanvas_type: assignment\npoints_possible: 10\n---\n\nDo it.'
    );

    // Subfolder inside module 2
    const sub = path.join(mod2, '01-exercises');
    fs.mkdirSync(sub);
    fs.writeFileSync(
      path.join(sub, '01-exercise-a.md'),
      '---\ntitle: Exercise A\n---\n\nFirst exercise.'
    );

    // Module 2 with a non-markdown file
    fs.writeFileSync(path.join(mod2, '02-data.csv'), 'a,b,c');
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

  it('derives module names from folder names', () => {
    const modules = scanCourse(tmpDir);
    assert.equal(modules[0].moduleName, 'Intro');
    assert.equal(modules[1].moduleName, 'Advanced');
  });

  it('assigns correct positions', () => {
    const modules = scanCourse(tmpDir);
    assert.equal(modules[0].position, 1);
    assert.equal(modules[1].position, 2);
  });

  it('scans markdown items with frontmatter', () => {
    const modules = scanCourse(tmpDir);
    const introItems = modules[0].items;

    assert.equal(introItems.length, 2);
    assert.equal(introItems[0].title, 'Welcome');
    assert.equal(introItems[0].canvasType, 'page');
    assert.equal(introItems[1].title, 'Setup');
    assert.equal(introItems[1].canvasType, 'page'); // defaults to page
  });

  it('skips underscore-prefixed entries', () => {
    const modules = scanCourse(tmpDir);
    const introItems = modules[0].items;

    // _files directory should not appear as an item
    const fileItem = introItems.find((i) => i.title === 'Files' || (i.file && i.file.includes('_files')));
    assert.equal(fileItem, undefined);
  });

  it('detects assignment type from frontmatter', () => {
    const modules = scanCourse(tmpDir);
    const advItems = modules[1].items;
    const hw = advItems.find((i) => i.type === 'item' && i.canvasType === 'assignment');
    assert.ok(hw);
    assert.equal(hw.title, 'Homework');
    assert.equal(hw.frontmatter.points_possible, 10);
  });

  it('handles subfolders as subheaders with nested items', () => {
    const modules = scanCourse(tmpDir);
    const advItems = modules[1].items;
    const subheader = advItems.find((i) => i.type === 'subheader');

    assert.ok(subheader);
    assert.equal(subheader.title, 'Exercises');
    assert.equal(subheader.items.length, 1);
    assert.equal(subheader.items[0].title, 'Exercise A');
    assert.equal(subheader.items[0].indent, 1);
  });

  it('treats non-markdown files as canvas_type file', () => {
    const modules = scanCourse(tmpDir);
    const advItems = modules[1].items;
    const csvItem = advItems.find((i) => i.file === '02-data.csv');

    assert.ok(csvItem);
    assert.equal(csvItem.canvasType, 'file');
  });

  it('builds correct relative paths', () => {
    const modules = scanCourse(tmpDir);
    const introItems = modules[0].items;
    assert.equal(introItems[0].relativePath, path.join('01-intro', '01-welcome.md'));
  });
});
