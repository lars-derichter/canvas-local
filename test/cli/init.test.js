const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dotenv = require('dotenv');

const init = require('../../cli/init');
const { RefusalError } = require('../../lib/errors');
// The extension's own `.env` parser, so what this command writes can be checked
// against the second reader of the same file. It requires nothing (see
// `docs/vscode.md`), so a plain `node --test` loads it.
const {
  readEnvConfig,
} = require('../../.vscode/extensions/course-manager/helpers');

const {
  _describesSameCourse: describesSameCourse,
  _describeSyncTarget: describeSyncTarget,
  _readExistingEnv: readExistingEnv,
  _parseCourseId: parseCourseId,
  _buildEnvFile: buildEnvFile,
} = init;

const CLI = path.join(__dirname, '..', '..', 'cli', 'index.js');

const URL = 'https://school.instructure.com';

/** Sync state as a course that has been pushed to leaves it. */
function synced(overrides = {}) {
  return {
    schema_version: 4,
    canvas_base_url: URL,
    course_id: 45083,
    modules: {
      '01-intro': { canvas_module_id: 100, item_order: [], items: {} },
    },
    icons: {},
    files: {},
    ...overrides,
  };
}

describe('describesSameCourse', () => {
  it('recognises a re-init of the same course', () => {
    assert.equal(
      describesSameCourse(synced(), { courseId: '45083', canvasBaseUrl: URL }),
      true,
    );
  });

  it('compares a stored number against an entered string', () => {
    assert.equal(
      describesSameCourse(synced({ course_id: 45083 }), {
        courseId: 45083,
        canvasBaseUrl: URL,
      }),
      true,
    );
  });

  it('rejects a different course', () => {
    assert.equal(
      describesSameCourse(synced(), { courseId: '58155', canvasBaseUrl: URL }),
      false,
      'those module ids belong to 45083 and mean nothing in 58155',
    );
  });

  it('rejects the same course id on a different instance', () => {
    assert.equal(
      describesSameCourse(synced(), {
        courseId: '45083',
        canvasBaseUrl: 'https://other.instructure.com',
      }),
      false,
    );
  });

  it('ignores a base URL that differs only by punctuation', () => {
    assert.equal(
      describesSameCourse(synced({ canvas_base_url: `${URL}/api/v1` }), {
        courseId: '45083',
        canvasBaseUrl: `${URL}/`,
      }),
      true,
    );
  });

  it('keeps the mappings of a file that claims no course', () => {
    // Written while CANVAS_COURSE_ID was unset: it was built against whatever
    // course was configured then, which is the one being named now.
    assert.equal(
      describesSameCourse(synced({ course_id: 0 }), {
        courseId: '45083',
        canvasBaseUrl: URL,
      }),
      true,
    );

    const noField = synced();
    delete noField.course_id;
    assert.equal(
      describesSameCourse(noField, { courseId: '45083', canvasBaseUrl: URL }),
      true,
    );
  });

  it('does not judge on a base URL the file never recorded', () => {
    assert.equal(
      describesSameCourse(synced({ canvas_base_url: '' }), {
        courseId: '45083',
        canvasBaseUrl: URL,
      }),
      true,
    );
  });
});

describe('describeSyncTarget', () => {
  it('names the course and the instance', () => {
    assert.equal(
      describeSyncTarget(synced()),
      `course 45083 on ${URL}`,
      'the line explains which ids are being dropped, so it names their course',
    );
  });

  it('drops the instance when the file never recorded one', () => {
    assert.equal(
      describeSyncTarget(synced({ canvas_base_url: '' })),
      'course 45083',
    );
  });

  it('stays readable when the file claims no course', () => {
    assert.equal(
      describeSyncTarget(synced({ course_id: 0 })),
      `another course on ${URL}`,
    );
  });
});

