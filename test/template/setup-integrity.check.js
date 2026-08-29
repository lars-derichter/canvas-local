const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  isPristine,
  bodyOf,
  isToolingReadme,
  isToolingIndex,
} = require('../../cli/setup');

const ROOT = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// The wizard offers to install these templates over their installed
// counterparts, and refuses when the destination looks authored. The two ship
// identical apart from their tip block and the relative paths inside, so a
// fresh project must read as pristine — otherwise setup declines to do its job.
//
// This holds in the template repository only: every path read here is one a
// course author is meant to replace, so the checks live outside `npm test` and
// run as `npm run test:template`. See docs/tests.md.
describe('the shipped context files read as pristine', () => {
  it('recognises the installed writing style guide', () => {
    const installed = bodyOf(read('context/writing-style.md'));
    const baselines = ['en', 'en-us', 'nl-be', 'nl'].map((variant) =>
      bodyOf(read(`templates/writing-style-${variant}.md`)),
    );
    assert.equal(isPristine(installed, baselines), true);
  });

  it('recognises the installed course context', () => {
    const installed = bodyOf(read('context/course-context.md'));
    const templates = ['en', 'nl'].map((language) =>
      bodyOf(read(`templates/course-context-${language}.md`)),
    );
    assert.equal(isPristine(installed, templates), true);
  });

  it('recognises the shipped README as the tooling one', () => {
    assert.equal(isToolingReadme(read('README.md')), true);
  });

  it('recognises the shipped course home as the tooling landing page', () => {
    assert.equal(isToolingIndex(read('course/index.md')), true);
  });
});
