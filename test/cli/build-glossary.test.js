const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  DEFAULT_CONFIG,
  defaultConfigFor,
  renderLemma,
  renderBody,
  serializePage,
  resolveLesson,
} = require('../../cli/build-glossary');
const { getLabels } = require('../../lib/config/labels');

const TERMS = [
  {
    term: 'variable',
    lesson: 1,
    kind: 'concept',
    synonyms: [],
    definition: 'A named box.',
  },
  {
    term: 'Scanner',
    lesson: 1,
    kind: 'code',
    synonyms: [],
    definition: 'Reads input.',
  },
  {
    term: 'instance variable',
    lesson: 2,
    kind: 'concept',
    synonyms: ['attribute', 'field'],
    definition: 'Data on an object.',
    note: 'A local variable never is.',
  },
  {
    term: 'boolean',
    lesson: 2,
    kind: 'code',
    synonyms: [],
    definition: 'true or false.',
  },
  {
    term: '&&',
    lesson: 2,
    kind: 'operator',
    synonyms: [],
    definition: 'Logical and.',
  },
];

describe('renderLemma', () => {
  it('renders a concept without backticks', () => {
    assert.equal(renderLemma(TERMS[0]), '- **variable**: A named box.');
  });

  it('wraps code and operator terms in backticks', () => {
    assert.equal(renderLemma(TERMS[1]), '- **`Scanner`**: Reads input.');
    assert.equal(renderLemma(TERMS[4]), '- **`&&`**: Logical and.');
  });

  it('lists synonyms in parentheses and appends the note as a final sentence', () => {
    assert.equal(
      renderLemma(TERMS[2]),
      '- **instance variable** (attribute, field): Data on an object. A local variable never is.',
    );
  });

  it('respects config.code_kinds', () => {
    const config = { ...DEFAULT_CONFIG, code_kinds: [] };
    assert.equal(renderLemma(TERMS[1], config), '- **Scanner**: Reads input.');
  });
});

