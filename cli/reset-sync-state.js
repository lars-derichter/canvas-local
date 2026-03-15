const fs = require('fs');
const path = require('path');
const readline = require('readline');
const log = require('./logger');
const { parseFrontmatter, serializeFrontmatter } = require('../lib/convert/frontmatter');

const COURSE_DIR = path.resolve(process.cwd(), 'course');
const SYNC_FILE = path.resolve(process.cwd(), '.canvas-sync.json');

async function resetSyncState() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => {
    rl.question('[reset] This will remove all canvas_id fields and delete .canvas-sync.json. Continue? (y/N) ', resolve);
  });
  rl.close();

  if (answer.toLowerCase() !== 'y') {
    console.log('[reset] Cancelled.');
    return;
  }

  let count = 0;

  // Remove canvas_id from all markdown files in course/
  const entries = fs.readdirSync(COURSE_DIR, { recursive: true });
  const files = entries
    .filter((e) => e.endsWith('.md'))
    .map((e) => path.join(COURSE_DIR, e));

  for (const filePath of files) {
    const raw = fs.readFileSync(filePath, 'utf8');
    const { data, content } = parseFrontmatter(raw);

    if (data.canvas_id != null) {
      delete data.canvas_id;
      fs.writeFileSync(filePath, serializeFrontmatter(data, content), 'utf8');
      log.info(`[reset] Removed canvas_id from ${path.relative(process.cwd(), filePath)}`);
      count++;
    }
  }

  if (count === 0) {
    log.info('[reset] No canvas_id fields found in course files.');
  } else {
    log.info(`[reset] Removed canvas_id from ${count} file(s).`);
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
