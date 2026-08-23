const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const extDir = path.resolve(
  __dirname,
  '../../.vscode/extensions/course-manager',
);
const extensionSource = fs.readFileSync(
  path.join(extDir, 'extension.js'),
  'utf-8',
);
const packageJson = JSON.parse(
  fs.readFileSync(path.join(extDir, 'package.json'), 'utf-8'),
);

// Extract the commands object from extension.js source using a regex.
// Captures the block: const commands = { ... };
function parseCommandsObject(source) {
  const match = source.match(/const commands\s*=\s*\{([^}]+)\}/);
  if (!match) return {};
  const entries = {};
  const re = /'([^']+)'\s*:\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(match[1])) !== null) {
    entries[m[1]] = m[2];
  }
  return entries;
}

// Extract extra commands registered individually outside the loop, either
// directly via registerCommand('course.x', ...) or through the local
// register('course.x', ...) helper.
function parseExtraRegisteredCommands(source) {
  const ids = [];
  const re = /register(?:Command)?\(\s*'(course\.\w+)'/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    ids.push(m[1]);
  }
  return ids;
}

const commandsMap = parseCommandsObject(extensionSource);
const extraRegistered = parseExtraRegisteredCommands(extensionSource);
const allRegisteredIds = [
  ...Object.keys(commandsMap),
  ...extraRegistered.filter((id) => !commandsMap[id]),
];
const packageCommands = packageJson.contributes.commands;

describe('VS Code extension: package.json', () => {
  it('has a valid main entry pointing to extension.js', () => {
    assert.equal(packageJson.main, './extension.js');
  });

  it('declares commands in contributes.commands', () => {
    assert.ok(Array.isArray(packageCommands));
    assert.ok(packageCommands.length > 0);
  });

  it('every declared command has a non-empty title', () => {
    for (const cmd of packageCommands) {
      assert.ok(cmd.title, `command ${cmd.command} has no title`);
      assert.ok(cmd.title.length > 0, `command ${cmd.command} has empty title`);
    }
  });

  it('every declared command ID starts with "course."', () => {
    for (const cmd of packageCommands) {
      assert.ok(
        cmd.command.startsWith('course.'),
        `unexpected prefix: ${cmd.command}`,
      );
    }
  });
});

describe('VS Code extension: command registry consistency', () => {
  const packageCommandIds = packageCommands.map((c) => c.command).sort();

  it('all commands in package.json are registered in extension.js', () => {
    for (const id of packageCommandIds) {
      assert.ok(
        allRegisteredIds.includes(id),
        `package.json declares "${id}" but extension.js does not register it`,
      );
    }
  });

  it('all commands registered in extension.js are declared in package.json', () => {
    for (const id of allRegisteredIds) {
      assert.ok(
        packageCommandIds.includes(id),
        `extension.js registers "${id}" but package.json does not declare it`,
      );
    }
  });

  it('command count matches between extension.js and package.json', () => {
    assert.equal(allRegisteredIds.length, packageCommandIds.length);
  });
});

describe('VS Code extension: commands map', () => {
  it('maps each command to a valid npx course CLI invocation', () => {
    for (const [id, cmd] of Object.entries(commandsMap)) {
      assert.ok(
        cmd.startsWith('npx course '),
        `command "${id}" does not start with "npx course ": ${cmd}`,
      );
    }
  });

  it('contains init command', () => {
    assert.ok(commandsMap['course.init']);
    assert.equal(commandsMap['course.init'], 'npx course init');
  });

  it('contains push and pull commands', () => {
    assert.equal(commandsMap['course.push'], 'npx course push');
    assert.equal(commandsMap['course.pull'], 'npx course pull');
  });

  it('contains push --dry-run command', () => {
    assert.equal(commandsMap['course.pushDryRun'], 'npx course push --dry-run');
  });

  it('contains status command', () => {
    assert.equal(commandsMap['course.status'], 'npx course status');
  });
});

