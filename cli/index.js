#!/usr/bin/env node

require('dotenv').config();

const { Command } = require('commander');
const pkg = require('../package.json');

const program = new Command();

program
  .name('course-cli')
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
  .action(require('./status'));

program
  .command('new-module')
  .description('Create a new course module folder with _category_.json')
  .action(require('./new-module'));

program.parse();