describe('readExistingEnv', () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'init-env-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const read = (content) => {
    const file = path.join(dir, '.env');
    fs.writeFileSync(file, content, 'utf8');
    return readExistingEnv(file);
  };

  /** The three values, so a case only has to name the ones it sets. */
  const env = ({ url = '', token = '', courseId = '' } = {}) => ({
    url,
    token,
    courseId,
  });

  it('offers nothing when there is no file', () => {
    assert.deepEqual(readExistingEnv(path.join(dir, '.env')), env());
  });

  // The shapes a hand-edited `.env` takes, lifted from the corpus
  // `test/vscode/helpers.test.js` holds for the extension's own reader. Every
  // one of them is a shape `dotenv` reads, and therefore one the rest of the
  // tool was already running on while this command could not see it.
  const SHAPES = [
    [
      'plain values',
      'CANVAS_API_URL=https://x.test\nCANVAS_API_TOKEN=abc\nCANVAS_COURSE_ID=45083\n',
      env({ url: 'https://x.test', token: 'abc', courseId: '45083' }),
    ],
    [
      'double-quoted values',
      'CANVAS_API_URL="https://x.test"\nCANVAS_COURSE_ID="45083"\n',
      env({ url: 'https://x.test', courseId: '45083' }),
    ],
    [
      'single-quoted values',
      "CANVAS_COURSE_ID='45083'\n",
      env({ courseId: '45083' }),
    ],
    [
      'export-prefixed keys',
      'export CANVAS_API_TOKEN=abc\n',
      env({ token: 'abc' }),
    ],
    [
      'an indented key',
      '  CANVAS_COURSE_ID=45083\n',
      env({ courseId: '45083' }),
    ],
    [
      'an inline comment',
      'CANVAS_COURSE_ID=45083 # spring\n',
      env({ courseId: '45083' }),
    ],
    ['a commented-out key', '# CANVAS_COURSE_ID=99999\n', env()],
    [
      'CRLF line endings',
      'CANVAS_API_URL=https://x.test\r\nCANVAS_COURSE_ID=45083\r\n',
      env({ url: 'https://x.test', courseId: '45083' }),
    ],
    ['trailing whitespace', 'CANVAS_API_TOKEN=abc  \n', env({ token: 'abc' })],
    ['an empty value', 'CANVAS_API_TOKEN=\n', env()],
    [
      'a hand-edited file',
      '# Canvas credentials\nCANVAS_API_URL="https://x.test"  # sandbox\n' +
        'export CANVAS_API_TOKEN=abc  \n  CANVAS_COURSE_ID=45083\n' +
        '# CANVAS_COURSE_ID=99999\n',
      env({ url: 'https://x.test', token: 'abc', courseId: '45083' }),
    ],
  ];

  for (const [name, content, expected] of SHAPES) {
    it(`reads ${name} the way every other command does`, () => {
      assert.deepEqual(read(content), expected);
    });
  }
});

describe('parseCourseId', () => {
  const ACCEPTED = [
    ['a course id', '45083', 45083],
    ['one already a number', 45083, 45083],
    ['a padded one, canonicalised', '045083', 45083],
    ['one with whitespace around it', '  45083  ', 45083],
  ];

  const REFUSED = [
    ['a term code', 'SPRING-2026'],
    // What `dotenv` never produces but a hand-typed answer can, and what wrote
    // `course_id: null` when it reached `Number()` unchecked.
    ['a quoted id', '"45083"'],
    ['an id with something after it', '45083x'],
    ['a decimal', '45.0'],
    ['exponent notation', '4e2'],
    ['a negative', '-1'],
    ['zero, which the state file uses for "no course"', '0'],
    ['an empty answer', ''],
    ['nothing at all', null],
    ['more digits than a Number can hold exactly', '9007199254740993'],
  ];

  for (const [name, input, expected] of ACCEPTED) {
    it(`takes ${name}`, () => {
      assert.equal(parseCourseId(input), expected);
    });
  }

  for (const [name, input] of REFUSED) {
    it(`refuses ${name}`, () => {
      assert.equal(
        parseCourseId(input),
        null,
        `${JSON.stringify(input)} reaching the sync state is what writes course_id: null`,
      );
    });
  }
});

