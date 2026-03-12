#!/usr/bin/env node

require('dotenv').config();

const { Command } = require('commander');
const pkg = require('../package.json');

const program = new Command();

program
  .name('canvas-local')
  .description('Sync course content with Canvas LMS')
  .version(pkg.version);

program
  .command('init')
  .description('Interactive setup for Canvas API credentials and sync file')
  .action(require('./init'));

program
  .command('push')
  .description('Push local course content to Canvas')
  .option('-m, --module <name>', 'Only push a specific module folder name')
  .option('--dry-run', 'Show what would happen without making API calls')
  .action(require('./push'));

program
  .command('pull')
  .description('Pull course content from Canvas into local markdown files')
  .action(require('./pull'));

program
  .command('status')
  .description('Compare local course content with Canvas sync state')
  .option('-r, --remote', 'Also fetch and compare against Canvas course data')
  .action(require('./status'));

program
  .command('new-module')
  .description('Create a new course module folder with _category_.json')
  .action(require('./new-module'));

program
  .command('move-module')
  .description('Move a course module to a different position')
  .action(require('./move-module'));

program
  .command('rename-module')
  .description('Rename a course module')
  .action(require('./rename-module'));

program
  .command('delete-module')
  .description('Delete a course module and renumber remaining modules')
  .action(require('./delete-module'));

program
  .command('new-item')
  .description('Create a new item (page, assignment, url, subsection, file) in a module')
  .action(require('./new-item'));

program
  .command('move-item')
  .description('Move an item to a new position within its module')
  .action(require('./move-item'));

program
  .command('movetomodule-item')
  .description('Move an item to a different module')
  .action(require('./movetomodule-item'));

program
  .command('rename-item')
  .description('Rename an item in a module')
  .action(require('./rename-item'));

program
  .command('delete-item')
  .description('Delete an item from a module and renumber remaining items')
  .action(require('./delete-item'));

program.parse();
