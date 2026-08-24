const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { scanCourse } = require('../../lib/convert/course-scanner');
const { _validateModules: validateModules } = require('../../cli/validate');

let tmpDir;
let moduleDir;

/**
 * Run validate over the temp course tree.
 */
function run() {
  return validateModules(scanCourse(tmpDir), tmpDir);
}

/**
 * Write a file inside the module folder, creating parent folders as needed.
 */
function writeItem(relativePath, content) {
  const target = path.join(moduleDir, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

describe('validateModules — file items', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-test-'));
    moduleDir = path.join(tmpDir, '01-module');
    fs.mkdirSync(moduleDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('accepts a file wrapper whose file_ref exists', () => {
    writeItem('_files/syllabus.pdf', 'binary');
    writeItem(
      '01-syllabus.md',
      '---\ntitle: Syllabus\ncanvas_type: file\nfile_ref: _files/syllabus.pdf\n---\n',
    );

    const { errors, warnings } = run();
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings, []);
  });

  it('reports a file wrapper without a file_ref', () => {
    writeItem(
      '01-syllabus.md',
      '---\ntitle: Syllabus\ncanvas_type: file\n---\n',
    );

    const { errors } = run();
    assert.deepEqual(errors, [
      '01-module/01-syllabus.md: file type requires a file_ref field',
    ]);
  });

  it('reports a file wrapper whose file_ref target is missing', () => {
    writeItem(
      '01-syllabus.md',
      '---\ntitle: Syllabus\ncanvas_type: file\nfile_ref: _files/missing.pdf\n---\n',
    );

    const { errors } = run();
    assert.deepEqual(errors, [
      '01-module/01-syllabus.md: file_ref not found: _files/missing.pdf',
    ]);
  });

  it('resolves file_ref relative to the wrapper, not the course root', () => {
    fs.mkdirSync(path.join(moduleDir, '02-section'), { recursive: true });
    writeItem('02-section/_files/handout.pdf', 'binary');
    writeItem(
      '02-section/01-handout.md',
      '---\ntitle: Handout\ncanvas_type: file\nfile_ref: _files/handout.pdf\n---\n',
    );

    const { errors } = run();
    assert.deepEqual(errors, []);
  });

  it('skips raw binaries dropped in a module folder', () => {
    writeItem('slides.pptx', 'binary');

    const { errors, warnings } = run();
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings, []);
  });

  it('accepts canvas_type: discussion as a known type', () => {
    writeItem(
      '01-debate.md',
      '---\ntitle: Week 1 debate\ncanvas_type: discussion\n---\n\nSay something.\n',
    );

    const { errors } = run();
    assert.deepEqual(errors, []);
  });

  it('accepts canvas_type: file as a known type', () => {
    writeItem('_files/syllabus.pdf', 'binary');
    writeItem(
      '01-syllabus.md',
      '---\ntitle: Syllabus\ncanvas_type: file\nfile_ref: _files/syllabus.pdf\n---\n',
    );

    const { errors } = run();
    assert.equal(
      errors.some((e) => e.includes('unknown canvas_type')),
      false,
    );
  });

  it('still reports an unknown canvas_type', () => {
    writeItem(
      '01-mystery.md',
      '---\ntitle: Mystery\ncanvas_type: announcement\n---\n',
    );

    const { errors } = run();
    assert.equal(errors.length, 1);
    assert.match(
      errors[0],
      /^01-module\/01-mystery\.md: unknown canvas_type "announcement" \(expected: /,
    );
  });

  it('validates a file wrapper like any other item', () => {
    writeItem('_files/syllabus.pdf', 'binary');
    writeItem(
      'syllabus.md',
      '---\ntitle: Syllabus\ncanvas_type: file\nfile_ref: _files/syllabus.pdf\n---\n\nSee [the intro](./99-nope.md).\n',
    );

    const { errors, warnings } = run();
    assert.deepEqual(warnings, [
      '01-module/syllabus.md: filename should start with a two-digit prefix',
    ]);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /broken link to "\.\/99-nope\.md"/);
  });
});