describe('buildEnvFile', () => {
  const KEY = 'CANVAS_API_TOKEN';
  const write = (value) => buildEnvFile({ [KEY]: value });

  // The property this whole thing exists for: whatever `dotenv.parse` reads out
  // of a `.env`, writing it back has to produce a file `dotenv.parse` reads the
  // same value out of. `.env` is gitignored, so a value this command mangles is
  // gone for good.
  //
  // Checked against `dotenv` itself rather than against an expected string,
  // because `dotenv` is the only authority on what the tool ends up running on:
  // an expected string would pin this command's idea of the file, which is the
  // half that was wrong.
  const ROUND_TRIP = [
    ['a plain token', 'abc123'],
    ['a URL', 'https://school.instructure.com'],
    ['a token with a tilde in it', '7~aBcD1234'],
    ['a space in the middle', 'ab cd'],
    ['a leading space', ' abc'],
    ['a trailing space', 'abc '],
    ['a value that is only whitespace', '   '],
    // 2b: unquoted, everything from the # on is a comment to `dotenv`.
    ['a #', 'ab#cd'],
    ['a # with a space before it', 'ab #cd'],
    ['a # at the front', '#abc'],
    // 2a: `CANVAS_API_TOKEN="a\nb"` parses to two lines, and written unquoted
    // it made a four-line .env whose token was `a`, with a stray `b` on its
    // own line.
    ['a newline', 'a\nb'],
    ['a CRLF pair', 'a\r\nb'],
    ['a trailing newline', 'abc\n'],
    ['a double quote', 'a"b'],
    ['a single quote', "a'b"],
    ['a value wrapped in double quotes', '"abc"'],
    ['a value wrapped in single quotes', "'abc'"],
    ['a backtick', 'a`b'],
    ['an equals sign', 'a=b'],
    ['a backslash', 'a\\b'],
    // A literal backslash-n, which is what the double-quoted form escapes a
    // real newline to: written that way it would come back as a newline.
    ['a literal \\n sequence', 'a\\nb'],
    ['an empty value', ''],
  ];

  for (const [name, value] of ROUND_TRIP) {
    it(`carries ${name} back out of dotenv unchanged`, () => {
      assert.equal(dotenv.parse(write(value))[KEY], value);
    });
  }

  it('writes a newline as an escape rather than a second line', () => {
    // Both forms round-trip through `dotenv` — `'a\nb'` across two lines does
    // too — so the round-trip table alone would not pin this. One line per key
    // is what keeps the file hand-editable, and it is what makes the file this
    // command writes byte-identical to the one it read.
    assert.equal(write('a\nb'), `${KEY}="a\\nb"\n`);
  });

  it('leaves a value that needs no quoting bare', () => {
    assert.equal(write('abc123'), `${KEY}=abc123\n`);
  });

  it('carries a value holding both kinds of quote', () => {
    // Neither quoted form closes around this, but nothing here needs quoting
    // in the first place: `dotenv` only reads an unquoted value as a quoted one
    // when it both begins and ends with the same quote character.
    assert.equal(dotenv.parse(write('a\'b"c'))[KEY], 'a\'b"c');
  });

  it('keeps a pair of values that break each other apart', () => {
    // The case per-line checking cannot see. A value that is one `'` is read
    // back perfectly on its own line: the quote has no partner, so `dotenv`
    // falls through to the unquoted branch. Two of them, one under the other,
    // and the first one's quote finds a partner at the end of the second — so
    // `CANVAS_API_URL` swallows the line break, the key and the `=` after it,
    // and `CANVAS_API_TOKEN` is not in the file at all.
    //
    // Nothing about either line is wrong; the pair is. That is why validation
    // is over the assembled file, and why a file that fails it is rewritten
    // rather than refused.
    const content = buildEnvFile({
      CANVAS_API_URL: "'",
      CANVAS_API_TOKEN: "'",
    });

    assert.deepEqual(dotenv.parse(content), {
      CANVAS_API_URL: "'",
      CANVAS_API_TOKEN: "'",
    });
  });

  it('retries in a quoted form instead of refusing a workable pair', () => {
    // The retry is what makes the pair above writable at all: greedily, each
    // value takes the bare form, and the bare form is what collides. Every
    // value written in a quoted form instead closes on its own line.
    const content = buildEnvFile({
      CANVAS_API_URL: "'",
      CANVAS_API_TOKEN: "'",
    });

    assert.equal(
      content.split('\n').filter(Boolean).length,
      2,
      'one line per key',
    );
    for (const line of content.split('\n').filter(Boolean)) {
      assert.match(line, /^CANVAS_\w+=(['"]).*\1$/, `left bare: ${line}`);
    }
  });

  it('holds every pair the corpus can make', () => {
    // The property, over the whole corpus rather than the one pair that
    // motivated it: for any two values, the file either reads back exactly or
    // is refused outright. Silently storing something else is the one outcome
    // that must not happen, and a pair is the smallest thing that produces it.
    let refused = 0;
    for (const [leftName, left] of ROUND_TRIP) {
      for (const [rightName, right] of ROUND_TRIP) {
        const pair = { CANVAS_API_URL: left, CANVAS_API_TOKEN: right };
        let content;
        try {
          content = buildEnvFile(pair);
        } catch (err) {
          assert.ok(
            err instanceof RefusalError,
            `${leftName} + ${rightName}: ${err.message}`,
          );
          refused += 1;
          continue;
        }
        assert.deepEqual(
          dotenv.parse(content),
          pair,
          `${leftName} + ${rightName}: written as ${JSON.stringify(content)}`,
        );
      }
    }
    assert.equal(
      refused,
      0,
      'every pair of these is writable; a refusal here means the retry lost ground',
    );
  });

  it('refuses a value no form carries, rather than mangling it', () => {
    // It takes all three to get here. The `#` rules out writing the value
    // bare — everything from there on is a comment. The single quote rules out
    // single quotes, which end at it. The double quote rules out double
    // quotes, which end at that. Backticks would close around all of it, and
    // are deliberately not written: the extension's own `.env` reader takes
    // them for part of the value (`test/vscode/helpers.test.js` pins that as a
    // known divergence).
    //
    // So there is no form left, and refusing is the only answer that does not
    // silently store a different value — in a file that is gitignored, where
    // there is nothing to compare it against afterwards.
    assert.throws(() => write('a\'b"c#d'), RefusalError);
    assert.throws(() => write('a\'b"c#d'), /CANVAS_API_TOKEN/);
  });

  it('names what is actually in the value it refuses', () => {
    // A refusal the reader cannot act on is barely better than silence, and a
    // refusal that names characters the value does not contain is worse: it
    // sends the author looking for a `#` that is not there. So the message is
    // built from the value rather than from the likeliest cause.
    assert.throws(
      () => write('a\'b"c#d'),
      (err) => {
        assert.match(err.message, /a single quote, a double quote and a #/);
        return true;
      },
    );
  });

  it('explains the line break that no form can carry', () => {
    // The manager's case: a literal `\n` and a real line break in one value.
    // Every part of that is invisible in a message about quote characters —
    // and this value holds none. What makes it unwritable is that the only
    // form carrying a line break writes it as `\n`, which the value already
    // contains, so the two become indistinguishable on the way back.
    assert.throws(
      () => write('a\\nb\nc'),
      (err) => {
        assert.match(err.message, /cannot tell the two apart/);
        // The list of what the value holds, which is the part that has to be
        // true of this value. The sentence after it names the three forms this
        // command writes, "single-quoted" among them, and that is not a claim
        // about the value.
        const holds = /Its value holds (.*?), and none of/.exec(err.message);
        assert.ok(holds, `no "Its value holds" clause in: ${err.message}`);
        assert.equal(holds[1], 'a line break and a literal \\n or \\r');
        return true;
      },
    );
  });

  it('names both keys, and what each holds, when it is the pair that fails', () => {
    // The other refusal. Naming one key would be a lie about a failure that
    // takes two, and naming neither character leaves nothing to act on.
    assert.throws(
      () =>
        buildEnvFile({
          CANVAS_API_URL: '#\\',
          CANVAS_API_TOKEN: '#"',
        }),
      (err) => {
        assert.ok(err instanceof RefusalError);
        assert.match(err.message, /CANVAS_API_URL holds a backslash/);
        assert.match(err.message, /CANVAS_API_TOKEN holds a double quote/);
        assert.match(err.message, /each writable on their own/);
        assert.match(err.message, /Nothing was written/);
        return true;
      },
    );
  });

  it('writes shapes the extension reads the same way, bar a line break', () => {
    // Two readers open this file: `dotenv`, for every CLI command
    // (`cli/index.js`), and `readEnvConfig`, the extension's own dependency-free
    // parser. A shape only one of them reads is a `.env` configured for half
    // the tool, which is the defect the corpus in `test/vscode/helpers.test.js`
    // exists to hold off — so the quoting chosen above stays inside the shapes
    // that corpus lists as AGREED.
    //
    // A value holding a line break is the exception, and it has no answer: the
    // escape form is the `escape inside double quotes` row that corpus already
    // pins as a known divergence, and the alternative — a real line break
    // inside quotes — is the `value spanning lines` row, which that reader gets
    // more wrong, not less. The extension reads CANVAS_API_URL and
    // CANVAS_COURSE_ID and never the token, and neither of those two can hold a
    // line break and still be what it claims to be.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'init-vscode-'));
    try {
      for (const [name, value] of ROUND_TRIP) {
        const content = write(value);
        fs.writeFileSync(path.join(dir, '.env'), content, 'utf8');
        const theirs = readEnvConfig(dir)[KEY];
        const ours = dotenv.parse(content)[KEY];
        if (/[\r\n]/.test(value)) {
          assert.notEqual(
            theirs,
            ours,
            `${name}: expected the known divergence`,
          );
          continue;
        }
        assert.equal(theirs, ours, `${name}: written as ${content.trim()}`);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes the three keys in the order it was given them', () => {
    assert.equal(
      buildEnvFile({
        CANVAS_API_URL: 'https://x.test',
        CANVAS_API_TOKEN: 'abc',
        CANVAS_COURSE_ID: '45083',
      }),
      'CANVAS_API_URL=https://x.test\nCANVAS_API_TOKEN=abc\nCANVAS_COURSE_ID=45083\n',
    );
  });
});

/**
 * Run `npx course init` in `dir`, answering its questions with `answers`, and
 * hand back the exit code, the output and whatever the two files say
 * afterwards.
 *
 * One line per question, written only once that question is actually waiting.
 * Piping all the answers in at once does not work: readline hands the whole
 * chunk out in one synchronous pass, and every line after the first arrives
 * before anything is waiting for it, so they are dropped and the run ends on
 * "the input stream ended before one arrived".
 *
 * **A question is detected by the output ending in `': '`,** which is how
 * `ask` writes a prompt (`cli/module-utils.js`) and nothing else here ends. It
 * deliberately does not look for the question's text: the course id is asked
 * more than once when the answer does not parse, and the complaint printed
 * between two of those asks quotes the question back, so counting the text
 * would count the complaint as a fourth question. The output only grows, so its
 * length at the moment of a prompt is what tells one prompt from the same
 * prompt seen twice in two chunks.
 *
 * An empty answer takes the offered default, so `['', '', '']` is a re-init
 * that accepts what `.env` already holds. `answers` may be longer than three:
 * a fourth answer is what the course id is asked again with.
 *
 * With `endless`, the last answer is repeated for ever and the stream is never
 * closed. That is `yes | npx course init` — a source that neither parses nor
 * runs out — and a command with no cap on its re-asking never returns from it.
 * Without it the stream is closed once the last answer is written, so a
 * question asked after that ends the run: `prompt` throws on an ended stream.
 *
 * Read back through `dotenv` rather than through this command's own reader, so
 * the assertion is about what the tool ends up running on rather than about two
 * halves of one function agreeing with each other. Neither file is required to
 * exist: a refused run writes nothing, and that is a thing tests here assert.
 */
function runInit(dir, answers = ['', '', ''], { endless = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, 'init'], { cwd: dir });
    let out = '';
    let stderr = '';
    let answered = 0;
    let promptedAt = -1;
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`init never finished asking:\n${out}`));
    }, 30000);

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      out += chunk;
      if (!out.endsWith(': ') || out.length === promptedAt) return;
      promptedAt = out.length;
      if (answered < answers.length) {
        child.stdin.write(`${answers[answered]}\n`);
        answered += 1;
        if (answered === answers.length && !endless) child.stdin.end();
      } else if (endless) {
        child.stdin.write(`${answers[answers.length - 1]}\n`);
      }
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      try {
        const envFile = path.join(dir, '.env');
        const stateFile = path.join(dir, '.canvas-sync.json');
        const raw = fs.existsSync(envFile)
          ? fs.readFileSync(envFile, 'utf8')
          : null;
        resolve({
          code,
          out,
          stderr,
          raw,
          values: raw == null ? null : dotenv.parse(raw),
          state: fs.existsSync(stateFile)
            ? JSON.parse(fs.readFileSync(stateFile, 'utf8'))
            : null,
        });
      } catch (err) {
        reject(err);
      }
    });
  });
}

