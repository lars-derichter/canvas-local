const fs = require('fs');
const path = require('path');
const log = require('./logger');
const {
  parseFrontmatter,
  serializeFrontmatter,
} = require('../lib/convert/frontmatter');
const { writeMarkdown } = require('../lib/convert/format-markdown');
const { COURSE_DIR } = require('./module-utils');
const { confirm } = require('./backup-warning');
const { SYNC_FILE } = require('../lib/sync/state');

/**
 * Forget which Canvas objects this course's files are.
 *
 * Two things go, and only the first is what this command is for. The sync state
 * is the single record of identity, so deleting it is the reset — after which
 * the next push creates everything fresh in Canvas, alongside whatever is
 * already there.
 *
 * The rest is cleanup of a file format this version no longer writes. Up to
 * schema v4 the identity was also copied into every markdown file's `canvas_id`
 * and every `_category_.json`'s `customProps.canvas_module_id`; a course
 * authored under an older version still carries those, and leaving them behind
 * would leave a stale second answer in the tree for anyone — or anything —
 * reading the frontmatter. `canvas_type` is untouched: that is the author's
 * declaration of what a file should become, not a record of what Canvas did.
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
      'Canvas id it holds, and clear the leftover canvas_id and ' +
      'canvas_module_id fields older versions wrote into course files. ' +
      'Continue? (y/N)',
  );

  if (!ok) {
    log.info('[reset] Cancelled.');
    return;
  }

  let count = 0;

  // Clear the canvas_id an older version wrote into each markdown file.
  const entries = fs.readdirSync(COURSE_DIR, { recursive: true });
  const files = entries
    .filter((e) => e.endsWith('.md'))
    .map((e) => path.join(COURSE_DIR, e));

  for (const filePath of files) {
    const raw = fs.readFileSync(filePath, 'utf8');
    const { data, content } = parseFrontmatter(raw);

    if (data.canvas_id != null) {
      delete data.canvas_id;
      await writeMarkdown(filePath, serializeFrontmatter(data, content));
      log.info(
        `[reset] Removed canvas_id from ${path.relative(process.cwd(), filePath)}`,
      );
      count++;
    }
  }

  if (count === 0) {
    log.info('[reset] No leftover canvas_id fields in course files.');
  } else {
    log.info(`[reset] Removed canvas_id from ${count} file(s).`);
  }

  // …and the canvas_module_id it wrote into each _category_.json.
  const categoryFiles = entries
    .filter((e) => path.basename(e) === '_category_.json')
    .map((e) => path.join(COURSE_DIR, e));

  for (const catFile of categoryFiles) {
    try {
      const cat = JSON.parse(fs.readFileSync(catFile, 'utf8'));
      if (cat.customProps && cat.customProps.canvas_module_id != null) {
        delete cat.customProps.canvas_module_id;
        if (Object.keys(cat.customProps).length === 0) delete cat.customProps;
        fs.writeFileSync(catFile, JSON.stringify(cat, null, 2) + '\n', 'utf8');
        log.info(
          `[reset] Removed canvas_module_id from ${path.relative(process.cwd(), catFile)}`,
        );
      }
    } catch (err) {
      log.warn(`[reset] Could not update ${catFile}: ${err.message}`);
    }
  }

  // Delete .canvas-sync.json
  if (fs.existsSync(SYNC_FILE)) {
    fs.unlinkSync(SYNC_FILE);
    log.info('[reset] Deleted .canvas-sync.json');
  } else {
    log.info('[reset] No .canvas-sync.json found.');
  }
}

module.exports = resetSyncState;
