const { describe, it, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const log = require('../../cli/logger');

/**
 * Capture the three console sinks the logger writes to.
 *
 * The logger is a module-level singleton with module-level mode flags, so every
 * test here has to put both back: a stray `quiet: true` would travel to whatever
 * test file the runner picks up next and silence assertions it never made.
 */
function capture() {
  return {
    log: mock.method(console, 'log', () => {}),
    warn: mock.method(console, 'warn', () => {}),
    error: mock.method(console, 'error', () => {}),
  };
}

const said = (sink) =>
  sink.mock.calls.map((call) => call.arguments.join(' ')).join('\n');

afterEach(() => {
  mock.restoreAll();
  log.configure({ verbose: false, quiet: false });
});

describe('logger levels under --quiet', () => {
  it('silences info and warn', () => {
    const out = capture();
    log.configure({ quiet: true });

    log.info('ordinary progress');
    log.warn('a file that would not parse');

    assert.equal(said(out.log), '');
    assert.equal(
      said(out.warn),
      '',
      'warn is chatter about what a run met on the way, which is exactly what --quiet is for',
    );
  });

  it('shows refusal, the reason a run did less than it was asked', () => {
    // The defect this level exists for: the git guard in `lib/sync/gather.js`
    // refuses every local write when it cannot read git state, and said so
    // through `warn`. A `pull --quiet` outside a checkout therefore wrote
    // nothing, exited 0, and gave no reason at all — silence a script reads as
    // a pull that found nothing to do.
    const out = capture();
    log.configure({ quiet: true });

    log.refusal('[pull] nothing here is overwritten or deleted this run');

    assert.match(said(out.warn), /nothing here is overwritten/);
  });

  it('shows error', () => {
    const out = capture();
    log.configure({ quiet: true });

    log.error('[pull] Error: could not read the course');

    assert.match(said(out.error), /could not read the course/);
  });

  it('puts a refusal on stderr, where it cannot land in parsed output', () => {
    // Same stream as `warn` and `error`. A run that is being read by something
    // else is being read off stdout, and the reason it wrote nothing is not
    // part of that.
    const out = capture();

    log.refusal('[sync] git could not be run');

    assert.match(said(out.warn), /git could not be run/);
    assert.equal(said(out.log), '');
  });
});