describe('VS Code extension: context-aware commands', () => {
  it('registers all module management commands individually', () => {
    for (const id of [
      'course.newModule',
      'course.moveModule',
      'course.renameModule',
      'course.deleteModule',
    ]) {
      assert.ok(
        extraRegistered.includes(id),
        `${id} should be registered via registerCommand`,
      );
    }
  });

  it('registers all item management commands individually', () => {
    for (const id of [
      'course.newItem',
      'course.moveItem',
      'course.moveItemToModule',
      'course.renameItem',
      'course.deleteItem',
    ]) {
      assert.ok(
        extraRegistered.includes(id),
        `${id} should be registered via registerCommand`,
      );
    }
  });

  it('structural commands run through the silent CLI runner with flags', () => {
    assert.match(extensionSource, /'rename-item',\s*'--path'/);
    assert.match(extensionSource, /'move-item',\s*'--path'/);
    assert.match(extensionSource, /'movetomodule-item',\s*'--path'/);
    assert.match(extensionSource, /'delete-item',\s*'--path'/);
    assert.match(extensionSource, /'delete-module',\s*'--module'/);
    assert.match(extensionSource, /'rename-module',\s*'--module'/);
  });

  it('deletes require explicit confirmation dialogs', () => {
    assert.match(
      extensionSource,
      new RegExp(
        "showWarningMessage\\([\\s\\S]{0,200}modal: true[\\s\\S]{0,100}'Delete'",
      ),
    );
  });
});