describe('npx course init round-tripping .env', () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'init-roundtrip-'));
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      '{ "name": "fixture", "private": true }\n',
      'utf8',
    );
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** `runInit` for the runs that are supposed to succeed. */
  async function reinit(answers) {
    const result = await runInit(dir, answers);
    assert.equal(result.code, 0, `${result.out}\n${result.stderr}`);
    return result;
  }

  const writeEnv = (content) =>
    fs.writeFileSync(path.join(dir, '.env'), content, 'utf8');

  it('takes the quotes off before the values reach the sync state', async () => {
    // Quoting a value is ordinary `.env` practice and every command reads
    // through the quotes, so the file itself was never the problem. What the
    // prefill fed was: the offered default carried the quote characters, and
    // accepting it wrote `canvas_base_url: "\"https://x.test\""` and
    // `course_id: null` (`Number('"45083"')` is NaN, and JSON has no NaN) into
    // the sync state — the very `.env`-against-state mismatch `init` is the
    // command for repairing.
    writeEnv(
      'CANVAS_API_URL="https://x.test"\nCANVAS_API_TOKEN="abc"\nCANVAS_COURSE_ID="45083"\n',
    );

    const after = await reinit();

    assert.equal(after.values.CANVAS_API_URL, 'https://x.test');
    assert.equal(after.values.CANVAS_API_TOKEN, 'abc');
    assert.equal(after.values.CANVAS_COURSE_ID, '45083');
    assert.equal(after.state.canvas_base_url, 'https://x.test');
    assert.equal(after.state.course_id, 45083);
  });

  it('finds the values behind an export prefix rather than offering a blank', async () => {
    writeEnv(
      'export CANVAS_API_URL=https://x.test\nexport CANVAS_API_TOKEN=abc\n' +
        'export CANVAS_COURSE_ID=45083\n',
    );

    const after = await reinit();

    assert.equal(after.values.CANVAS_API_URL, 'https://x.test');
    assert.equal(after.values.CANVAS_API_TOKEN, 'abc');
    assert.equal(after.values.CANVAS_COURSE_ID, '45083');
  });

  it('carries a value with a space in it through unchanged', async () => {
    writeEnv(
      'CANVAS_API_URL=https://x.test\nCANVAS_API_TOKEN=ab cd\nCANVAS_COURSE_ID=45083\n',
    );

    const after = await reinit();

    assert.equal(after.values.CANVAS_API_TOKEN, 'ab cd');
  });

  it('offers back the truncated value a # leaves, which is the one in use', async () => {
    // Unquoted, a `#` in a value makes everything after it a comment — to
    // `dotenv`, and therefore to every command that talks to Canvas. So `ab`
    // was never a value this command destroyed: it is the token every request
    // has been carrying. Offering it back is this command agreeing with the
    // tool rather than showing a token nothing uses.
    writeEnv(
      'CANVAS_API_URL=https://x.test\nCANVAS_API_TOKEN=ab#cd\nCANVAS_COURSE_ID=45083\n',
    );

    const after = await reinit();

    assert.equal(after.values.CANVAS_API_TOKEN, 'ab');
  });

  it('keeps a # in a token that is typed at the prompt', async () => {
    // The other half of the same fact. `ab#cd` is a value `dotenv` cannot read
    // out of an unquoted line, so writing it unquoted hands the author a file
    // that goes on not working, with no sign of why. Quoting is what makes
    // retyping it the repair it looks like.
    writeEnv(
      'CANVAS_API_URL=https://x.test\nCANVAS_API_TOKEN=ab#cd\nCANVAS_COURSE_ID=45083\n',
    );

    const after = await reinit(['', 'ab#cd', '']);

    assert.equal(after.values.CANVAS_API_TOKEN, 'ab#cd');
  });

  it('keeps a token whose value holds a newline on one line', async () => {
    // `dotenv` expands `\n` inside double quotes, so this file's token is two
    // lines long. Written back unquoted it became a four-line `.env`: the
    // token truncated to `a`, and a stray `b` sitting on a line of its own
    // where the next key used to be. `.env` is gitignored, so there is no undo.
    writeEnv(
      'CANVAS_API_URL=https://x.test\nCANVAS_API_TOKEN="a\\nb"\nCANVAS_COURSE_ID=45083\n',
    );

    const after = await reinit();

    assert.equal(after.values.CANVAS_API_TOKEN, 'a\nb');
    assert.equal(after.values.CANVAS_COURSE_ID, '45083');
    assert.equal(
      after.raw.split('\n').filter(Boolean).length,
      3,
      'one line per key, or the file has grown a line that is not a key',
    );
  });
});

