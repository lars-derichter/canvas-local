const fs = require('fs');
const log = require('./logger');
const { confirm } = require('./backup-warning');
const { SYNC_FILE } = require('../lib/sync/state');

/**
 * Forget which Canvas objects this course's files are.
 *
 * The sync state is the single record of identity, so deleting it is the whole
 * reset — after which the next push creates everything fresh in Canvas,
 * alongside whatever is already there. Nothing in `course/` is touched: no
 * markdown file and no `_category_.json` carries a Canvas id, so there is
 * nothing in the tree for this to clear.
 *
 * The question goes through `confirm`, the same one `reset-canvas` and the two
 * pull and push confirmations use. This built its own readline interface and
 * called `rl.question` raw, which is the defect `122bd72` and `cb24bbc` closed
 * everywhere else: the callback never fires once stdin reaches EOF, so a
 * scripted run printed the question, never settled, and exited 0 having deleted
 * nothing and said nothing. `confirm` rather than `prompt` is the right half of
 * that pair here — `prompt` throws, because a run that cannot say which module
 * to create has no safe answer to fall back on, and a destructive confirmation
 * does: not deleting.
 */
async function resetSyncState() {
  const ok = await confirm(
    '[reset] This will delete .canvas-sync.json, so the course forgets every ' +
      'Canvas id it holds. Continue? (y/N)',
  );

  if (!ok) {
    log.info('[reset] Cancelled.');
    return;
  }

  if (fs.existsSync(SYNC_FILE)) {
    fs.unlinkSync(SYNC_FILE);
    log.info('[reset] Deleted .canvas-sync.json');
  } else {
    log.info('[reset] No .canvas-sync.json found.');
  }
}

module.exports = resetSyncState;
