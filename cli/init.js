const fs = require('fs');
const path = require('path');

const { PROJECT_ROOT } = require('./project-root');
const { createRL, prompt } = require('./module-utils');
const { normaliseBaseUrl } = require('../lib/canvas/client');
const {
  emptyState,
  loadState,
  saveState,
  SYNC_FILE,
} = require('../lib/sync/state');

const ENV_FILE = path.join(PROJECT_ROOT, '.env');

/**
 * Whether an existing sync state describes the course `init` is about to write.
 *
 * A file that claims no course — written while `CANVAS_COURSE_ID` was unset —
 * contradicts nothing, so its mappings are kept: they were built against
 * whatever course was configured at the time, which is the one being named now.
 *
 * @param {object} syncData
 * @param {{courseId: string|number, canvasBaseUrl: string}} target
 * @returns {boolean}
 */
function describesSameCourse(syncData, { courseId, canvasBaseUrl }) {
  const fileCourse =
    syncData.course_id != null && Number(syncData.course_id) !== 0
      ? String(syncData.course_id)
      : '';
  if (fileCourse && fileCourse !== String(courseId)) return false;

  const fileUrl = normaliseBaseUrl(syncData.canvas_base_url);
  const targetUrl = normaliseBaseUrl(canvasBaseUrl);
  if (fileUrl && targetUrl && fileUrl !== targetUrl) return false;

  return true;
}

/**
 * What an existing sync state says it describes, for the line that explains why
 * its ids are being dropped.
 *
 * @param {object} syncData
 * @returns {string}
 */
function describeSyncTarget(syncData) {
  const course =
    syncData.course_id != null && Number(syncData.course_id) !== 0
      ? `course ${syncData.course_id}`
      : 'another course';
  const url = normaliseBaseUrl(syncData.canvas_base_url);
  return url ? `${course} on ${url}` : course;
}

async function init() {
  // `init` has no flags at all, so a run that cannot answer has nowhere to put
  // the three values and is told the only thing left to do: run it in a
  // terminal. The shared prompt is what says so — a private copy of it here is
  // what let this command keep hanging after the shared one was fixed.
  const rl = createRL({ command: 'init' });

  console.log('[init] Canvas LMS setup');
  console.log(
    '[init] This will create .env and .canvas-sync.json in the project root.\n',
  );

  // Read existing .env values if present
  let existingUrl = '';
  let existingToken = '';
  let existingCourseId = '';
  if (fs.existsSync(ENV_FILE)) {
    const envContent = fs.readFileSync(ENV_FILE, 'utf8');
    const urlMatch = envContent.match(/^CANVAS_API_URL=(.*)$/m);
    const tokenMatch = envContent.match(/^CANVAS_API_TOKEN=(.*)$/m);
    const courseMatch = envContent.match(/^CANVAS_COURSE_ID=(.*)$/m);
    if (urlMatch) existingUrl = urlMatch[1].trim();
    if (tokenMatch) existingToken = tokenMatch[1].trim();
    if (courseMatch) existingCourseId = courseMatch[1].trim();
  }

  const canvasUrl = await prompt(
    rl,
    'Canvas URL (e.g. https://school.instructure.com)',
    existingUrl,
  );
  const apiToken = await prompt(rl, 'Canvas API token', existingToken);
  const courseId = await prompt(rl, 'Canvas course ID', existingCourseId);

  rl.close();

  if (!canvasUrl || !apiToken || !courseId) {
    console.error('[init] Error: All three values are required.');
    process.exit(1);
  }

  // Strip trailing slashes and any /api/v1 suffix: API paths already carry
  // /api/v1, so CANVAS_API_URL is the base URL alone. `normaliseBaseUrl` is the
  // definition of that shape, and this is the command that writes it, so the
  // two agreeing is not a nicety — every later comparison of `.env` against the
  // sync file assumes both went through it.
  const apiUrl = normaliseBaseUrl(canvasUrl);

  // Write .env file
  const envContent = [
    `CANVAS_API_URL=${apiUrl}`,
    `CANVAS_API_TOKEN=${apiToken}`,
    `CANVAS_COURSE_ID=${courseId}`,
    '',
  ].join('\n');

  fs.writeFileSync(ENV_FILE, envContent, 'utf8');
  console.log(`[init] Wrote ${ENV_FILE}`);

  // Create .canvas-sync.json. Starting from an empty v4 state rather than an
  // object literal is what guarantees every container is present: a state
  // missing `icons` or `files` reads as a hand-trimmed one, and the commands
  // that write them would have to guard for it.
  const syncData = emptyState();
  syncData.canvas_base_url = apiUrl;
  syncData.course_id = Number(courseId);

  // Preserve existing module mappings if the file already exists. `init` is the
  // command that repairs a sync state disagreeing with `.env`, so it reads one
  // that the other commands refuse — and then must not carry its contents over.
  // Those ids belong to the course the old file describes; keeping them under a
  // new course id would rebuild exactly the mismatch, in a file that now looks
  // coherent. Only a re-init of the same course keeps them.
  const existing = loadState({ allowNull: true, skipEnvCheck: true });
  const sameCourse =
    existing != null &&
    describesSameCourse(existing, { courseId, canvasBaseUrl: apiUrl });

  if (existing && !sameCourse) {
    console.log(
      `[init] The existing ${SYNC_FILE} describes ` +
        `${describeSyncTarget(existing)}, so its module, file and icon ids are ` +
        'left behind: they mean nothing in course ' +
        `${courseId}. The next push creates everything fresh there.`,
    );
  } else if (existing) {
    if (existing.modules) syncData.modules = existing.modules;
    if (existing.files) syncData.files = existing.files;
    if (existing.icons) syncData.icons = existing.icons;
  }

  saveState(syncData);
  console.log(`[init] Wrote ${SYNC_FILE}`);

  console.log(
    '\n[init] ⚠ Security reminder: .env contains your Canvas API token.',
  );
  console.log(
    '[init]   Make sure .env is listed in .gitignore and never committed to version control.',
  );

  console.log('\n[init] Setup complete. You can now run:');
  console.log('  npx course push   - push local content to Canvas');
  console.log('  npx course pull   - pull Canvas content locally');
  console.log('  npx course status - compare local vs Canvas state');
}

module.exports = init;

// Exported for testing
init._describesSameCourse = describesSameCourse;
init._describeSyncTarget = describeSyncTarget;