describe('npx course init on a course id that is not one', () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'init-courseid-'));
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      '{ "name": "fixture", "private": true }\n',
      'utf8',
    );
    fs.writeFileSync(
      path.join(dir, '.env'),
      'CANVAS_API_URL=https://x.test\nCANVAS_API_TOKEN=abc\n' +
        'CANVAS_COURSE_ID=SPRING-2026\n',
      'utf8',
    );
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const runInitHere = (answers, options) => runInit(dir, answers, options);

  it('writes nothing at all rather than course_id: null', async () => {
    // `Number('SPRING-2026')` is NaN and JSON has no NaN, so `JSON.stringify`
    // wrote `"course_id": null` and the run exited 0 — the very
    // `.env`-against-state mismatch this command exists to repair, built by the
    // command itself. Nothing having been written is the other half: `.env`
    // still holds what it held, so the author can see what they have to fix.
    const after = await runInitHere(['', '', '']);

    assert.notEqual(after.code, 0);
    assert.equal(
      after.state,
      null,
      'a sync state written here would be the mismatch, in a file that looks coherent',
    );
    assert.match(after.raw, /CANVAS_COURSE_ID=SPRING-2026/);
    assert.match(`${after.out}${after.stderr}`, /SPRING-2026/);
  });

  it('takes the course id when it is typed at the prompt', async () => {
    const after = await runInitHere(['', '', '45083']);

    assert.equal(after.code, 0, `${after.out}${after.stderr}`);
    assert.equal(after.state.course_id, 45083);
    assert.equal(after.values.CANVAS_COURSE_ID, '45083');
  });

  it('asks again after a bad answer rather than giving up on the run', async () => {
    // The choice this command makes, pinned. Refusing once and exiting would
    // also keep `course_id: null` out of the sync state, and would also pass
    // every other test here — so without this the two designs are
    // indistinguishable. Asking again is what the rest of `cli/` does
    // (`new-module.js` asks for a position the same way), and it is what saves
    // the two answers already given: a one-shot refusal here means retyping
    // the URL and the token to fix the course id.
    const after = await runInitHere(['', '', 'SPRING-2026', '45083']);

    assert.equal(after.code, 0, `${after.out}${after.stderr}`);
    assert.equal(after.state.course_id, 45083);
    assert.match(after.out, /"SPRING-2026" is not a Canvas course ID/);
    assert.match(after.out, /Please try again/);
  });

  it('gives up rather than re-asking for ever an endless bad source', async () => {
    // `yes | npx course init` is not EOF: the answers never run out and never
    // parse. An uncapped loop takes that to be a person who keeps mistyping,
    // and prints its complaint thousands of times a minute for as long as the
    // pipe lives — a hang that burns a core, in a command a script may well
    // run unattended. The cap turns it back into what the one-shot design
    // would have done: exit non-zero, naming the value.
    const after = await runInitHere(['', '', 'y'], { endless: true });

    assert.notEqual(after.code, 0);
    assert.equal(after.state, null);
    assert.match(
      `${after.out}${after.stderr}`,
      /"y" is not a Canvas course ID/,
    );
    assert.match(`${after.out}${after.stderr}`, /3 tries/);
    // The complaint is printed between tries and not after the last one, so a
    // capped run prints strictly fewer of them than it made attempts.
    assert.ok(
      after.out.split('Please try again').length - 1 <= 2,
      `complained ${after.out.split('Please try again').length - 1} times`,
    );
  });

  it('normalises a padded course id, so .env and the state agree', async () => {
    // The two are compared as strings (`assertStateMatchesEnv` in
    // `lib/sync/state.js`), so `.env` holding `045083` beside a state holding
    // `45083` is a mismatch every later command refuses to run through.
    const after = await runInitHere(['', '', '045083']);

    assert.equal(after.code, 0, `${after.out}${after.stderr}`);
    assert.equal(after.values.CANVAS_COURSE_ID, '45083');
    assert.equal(after.state.course_id, 45083);
  });
});