describe('renderBody', () => {
  it('is cumulative: only includes terms up to the given lesson', () => {
    const body = renderBody(TERMS, 1);
    assert.match(body, /Scanner/);
    assert.match(body, /variable/);
    assert.doesNotMatch(body, /instance variable/);
    assert.doesNotMatch(body, /Operators/); // no operators yet at lesson 1
    assert.match(body, /after lesson 1/);
  });

  it('emits the operators section first, then the terms section', () => {
    const body = renderBody(TERMS, 2);
    const opIdx = body.indexOf('## Operators');
    const termIdx = body.indexOf('## Terms');
    assert.ok(opIdx !== -1 && termIdx !== -1);
    assert.ok(opIdx < termIdx, 'Operators should come before Terms');
  });

  it('sorts terms case-insensitively', () => {
    const body = renderBody(TERMS, 2);
    // Use the unique bolded lemma tokens to avoid substring collisions
    // (e.g. "variable" is a substring of "instance variable").
    const order = [
      '**`boolean`**',
      '**instance variable**',
      '**`Scanner`**',
      '**variable**',
    ].map((t) => body.indexOf(t));
    assert.ok(
      order.every((i) => i !== -1),
      'all lemmas present',
    );
    const sorted = [...order].sort((a, b) => a - b);
    assert.deepEqual(order, sorted);
  });

  it('uses configured intro and headings', () => {
    const config = {
      ...DEFAULT_CONFIG,
      intro: 'Dit is de woordenlijst na les {lesson}.',
      headings: { operators: 'Operatoren', terms: 'Termen' },
    };
    const body = renderBody(TERMS, 2, config);
    assert.match(body, /^Dit is de woordenlijst na les 2\./);
    assert.match(body, /## Operatoren/);
    assert.match(body, /## Termen/);
  });
});

describe('serializePage', () => {
  it('forces the quoted emoji title and defaults canvas_type', () => {
    const page = serializePage({}, 'BODY');
    assert.match(
      page,
      /^---\ntitle: "📘 Glossary"\ncanvas_type: "page"\n---\n\nBODY\n$/,
    );
  });

  it('preserves existing frontmatter such as canvas_id', () => {
    const page = serializePage(
      { title: 'old', canvas_type: 'page', canvas_id: 98765 },
      'BODY',
    );
    assert.match(page, /title: "📘 Glossary"/);
    assert.match(page, /canvas_id: 98765/);
  });

  it('uses the configured title', () => {
    const config = { ...DEFAULT_CONFIG, title: '📘 Woordenlijst' };
    const page = serializePage({}, 'BODY', config);
    assert.match(page, /title: "📘 Woordenlijst"/);
  });
});

describe('resolveLesson', () => {
  it('prefers a lesson frontmatter key on the page', () => {
    assert.equal(
      resolveLesson('05-anything', { lesson: 3 }, DEFAULT_CONFIG),
      3,
    );
  });

  it('falls back to the module numeric prefix by default', () => {
    assert.equal(resolveLesson('07-loops', {}, DEFAULT_CONFIG), 7);
  });

  it('applies a custom module_pattern', () => {
    const config = { ...DEFAULT_CONFIG, module_pattern: 'les(\\d+)' };
    assert.equal(resolveLesson('03-les1-de-slaapkamer', {}, config), 1);
  });

  it('returns null when no lesson number can be resolved', () => {
    const config = { ...DEFAULT_CONFIG, module_pattern: 'les(\\d+)' };
    assert.equal(resolveLesson('99-reference', {}, config), null);
  });
});

// The command used to resolve `course/` and the default glossary from
// `process.cwd()`, so it was the one command in this CLI that only worked from
// the project root. Run through a child process with its cwd inside the
// fixture, because PROJECT_ROOT is resolved once at require time.
describe('npx course build-glossary from a subdirectory', () => {
  const CLI = path.resolve(__dirname, '../../cli/index.js');
  const made = [];

  afterEach(() => {
    for (const dir of made.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  /** A throwaway project with one lesson module and one glossary page. */
  function project() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'build-glossary-'));
    made.push(dir);
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      '{ "name": "fixture", "private": true }\n',
      'utf8',
    );
    fs.mkdirSync(path.join(dir, 'course', '01-loops'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'course', '01-loops', '02-glossary.md'),
      '---\ntitle: "stale"\n---\n\nstale body\n',
      'utf8',
    );
    fs.mkdirSync(path.join(dir, 'sources', 'reference-materials'), {
      recursive: true,
    });
    writeGlossary(
      path.join(dir, 'sources', 'reference-materials', 'glossary.yml'),
      'A repeated block.',
    );
    return dir;
  }

  function writeGlossary(file, definition) {
    fs.writeFileSync(
      file,
      `terms:\n  - term: loop\n    lesson: 1\n    kind: concept\n    definition: ${definition}\n`,
      'utf8',
    );
  }

  function run(dir, args = [], cwd = path.join(dir, 'course', '01-loops')) {
    return spawnSync(process.execPath, [CLI, 'build-glossary', ...args], {
      cwd,
      input: '',
      encoding: 'utf8',
      timeout: 30000,
    });
  }

  function page(dir) {
    return fs.readFileSync(
      path.join(dir, 'course', '01-loops', '02-glossary.md'),
      'utf8',
    );
  }

  it('rebuilds the page from the project root when run inside a module', () => {
    const dir = project();

    const built = run(dir);

    assert.equal(built.status, 0, built.stderr);
    assert.match(page(dir), /- \*\*loop\*\*: A repeated block\./);
    assert.match(page(dir), /title: "📘 Glossary"/);
  });

  it('reports up-to-date pages under --check from inside a module', () => {
    const dir = project();
    assert.equal(run(dir).status, 0);

    const checked = run(dir, ['--check']);

    assert.equal(checked.status, 0, checked.stderr);
    assert.match(checked.stdout, /All glossary pages are up to date/);
  });

  it('fails --check on a stale page from inside a module', () => {
    const dir = project();

    const checked = run(dir, ['--check']);

    assert.equal(checked.status, 1);
    assert.match(checked.stderr, /1 glossary page\(s\) out of date/);
    assert.match(page(dir), /stale body/, '--check must not write');
  });

  it('still limits the run to one module with --module', () => {
    const dir = project();
    fs.mkdirSync(path.join(dir, 'course', '02-arrays'));
    const other = path.join(dir, 'course', '02-arrays', '02-glossary.md');
    fs.writeFileSync(other, '---\ntitle: "stale"\n---\n\nstale body\n', 'utf8');

    const built = run(dir, ['--module', '01-loops']);

    assert.equal(built.status, 0, built.stderr);
    assert.match(page(dir), /A repeated block\./);
    assert.match(fs.readFileSync(other, 'utf8'), /stale body/);
  });

  it('resolves an explicit --glossary from the working directory', () => {
    const dir = project();
    // Same filename, different content, sitting next to the cwd: only a
    // cwd-relative resolution can pick it up.
    writeGlossary(
      path.join(dir, 'course', '01-loops', 'local.yml'),
      'The local definition.',
    );

    const built = run(dir, ['--glossary', 'local.yml']);

    assert.equal(built.status, 0, built.stderr);
    assert.match(page(dir), /- \*\*loop\*\*: The local definition\./);
  });
});

describe('defaultConfigFor', () => {
  it('keeps the English baseline in DEFAULT_CONFIG', () => {
    assert.equal(DEFAULT_CONFIG.title, '📘 Glossary');
    assert.equal(DEFAULT_CONFIG.headings.operators, 'Operators');
    assert.equal(DEFAULT_CONFIG.headings.terms, 'Terms');
    assert.match(DEFAULT_CONFIG.intro, /\{lesson\}/);
  });

  it('localizes the language strings for nl labels', () => {
    const config = defaultConfigFor(getLabels('nl'));
    assert.equal(config.title, '📘 Woordenlijst');
    assert.equal(config.headings.operators, 'Operatoren');
    assert.equal(config.headings.terms, 'Termen');
    assert.match(config.intro, /\{lesson\}/);
    // structural settings stay identical to the baseline
    assert.equal(config.page_pattern, DEFAULT_CONFIG.page_pattern);
    assert.deepEqual(config.kinds, DEFAULT_CONFIG.kinds);
  });
});
