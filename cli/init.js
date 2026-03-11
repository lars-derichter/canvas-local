const fs = require('fs');
const path = require('path');
const readline = require('readline');

const SYNC_FILE = path.resolve(process.cwd(), '.canvas-sync.json');
const ENV_FILE = path.resolve(process.cwd(), '.env');

function prompt(rl, question, defaultValue) {
  const suffix = defaultValue ? ` (${defaultValue})` : '';
  return new Promise((resolve) => {
    rl.question(`${question}${suffix}: `, (answer) => {
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

async function init() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('[init] Canvas LMS setup');
  console.log('[init] This will create .env and .canvas-sync.json in the project root.\n');

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

  const canvasUrl = await prompt(rl, 'Canvas API URL (e.g. https://school.instructure.com)', existingUrl);
  const apiToken = await prompt(rl, 'Canvas API token', existingToken);
  const courseId = await prompt(rl, 'Canvas course ID', existingCourseId);

  rl.close();

  if (!canvasUrl || !apiToken || !courseId) {
    console.error('[init] Error: All three values are required.');
    process.exit(1);
  }

  // Normalize the URL: ensure it ends with /api/v1 for CANVAS_API_URL
  const baseUrl = canvasUrl.replace(/\/+$/, '');
  const apiUrl = baseUrl.endsWith('/api/v1') ? baseUrl : `${baseUrl}/api/v1`;

  // Write .env file
  const envContent = [
    `CANVAS_API_URL=${apiUrl}`,
    `CANVAS_API_TOKEN=${apiToken}`,
    `CANVAS_COURSE_ID=${courseId}`,
    '',
  ].join('\n');

  fs.writeFileSync(ENV_FILE, envContent, 'utf8');
  console.log(`[init] Wrote ${ENV_FILE}`);

  // Create .canvas-sync.json
  const syncData = {
    canvas_base_url: baseUrl.replace(/\/api\/v1$/, ''),
    course_id: Number(courseId),
    modules: {},
    last_sync: null,
  };

  // Preserve existing module mappings if the file already exists
  if (fs.existsSync(SYNC_FILE)) {
    try {
      const existing = JSON.parse(fs.readFileSync(SYNC_FILE, 'utf8'));
      if (existing.modules) {
        syncData.modules = existing.modules;
      }
    } catch (_) {
      // Ignore parse errors, start fresh
    }
  }

  fs.writeFileSync(SYNC_FILE, JSON.stringify(syncData, null, 2) + '\n', 'utf8');
  console.log(`[init] Wrote ${SYNC_FILE}`);

  console.log('\n[init] Setup complete. You can now run:');
  console.log('  course-cli push   - push local content to Canvas');
  console.log('  course-cli pull   - pull Canvas content locally');
  console.log('  course-cli status - compare local vs Canvas state');
}

module.exports = init;