describe('VS Code extension: export commands', () => {
  const itemContextMenus = packageJson.contributes.menus['view/item/context'];
  const viewTitleMenus = packageJson.contributes.menus['view/title'];

  it('registers all export commands individually', () => {
    for (const id of [
      'course.exportItem',
      'course.exportModule',
      'course.exportCourse',
      'course.exportCourseToc',
    ]) {
      assert.ok(
        extraRegistered.includes(id),
        `${id} should be registered via registerCommand`,
      );
    }
  });

  it('streams export output through the shared terminal', () => {
    assert.match(extensionSource, /runInTerminal\(`npx course export /);
    assert.match(
      extensionSource,
      /npx course export --module \$\{folder\} --format/,
    );
  });

  it('exportItem supports multi-select via the second handler argument', () => {
    assert.match(
      extensionSource,
      /register\('course\.exportItem',\s*async \(item, selected\)/,
    );
    assert.match(extensionSource, /Array\.isArray\(selected\)/);
  });

  it('offers Export on item and module context menus', () => {
    const exportItem = itemContextMenus.find(
      (m) => m.command === 'course.exportItem',
    );
    assert.ok(exportItem, 'course.exportItem needs a context menu entry');
    assert.match(exportItem.when, /page\|assignment\|external_url\|file/);
    const exportModule = itemContextMenus.find(
      (m) => m.command === 'course.exportModule',
    );
    assert.ok(exportModule, 'course.exportModule needs a context menu entry');
    assert.match(exportModule.when, /module/);
  });

  it('gates the TOC export action behind a context key', () => {
    const tocEntry = viewTitleMenus.find(
      (m) => m.command === 'course.exportCourseToc',
    );
    assert.ok(tocEntry, 'course.exportCourseToc needs a view/title entry');
    assert.match(tocEntry.when, /course\.tocReady/);
    assert.match(extensionSource, /setContext', 'course\.tocReady', true/);
  });
});

describe('VS Code extension: subsection move support', () => {
  const itemContextMenus = packageJson.contributes.menus['view/item/context'];

  function whenFor(commandId) {
    const entry = itemContextMenus.find((m) => m.command === commandId);
    assert.ok(entry, `${commandId} should have a view/item/context menu entry`);
    return entry.when;
  }

  it('offers Move Item on subsections', () => {
    assert.match(whenFor('course.moveItem'), /subheader/);
  });

  it('offers Move Item to Module on subsections', () => {
    assert.match(whenFor('course.moveItemToModule'), /subheader/);
  });

  it('skips the sub-section prompt when the moved item is itself a subsection', () => {
    // The moveItemToModule handler must not offer destination subsections for a
    // directory source — subsections cannot be nested.
    assert.match(
      extensionSource,
      /isSubsection\s*=[\s\S]*?statSync\([^)]*\)\.isDirectory\(\)/,
    );
    assert.match(extensionSource, /isSubsection\s*\?\s*\[\]\s*:/);
  });
});

describe('VS Code extension: drag and drop', () => {
  const providerSource = fs.readFileSync(
    path.join(extDir, 'CourseTreeProvider.js'),
    'utf-8',
  );

  it('routes module reordering through the CLI', () => {
    assert.match(providerSource, /'move-module',\s*'--module'/);
  });

  it('gives every synced type its own icon', () => {
    // An unmapped type silently borrows the page icon, so the tree showed a
    // quiz, a discussion and an LTI link as if all three were pages.
    const iconMap = providerSource.slice(
      providerSource.indexOf('const ICON_MAP'),
      providerSource.indexOf('};', providerSource.indexOf('const ICON_MAP')),
    );
    for (const type of [
      'page',
      'assignment',
      'discussion',
      'quiz',
      'external_url',
      'external_tool',
      'file',
    ]) {
      assert.match(iconMap, new RegExp(`\\b${type}:`), `${type} needs an icon`);
    }
  });

  it('routes item moves through the CLI', () => {
    assert.match(providerSource, /'movetomodule-item',\s*'--path'/);
    assert.match(providerSource, /'move-item',\s*'--path'/);
  });

  it('routes external file drops through new-item --type file', () => {
    assert.match(
      providerSource,
      /'new-item',\s*'--module',[^\]]*'--type',\s*'file'/,
    );
  });

  it('no longer renames files directly during drops', () => {
    const dropSection = providerSource.slice(
      providerSource.indexOf('handleDrop'),
    );
    assert.ok(
      !dropSection.includes('renameSync'),
      'drag-and-drop must not bypass the CLI with fs.renameSync',
    );
    assert.ok(
      !dropSection.includes('copyFileSync'),
      'drag-and-drop must not bypass the CLI with fs.copyFileSync',
    );
  });

  it('routes subsection drags to a dedicated handler', () => {
    assert.match(providerSource, /contextValue === 'subheader'/);
    assert.match(providerSource, /_handleSubsectionDrop\(/);
    assert.match(providerSource, /async _handleSubsectionDrop\(/);
  });

  it('never nests a subsection inside another subsection during a drop', () => {
    const start = providerSource.indexOf('async _handleSubsectionDrop(');
    const subsectionHandler = providerSource.slice(
      start,
      providerSource.indexOf('async _handleExternalFileDrop(', start),
    );
    assert.ok(start !== -1, '_handleSubsectionDrop should exist');
    assert.ok(
      !subsectionHandler.includes('--to-subsection'),
      'moving a subsection must not pass --to-subsection',
    );
  });
});

describe('VS Code extension: pushModule command', () => {
  it('registers course.pushModule as a separate command', () => {
    assert.ok(
      extraRegistered.includes('course.pushModule'),
      'course.pushModule should be registered via registerCommand',
    );
  });

  it('pushModule builds the correct CLI command with --module flag', () => {
    assert.match(extensionSource, /npx course push --module \$\{picked\}/);
  });
});

describe('VS Code extension: search command', () => {
  it('registers course.search as a separate command', () => {
    assert.ok(
      extraRegistered.includes('course.search'),
      'course.search should be registered via registerCommand',
    );
  });

  it('declares the command with a title and search icon', () => {
    const cmd = packageCommands.find((c) => c.command === 'course.search');
    assert.ok(cmd, 'course.search needs a contributes.commands entry');
    assert.equal(cmd.title, 'Course: Search...');
    assert.match(cmd.icon, /search/);
  });

  it('appears as a navigation icon on the courseTree title bar', () => {
    const entry = packageJson.contributes.menus['view/title'].find(
      (m) => m.command === 'course.search',
    );
    assert.ok(entry, 'course.search needs a view/title entry');
    assert.equal(entry.group, 'navigation');
  });

  it('prompts for a keyword and streams the search through the terminal', () => {
    const start = extensionSource.indexOf("register('course.search'");
    assert.ok(start !== -1);
    const handler = extensionSource.slice(start, start + 600);
    assert.match(handler, /showInputBox/);
    assert.match(handler, /npx course search "/);
  });
});

describe('VS Code extension: open in Canvas', () => {
  const start = extensionSource.indexOf("register('course.openInCanvas'");
  const handler = extensionSource.slice(start, start + 2500);

  it('registers the command', () => {
    assert.ok(start !== -1);
  });

  it('builds a discussion_topics URL for a discussion', () => {
    assert.match(
      handler,
      /canvasType === 'discussion'[\s\S]*?\/courses\/\$\{courseId\}\/discussion_topics\/\$\{canvasId\}/,
    );
  });

  it('builds a quizzes URL for a quiz', () => {
    // Everything unmatched falls through to the page URL, which sent a quiz to
    // /pages/<quiz id> and opened nothing.
    assert.match(
      handler,
      /canvasType === 'quiz'[\s\S]*?\/courses\/\$\{courseId\}\/quizzes\/\$\{canvasId\}/,
    );
  });

  it('opens a link and an LTI launch as the module item they are', () => {
    // Neither has a content object of its own, and canvas_id holds the module
    // item id, so the page URL these used to fall through to was doubly wrong.
    assert.match(
      handler,
      /canvasType === 'external_url'[\s\S]*?canvasType === 'external_tool'[\s\S]*?\/courses\/\$\{courseId\}\/modules\/items\/\$\{canvasId\}/,
    );
  });

  it('still builds assignment, file and page URLs', () => {
    assert.match(
      handler,
      /canvasType === 'assignment'[\s\S]*?\/courses\/\$\{courseId\}\/assignments\/\$\{canvasId\}/,
    );
    assert.match(
      handler,
      /canvasType === 'file'[\s\S]*?\/courses\/\$\{courseId\}\/files\/\$\{canvasId\}/,
    );
    assert.match(handler, /\/courses\/\$\{courseId\}\/pages\/\$\{canvasId\}/);
  });
});

describe('VS Code extension: activate and deactivate', () => {
  it('exports activate function', () => {
    assert.match(extensionSource, /module\.exports\s*=\s*\{[^}]*activate/);
  });

  it('exports deactivate function', () => {
    assert.match(extensionSource, /module\.exports\s*=\s*\{[^}]*deactivate/);
  });

  it('init command skips workspace validation', () => {
    assert.match(extensionSource, /noValidationCommands.*course\.init/);
  });
});

describe('VS Code extension: workspace validation', () => {
  it('defines validateWorkspace function', () => {
    assert.match(extensionSource, /function validateWorkspace\(\)/);
  });

  it('checks for course/ directory existence', () => {
    assert.match(extensionSource, /path\.join\(workspaceRoot,\s*'course'\)/);
  });

  it('shows error when no workspace folder is open', () => {
    assert.match(
      extensionSource,
      /showErrorMessage[\s\S]*?No workspace folder open/,
    );
  });

  it('shows warning when course/ directory is missing', () => {
    assert.match(
      extensionSource,
      new RegExp('showWarningMessage[\\s\\S]*No course/ directory found'),
    );
  });
});

describe('VS Code extension: CLI runner', () => {
  it('defines a silent runCli helper using execFile', () => {
    assert.match(extensionSource, /function runCli\(/);
    assert.match(extensionSource, /cp\.execFile\(/);
  });

  it('reuses a single shared terminal for streaming commands', () => {
    assert.match(extensionSource, /function getSharedTerminal\(\)/);
    assert.match(
      extensionSource,
      /terminals\.find\(\s*\(t\) => t\.name === 'Canvas Course Builder',?\s*\)/,
    );
  });

  it('surfaces a warning a successful run wrote to stderr', () => {
    // The silent runner drives every delete and the merge, and it used to
    // append a successful run's stderr to a channel it never reveals. That is
    // where `delete-item` and `delete-module` name the Canvas objects a
    // renumber collision put out of reach, so the one warning in this tool
    // that cannot be recovered from was the one nobody saw.
    const success = extensionSource.slice(
      extensionSource.indexOf('resolve(false);'),
      extensionSource.indexOf('resolve(true);'),
    );
    assert.match(
      success,
      /showWarningMessage/,
      'the success branch has to surface stderr, not only log it',
    );
    assert.match(
      success,
      /'Show Log'/,
      'and offer the channel, because the CLI lists one object per line',
    );
  });
});
