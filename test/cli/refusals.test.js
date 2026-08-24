const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { RefusalError } = require('../../lib/errors');
const { UnanswerableError } = require('../../cli/module-utils');
const { SCHEMA_VERSION } = require('../../lib/sync/state');

const CLI = path.join(__dirname, '..', '..', 'cli', 'index.js');
const CANVAS_URL = 'https://canvas.example.com';
const STATE_COURSE = 45083;
const ENV_COURSE = '58155';

const made = [];

afterEach(() => {
  while (made.length) fs.rmSync(made.pop(), { recursive: true, force: true });
});

/**
 * A throwaway project whose sync state describes a course `.env` does not name,
 * or holds whatever `stateText` says instead.
 *
 * Out of the repository and run as a child, for the reason
 * `test/cli/delete-module.test.js` gives: `SYNC_FILE` is a module-level constant
 * resolved from `process.cwd()` at require time, and the child's `PROJECT_ROOT`
 * has to be the fixture rather than this repository — which also keeps dotenv
 * away from the repository's own `.env`.
 */
function project(stateText) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'refusal-'));
  made.push(dir);
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    '{ "name": "fixture", "private": true }\n',
    'utf8',
  );
  fs.mkdirSync(path.join(dir, 'course', '01-intro'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'course', '01-intro', '01-welcome.md'),
    '---\ntitle: Welcome\n---\n\nBody\n',
    'utf8',
  );
  fs.writeFileSync(
    path.join(dir, '.canvas-sync.json'),
    stateText ??
      JSON.stringify(
        {
          schema_version: SCHEMA_VERSION,
          canvas_base_url: CANVAS_URL,
          course_id: STATE_COURSE,
          last_sync: null,
          modules: {},
          icons: {},
          files: {},
        },
        null,
        2,
      ) + '\n',
    'utf8',
  );
  return dir;
}

/** Run the CLI in `dir` against an environment that names another course. */
function run(dir, args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: dir,
    input: '',
    encoding: 'utf8',
    // Every command here refuses before it asks anything, and the timeout is
    // what proves that rather than hanging the suite if one day it does not.
    timeout: 30000,
    env: {
      ...process.env,
      CANVAS_API_URL: CANVAS_URL,
      CANVAS_COURSE_ID: ENV_COURSE,
    },
  });
}

describe('RefusalError', () => {
  it('is what UnanswerableError is', () => {
    // The existing handling of an unanswerable question is the precedent every
    // other deliberate stop now follows, so the two have to be the same thing
    // to the handler. Catching it by its own name still works, which is what
    // its own tests do.
    const error = new UnanswerableError('no answer');
    assert.ok(error instanceof RefusalError);
    assert.ok(error instanceof Error);
    assert.equal(error.name, 'UnanswerableError');
  });
});

describe('a refusal reaching the user', () => {
  it('is the message, without a stack trace', () => {
    // The course-mismatch refusal is three paragraphs of what happened and
    // which of the two ways out applies. It used to arrive under a Node
    // unhandled-rejection dump: the sentence saying to run `reset-sync-state`
    // sat between a source-code excerpt and twelve frames of commander, where
    // it reads as tool internals rather than as the instruction it is.
    const dir = project();

    const result = run(dir, ['status']);

    assert.equal(result.status, 1, 'a refused run must not report success');
    assert.match(result.stderr, /describes course 45083/);
    assert.match(result.stderr, /npx course reset-sync-state/);
    assert.doesNotMatch(
      result.stderr,
      /\n\s+at /,
      'a decision the tool made and can explain is not a crash',
    );
    assert.doesNotMatch(
      result.stderr,
      /Node\.js v|triggerUncaughtException/,
      'nor is it the runtime reporting that nobody handled it',
    );
  });

  it('is what a sync state left mid-merge gets, before anything runs', () => {
    // The other way the sync file stops being readable, and the one an author
    // meets: a merge nobody finished. It used to pass for a course that had
    // never been synced, which the tool only announced by duplicating content
    // on Canvas some runs later.
    const dir = project(
      [
        '<<<<<<< HEAD',
        `{ "schema_version": ${SCHEMA_VERSION} }`,
        '=======',
        `{ "schema_version": ${SCHEMA_VERSION}, "modules": {} }`,
        '>>>>>>> origin/main',
        '',
      ].join('\n'),
    );

    const result = run(dir, ['status']);

    assert.equal(result.status, 1, 'a refused run must not report success');
    assert.match(result.stderr, /could not be parsed as JSON/);
    assert.match(result.stderr, /conflict markers/);
    assert.doesNotMatch(
      result.stderr,
      /\n\s+at /,
      'a decision the tool made and can explain is not a crash',
    );
  });

  it('still shows its stack under --verbose', () => {
    // --verbose is the flag for "why is it doing that", and a refusal nobody
    // expected is that question. The frames come from the handler rather than
    // from an unhandled rejection, so the message keeps its shape and the exit
    // code stays the handler's.
    const dir = project();

    const result = run(dir, ['--verbose', 'status']);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /describes course 45083/);
    assert.match(result.stderr, /\n\s+at /, '--verbose has to reach the stack');
    assert.doesNotMatch(
      result.stderr,
      /Node\.js v|triggerUncaughtException/,
      'and it is still the handler printing it, not the runtime giving up',
    );
  });
});

describe('an error the tool did not mean', () => {
  it('keeps its stack', () => {
    // The fence on the rule above. A handler that presented everything as a
    // one-line message would pass every test in this file and turn the next
    // TypeError in the planner into an unreportable sentence.
    //
    // `--var` without an `=` is the shortest genuine one: a plain Error out of
    // an option processor, on the same rejection path as any action's. If it is
    // ever reclassified as a refusal this test fails, which is the right moment
    // to pick another — not to delete the check.
    const dir = project();

    const result = run(dir, ['export', '--var', 'nope']);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /--var expects key=value/);
    assert.match(
      result.stderr,
      /\n\s+at /,
      'an unexpected error is a bug report, and a bug report is its frames',
    );
  });
});
