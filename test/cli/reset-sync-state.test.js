const { describe, it, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { Readable } = require('stream');

// Set required env vars before requiring anything that loads the client.
process.env.CANVAS_API_URL = 'https://canvas.example.com';
process.env.CANVAS_API_TOKEN = 'test-token-123';

const resetSyncState = require('../../cli/reset-sync-state');

afterEach(() => {
  mock.restoreAll();
});

/**
 * Run `resetSyncState` against a stdin holding exactly `input`, and never let it
 * wait longer than it should.
 *
 * The defect this covers is a promise that never settles, which as a test is a
 * timeout rather than a failure — so the wait is raced explicitly and the answer
 * is which of the two won. The timer is unref'd, so a run that settles properly
 * does not pay for it.
 */
async function reset(input) {
  const original = Object.getOwnPropertyDescriptor(process, 'stdin');
  const fake = Readable.from(input === null ? [] : [input]);
  fake.isTTY = false;
  Object.defineProperty(process, 'stdin', { value: fake, configurable: true });
  try {
    return await Promise.race([
      resetSyncState().then(() => 'settled'),
      new Promise((resolve) => setTimeout(() => resolve('hung'), 500).unref()),
    ]);
  } finally {
    Object.defineProperty(process, 'stdin', original);
  }
}

describe('npx course reset-sync-state', () => {
  /**
   * Nothing may reach the working tree. The command has no injection points and
   * deletes the real `.canvas-sync.json`, so the writes are stubbed to throw:
   * a cancelled run must not make one, and a test must never be the thing that
   * empties the repository's own sync state.
   */
  function noWrites() {
    const forbid = (name) => () => {
      throw new Error(`a cancelled reset must not call ${name}`);
    };
    return {
      log: mock.method(console, 'log', () => {}),
      unlink: mock.method(fs, 'unlinkSync', forbid('unlinkSync')),
      write: mock.method(fs, 'writeFileSync', forbid('writeFileSync')),
    };
  }

  it('cancels rather than hanging when nothing can answer', async () => {
    // `rl.question`'s callback never fires once stdin reaches EOF, so a question
    // that waits only for it never settles: the run stops mid-question with the
    // event loop drained and the process exits 0, having deleted nothing and
    // said nothing about it. `cb24bbc` fixed that class of defect for twelve
    // commands and `122bd72` for `confirm`; this one built its own readline and
    // was reached by neither.
    const out = noWrites();

    const outcome = await reset(null);

    assert.equal(
      outcome,
      'settled',
      'a question the input stream cannot answer has to resolve, not hang',
    );
    assert.equal(out.unlink.mock.callCount(), 0);
    assert.match(
      out.log.mock.calls.map((call) => call.arguments.join(' ')).join('\n'),
      /Cancelled/,
      'cancelling is the safe answer to a destructive question, and it is said',
    );
  });

  it('cancels on a plain no', async () => {
    const out = noWrites();

    const outcome = await reset('n\n');

    assert.equal(outcome, 'settled');
    assert.equal(out.unlink.mock.callCount(), 0);
    assert.match(
      out.log.mock.calls.map((call) => call.arguments.join(' ')).join('\n'),
      /Cancelled/,
    );
  });
});