describe('validateModules — raw HTML file references', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-rawhtml-'));
    moduleDir = path.join(tmpDir, '01-module');
    fs.mkdirSync(moduleDir, { recursive: true });
    fs.mkdirSync(path.join(moduleDir, '_files'), { recursive: true });
    fs.writeFileSync(path.join(moduleDir, '_files', 'diagram.png'), 'binary');
    fs.writeFileSync(path.join(moduleDir, '_files', 'handout.pdf'), 'binary');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /** Write a page whose body is `body`. */
  function writePage(body) {
    writeItem('01-page.md', `---\ntitle: Page\n---\n\n${body}\n`);
  }

  it('warns about an image written as a raw HTML tag', () => {
    writePage('<img src="_files/diagram.png" alt="Diagram">');

    const { errors, warnings } = run();
    assert.deepEqual(errors, []);
    assert.equal(warnings.length, 1);
    assert.match(
      warnings[0],
      /^01-module\/01-page\.md: raw HTML <img src="_files\/diagram\.png"> will not sync\./,
    );
    assert.match(warnings[0], /!\[alt\]\(_files\/diagram\.png\)/);
  });

  it('warns about a link written as a raw HTML tag', () => {
    writePage('<a href="_files/handout.pdf">Handout</a>');

    const { errors, warnings } = run();
    assert.deepEqual(errors, []);
    assert.equal(warnings.length, 1);
    assert.match(
      warnings[0],
      /^01-module\/01-page\.md: raw HTML <a href="_files\/handout\.pdf"> will not sync\./,
    );
    assert.match(warnings[0], /\[text\]\(_files\/handout\.pdf\)/);
  });

  it('says nothing about the same references in markdown syntax', () => {
    writePage(
      '![Diagram](_files/diagram.png)\n\n[Handout](_files/handout.pdf)\n',
    );

    const { errors, warnings } = run();
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings, []);
  });

  it('ignores a raw HTML example inside a fence or a code span', () => {
    writePage(
      '```html\n<img src="_files/diagram.png">\n```\n\n' +
        'Avoid `<a href="_files/handout.pdf">Handout</a>` in a page.\n',
    );

    const { errors, warnings } = run();
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings, []);
  });

  it('reports each distinct raw HTML reference once', () => {
    writePage(
      '<img src="_files/diagram.png">\n\n<img src="_files/diagram.png">\n\n' +
        "<a href='_files/handout.pdf'>Handout</a>\n",
    );

    const { warnings } = run();
    assert.equal(warnings.length, 2);
    assert.match(warnings[0], /<img src="_files\/diagram\.png">/);
    assert.match(warnings[1], /<a href="_files\/handout\.pdf">/);
  });

  it('leaves an absolute URL that happens to contain _files/ alone', () => {
    writePage('<img src="https://example.org/_files/diagram.png">');

    const { errors, warnings } = run();
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings, []);
  });

  it('does not mistake a data- attribute for src', () => {
    writePage('<div data-src="_files/diagram.png"></div>');

    const { warnings } = run();
    assert.deepEqual(warnings, []);
  });

  it('keeps the raw HTML warning out of the exit-code path', () => {
    // Warnings never fail validate; only errors do. This one is a warning
    // because the page still renders locally and pushes without crashing.
    writePage('<img src="_files/diagram.png">');

    const { errors } = run();
    assert.deepEqual(errors, []);
  });
});

describe('validateModules — reference-style file references', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-refstyle-'));
    moduleDir = path.join(tmpDir, '01-module');
    fs.mkdirSync(moduleDir, { recursive: true });
    fs.mkdirSync(path.join(moduleDir, '_files'), { recursive: true });
    fs.writeFileSync(path.join(moduleDir, '_files', 'diagram.png'), 'binary');
    fs.writeFileSync(path.join(moduleDir, '_files', 'handout.pdf'), 'binary');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /** Write a page whose body is `body`. */
  function writePage(body) {
    writeItem('01-page.md', `---\ntitle: Page\n---\n\n${body}\n`);
  }

  it('warns about an image written reference-style', () => {
    writePage('![Diagram][d]\n\n[d]: _files/diagram.png');

    const { errors, warnings } = run();
    assert.deepEqual(errors, []);
    assert.equal(warnings.length, 1);
    assert.match(
      warnings[0],
      /^01-module\/01-page\.md: reference-style definition \[d\]: _files\/diagram\.png will not sync\./,
    );
    assert.match(warnings[0], /!\[alt\]\(_files\/diagram\.png\)/);
    assert.match(warnings[0], /\[text\]\(_files\/diagram\.png\)/);
  });

  it('warns once per definition, not once per reference to it', () => {
    writePage(
      '![Diagram][d]\n\nAnd again: ![Diagram][d]\n\nCollapsed: ![d][]\n\n' +
        'Shortcut: [d]\n\n[d]: _files/diagram.png\n[h]: _files/handout.pdf',
    );

    const { warnings } = run();
    assert.equal(warnings.length, 2);
    assert.match(warnings[0], /\[d\]: _files\/diagram\.png/);
    assert.match(warnings[1], /\[h\]: _files\/handout\.pdf/);
  });

  it('quotes the label as the author spelled it', () => {
    writePage('![Diagram][Big Label]\n\n[Big Label]: _files/diagram.png');

    const { warnings } = run();
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /definition \[Big Label\]: _files\/diagram\.png/);
  });

  it('reads an angle-bracketed destination and a title on the next line', () => {
    writePage('![Diagram][d]\n\n[d]: <_files/diagram.png>\n   "The diagram"');

    const { warnings } = run();
    assert.equal(warnings.length, 1);
    assert.match(
      warnings[0],
      /definition \[d\]: _files\/diagram\.png will not/,
    );
  });

  it('finds a definition nested in a blockquote or a list item', () => {
    // CommonMark resolves a reference through either of these, so a push turns
    // them into the same dead relative path a top-level definition would.
    writePage(
      '> [d]: _files/diagram.png\n\n- item\n\n  [h]: _files/handout.pdf',
    );

    const { warnings } = run();
    assert.equal(warnings.length, 2);
    assert.match(warnings[0], /\[d\]: _files\/diagram\.png/);
    assert.match(warnings[1], /\[h\]: _files\/handout\.pdf/);
  });

  it('says nothing about the same reference in inline syntax', () => {
    writePage(
      '![Diagram](_files/diagram.png)\n\n[Handout](_files/handout.pdf)\n',
    );

    const { errors, warnings } = run();
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings, []);
  });

  it('leaves an absolute destination alone', () => {
    writePage(
      '![Diagram][d]\n\n[d]: https://example.org/_files/diagram.png\n' +
        '[h]: /_files/handout.pdf',
    );

    const { errors, warnings } = run();
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings, []);
  });

  it('ignores a definition inside a fence, a code span or an indented block', () => {
    writePage(
      '```markdown\n[d]: _files/diagram.png\n```\n\n' +
        'Avoid `[d]: _files/diagram.png` at the bottom.\n\n' +
        '    [d]: _files/diagram.png\n',
    );

    const { errors, warnings } = run();
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings, []);
  });

  it('does not mistake a definition-shaped line inside a paragraph for one', () => {
    // A definition cannot interrupt a paragraph, so this is prose that happens
    // to look like one and resolves no reference at all.
    writePage('Some text\n[d]: _files/diagram.png');

    const { warnings } = run();
    assert.deepEqual(warnings, []);
  });

  it('leaves a definition that points outside _files/ alone', () => {
    writePage('[d]: ./02-other.md\n[e]: ../01-module/notes.txt');

    const { warnings } = run();
    assert.deepEqual(warnings, []);
  });

  it('keeps the reference-style warning out of the exit-code path', () => {
    // Warnings never fail validate; only errors do. The page still renders
    // locally and still pushes, it just loses the file on the way.
    writePage('![Diagram][d]\n\n[d]: _files/diagram.png');

    const { errors } = run();
    assert.deepEqual(errors, []);
  });
});

