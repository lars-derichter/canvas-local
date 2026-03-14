const log = require('./logger');
const { createRL, prompt } = require('./module-utils');
const { listModules, deleteModule } = require('../lib/canvas/modules');
const { listPages, deletePage } = require('../lib/canvas/pages');
const { listAssignments, deleteAssignment } = require('../lib/canvas/assignments');
const { listFiles, deleteFile } = require('../lib/canvas/files');

async function resetCanvas() {
  const courseId = process.env.CANVAS_COURSE_ID;
  if (!courseId) {
    log.error('CANVAS_COURSE_ID is not set. Run "npx course init" first.');
    return;
  }

  const rl = createRL();
  const answer = await prompt(rl, `Are you sure you want to delete all content on the Canvas course with id ${courseId}? (y/n) `);
  rl.close();

  if (answer.toLowerCase() !== 'y') {
    log.info('Aborted.');
    return;
  }

  const errors = [];

  // Delete all modules
  const modules = await listModules(courseId);
  log.info(`[reset-canvas] Deleting ${modules.length} module(s)...`);
  for (const mod of modules) {
    try {
      await deleteModule(courseId, mod.id);
      log.verbose(`  Deleted module: ${mod.name} (id=${mod.id})`);
    } catch (err) {
      log.error(`  Failed to delete module ${mod.id}: ${err.message}`);
      errors.push(`module ${mod.id}`);
    }
  }

  // Delete all pages
  const pages = await listPages(courseId);
  log.info(`[reset-canvas] Deleting ${pages.length} page(s)...`);
  for (const page of pages) {
    try {
      await deletePage(courseId, page.url);
      log.verbose(`  Deleted page: ${page.title}`);
    } catch (err) {
      log.error(`  Failed to delete page "${page.title}": ${err.message}`);
      errors.push(`page "${page.title}"`);
    }
  }

  // Delete all assignments
  const assignments = await listAssignments(courseId);
  log.info(`[reset-canvas] Deleting ${assignments.length} assignment(s)...`);
  for (const assignment of assignments) {
    try {
      await deleteAssignment(courseId, assignment.id);
      log.verbose(`  Deleted assignment: ${assignment.name}`);
    } catch (err) {
      log.error(`  Failed to delete assignment "${assignment.name}": ${err.message}`);
      errors.push(`assignment "${assignment.name}"`);
    }
  }

  // Delete all files
  const files = await listFiles(courseId);
  log.info(`[reset-canvas] Deleting ${files.length} file(s)...`);
  for (const file of files) {
    try {
      await deleteFile(file.id);
      log.verbose(`  Deleted file: ${file.display_name}`);
    } catch (err) {
      log.error(`  Failed to delete file "${file.display_name}": ${err.message}`);
      errors.push(`file "${file.display_name}"`);
    }
  }

  if (errors.length > 0) {
    log.error(`[reset-canvas] Completed with ${errors.length} error(s).`);
  } else {
    log.info('[reset-canvas] All content deleted successfully.');
  }
}

module.exports = resetCanvas;
