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

// The command ids listed in the noValidationCommands set literal.
function parseNoValidationCommands(source) {
  const start = source.indexOf('const noValidationCommands = new Set(');
  if (start === -1) return [];
  const literal = source.slice(start, source.indexOf(');', start));
  return [...literal.matchAll(/'(course\.\w+)'/g)].map((m) => m[1]);
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

describe('VS Code extension: command palette visibility', () => {
  // A contributed command is palette-visible unless a commandPalette entry
  // hides it, and these four do nothing there: each reads the tree item it was
  // clicked on and returns when it is missing, silently. Every other command
  // asks for what it needs (quick pick, input box, active editor) and works
  // from the palette.
  const contextOnly = [
    'course.mergeSetSource',
    'course.mergeWithSource',
    'course.openInCanvas',
    'course.pushItem',
  ];
  const paletteMenus = packageJson.contributes.menus.commandPalette;

  // The handler body, from its register() call to the next one.
  function handlerFor(id) {
    const start = extensionSource.indexOf(`register('${id}'`);
    assert.ok(start !== -1, `${id} should be registered`);
    const next = extensionSource.indexOf("\n  register('", start);
    return extensionSource.slice(start, next === -1 ? undefined : next);
  }

  it('declares a commandPalette menu section', () => {
    assert.ok(
      Array.isArray(paletteMenus),
      'contributes.menus needs a commandPalette section',
    );
  });

  it('hides exactly the commands that cannot run without a tree item', () => {
    for (const entry of paletteMenus) {
      assert.equal(
        entry.when,
        'false',
        `${entry.command} should be hidden with when: "false"`,
      );
    }
    assert.deepEqual(
      paletteMenus.map((m) => m.command).sort(),
      [...contextOnly].sort(),
    );
  });

  it('hides only commands the manifest declares', () => {
    const declared = packageCommands.map((c) => c.command);
    for (const entry of paletteMenus) {
      assert.ok(
        declared.includes(entry.command),
        `commandPalette hides "${entry.command}", which is not a declared command`,
      );
    }
  });

  it('each hidden handler really lacks a palette fallback', () => {
    for (const id of contextOnly) {
      const handler = handlerFor(id);
      for (const fallback of [
        'resolveItemPath',
        'resolveModuleFolder',
        'pickItemPath',
        'pickModuleFolder',
        'showQuickPick',
        'showInputBox',
      ]) {
        assert.ok(
          !handler.includes(fallback),
          `${id} now falls back to ${fallback}: unhide it from the palette`,
        );
      }
    }
  });

  it('leaves the commands that ask for their target visible', () => {
    const hidden = new Set(paletteMenus.map((m) => m.command));
    for (const id of [
      'course.pushModule',
      'course.mergeItems',
      'course.renameItem',
      'course.deleteItem',
      'course.exportItem',
      'course.splitItem',
    ]) {
      assert.ok(!hidden.has(id), `${id} works from the palette and must stay`);
    }
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

  it('gives all three sync directions a --dry-run entry', () => {
    assert.equal(commandsMap['course.syncDryRun'], 'npx course sync --dry-run');
    assert.equal(commandsMap['course.pushDryRun'], 'npx course push --dry-run');
    assert.equal(commandsMap['course.pullDryRun'], 'npx course pull --dry-run');
  });

  it('contains status command', () => {
    assert.equal(commandsMap['course.status'], 'npx course status');
  });
});

describe('VS Code extension: advanced commands', () => {
  // The palette carries every CLI command, the advanced three included. What
  // keeps them advanced is where they are *not*: no view/title entry and no
  // context menu, so they are only ever reached by typing their name.
  const advanced = {
    'course.buildGlossary': {
      cli: 'npx course build-glossary',
      title: 'Course: Build Glossary',
    },
    'course.resetSyncState': {
      cli: 'npx course reset-sync-state',
      title: 'Course: Reset Sync State (Destructive)',
    },
    'course.resetCanvas': {
      cli: 'npx course reset-canvas',
      title: 'Course: Reset Canvas (Deletes ALL Canvas Content)',
    },
  };
  const menus = packageJson.contributes.menus;

  it('runs each one in the terminal, where the CLI asks its own questions', () => {
    // reset-canvas prints an inventory and waits for y/N; reset-sync-state
    // waits for y/N. Both gates are stdin, so the silent runCli path would
    // hang on them or, worse, answer nothing and look cancelled.
    for (const [id, { cli }] of Object.entries(advanced)) {
      assert.equal(commandsMap[id], cli, `${id} must map to ${cli}`);
    }
  });

  it('declares each one with its palette title', () => {
    for (const [id, { title }] of Object.entries(advanced)) {
      const cmd = packageCommands.find((c) => c.command === id);
      assert.ok(cmd, `${id} needs a contributes.commands entry`);
      assert.equal(cmd.title, title);
    }
  });

  it('keeps them out of the Course Manager view and every menu', () => {
    for (const section of Object.keys(menus)) {
      if (section === 'commandPalette') continue;
      for (const entry of menus[section]) {
        assert.ok(
          !advanced[entry.command],
          `${entry.command} is an advanced command and must not appear in ${section}`,
        );
      }
    }
  });

  it('leaves them visible in the palette', () => {
    const hidden = new Set(menus.commandPalette.map((m) => m.command));
    for (const id of Object.keys(advanced)) {
      assert.ok(!hidden.has(id), `${id} is the palette's alone to offer`);
    }
  });

  it('exempts only the two resets from the course/ warning', () => {
    // Neither reset reads course/: they act on .canvas-sync.json and on
    // Canvas. Reset Sync State is what you run when the project is broken, so
    // a warning that course/ is missing would point away from the fix.
    assert.deepEqual(parseNoValidationCommands(extensionSource).sort(), [
      'course.init',
      'course.resetCanvas',
      'course.resetSyncState',
    ]);
  });

  it('gives Build Glossary and Pull the normal workspace check', () => {
    const exempt = parseNoValidationCommands(extensionSource);
    for (const id of [
      'course.buildGlossary',
      'course.pull',
      'course.pullDryRun',
    ]) {
      assert.ok(
        !exempt.includes(id),
        `${id} works on course/, so the missing-course/ warning applies`,
      );
    }
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

describe('VS Code extension: merge confirmation', () => {
  const start = extensionSource.indexOf('async function confirmMerge(');
  const helper = extensionSource.slice(
    start,
    extensionSource.indexOf('async function resolveItemPath(', start),
  );

  it('registers both merge entry points', () => {
    for (const id of [
      'course.mergeSetSource',
      'course.mergeWithSource',
      'course.mergeItems',
    ]) {
      assert.ok(
        extraRegistered.includes(id),
        `${id} should be registered via registerCommand`,
      );
    }
  });

  it('confirms in a modal naming both files and the one that goes', () => {
    // A merge deletes the source, and neither entry point used to ask
    // anything: the CLI's own y/N question is on its interactive path, which
    // --source/--target skips.
    assert.ok(start !== -1, 'confirmMerge should exist');
    assert.ok(
      helper.includes(
        'Merge "${source}" into "${target}"? "${source}" will be deleted.',
      ),
      'the modal has to name the target and, twice, the file being deleted',
    );
    assert.match(helper, /modal: true/);
    assert.match(helper, /'Merge'/);
    assert.match(
      helper,
      /return choice === 'Merge'/,
      'a dismissed modal must read as a cancel',
    );
  });

  it('gates both merge handlers on that confirmation', () => {
    const gated =
      extensionSource.match(/await confirmMerge\(sourcePath, targetPath\)/g) ||
      [];
    assert.equal(gated.length, 2, 'both handlers have to ask before merging');
  });

  it('passes --yes, which the CLI requires in flag mode', () => {
    const calls = extensionSource.match(/'merge-items',[\s\S]*?\]/g) || [];
    assert.equal(calls.length, 2);
    for (const call of calls) {
      assert.match(call, /'--yes'/);
    }
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
    assert.ok(
      parseNoValidationCommands(extensionSource).includes('course.init'),
    );
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

describe('VS Code extension: terminal pool', () => {
  // Streaming commands must never type into a terminal that is running
  // something — while sync waits at a conflict prompt, a second command line
  // would be read as the answer. The decision itself is pickTerminal
  // (helpers.test.js); these assertions pin the wiring around it. Whether the
  // shell integration events actually flip `busy` needs an extension host and
  // is checked by the manual smoke test.

  it('requires a VS Code with the shell integration events', () => {
    // onDidStartTerminalShellExecution and friends arrived in 1.93.
    assert.equal(packageJson.engines.vscode, '^1.93.0');
  });

  it('chooses the terminal through pickTerminal, never by bare name lookup', () => {
    assert.match(
      extensionSource,
      /pickTerminal\(terminalPool, TERMINAL_BASE_NAME\)/,
    );
    assert.ok(
      !extensionSource.includes('getSharedTerminal'),
      'the by-name shared-terminal lookup must be gone',
    );
  });

  it('marks the terminal busy before showing it and sending the text', () => {
    const start = extensionSource.indexOf('function runInTerminal(');
    assert.ok(start !== -1);
    const handler = extensionSource.slice(start, start + 1200);
    const busyAt = handler.indexOf('entry.busy = true');
    const awaitingAt = handler.indexOf('entry.awaitingStart = true');
    const showAt = handler.indexOf('.show()');
    const sendAt = handler.indexOf('.sendText(');
    assert.ok(busyAt !== -1 && awaitingAt !== -1 && showAt !== -1);
    assert.ok(busyAt < sendAt, 'busy must be set before the text is sent');
    assert.ok(
      awaitingAt < sendAt,
      'the fallback flag must be set before the text is sent',
    );
    assert.ok(showAt < sendAt, 'the terminal is shown before the send');
  });

  it('moves the chosen terminal to the most-recently-used end of the pool', () => {
    assert.match(extensionSource, /terminalPool\.splice\(choice\.index, 1\)/);
    assert.match(extensionSource, /terminalPool\.push\(entry\)/);
  });

  it('flips busy on the shell integration execution events', () => {
    assert.match(
      extensionSource,
      /onDidStartTerminalShellExecution\(\(event\)/,
    );
    assert.match(extensionSource, /onDidEndTerminalShellExecution\(\(event\)/);
    assert.match(
      extensionSource,
      /onDidChangeTerminalShellIntegration\(\(event\)/,
    );
  });

  it('guards the 1.93 events so an older host degrades instead of crashing', () => {
    assert.match(
      extensionSource,
      /typeof vscode\.window\.onDidStartTerminalShellExecution === 'function'/,
    );
    assert.match(
      extensionSource,
      /typeof vscode\.window\.onDidChangeTerminalShellIntegration === 'function'/,
    );
  });

  it('prunes closed terminals from the pool', () => {
    assert.match(extensionSource, /onDidCloseTerminal\(\(terminal\)/);
    assert.match(
      extensionSource,
      /terminalPool\.filter\(\(e\) => e\.terminal !== terminal\)/,
    );
  });

  it('adopts pool-named terminals from before a window reload as busy', () => {
    const start = extensionSource.indexOf('Terminal pool bookkeeping');
    assert.ok(start !== -1);
    const wiring = extensionSource.slice(start, start + 900);
    assert.match(
      wiring,
      /terminalNumber\(terminal\.name, TERMINAL_BASE_NAME\) !== null/,
    );
    assert.match(wiring, /busy: true/);
  });
});