describe('validateModules — quiz items', () => {
  let root;
  let courseDir;
  let quizModuleDir;

  /**
   * Validate a repo-shaped temp tree: course/ holds the modules, and quiz_ref
   * paths resolve from the root above it, where evaluations/ lives.
   */
  function runFromRoot() {
    return validateModules(scanCourse(courseDir), courseDir, root);
  }

  /** Write a quiz item with the given frontmatter lines. */
  function writeQuiz(lines) {
    fs.writeFileSync(
      path.join(quizModuleDir, '05-test.md'),
      `---\ntitle: Test 1\ncanvas_type: quiz\n${lines}---\n`,
    );
  }

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-quiz-'));
    courseDir = path.join(root, 'course');
    quizModuleDir = path.join(courseDir, '01-module');
    fs.mkdirSync(quizModuleDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('accepts a quiz whose quiz_ref zip is on disk', () => {
    const zipDir = path.join(root, 'evaluations', '2526', 'test-1');
    fs.mkdirSync(zipDir, { recursive: true });
    fs.writeFileSync(path.join(zipDir, 'test-1-qti.zip'), 'binary');
    writeQuiz('quiz_ref: evaluations/2526/test-1/test-1-qti.zip\n');

    const { errors, warnings } = runFromRoot();
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings, []);
  });

  it('warns about a quiz without a quiz_ref, but does not error', () => {
    // A quiz pulled from Canvas has no quiz_ref and never will until the author
    // points it at a package, so this state has to stay valid. It is still the
    // one a rollover cannot rebuild, so it has to be said out loud.
    writeQuiz('');

    const { errors, warnings } = runFromRoot();
    assert.deepEqual(errors, []);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /^01-module\/05-test\.md: quiz has no quiz_ref/);
    assert.match(warnings[0], /rollover/);
  });

  it('reports a quiz_ref that points at nothing', () => {
    writeQuiz('quiz_ref: evaluations/2526/test-1/missing-qti.zip\n');

    const { errors } = runFromRoot();
    assert.deepEqual(errors, [
      '01-module/05-test.md: quiz_ref not found: evaluations/2526/test-1/missing-qti.zip (resolved from the repo root)',
    ]);
  });

  it('resolves quiz_ref from the repo root, not from the item', () => {
    // The zip lives under evaluations/, outside course/, so a path that would
    // resolve relative to the markdown file must not be accepted.
    fs.mkdirSync(path.join(quizModuleDir, 'evaluations'), { recursive: true });
    fs.writeFileSync(
      path.join(quizModuleDir, 'evaluations', 'test-1-qti.zip'),
      'binary',
    );
    writeQuiz('quiz_ref: evaluations/test-1-qti.zip\n');

    const { errors } = runFromRoot();
    assert.equal(errors.length, 1);
    assert.match(errors[0], /quiz_ref not found/);
  });

  it('accepts canvas_type: quiz as a known type', () => {
    writeQuiz('quiz_ref: evaluations/2526/test-1/test-1-qti.zip\n');

    const { errors } = runFromRoot();
    assert.equal(
      errors.some((e) => e.includes('unknown canvas_type')),
      false,
    );
  });
});
