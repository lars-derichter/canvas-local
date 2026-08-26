const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Linter } = require('eslint');

const extDir = path.resolve(
  __dirname,
  '../../.vscode/extensions/course-manager',
);
/**
 * Every JavaScript file the extension ships, walked rather than listed.
 *
 * A hardcoded list is a hole with no bottom: a file added tomorrow is invisible
 * and nothing says so, and the guards in this file that scan source text would
 * go on passing over a shrinking share of the extension. `cli-contract.test.js`
 * learned that the hard way — a planted `commands/sync.js` invoking a
 * nonexistent subcommand left it green — so this is the same walk, kept in the
 * same shape: it descends into subdirectories, and it takes `.mjs` and `.cjs`
 * as readily as `.js`.
 *
 * Names come back with `/` separators whatever the platform, so a failure reads
 * the same on Windows as here.
 */
function extensionSourceNames(dir = extDir, prefix = '') {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      found.push(...extensionSourceNames(path.join(dir, entry.name), name));
    } else if (/\.(js|mjs|cjs)$/.test(entry.name)) {
      found.push(name);
    }
  }
  return found.sort();
}

/**
 * The extension is thirteen files across two directories; a walk that finds
 * many fewer has stopped walking.
 *
 * Ten, not thirteen: high enough that dropping `commands/` (six files, and
 * where most of what the rules below check now lives) takes the count under it,
 * with headroom for the ordinary case of a file being merged into another. The
 * descent is pinned by name as well, because a count alone would be satisfied
 * by the seven top-level files.
 */
const MINIMUM_SOURCES = 10;

const extensionSources = extensionSourceNames().map((name) => ({
  name,
  text: fs.readFileSync(path.join(extDir, ...name.split('/')), 'utf-8'),
}));

/**
 * Every source, end to end, for the assertions that are about the extension
 * rather than about which of its files a line ended up in.
 *
 * Most of them are. `extension.js` was one 1400-line file when they were
 * written, so they read one file; the split moved almost every line they match
 * into `terminal.js`, `runner.js`, `pickers.js` or `commands/`, and none of
 * those moves changed what any of them is asserting. Reading the corpus keeps
 * them pinned to the code instead of to a filename, so the next ordinary move
 * stays an ordinary move. Where a rule genuinely is about one file — the runner
 * spawning no shell, the pool bookkeeping — the file is named.
 *
 * Joining is safe for matching and for a search that lands on a unique
 * construct; it is not safe for slicing a region that runs to "the next one of
 * these", which would run off the end of its file and into the next. Those go
 * through `sourceHolding` below.
 */
const allSource = extensionSources.map((source) => source.text).join('\n');

/** The one file holding `needle`, for a region that has to stay inside a file. */
function sourceHolding(needle) {
  const holding = extensionSources.filter((source) =>
    source.text.includes(needle),
  );
  assert.equal(
    holding.length,
    1,
    `${needle} should be in exactly one extension source, found ` +
      `${holding.length} (${holding.map((s) => s.name).join(', ') || 'none'})`,
  );
  return holding[0].text;
}

describe('VS Code extension: the source walk the guards below stand on', () => {
  it('finds every JavaScript file the extension ships', () => {
    const names = extensionSources.map((source) => source.name);
    assert.ok(
      names.length >= MINIMUM_SOURCES,
      `the walk found ${names.length} files (${names.join(', ')})`,
    );
    assert.ok(names.includes('extension.js'));
    assert.ok(names.includes('CourseTreeProvider.js'));
    assert.ok(names.includes('helpers.js'));
    assert.ok(
      names.some((name) => name.includes('/')),
      'the walk has to descend, or every commands/ file is invisible to the ' +
        `rules that read these sources (${names.join(', ')})`,
    );
  });
});

const packageJson = JSON.parse(
  fs.readFileSync(path.join(extDir, 'package.json'), 'utf-8'),
);
const { DEFAULT_PREVIEW_PORT } = require(path.join(extDir, 'helpers'));

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

/**
 * One command handler's source: from its `register()` call to the next one,
 * inside the file that holds it.
 *
 * A handler is bounded by the next registration, and a section by the next
 * section marker, so both of these read a region the file itself delimits.
 * They replace three slices of a fixed number of characters — 600, 900 and
 * 1200 — which pinned the wrong thing: adding an ordinary comment to a handler
 * pushed the line under test past the end of the window and failed a test whose
 * message mentioned neither comments nor lengths.
 *
 * Both read one file rather than the corpus, because both run to "the next one
 * of these": on a joined corpus the last handler of `commands/items.js` would
 * swallow the first of `commands/export.js`, which is a fixed offset again by
 * another name.
 */
function handlerSource(id) {
  const source = sourceHolding(`register('${id}'`);
  const start = source.indexOf(`register('${id}'`);
  const next = source.indexOf("\n  register('", start);
  return source.slice(start, next === -1 ? undefined : next);
}

/** One `// --- Name ---` section, up to the next section marker in its file. */
function sectionSource(name) {
  const source = sourceHolding(`// --- ${name}`);
  const start = source.indexOf(`// --- ${name}`);
  const rest = source.slice(start + 1);
  const next = rest.indexOf('// --- ');
  return next === -1 ? rest : rest.slice(0, next);
}

// Does a when-clause admit a row with this contextValue? Covers the two
// shapes the manifest writes: `viewItem == x` and `viewItem =~ /re/`.
function admits(when, contextValue) {
  const equality = when.match(/viewItem == (\w+)/);
  if (equality) return equality[1] === contextValue;
  const pattern = when.match(/viewItem =~ \/(.+?)\//);
  if (pattern) return new RegExp(pattern[1]).test(contextValue);
  return false;
}

const commandsMap = parseCommandsObject(allSource);
const extraRegistered = parseExtraRegisteredCommands(allSource);
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

describe('VS Code extension: the titles the messages quote', () => {
  // A message that tells the reader to run a command has to name it the way
  // the palette does, or the instruction is a search that finds nothing. The
  // one that started this: "Run \"Course: Init\" first", for a command titled
  // "Course: Init (Canvas Setup)".
  const sources = extensionSources;
  const titles = packageCommands.map((command) => command.title);
  // Punctuation and case off, so "Course: Export via TOC" and the real
  // "Course: Export via TOC..." collapse onto each other and can be compared.
  const bare = (text) => text.toLowerCase().replace(/[^a-z0-9]/g, '');
  const titleByBare = new Map(titles.map((title) => [bare(title), title]));

  /** Every double-quoted span in a source, which is how a title is quoted. */
  function quotedSpans(text) {
    return [...text.matchAll(/"([^"\n]+)"/g)].map((match) => match[1]);
  }

  it('finds the quoted titles it is meant to be checking', () => {
    const found = sources.flatMap(({ text }) =>
      quotedSpans(text).filter((span) => span.startsWith('Course: ')),
    );
    assert.ok(
      found.length >= 4,
      `only ${found.length} quoted "Course: …" titles found; the scan has ` +
        'most likely stopped seeing them',
    );
  });

  it('quotes a "Course: …" title exactly as the manifest declares it', () => {
    for (const { name, text } of sources) {
      for (const span of quotedSpans(text)) {
        if (!span.startsWith('Course: ')) continue;
        assert.ok(
          titles.includes(span),
          `${name} quotes "${span}", which no command is called. ` +
            `Closest: ${JSON.stringify(titleByBare.get(bare(span)) ?? titles.filter((t) => t.startsWith(span)))}`,
        );
      }
    }
  });

  it('spells a title it names in full down to the punctuation', () => {
    // The trailing "..." is part of the title, and the two commands with a
    // "Merge:" prefix have no "Course: " to catch them above.
    for (const { name, text } of sources) {
      for (const span of quotedSpans(text)) {
        const title = titleByBare.get(bare(span));
        if (!title || title === span) continue;
        assert.fail(`${name} quotes "${span}" for the command "${title}"`);
      }
    }
  });

  it('does not drop the "Course: " a title carries', () => {
    // The comment shorthand this started as: "Export via TOC" for a command
    // called "Course: Export via TOC...". A general substring search for
    // near-misses is too noisy to keep — it flags every quoted word that
    // happens to sit inside some title — but this one shape is exact: a span
    // that becomes a real title once the prefix is put back is the prefix
    // having been dropped. Zero false positives over all 80 double-quoted
    // spans in these three files, measured.
    for (const { name, text } of sources) {
      for (const span of quotedSpans(text)) {
        if (titles.includes(span)) continue;
        assert.ok(
          !titles.includes(`Course: ${span}`),
          `${name} quotes "${span}" for the command "Course: ${span}"`,
        );
      }
    }
  });

  it('labels a welcome-view button with the title of its command', () => {
    // The welcome view runs the command from a markdown link, and the link
    // text is what the reader will go looking for in the palette afterwards.
    const byId = new Map(packageCommands.map((c) => [c.command, c.title]));
    const links = packageJson.contributes.viewsWelcome.flatMap((entry) => [
      ...entry.contents.matchAll(/\[([^\]]+)\]\(command:([\w.]+)\)/g),
    ]);
    assert.ok(links.length > 0, 'the welcome view should offer a button');
    for (const [, label, id] of links) {
      assert.equal(label, byId.get(id), `the button for ${id} is mislabelled`);
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
  // hides it, and these seven do nothing there: each reads the tree item it was
  // clicked on and returns when it is missing, silently. Every other command
  // asks for what it needs (quick pick, input box, active editor) and works
  // from the palette.
  const contextOnly = [
    'course.mergeSetSource',
    'course.mergeWithSource',
    'course.openInCanvas',
    'course.pushItem',
    'course.syncItem',
    'course.pullItem',
    'course.statusItem',
  ];
  const paletteMenus = packageJson.contributes.menus.commandPalette;

  const handlerFor = handlerSource;

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

  it('leaves the TOC export ungated here, on purpose', () => {
    // The view menu gates it on course.tocReady so the button is not offered
    // over a TOC that does not exist. The palette deliberately does not: the
    // command checks the file itself and refuses with a sentence, so gating
    // buys nothing, while gating BOTH routes would make a key that missed its
    // create event unreachable until a window reload. The palette is the way
    // back in.
    assert.ok(
      !paletteMenus.some((m) => m.command === 'course.exportCourseToc'),
      'gating the palette too would leave no route back from a stale key',
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

  // Typing "Course:" has to bring up everything the palette offers, so a
  // palette-visible command without the prefix is invisible to that search.
  // The hidden ones are exempt: nobody ever reads their title in a
  // palette, only in the tree's hover buttons and right-click menu.
  //
  // The assertion runs on the label the palette composes, not on the raw
  // title, because those are two different strings: the palette prepends
  // `category` where a command declares one, while every menu renders the
  // title alone. Declaring "category": "Course" with a short title is
  // therefore a legitimate way to satisfy this rule, and one that would also
  // shorten the tree menus. Pinning the composed label leaves that refactor
  // open instead of failing it for the wrong reason.
  it('prefixes every palette-visible label with "Course: "', () => {
    const prefix = 'Course: ';
    const hidden = new Set(paletteMenus.map((m) => m.command));
    for (const cmd of packageCommands) {
      if (hidden.has(cmd.command)) continue;
      const label = cmd.category ? `${cmd.category}: ${cmd.title}` : cmd.title;
      assert.ok(
        label.startsWith(prefix),
        `${cmd.command} reaches the palette as "${label}": prefix it with "${prefix}"`,
      );
      assert.ok(
        label.slice(prefix.length).trim(),
        `${cmd.command} reaches the palette as the bare prefix: give it a name`,
      );
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

  it('exempts Setup, Init and the two resets from the course/ warning', () => {
    // None of the four reads course/. Setup writes it and is the command the
    // warning itself names, so warning during a Setup run would interrupt the
    // run that answers it. Init writes .env and the sync state; neither reset
    // reads course/ either, they act on .canvas-sync.json and on Canvas. Reset
    // Sync State is what you run when the project is broken, so a warning that
    // course/ is missing would point away from the fix.
    assert.deepEqual(parseNoValidationCommands(allSource).sort(), [
      'course.init',
      'course.resetCanvas',
      'course.resetSyncState',
      'course.setup',
    ]);
  });

  it('gives Build Glossary and Pull the normal workspace check', () => {
    const exempt = parseNoValidationCommands(allSource);
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
    assert.match(allSource, /'rename-item',\s*'--path'/);
    assert.match(allSource, /'move-item',\s*'--path'/);
    assert.match(allSource, /'movetomodule-item',\s*'--path'/);
    assert.match(allSource, /'delete-item',\s*'--path'/);
    assert.match(allSource, /'delete-module',\s*'--module'/);
    assert.match(allSource, /'rename-module',\s*'--module'/);
  });

  it('deletes require explicit confirmation dialogs', () => {
    assert.match(
      allSource,
      new RegExp(
        "showWarningMessage\\([\\s\\S]{0,200}modal: true[\\s\\S]{0,100}'Delete'",
      ),
    );
  });
});

describe('VS Code extension: merge confirmation', () => {
  const start = allSource.indexOf('async function confirmMerge(');
  const helper = allSource.slice(
    start,
    allSource.indexOf('async function resolveItemPath(', start),
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
      allSource.match(/await confirmMerge\(sourcePath, targetPath\)/g) || [];
    assert.equal(gated.length, 2, 'both handlers have to ask before merging');
  });

  it('passes --yes, which the CLI requires in flag mode', () => {
    const calls = allSource.match(/'merge-items',[\s\S]*?\]/g) || [];
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
    assert.match(allSource, /runInTerminal\(\s*\(q\) => `npx course export /);
    assert.match(
      allSource,
      /npx course export --module \$\{q\(folder\)\} --format/,
    );
  });

  it('exportItem supports multi-select via the second handler argument', () => {
    assert.match(
      allSource,
      /register\('course\.exportItem',\s*async \(item, selected\)/,
    );
    assert.match(allSource, /Array\.isArray\(selected\)/);
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
    assert.match(allSource, /setTocReady\(true\)/);
  });

  it('writes that key from one place, so it cannot disagree with itself', () => {
    // The key means "exports/toc.md is there". Restoring it on activation and
    // clearing it from a watcher only hold together while every write goes
    // through the same function: a second raw setContext elsewhere is how the
    // menu and the disk start telling different stories.
    const writes = allSource.match(/'course\.tocReady'/g) || [];
    assert.equal(
      writes.length,
      1,
      'course.tocReady should be named once, inside setTocReady',
    );
    assert.match(
      allSource,
      /const setTocReady = \(ready\) =>\s*vscode\.commands\.executeCommand\(\s*'setContext',\s*'course\.tocReady',\s*ready,?\s*\)/,
    );
  });

  it('restores the key from the file at activation', () => {
    // A context key dies with the window. The curated TOC does not, so a
    // reload used to hide the only command that consumes it.
    assert.match(
      allSource,
      /setTocReady\(fs\.existsSync\(curatedTocPath\(workspaceRoot\)\)\)/,
    );
  });

  it('keeps the key with the file for as long as the window is open', () => {
    assert.match(
      allSource,
      /createFileSystemWatcher\(\s*new vscode\.RelativePattern\(workspaceRoot, 'exports\/toc\.md'\)/,
      'the pattern is rooted at the workspace: exports/ may not exist yet',
    );
    assert.match(allSource, /onDidCreate\(\(\) => setTocReady\(true\)\)/);
    assert.match(allSource, /onDidDelete\(\(\) => setTocReady\(false\)\)/);
  });

  it('does not clear the key over a TOC that is still on disk', () => {
    // Exporting the curated list to PDF leaves the list exactly where it was,
    // and exporting it to DOCX as well is the ordinary next step. Clearing the
    // key there made the key mean two things at once.
    const start = allSource.indexOf("register('course.exportCourseToc'");
    const handler = allSource.slice(
      start,
      allSource.indexOf("\n  register('", start),
    );
    assert.ok(start !== -1, 'the TOC export handler has to be findable');
    assert.ok(
      !/setTocReady\(true\)/.test(handler),
      'the consuming command does not arm the key either',
    );
    assert.match(
      handler,
      /if \(!fs\.existsSync\(curatedTocPath\(workspaceRoot\)\)\)/,
      'it checks the file itself, because a menu can be one event behind',
    );
    assert.match(
      handler,
      /setTocReady\(false\)/,
      'and puts the menu straight when it finds the file gone',
    );
  });
});

describe('VS Code extension: split at cursor, from the editor', () => {
  const editorMenus = packageJson.contributes.menus['editor/context'] || [];
  const entry = editorMenus.find((m) => m.command === 'course.splitItem');

  /**
   * The regex out of a `=~` clause, extracted the way VS Code extracts it:
   * everything between the opening delimiter and the last `/` in the lexeme.
   * Retyping the pattern here would test a copy rather than the clause the
   * host will actually compile.
   */
  function matcherOf(clause, key) {
    const at = clause.indexOf(`${key} =~ `);
    assert.notEqual(at, -1, `${key} =~ … should be part of the clause`);
    const lexeme = clause.slice(at + `${key} =~ `.length).trim();
    assert.ok(lexeme.startsWith('/'), 'a =~ operand is a regex literal');
    return new RegExp(lexeme.slice(1, lexeme.lastIndexOf('/')));
  }

  it('offers Split Item at Cursor in the editor context menu', () => {
    assert.ok(entry, 'course.splitItem needs an editor/context entry');
    assert.equal(entry.group, '1_modification');
  });

  it('offers it for markdown only', () => {
    // The handler refuses anything else out loud; the menu should not have
    // asked in the first place.
    assert.match(entry.when, /resourceExtname == \.md/);
  });

  it('offers it under course/ and nowhere else', () => {
    const matches = matcherOf(entry.when, 'resourcePath');
    for (const inside of [
      '/home/lars/project/course/01-intro/02-page.md',
      '/home/lars/project/course/01-intro/03-sub/01-page.md',
      'C:\\Users\\lars\\project\\course\\01-intro\\02-page.md',
    ]) {
      assert.ok(matches.test(inside), `${inside} should offer the split`);
    }
    for (const outside of [
      '/home/lars/project/sources/lessons/01-intro.md',
      '/home/lars/project/README.md',
      // The trap this clause exists to avoid: the project is called
      // canvas-course-builder, so a plain `course` search matches every file
      // in it. Separators on both sides are what make it a folder.
      '/home/lars/canvas-course-builder/docs/vscode.md',
      'C:\\Users\\lars\\canvas-course-builder\\docs\\vscode.md',
      '/home/lars/project/coursework/notes.md',
    ]) {
      assert.ok(!matches.test(outside), `${outside} should not offer it`);
    }
  });

  it('accepts two false positives, knowingly', () => {
    // What a path pattern cannot know is where the workspace root is: VS Code
    // has no context key for a path relative to it. So `course/` anywhere on
    // the path counts, and these two are the cost. Both are harmless — the
    // handler saves the file and hands it to `split-item`, which refuses a
    // file it cannot place — and both are cheaper than a context key
    // maintained from onDidChangeActiveTextEditor for one menu entry.
    const matches = matcherOf(entry.when, 'resourcePath');
    for (const accepted of [
      // A course/ folder that is not THE course/: nothing in this template
      // creates one, but nothing stops an author either.
      '/home/lars/project/sources/course/notes.md',
      // The whole project checked out inside a folder called course.
      '/home/lars/course/other-project/docs/x.md',
    ]) {
      assert.ok(
        matches.test(accepted),
        `${accepted} is a known false positive and should still match; if it ` +
          'no longer does, this note is out of date',
      );
    }
  });

  it('matches the separator of the platform the editor runs on', () => {
    // `resourcePath` is the URI's fsPath for a file: backslashes on Windows.
    // A forward-slash-only pattern would make this a macOS and Linux feature.
    const matches = matcherOf(entry.when, 'resourcePath');
    assert.ok(matches.test('\\course\\a.md'));
    assert.ok(matches.test('/course/a.md'));
  });

  it('stays in the palette too, where it needs no path at all', () => {
    const hidden = new Set(
      packageJson.contributes.menus.commandPalette.map((m) => m.command),
    );
    assert.ok(!hidden.has('course.splitItem'));
  });
});

describe('VS Code extension: the preview port setting', () => {
  const setting =
    packageJson.contributes.configuration?.properties?.[
      'courseManager.previewPort'
    ];

  it('is contributed, or nobody can set it from the settings UI', () => {
    assert.ok(setting, 'contributes.configuration needs previewPort');
    assert.equal(setting.type, 'integer');
    assert.equal(setting.minimum, 1);
    assert.equal(setting.maximum, 65535);
    assert.ok(
      setting.description || setting.markdownDescription,
      'a setting with no description is a setting nobody can act on',
    );
  });

  it('declares the same default the extension falls back to', () => {
    // Two places have to agree: the manifest default is what the settings UI
    // shows and what `get()` returns in the host, and DEFAULT_PREVIEW_PORT is
    // what a value the host cannot supply falls back to.
    assert.equal(setting.default, DEFAULT_PREVIEW_PORT);
  });

  it('reads the setting when the command runs, not when the window opens', () => {
    // Captured at activation, a change would need a reload to take effect —
    // which is the same wait the setting exists to avoid.
    const start = allSource.indexOf("register('course.preview'");
    assert.ok(start !== -1, 'the preview handler has to be findable');
    const handler = allSource.slice(start, allSource.indexOf('\n  });', start));
    assert.match(handler, /getConfiguration\('courseManager'\)/);
    assert.match(handler, /\.get\('previewPort'\)/);
  });

  it('puts the port in the URL it polls and in the command it sends', () => {
    // The address and the shape, not the name of the variable: the point is
    // that the port polled is the port configured, and a rename that keeps
    // that is not a regression.
    assert.match(allSource, /const url = `http:\/\/localhost:\$\{\w+\}`/);
    // Quoted, like every other value a command line carries. The port is an
    // integer today and quoting it costs nothing; what it buys is that the
    // line stays safe if previewPort ever returns something else.
    //
    // The flag and the shape of the value, not the name of the variable: what
    // the value must go through is the rule above, and pinning the spelling
    // here would fail an extraction that kept both.
    assert.match(allSource, /`npm start -- --port \$\{q\(\w+\)\}`/);
    assert.ok(
      !/localhost:3000/.test(allSource),
      'no hardcoded 3000 may survive next to the setting',
    );
  });

  it('quotes for the shell the preview terminal is actually running', () => {
    // The preview terminal is outside the pool, so it keeps a stamp of its
    // own. Quoting for the current default profile instead would mean a line
    // quoted for PowerShell typed into the cmd this window opened last time.
    //
    // The property, not the spelling: the quoting function the preview line is
    // built with comes from the preview terminal's own stamp, and which stamp
    // that is comes from `previewTerminalEntry`, whose rule is pinned by its
    // own tests rather than by a pattern here.
    assert.match(allSource, /previewTerminalEntry\(/);
    assert.match(allSource, /flavour: currentFlavour\(\)/);
    assert.match(allSource, /quoterFor\(previewEntry\.flavour\)/);
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
      allSource,
      /isSubsection\s*=[\s\S]*?statSync\([^)]*\)\.isDirectory\(\)/,
    );
    assert.match(allSource, /isSubsection\s*\?\s*\[\]\s*:/);
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
    assert.match(allSource, /npx course push --module \$\{q\(picked\)\}/);
  });
});

describe('VS Code extension: active-editor preselection', () => {
  // The palette pickers seed from the file open in the editor: its module (or
  // the file itself) moves to the top of the quick pick, marked, so Enter
  // confirms it. The detection is courseLocation and the reorder is
  // promoteActive, both pure and tested in helpers.test.js; these assertions
  // pin that every module/item picker actually routes through them.

  // A top-level function's source, from its declaration to the next top-level
  // function declaration in the same file. Bounded by the file, because "the
  // next declaration" run over the corpus would spill into the file after it.
  function functionBody(name) {
    const declaration = new RegExp(`(?:async )?function ${name}\\(`);
    const source = extensionSources.find((file) => declaration.test(file.text));
    assert.ok(source, `${name} should exist`);
    const match = source.text.match(declaration);
    const start = match.index;
    const next = source.text
      .slice(start + match[0].length)
      .search(/\n(?:async )?function \w+\(/);
    return next === -1
      ? source.text.slice(start)
      : source.text.slice(start, start + match[0].length + next);
  }

  it('imports the pure detection and reorder helpers', () => {
    const pickers = sourceHolding('function activeCourseLocation(');
    const importBlock = pickers.slice(
      0,
      pickers.indexOf("require('./helpers')"),
    );
    assert.match(importBlock, /courseLocation/);
    assert.match(importBlock, /promoteActive/);
  });

  it('reads the active editor in one place, real files only', () => {
    const body = functionBody('activeCourseLocation');
    assert.match(body, /vscode\.window\.activeTextEditor/);
    assert.match(
      body,
      /scheme !== 'file'/,
      'an untitled or virtual document must not seed the pickers',
    );
    assert.match(body, /courseLocation\(workspaceRoot,/);
  });

  it('every module/item picker seeds through promoteActive', () => {
    // Two pickers have nothing to seed from the open editor: pickFormat
    // chooses an output format, and pickTerminal chooses which of the shared
    // terminals a command line goes into. Neither is a module or an item. A new
    // pick* function added without preselection fails here until it routes
    // through promoteActive or earns a place on this allowlist.
    const unseeded = new Set(['pickFormat', 'pickTerminal']);
    const pickers = [
      ...allSource.matchAll(/(?:async )?function (pick\w+)\(/g),
    ].map((m) => m[1]);
    assert.ok(pickers.includes('pickModuleFolder'));
    assert.ok(pickers.includes('pickItemPath'));
    for (const name of pickers) {
      if (unseeded.has(name)) continue;
      const body = functionBody(name);
      assert.match(
        body,
        /promoteActive\(/,
        `${name} must offer the active file's entry first`,
      );
    }
  });

  it("marks the seeded module row as the current file's module", () => {
    const body = functionBody('pickModuleFolder');
    assert.match(body, /activeCourseLocation\(\)/);
    assert.match(body, /current file's module/);
  });

  it('seeds both item steps and hands the module step its seed flag', () => {
    const body = functionBody('pickItemPath');
    assert.match(body, /activeCourseLocation\(\)/);
    assert.match(
      body,
      /pickModuleFolder\('Select module', \{ preselect \}\)/,
      "the module step must inherit the caller's preselect choice",
    );
    assert.match(body, /current file's subsection/);
    const fileMarks = body.match(/'current file'/g) || [];
    assert.equal(
      fileMarks.length,
      2,
      'the entry pick and the subsection pick each mark the current file',
    );
    assert.ok(
      body.indexOf('promoteActive') !== body.lastIndexOf('promoteActive'),
      'both quick-pick steps must route through promoteActive',
    );
  });

  it('keeps tree invocations untouched: resolvers seed only their fallback', () => {
    for (const [resolver, picker] of [
      ['resolveItemPath', 'pickItemPath'],
      ['resolveModuleFolder', 'pickModuleFolder'],
    ]) {
      const body = functionBody(resolver);
      assert.match(
        body,
        new RegExp(`return ${picker}\\(`),
        `${resolver} must reach the seeded picker only without a tree item`,
      );
      assert.ok(
        !body.includes('activeCourseLocation'),
        `${resolver} must not second-guess a tree item with editor detection`,
      );
    }
  });

  it('leaves the merge target unseeded, and only the merge target', () => {
    // The active file is the natural merge source; seeding the target too
    // would point Enter at merging the file into itself.
    const start = allSource.indexOf("register('course.mergeItems'");
    assert.ok(start !== -1);
    const next = allSource.indexOf("\n  register('", start);
    const handler = allSource.slice(start, next);
    const optOuts = allSource.match(/\{ preselect: false \}/g) || [];
    assert.equal(optOuts.length, 1, 'exactly one pick opts out of the seed');
    assert.match(
      handler,
      /Target item \(keeps frontmatter, receives content\)',\s*\{ preselect: false \}/,
    );
  });

  it('seeds the move destination only for an item outside the active module', () => {
    // Seeded unconditionally, Enter would run movetomodule-item onto the
    // item's own module, which appends and gap-closes: a silent move to the
    // end. The decision is seedsDestination (pure, helpers.test.js); this
    // pins that the handler feeds it both locations and passes its verdict,
    // not a literal, to the pick.
    const start = allSource.indexOf("register('course.moveItemToModule'");
    assert.ok(start !== -1);
    const next = allSource.indexOf("\n  register('", start);
    const handler = allSource.slice(start, next);
    assert.match(
      handler,
      /seedsDestination\(\s*courseLocation\(workspaceRoot, itemPath\),\s*activeCourseLocation\(\),?\s*\)/,
    );
    assert.match(
      handler,
      /pickModuleFolder\('Move to which module\?', \{\s*preselect,?\s*\}\)/,
    );
  });
});

describe('VS Code extension: inline push button', () => {
  const pushEntries = packageJson.contributes.menus['view/item/context'].filter(
    (m) => m.command === 'course.pushItem',
  );

  it('hangs off the tree as an inline button', () => {
    assert.ok(
      pushEntries.some((m) => m.group === 'inline'),
      'course.pushItem needs an inline view/item/context entry',
    );
  });

  it('is offered on module rows and nowhere else', () => {
    // The handler pushes treeItem.moduleFolderName, which is the whole module
    // whichever row was clicked, and the CLI has no smaller push than
    // --module. On a page the button therefore promised a per-item push and
    // uploaded every sibling with it.
    assert.ok(pushEntries.length > 0);
    for (const entry of pushEntries) {
      assert.ok(
        admits(entry.when, 'module'),
        `"${entry.when}" has to admit module rows`,
      );
      for (const row of [
        'page',
        'assignment',
        'discussion',
        'quiz',
        'external_url',
        'external_tool',
        'file',
        'subheader',
      ]) {
        assert.ok(
          !admits(entry.when, row),
          `"${entry.when}" offers Push on a ${row} row, which it cannot push alone`,
        );
      }
    }
  });

  it('says which module it pushes, since only the hover shows the title', () => {
    const cmd = packageCommands.find((c) => c.command === 'course.pushItem');
    assert.ok(cmd, 'course.pushItem needs a contributes.commands entry');
    assert.equal(cmd.title, 'Push This Module to Canvas');
    assert.match(cmd.icon, /cloud-upload/);
  });
});

describe('VS Code extension: module-scoped sync family', () => {
  // sync, pull and status all take -m, and for a long time only push was
  // offered on a module row: narrowing a sync to one module meant leaving the
  // tree for the terminal. The three join push in one context-menu group, so a
  // module row carries the same four directions the view title carries for the
  // whole course.
  const family = {
    'course.syncItem': {
      title: 'Sync This Module with Canvas',
      line: 'npx course sync --module',
    },
    'course.pushItem': {
      title: 'Push This Module to Canvas',
      line: 'npx course push --module',
    },
    'course.pullItem': {
      title: 'Pull This Module from Canvas',
      line: 'npx course pull --module',
    },
    'course.statusItem': {
      title: 'Status of This Module',
      line: 'npx course status --module',
    },
  };
  const itemContextMenus = packageJson.contributes.menus['view/item/context'];
  const grouped = itemContextMenus.filter((m) =>
    (m.group || '').startsWith('4_canvas'),
  );

  it('declares and registers all four', () => {
    for (const [id, { title }] of Object.entries(family)) {
      const cmd = packageCommands.find((c) => c.command === id);
      assert.ok(cmd, `${id} needs a contributes.commands entry`);
      assert.equal(cmd.title, title);
      assert.ok(
        extraRegistered.includes(id),
        `${id} should be registered via registerCommand`,
      );
    }
  });

  it('keeps all four out of the palette', () => {
    // Each acts on the row it was clicked, and the palette already carries the
    // whole-course Sync, Push, Pull and Status. A palette entry here would
    // have no row to read and would return silently.
    const hidden = new Set(
      packageJson.contributes.menus.commandPalette.map((m) => m.command),
    );
    for (const id of Object.keys(family)) {
      assert.ok(hidden.has(id), `${id} has no tree row in the palette`);
    }
  });

  it('offers each on module rows and nowhere else', () => {
    // `--module` is the narrowest scope all four share, so on a page row the
    // entry would promise a per-item sync and move every sibling with it.
    for (const entry of grouped) {
      assert.ok(
        admits(entry.when, 'module'),
        `"${entry.when}" has to admit module rows`,
      );
      for (const row of [
        'page',
        'assignment',
        'discussion',
        'quiz',
        'external_url',
        'external_tool',
        'file',
        'subheader',
      ]) {
        assert.ok(
          !admits(entry.when, row),
          `"${entry.when}" offers a module-scoped run on a ${row} row`,
        );
      }
    }
  });

  it('reads as one menu group, in the order the four commands relate', () => {
    // Sync is the whole engine; push and pull are that engine with one side
    // pinned; status is the same run writing nothing. Without the @n suffixes
    // VS Code sorts a group by title, which would file them Pull, Push,
    // Status, Sync: alphabetical, and meaningless.
    assert.deepEqual(
      grouped
        .slice()
        .sort((a, b) => a.group.localeCompare(b.group))
        .map((m) => m.command),
      [
        'course.syncItem',
        'course.pushItem',
        'course.pullItem',
        'course.statusItem',
      ],
    );
  });

  it('leaves push its inline button as well as its menu entry', () => {
    // The group entry is a second contribution, not a move: the hover button
    // is how a module gets pushed without opening a menu at all. VS Code
    // renders the two from one contribution each, because the context menu is
    // built from the groups that are not `inline`.
    //
    // The cost of the pair, recorded here because a manifest cannot carry a
    // comment: "Hide" in a menu is keyed on (menu id, command id), and both
    // entries are view/item/context + course.pushItem. So an author who hides
    // the dropdown row hides the inline button with it. The alternative was a
    // menu whose Canvas group skips the one direction authors use most.
    const pushEntries = itemContextMenus.filter(
      (m) => m.command === 'course.pushItem',
    );
    assert.equal(pushEntries.length, 2);
    assert.ok(pushEntries.some((m) => m.group === 'inline'));
  });

  it('builds a --module line with the folder name quoted', () => {
    // A module folder name is whatever the author (or a Canvas pull) created,
    // so it reaches the terminal through the builder's q(), never raw.
    for (const { line } of Object.values(family)) {
      assert.match(
        allSource,
        new RegExp(
          `runInTerminal\\(\\(q\\) => \`${line} \\$\\{q\\(moduleName\\)\\}\`\\)`,
        ),
        `${line} should be built with a quoted module name`,
      );
    }
  });

  it('streams all four through the terminal, not the silent runner', () => {
    // The output is a report to read as it arrives, and sync stops to ask
    // which side wins when both reordered the module: the CLI's `--order`
    // default is `ask`, and the silent runner would hang on that question
    // where nobody could see it.
    for (const id of Object.keys(family)) {
      const start = allSource.indexOf(`register('${id}'`);
      const next = allSource.indexOf("\n  register('", start);
      const handler = allSource.slice(start, next);
      assert.match(handler, /runInTerminal\(/, `${id} must stream its output`);
      assert.ok(
        !handler.includes('runCli('),
        `${id} must not run through the silent runner`,
      );
    }
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
    const handler = handlerSource('course.search');
    assert.match(handler, /showInputBox/);
    assert.match(handler, /npx course search \$\{q\(keyword\.trim\(\)\)\}/);
  });
});

describe('VS Code extension: open in Canvas', () => {
  const start = allSource.indexOf("register('course.openInCanvas'");
  const next = allSource.indexOf("\n  register('", start);
  const handler = allSource.slice(start, next === -1 ? undefined : next);
  const openEntries = packageJson.contributes.menus['view/item/context'].filter(
    (m) => m.command === 'course.openInCanvas',
  );

  it('registers the command', () => {
    assert.ok(start !== -1);
  });

  it('is offered on every row the handler can address', () => {
    // The handler grew branches for discussions, quizzes and LTI links while
    // the menu clause still listed the four original types, so those rows
    // never got the button the code behind it was ready to serve.
    assert.ok(openEntries.length > 0, 'openInCanvas needs a context entry');
    for (const entry of openEntries) {
      for (const row of [
        'module',
        'page',
        'assignment',
        'discussion',
        'quiz',
        'external_url',
        'external_tool',
        'file',
      ]) {
        assert.ok(
          admits(entry.when, row),
          `"${entry.when}" has to admit ${row} rows`,
        );
      }
      // A subheader is a local folder, and the Canvas text header it becomes
      // has no address of its own — the handler returns on its missing
      // filePath, so the button would do nothing at all.
      assert.ok(
        !admits(entry.when, 'subheader'),
        `"${entry.when}" offers Open in Canvas on a subheader row, which has nothing to open`,
      );
    }
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

  it('deep-links a module row to its anchor on the modules page', () => {
    // The module row used to open the course's modules page flat, leaving the
    // author to find the module in a list that can run to dozens.
    assert.match(handler, /contextValue === 'module'/);
    assert.match(handler, /getModuleCanvasId\(\s*workspaceRoot,/);
    assert.match(handler, /canvasModuleUrl\(baseUrl, courseId, moduleId\)/);
  });
});

describe('VS Code extension: activate and deactivate', () => {
  it('exports activate function', () => {
    assert.match(allSource, /module\.exports\s*=\s*\{[^}]*activate/);
  });

  it('exports deactivate function', () => {
    assert.match(allSource, /module\.exports\s*=\s*\{[^}]*deactivate/);
  });

  it('init command skips workspace validation', () => {
    assert.ok(parseNoValidationCommands(allSource).includes('course.init'));
  });
});

describe('VS Code extension: empty-view welcome', () => {
  // The tree renders empty in three situations, all of them a bare panel
  // before this: `getChildren` returns [] when no workspace folder is open,
  // when the workspace has no course/ directory, and when course/ holds no
  // module folders — which is exactly what Setup leaves behind when the author
  // removes the built-in tutorial module.
  const welcome = packageJson.contributes.viewsWelcome;
  const treeViewId = packageJson.contributes.views['course-manager'][0].id;
  const withFolder = () =>
    welcome.find((e) => e.when === 'workbenchState != empty');
  const withoutFolder = () =>
    welcome.find((e) => e.when === 'workbenchState == empty');

  it('contributes welcome content for the tree view', () => {
    assert.ok(
      Array.isArray(welcome),
      'contributes needs a viewsWelcome section',
    );
    assert.ok(welcome.length > 0);
    for (const entry of welcome) {
      assert.equal(
        entry.view,
        treeViewId,
        `welcome content targets "${entry.view}", not the tree view`,
      );
      assert.ok(
        entry.contents && entry.contents.trim().length > 0,
        'a welcome entry with no contents renders the blank panel again',
      );
    }
  });

  it('says something in both empty states', () => {
    // VS Code cannot tell a missing course/ from an empty one, so the clauses
    // split on the only thing it does know: whether a folder is open at all.
    assert.ok(withoutFolder(), 'the no-folder state needs its own entry');
    assert.ok(withFolder(), 'the folder-open states need their own entry');
  });

  it('offers Setup as a button once a folder is open', () => {
    // A link alone on its line is what VS Code renders as a button; one inside
    // a sentence stays an inline link.
    const button = '[Course: Setup (First-Run Wizard)](command:course.setup)';
    assert.ok(
      withFolder().contents.split('\n').includes(button),
      'the Setup command link has to sit on a line of its own to be a button',
    );
  });

  it('links only commands the manifest declares and the extension registers', () => {
    const linked = [
      ...welcome
        .map((e) => e.contents)
        .join('\n')
        .matchAll(/\(command:([\w.]+)\)/g),
    ].map((m) => m[1]);
    assert.ok(linked.includes('course.setup'));
    for (const id of linked) {
      assert.ok(
        packageCommands.some((c) => c.command === id),
        `the welcome links "${id}", which is not a declared command`,
      );
      assert.ok(
        allRegisteredIds.includes(id),
        `the welcome links "${id}", which extension.js does not register`,
      );
    }
  });

  it('offers no button at all when no folder is open', () => {
    // Every command here runs `npx course` in a terminal opened at the
    // workspace root, and in this state there is none: the run would land in
    // whatever directory VS Code happened to hand the terminal.
    assert.ok(
      !withoutFolder().contents.includes('(command:'),
      'a command button with no workspace runs the CLI somewhere unknown',
    );
  });

  it('points at the same tutorial module Setup names when it removes it', () => {
    // The author who deleted their copy, and the project that never had a
    // course/ to hold one, both still need somewhere to read it.
    const setupSource = fs.readFileSync(
      path.resolve(__dirname, '../../cli/setup.js'),
      'utf-8',
    );
    const url = setupSource.match(
      /const TUTORIAL_UPSTREAM_URL =\s*\n?\s*'([^']+)'/,
    );
    assert.ok(url, 'cli/setup.js should define TUTORIAL_UPSTREAM_URL');
    assert.ok(
      withFolder().contents.includes(`(${url[1]})`),
      `the welcome should link the tutorial at ${url[1]}`,
    );
  });
});

describe('VS Code extension: workspace validation', () => {
  it('defines validateWorkspace function', () => {
    assert.match(allSource, /function validateWorkspace\(\)/);
  });

  it('checks for course/ directory existence', () => {
    assert.match(allSource, /path\.join\(workspaceRoot,\s*'course'\)/);
  });

  it('shows error when no workspace folder is open', () => {
    assert.match(allSource, /showErrorMessage[\s\S]*?No workspace folder open/);
  });

  it('shows warning when course/ directory is missing', () => {
    assert.match(
      allSource,
      new RegExp('showWarningMessage[\\s\\S]*No course/ directory found'),
    );
  });

  it('sends that warning to Setup, the command that creates a course', () => {
    // Init writes .env and .canvas-sync.json and never touches course/, so
    // "Run Course: Init first" pointed at the one command that could not help.
    const warning = allSource.match(
      /'(Canvas Course Builder: No course\/ directory found[^']*)'/,
    );
    assert.ok(warning, 'the missing-course/ warning should exist');
    assert.match(warning[1], /Course: Setup \(First-Run Wizard\)/);
    assert.ok(
      !warning[1].includes('Course: Init'),
      'Init configures Canvas credentials, not course/',
    );
  });

  it('does not warn Setup about the course/ it is about to create', () => {
    assert.ok(
      parseNoValidationCommands(allSource).includes('course.setup'),
      'the warning names Setup, so firing it during a Setup run is circular',
    );
  });

  it('describes itself as warning, not erroring, on a missing course/', () => {
    // The docstring claimed an error, which read as a hard gate on course/. The
    // gate is on the workspace folder alone: a missing course/ draws a warning
    // and the root comes back regardless, which is what lets Setup run.
    const at = allSource.indexOf('function validateWorkspace()');
    const doc = allSource.slice(allSource.lastIndexOf('/**', at), at);
    assert.match(doc, /warning/i, 'the docstring has to name the warning');
    assert.ok(
      !/error message if not found/i.test(doc),
      'the docstring must not promise an error for a missing course/',
    );
  });
});

describe('VS Code extension: CLI runner', () => {
  // The runner file. It used to be a section between two headings inside
  // extension.js, delimited the same way and read for the same reason: the
  // extension quotes `npx course …` command lines all over the place, so the
  // assertions below about what the runner does *not* spawn only mean anything
  // against the runner itself.
  const runner = sourceHolding('function execCli(');

  it('defines a silent runCli helper using execFile', () => {
    assert.ok(runner.length > 0, 'the runner section has to be findable');
    assert.match(allSource, /function runCli\(/);
    assert.match(allSource, /cp\.execFile\(/);
  });

  it('never asks execFile for a shell', () => {
    // This path is safe for one reason: there is no shell on it. Every module
    // name, item title, `--points` and path the author typed goes to the CLI as
    // one argv entry, whatever characters are in it, and nothing needs quoting
    // because nothing is parsed. `shell: true` turns all twelve silent
    // subcommands into shell lines in a single word, and none of the quoting
    // rules in this file would notice, because there is no command line written
    // down anywhere to read. Measured: a module named `01-intro; touch FILE`
    // creates the file with that option and does not without it.
    //
    // Not a hypothetical flag either. `cliEntryPoint`'s own comment explains
    // that Windows cannot spawn npx.cmd without a shell — the exact reasoning
    // that walks a contributor to this option.
    //
    // Read across every file the extension ships, for the same reason the
    // quoting rules are: which file the spawn lives in is not part of the rule.
    const spawns = scannedSources.flatMap((source) =>
      source.ast.calls
        .filter(
          (node) =>
            node.callee.type === 'MemberExpression' &&
            node.callee.property.type === 'Identifier' &&
            node.callee.property.name === 'execFile',
        )
        .map((node) => ({ source, node })),
    );
    assert.ok(spawns.length > 0, 'the runner has to spawn the CLI somewhere');
    for (const { source, node } of spawns) {
      let options = node.arguments[2];
      if (options && options.type === 'Identifier') {
        // Built just above the call and passed by name. Followed by name to
        // its declaration, and refused when the name is declared more than
        // once, because then this cannot say which object was passed.
        const declared = source.ast.declarators.filter(
          (declarator) =>
            declarator.id.type === 'Identifier' &&
            declarator.id.name === options.name,
        );
        assert.equal(
          declared.length,
          1,
          `the execFile options in ${source.name} are passed as ` +
            `\`${options.name}\`, which is declared ${declared.length} ` +
            'times: spell them out at the call',
        );
        options = declared[0].init;
      }
      assert.ok(
        options && options.type === 'ObjectExpression',
        `the execFile options at ${source.name}:${node.loc.start.line} have ` +
          'to be an object this test can read',
      );
      for (const property of options.properties) {
        assert.notEqual(
          property.type,
          'SpreadElement',
          'a spread into the execFile options could carry a shell in from ' +
            'anywhere: spell the options out',
        );
        const key =
          property.key.type === 'Identifier'
            ? property.key.name
            : String(property.key.value);
        assert.notEqual(
          key,
          'shell',
          'a shell here would parse every value the author typed. If a ' +
            'program cannot be spawned without one, spawn a different ' +
            'program, or quote the line the way runInTerminal does.',
        );
      }
    }
  });

  it('runs node on the CLI in the workspace, and nothing else', () => {
    // The fallback that used to sit here spawned `npx` when cli/index.js was
    // missing. On Windows that program is npx.cmd, which libuv will not
    // resolve from PATH and Node will not run without a shell, so the fallback
    // could only ever produce an ENOENT naming a program the author never
    // typed. The extension ships inside the template, so the CLI is either
    // right there or the open folder is not a course project.
    assert.match(runner, /cliEntryPoint\(workspaceRoot\)/);
    assert.match(runner, /cp\.execFile\(\s*process\.execPath/);
    assert.ok(
      !runner.includes("'npx'"),
      'the silent runner must not shell out to npx',
    );
    assert.ok(
      runner.indexOf('cliEntryPoint(') < runner.indexOf('cp.execFile('),
      'the missing-CLI refusal has to come before the spawn',
    );
    assert.match(
      runner,
      /showErrorMessage\(\s*'[^']*cli\/index\.js[^']*'/,
      'the refusal has to name the file it could not find',
    );
  });

  it('tells the child to behave as node, rather than hoping it was told', () => {
    // process.execPath in a desktop extension host is the Electron helper
    // binary the host itself runs as, and it only behaves as node when
    // ELECTRON_RUN_AS_NODE is in its environment. Measured on a live host:
    // that variable is not in the extension host's OS-level environment. What
    // supplies it is VS Code's own bootstrap writing it into process.env at
    // runtime — an implementation detail of a minified bundle, which a
    // filtered environment would drop without a word.
    assert.match(runner, /env: cliChildEnv\(process\.env\)/);
  });

  it('gives the run more room than the one-megabyte default', () => {
    // Past maxBuffer Node kills the child, so the overflow arrives as a
    // truncated buffer and an error over a command that had already renamed
    // half a directory.
    assert.match(runner, /maxBuffer: CLI_MAX_BUFFER/);
    const size = allSource.match(
      /const CLI_MAX_BUFFER = (\d+) \* 1024 \* 1024;/,
    );
    assert.ok(size, 'CLI_MAX_BUFFER has to be written in megabytes');
    assert.ok(
      Number(size[1]) > 1,
      `CLI_MAX_BUFFER is ${size[1]} MB, which is no better than the default`,
    );
  });

  it('sends every run through the queue, never straight to execFile', () => {
    // Two structural commands that overlap both renumber a directory and both
    // rewrite .canvas-sync.json. A second call site for execCli would be a way
    // around the only thing stopping that.
    assert.match(runner, /const cliQueue = createSerialQueue\(\)/);
    assert.match(runner, /cliQueue\(\(\) => execCli\(args\)\)/);
    assert.equal(
      (runner.match(/execCli\(/g) || []).length,
      2,
      'execCli should appear twice: its declaration and the queued call',
    );
  });

  it('kills a run that hangs instead of hanging with it', () => {
    // Nothing on this path waits for a network — none of the subcommands the
    // silent runner invokes builds a Canvas client — so a run is local file
    // work and node's own startup, under a second on this project. A child
    // that outlasts minutes is a child that is never coming back, and without
    // a timeout the command it belongs to waits for it forever, silently,
    // with every queued command behind it.
    assert.match(runner, /timeout: CLI_TIMEOUT_MS/);
    const limit = allSource.match(
      /const CLI_TIMEOUT_MS = (\d+) \* 60 \* 1000;/,
    );
    assert.ok(limit, 'CLI_TIMEOUT_MS has to be written in minutes');
    assert.ok(
      Number(limit[1]) >= 1,
      `CLI_TIMEOUT_MS is ${limit[1]} minute(s), close enough to a real run to ` +
        'kill one halfway through a renumber',
    );
  });

  it('settles the run even when reporting it throws', () => {
    // The queue's next turn waits on this promise, so a throw that skipped
    // resolve() would stop every later structural command for the session.
    // Demonstrated before the guard existed: a stdout the callback could not
    // read left the command after it never running at all.
    const callback = runner.slice(
      runner.indexOf('(err, stdout, stderr) => {'),
      runner.indexOf('function settle('),
    );
    assert.ok(
      callback.length > 0,
      'the completion callback has to be findable',
    );
    assert.match(callback, /try \{/, 'the reporting has to be guarded');
    assert.match(
      callback,
      /catch \(error\) \{[\s\S]*?resolve\(false\)/,
      'and the guard has to settle the run, not merely log',
    );
  });

  it('shows progress for a slow run, and only for a slow one', () => {
    // A queued command has not started at all, and a batch drop runs one CLI
    // per dragged row, so the wait is exactly when an author needs telling.
    // A spinner on every rename would be noise, hence the delay; ten spinners
    // for a ten-row drop would be the same noise, hence the shared gate.
    assert.match(runner, /const trackProgress = createProgressGate\(/);
    assert.match(runner, /trackProgress\(run, /);
    assert.match(runner, /vscode\.window\.withProgress\(/);
    assert.match(runner, /location: vscode\.ProgressLocation\.Window/);
    assert.match(runner, /setTimeout\(announce, PROGRESS_AFTER_MS\)/);
    assert.match(runner, /return \(\) => clearTimeout\(timer\)/);

    // The delay needs a floor as much as the buffer needs a ceiling. At zero
    // the call is still there, the spinner still opens and closes, and every
    // rename flashes one — the noise the delay exists to prevent, with nothing
    // above failing. A real run is a few hundred milliseconds, so the floor
    // sits above that.
    const delay = allSource.match(/const PROGRESS_AFTER_MS = (\d+);/);
    assert.ok(delay, 'PROGRESS_AFTER_MS has to be a plain number');
    assert.ok(
      Number(delay[1]) >= 250,
      `PROGRESS_AFTER_MS is ${delay[1]}ms, short enough to flash a spinner on ` +
        'commands that finish immediately',
    );
  });

  it('surfaces a warning a successful run wrote to stderr', () => {
    // The silent runner drives every delete and the merge, and it used to
    // append a successful run's stderr to a channel it never reveals. That is
    // where `delete-item` and `delete-module` name the Canvas objects a
    // renumber collision put out of reach, so the one warning in this tool
    // that cannot be recovered from was the one nobody saw.
    //
    // Cut from the runner section, and from its LAST failure rather than its
    // first. The runner refuses a workspace with no CLI before it reaches
    // execFile, and settles a run whose reporting threw, so `resolve(false)`
    // appears three times here; starting at the first would swallow the error
    // branch, whose own notification carries a 'Show Log' button, and leave
    // half this test passing on the branch it is not about. Whole-file offsets
    // do not work either: the preview poll further down resolves false twice
    // more. Both ends are checked, because `indexOf` answers a question it
    // could not find with -1, and `slice(start, -1)` quietly widens.
    const failureAt = runner.lastIndexOf('resolve(false);');
    const successAt = runner.indexOf('resolve(true);');
    assert.ok(
      failureAt !== -1 && successAt !== -1 && failureAt < successAt,
      'the runner has to fail before it succeeds for this slice to be the ' +
        'success branch',
    );
    const success = runner.slice(failureAt, successAt);
    assert.match(
      success,
      /showWarningMessage/,
      'the success branch has to surface stderr, not only log it',
    );

    // The button, not the text. The handler under the call compares
    // `choice === 'Show Log'`, so a plain search of the branch passes on that
    // comparison with the button gone — measured, it did. Reading the call's
    // own argument list instead is what tells them apart, and it survives
    // prettier collapsing the call onto one line.
    const callAt = success.indexOf('showWarningMessage(');
    const argumentsEnd = success.indexOf('.then(', callAt);
    assert.ok(
      callAt !== -1 && argumentsEnd !== -1,
      'the warning call and the handler that follows it have to be findable',
    );
    assert.match(
      success.slice(callAt, argumentsEnd),
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
    // The whole pool, unfiltered: the line is quoted for whichever terminal
    // comes back, so none of them has to be held out of the running.
    assert.match(allSource, /pickTerminal\(terminalPool, TERMINAL_BASE_NAME\)/);
    assert.ok(
      !allSource.includes('getSharedTerminal'),
      'the by-name shared-terminal lookup must be gone',
    );
  });

  it('marks the terminal busy before showing it and sending the text', () => {
    const start = allSource.indexOf('function runInTerminal(');
    assert.ok(start !== -1);
    // The whole function, not a fixed window: it grows, and a window that ran
    // out before the send turned this into a test of nothing.
    const handler = allSource.slice(start, allSource.indexOf('\n}\n', start));
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
    assert.match(allSource, /terminalPool\.splice\(choice\.index, 1\)/);
    assert.match(allSource, /terminalPool\.push\(entry\)/);
  });

  it('flips busy on the shell integration execution events', () => {
    assert.match(allSource, /onDidStartTerminalShellExecution\(\(event\)/);
    assert.match(allSource, /onDidEndTerminalShellExecution\(\(event\)/);
    assert.match(allSource, /onDidChangeTerminalShellIntegration\(\(event\)/);
  });

  it('guards the 1.93 events so an older host degrades instead of crashing', () => {
    assert.match(
      allSource,
      /typeof vscode\.window\.onDidStartTerminalShellExecution === 'function'/,
    );
    assert.match(
      allSource,
      /typeof vscode\.window\.onDidChangeTerminalShellIntegration === 'function'/,
    );
  });

  it('prunes closed terminals from the pool', () => {
    assert.match(allSource, /onDidCloseTerminal\(\(terminal\)/);
    assert.match(
      allSource,
      /terminalPool\.filter\(\(e\) => e\.terminal !== terminal\)/,
    );
  });

  it('adopts pool-named terminals from before a window reload as busy', () => {
    const wiring = sectionSource('Terminal pool bookkeeping');
    assert.match(
      wiring,
      /terminalNumber\(terminal\.name, TERMINAL_BASE_NAME\) !== null/,
    );
    assert.match(wiring, /busy: true/);
  });
});

// --- Terminal argument quoting -------------------------------------------
//
// Every value interpolated into a terminal command line has to be quoted for
// the shell that will run it: a search term is whatever the author typed, and a
// folder name is whatever the author (or a Canvas pull) created — `01-intro;
// rm -rf ~` is a legal directory name. The quoting rules are shellQuote and
// shellFlavour in helpers.js, tested there. Here: that no call site can slip a
// value past them, and that runInTerminal really quotes for the terminal it
// picks.

const {
  pickTerminal,
  shellFlavour,
  shellQuote,
} = require('../../.vscode/extensions/course-manager/helpers');

/**
 * The source with comments removed. Scanning the raw text would match command
 * lines written in doc comments, which look exactly like the real thing.
 */
function stripComments(source) {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (c === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? source.length : end + 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      out += c;
      i++;
      while (i < source.length) {
        if (source[i] === '\\') {
          out += source.slice(i, i + 2);
          i += 2;
          continue;
        }
        out += source[i];
        if (source[i] === c) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** The argument text of every `callee(...)` call, parens and quotes balanced. */
function callArguments(source, callee) {
  const args = [];
  const needle = `${callee}(`;
  let at = source.indexOf(needle);
  while (at !== -1) {
    if (source.slice(Math.max(0, at - 9), at) === 'function ') {
      at = source.indexOf(needle, at + needle.length);
      continue;
    }
    let i = at + needle.length;
    const start = i;
    let depth = 1;
    while (i < source.length && depth > 0) {
      const c = source[i];
      if (c === '(') depth++;
      else if (c === ')') depth--;
      else if (c === '`' || c === "'" || c === '"') {
        i++;
        while (i < source.length && source[i] !== c) {
          if (source[i] === '\\') i++;
          i++;
        }
      }
      i++;
    }
    args.push(
      source
        .slice(start, i - 1)
        .replace(/,\s*$/, '')
        .trim(),
    );
    at = source.indexOf(needle, i);
  }
  return args;
}

/** Every `${...}` of a template literal's body, braces balanced. */
function interpolationsOf(template) {
  const found = [];
  for (let i = 0; i < template.length - 1; i++) {
    if (template[i] !== '$' || template[i + 1] !== '{') continue;
    let depth = 1;
    let j = i + 2;
    const start = j;
    while (j < template.length && depth > 0) {
      if (template[j] === '{') depth++;
      else if (template[j] === '}') depth--;
      j++;
    }
    found.push({
      expression: template.slice(start, j - 1),
      // What sits against the hole on either side. A quote there is a second,
      // hand-written layer of quoting around an already quoted value.
      before: template[i - 1] ?? '',
      after: template[j] ?? '',
    });
    i = j - 1;
  }
  return found;
}

/** Is the expression exactly one `q(...)` call, and nothing wrapped around it? */
function isQuoteCall(expression) {
  if (!expression.startsWith('q(')) return false;
  let depth = 0;
  for (let i = 1; i < expression.length; i++) {
    const c = expression[i];
    if (c === "'" || c === '"' || c === '`') {
      i++;
      while (i < expression.length && expression[i] !== c) {
        if (expression[i] === '\\') i++;
        i++;
      }
      continue;
    }
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return i === expression.length - 1;
    }
  }
  return false;
}

/**
 * The extension's own syntax tree, and the two node kinds a command line can be
 * built out of.
 *
 * Parsed through the linter, which is the route `cli-contract.test.js` takes to
 * the same object. Going through a parser at all is the point: a command line
 * has to be found by what it says, not by the name of the function it is handed
 * to. `previewTerminal.sendText(...)`, `previewTerminal['sendText'](...)` and
 * `previewTerminal.shellIntegration.executeCommand(...)` all reach a shell, and
 * a scan that knows only the first spelling reports the other two as clean.
 */
function parseExtension(source, filename) {
  const templates = [];
  const sums = [];
  const calls = [];
  const declarators = [];
  let sourceCode = null;
  const messages = new Linter().verify(
    source,
    {
      plugins: {
        quoting: {
          rules: {
            capture: {
              create(context) {
                sourceCode = context.sourceCode;
                return {
                  TemplateLiteral(node) {
                    templates.push(node);
                  },
                  BinaryExpression(node) {
                    if (node.operator === '+') sums.push(node);
                  },
                  CallExpression(node) {
                    calls.push(node);
                  },
                  VariableDeclarator(node) {
                    declarators.push(node);
                  },
                };
              },
            },
          },
        },
      },
      rules: { 'quoting/capture': 'error' },
      languageOptions: { ecmaVersion: 'latest', sourceType: 'commonjs' },
    },
    filename,
  );
  const fatal = messages.find((message) => message.fatal);
  assert.ok(!fatal, `${filename} did not parse: ${fatal && fatal.message}`);
  assert.ok(sourceCode, `${filename} produced no source code object`);
  return { templates, sums, calls, declarators };
}

/** What a command line says, whoever ends up running it. */
const COMMAND_LINE = /npx course |npm start/;

/**
 * Does this template say a command line out loud?
 *
 * Deliberately eager. Over-selecting costs nothing: a template that is not a
 * command line passes the rules below without noticing them. Under-selecting
 * costs everything, because a template this does not pick is never examined at
 * all — not for quoting, not for hand-written quotes, not for anything.
 *
 * Whitespace runs are collapsed first, so `npx  course` and a tab between the
 * words read the same as one space; both were spellings that hid a sink. The
 * quasis are read joined tightly as well as spaced, so a hole in the middle of
 * the name (`npx cours${x}e ...`) is put back together by the tight join.
 *
 * What this cannot do is see a name whose missing piece is inside the hole
 * itself: `npx cours${e} search` says only "npx cours" out loud, and no reading
 * of the fixed text recovers the rest. That is what the sink selector below is
 * for, and why there are two.
 */
function namesACommandLine(node) {
  const parts = node.quasis.map((quasi) => quasi.value.cooked ?? '');
  return [parts.join(''), parts.join(' ')].some((text) =>
    COMMAND_LINE.test(text.replace(/\s+/g, ' ')),
  );
}

/** Terminal APIs that run whatever they are given. */
const TERMINAL_METHODS = new Set(['sendText', 'executeCommand']);

/** The name a callee reaches for, however it is written. */
function calleeMember(node) {
  if (node.callee.type !== 'MemberExpression') return null;
  const property = node.callee.property;
  if (property.type === 'Identifier' && !node.callee.computed) {
    return property.name;
  }
  return property.type === 'Literal' ? String(property.value) : null;
}

/**
 * Every template handed to something that runs it, whatever the template says.
 *
 * The other half of the selection, and the half that does not care about
 * spelling: a line typed into a terminal is examined because of where it is
 * going, not because of what it managed to spell. Computed access counts
 * (`t['sendText']`), because it reaches the same method.
 *
 * Neither selector is complete on its own. This one misses a command line
 * handed to a helper of one's own devising; the content one misses a command
 * name assembled out of pieces. Between them, a line has to be both unspoken
 * and unsent to go unread, and the two fail differently enough that a change
 * papering over one tends to be caught by the other.
 */
function sinkTemplates(calls) {
  const found = [];
  for (const node of calls) {
    const member = calleeMember(node);
    const isSink =
      (member && TERMINAL_METHODS.has(member)) ||
      (node.callee.type === 'Identifier' &&
        node.callee.name === 'runInTerminal');
    if (!isSink) continue;
    for (const argument of node.arguments) {
      if (argument.type === 'TemplateLiteral') found.push(argument);
      if (
        argument.type === 'ArrowFunctionExpression' &&
        argument.body.type === 'TemplateLiteral'
      ) {
        found.push(argument.body);
      }
    }
  }
  return found;
}

/**
 * One scanned source file: its syntax tree, its stripped text, and everything
 * the shell rules read out of it.
 *
 * Every file the extension ships, not one of them. Until this walked, those
 * rules read `extension.js` alone, so moving a builder, a `sendText` or the
 * `execFile` call into a second file would have taken it out of every one of
 * them with the whole suite green — and `cli-contract.test.js`, which does
 * walk, would not have noticed either, because it checks subcommands and flags
 * rather than shells and quoting.
 */
function scanSource(source) {
  const code = stripComments(source.text);
  const ast = parseExtension(source.text, source.name);
  const { templates: allTemplates, sums, calls } = ast;

  // The rule, in one sentence a contributor can hold: every value a command
  // line carries is quoted, by the `q` handed to the builder.
  //
  // There is no list of names that may go unquoted. The previous shape of this
  // file kept one, and the proof behind it was walked around twice: once by a
  // parameter of the same name, which is a binding a search for assignments
  // cannot see, and once by an unanchored pattern, which exempts whatever is
  // appended to the line it matched. A list of exemptions has to be proved, a
  // proof has to be maintained, and neither is something a contributor can
  // hold in their head while making an ordinary change. Quoting travels with
  // the value instead, so extracting a helper or renaming a variable stays an
  // ordinary refactor.
  const commandTemplates = [
    ...new Set([
      ...allTemplates.filter(namesACommandLine),
      ...sinkTemplates(calls),
    ]),
  ];
  const templates = commandTemplates.map((node) =>
    source.text.slice(node.range[0] + 1, node.range[1] - 1),
  );

  return {
    name: source.name,
    text: source.text,
    code,
    ast,
    sums,
    templates,
    builders: callArguments(code, 'runInTerminal'),
    sent: callArguments(code, '.sendText'),
    interpolations: templates
      .flatMap(interpolationsOf)
      .map((hole) => ({ ...hole, where: source.name })),
  };
}

const scannedSources = extensionSources.map(scanSource);

describe('VS Code extension: terminal argument quoting', () => {
  const builders = scannedSources.flatMap((source) => source.builders);
  const interpolations = scannedSources.flatMap(
    (source) => source.interpolations,
  );

  it('strips comments without eating the code it has to scan', () => {
    // Asserted over the corpus rather than over one file, so that moving the
    // runner or the command table to another file leaves this positive control
    // standing instead of quietly turning it into a check on nothing.
    const code = scannedSources.map((source) => source.code).join('\n');
    assert.ok(code.includes('function runInTerminal(build) {'));
    assert.ok(
      !code.includes('rm -rf ~'),
      'the doc comment that names a hostile folder should be gone',
    );
    assert.ok(code.includes("'npx course setup'"), 'strings must survive');
  });

  it('finds the command lines it is meant to be checking', () => {
    assert.ok(
      scannedSources.length >= MINIMUM_SOURCES,
      `only ${scannedSources.length} extension sources were scanned`,
    );
    assert.ok(
      builders.length >= 8,
      `found ${builders.length} runInTerminal calls`,
    );
    assert.ok(
      interpolations.length >= 6,
      `expected several interpolations, found ${interpolations.length}`,
    );
  });

  it('lets only a builder reach runInTerminal, never a built string', () => {
    // The shape is `(q) => \`…\`` or `() => name`. A concatenation —
    // `'npx course push --module ' + moduleName` — cannot match, which is the
    // point: it would carry an unquoted value past every other check here.
    for (const argument of builders) {
      assert.match(
        argument,
        /^\((?:q)?\) =>\s*(`[\s\S]*`|[A-Za-z_$][\w$]*)$/,
        `runInTerminal argument is not a template builder: ${argument}`,
      );
    }
  });

  it('quotes every value a command line carries', () => {
    for (const { expression, where } of interpolations) {
      // The one multi-value form: every path quoted, then joined.
      if (/^[A-Za-z_$][\w$]*\.map\(q\)\.join\(' '\)$/.test(expression))
        continue;
      assert.ok(
        isQuoteCall(expression),
        `\${${expression}} reaches a shell unquoted, in ${where}. Every value ` +
          'in a command line goes through the q() the builder is handed: write ' +
          `\${q(${expression})}. If there is no q in scope, the line is being ` +
          'built somewhere that does not know which shell will run it, and ' +
          'that is the thing to fix.',
      );
    }
  });

  it('builds a command line as a template, never by adding strings', () => {
    // A concatenation carries values past every check here: the fixed text is
    // split across operands, so nothing reads as a command line, and there is
    // no hole for the interpolation rule to look at.
    for (const source of scannedSources) {
      for (const node of source.sums) {
        const text = source.text.slice(...node.range);
        assert.ok(
          !COMMAND_LINE.test(text),
          `a command line is being built by concatenation at ` +
            `${source.name}:${node.loc.start.line}: write it as one template ` +
            'literal, so the values in it can be seen and quoted',
        );
      }
    }
  });

  it('writes no quotes of its own around an already quoted value', () => {
    // `"${q(path)}"` passes every other check here and is an injection under
    // cmd: q() emits `^"…^"`, whose caret-escaped quotes leave the hand-written
    // pair as the only real ones, so cmd enters a quoted section it never
    // leaves and a `&` inside the value goes live. The quoting function decides
    // what quotes a value needs; the template contributes none.
    for (const { expression, before, after, where } of interpolations) {
      for (const [side, character] of [
        ['before', before],
        ['after', after],
      ]) {
        assert.ok(
          !['"', "'", '`'].includes(character),
          `a ${character} sits ${side} \${${expression}} in ${where}, quoting an already quoted value`,
        );
      }
    }
  });

  it('quotes through the one function that knows the terminal', () => {
    // `shellQuote` is called in exactly one place, `quoterFor`, which is handed
    // the flavour stamp of the terminal that is about to receive the line. A
    // second call site anywhere else — in any file the extension ships — would
    // be a handler quoting for a shell of its own choosing, which is how a line
    // quoted for PowerShell ends up typed into cmd.
    //
    // The declaration in `helpers.js` is not a call site, and is the only thing
    // the lookbehind takes out.
    const sites = scannedSources.flatMap((source) =>
      [...source.code.matchAll(/(?<!function )shellQuote\(/g)].map((match) => ({
        source,
        index: match.index,
      })),
    );
    assert.equal(
      sites.length,
      1,
      `shellQuote should have one call site, found ${sites
        .map((site) => site.source.name)
        .join(', ')}`,
    );
    const { source, index } = sites[0];
    const quoter = source.code.indexOf('function quoterFor(');
    const quoterEnd = source.code.indexOf('\n}\n', quoter);
    assert.ok(quoter !== -1, `quoterFor should be findable in ${source.name}`);
    assert.ok(index > quoter && index < quoterEnd);
  });

  it('sends nothing to a terminal that has not been read', () => {
    // The second layer, and it is about the shape of the argument rather than
    // its text. The rules above check the values inside a command line; this
    // one refuses a `sendText(answer)` that carries no command line at all,
    // which they would have nothing to look at.
    //
    // Deliberately not a list of the exact strings in the file. That is what it
    // used to be, and it made the preview line unrefactorable: extracting a
    // helper or renaming the variable failed a test whose message named
    // neither, with no green path an ordinary change could take.
    for (const source of scannedSources) {
      for (const argument of source.sent) {
        const namesACommandLine =
          /^[`'"]/.test(argument) && COMMAND_LINE.test(argument);
        assert.ok(
          namesACommandLine || argument === 'commandStr',
          `${argument} is typed into a terminal in ${source.name}, and it ` +
            'neither spells out a command line here nor comes from ' +
            'runInTerminal. Build the line as a template literal so its ' +
            'values can be seen and quoted.',
        );
      }
    }
  });
});

describe('VS Code extension: runInTerminal quotes for the terminal it picks', () => {
  // Source assertions cannot show that the flavour used is the flavour of the
  // terminal that receives the line, so runInTerminal itself is lifted out of
  // the file and run against the real pickTerminal and the real shellQuote,
  // with only vscode and the pool stubbed.
  function loadRunInTerminal(overrides = {}) {
    // Both functions are lifted, not just the one under test: `quoterFor` is
    // where the flavour meets the value, so a copy written here would be a
    // copy under test.
    const lift = (name) => {
      const start = allSource.indexOf(`function ${name}(`);
      assert.notEqual(start, -1, `${name} should be findable in the source`);
      return allSource.slice(start, allSource.indexOf('\n}\n', start) + 2);
    };
    const source = `${lift('quoterFor')}\n${lift('runInTerminal')}`;
    const typed = [];
    const created = [];
    const errors = [];
    const vscode = {
      window: {
        createTerminal: (options) => {
          created.push(options.name);
          return {
            name: options.name,
            show() {},
            sendText: (text) => typed.push(text),
          };
        },
        showErrorMessage: (message) => errors.push(message),
      },
    };
    const deps = {
      vscode,
      pickTerminal,
      shellQuote,
      TERMINAL_BASE_NAME: 'CCB',
      workspaceRoot: '/ws',
      currentFlavour: () => 'posix',
      terminalPool: [],
      ...overrides,
    };
    const names = Object.keys(deps);
    const factory = new Function(...names, `${source}\nreturn runInTerminal;`);
    return {
      run: factory(...names.map((name) => deps[name])),
      pool: deps.terminalPool,
      typed,
      created,
      errors,
    };
  }

  /** A pooled terminal that records what is typed into the shared log. */
  const pooled = (name, flavour, busy, typed) => ({
    terminal: { name, show() {}, sendText: (text) => typed.push(text) },
    name,
    busy,
    awaitingStart: false,
    flavour,
  });

  it('quotes a value that would have been safe bare', () => {
    // The obvious optimisation inside `quoterFor` is a fast path: leave a value
    // of ordinary characters alone and quote only what needs it. It is refused
    // deliberately, because "every value is quoted" is a rule a reader can
    // check by looking, and "every value that needs it" is one they cannot.
    //
    // Stated here rather than left to luck. Such a fast path did fail the suite
    // before this test existed, but only because two other tests happened to
    // assert on `3000` and `exports/toc.md`, which it would have let through —
    // a fixture choice, not a decision.
    const { run, typed } = loadRunInTerminal();
    run((q) => `npx course export --format ${q('pdf')}`);
    assert.deepEqual(typed, ["npx course export --format 'pdf'"]);
  });

  it('stamps a new terminal with the flavour it was created under', () => {
    const h = loadRunInTerminal({ currentFlavour: () => 'powershell' });
    h.run((q) => `npx course search ${q("it's")}`);
    assert.deepStrictEqual(h.created, ['CCB']);
    assert.equal(h.pool[0].flavour, 'powershell');
    assert.deepStrictEqual(h.typed, ["npx course search 'it''s'"]);
  });

  it('quotes for the reused terminal, not for the current profile', () => {
    // The regression this shape exists for: the author started a terminal
    // under Command Prompt and has since switched the default to PowerShell.
    const typed = [];
    const pool = [pooled('CCB', 'cmd', false, typed)];
    const h = loadRunInTerminal({
      terminalPool: pool,
      currentFlavour: () => 'powershell',
      ...{},
    });
    h.run((q) => `npx course search ${q('a & calc')}`);
    assert.deepStrictEqual(h.created, [], 'the idle terminal is reused');
    assert.deepStrictEqual(typed, ['npx course search ^"a ^& calc^"']);
  });

  it('quotes for the stamped terminal even at the cap', () => {
    // Five idle cmd terminals and a profile now set to PowerShell: this is the
    // case that used to type PowerShell quoting into a cmd terminal, because
    // hiding the stale entries drove the pool to its cap and the cap fallback
    // handed one back anyway.
    const typed = [];
    const pool = [1, 2, 3, 4, 5].map((n) =>
      pooled(n === 1 ? 'CCB' : `CCB ${n}`, 'cmd', false, typed),
    );
    const h = loadRunInTerminal({
      terminalPool: pool,
      currentFlavour: () => 'powershell',
    });
    h.run((q) => `npx course search ${q('a & calc')}`);
    assert.deepStrictEqual(h.created, []);
    assert.deepStrictEqual(typed, ['npx course search ^"a ^& calc^"']);
  });

  it('guesses the current flavour for an adopted terminal', () => {
    // Five adopted terminals: all busy, none stamped, so the cap fallback
    // reuses the most recent one. Its shell is unknowable, so the current
    // profile is the guess — and it must be a guess that still quotes.
    const typed = [];
    const pool = [1, 2, 3, 4, 5].map((n) =>
      pooled(n === 1 ? 'CCB' : `CCB ${n}`, null, true, typed),
    );
    const h = loadRunInTerminal({
      terminalPool: pool,
      currentFlavour: () => 'csh',
    });
    h.run((q) => `npx course search ${q('wow!!')}`);
    assert.deepStrictEqual(h.created, []);
    assert.deepStrictEqual(typed, ["npx course search 'wow\\!\\!'"]);
  });

  it('types nothing at all when the value cannot be represented', () => {
    // A module folder named with a line break. csh would run the second line
    // as a command, so the line is never built and never sent.
    const typed = [];
    const pool = [pooled('CCB', 'csh', false, typed)];
    const h = loadRunInTerminal({
      terminalPool: pool,
      currentFlavour: () => 'csh',
    });
    h.run((q) => `npx course push --module ${q('01-intro\ntouch /tmp/pwned')}`);
    assert.deepStrictEqual(typed, [], 'nothing may be typed');
    assert.deepStrictEqual(h.created, [], 'and no terminal may be created');
    assert.equal(h.errors.length, 1);
    assert.match(h.errors[0], /line break/);
    assert.match(h.errors[0], /Nothing was run/);
    // This terminal was opened here, so its shell is known and the message
    // says csh without hedging.
    assert.ok(!/guess/.test(h.errors[0]), h.errors[0]);
    assert.equal(
      pool[0].busy,
      false,
      'the terminal stays free for the next run',
    );
  });

  it('does not claim to know the shell of an adopted terminal', () => {
    // Five adopted terminals, so the cap fallback reuses one, and its flavour
    // is the current profile standing in for a shell nobody here knows. The
    // refusal is still right; naming that shell as fact would not be.
    const typed = [];
    const pool = [1, 2, 3, 4, 5].map((n) =>
      pooled(n === 1 ? 'CCB' : `CCB ${n}`, null, true, typed),
    );
    const h = loadRunInTerminal({
      terminalPool: pool,
      currentFlavour: () => 'powershell',
    });
    h.run((q) => `npx course search ${q('a\nb')}`);
    assert.deepStrictEqual(typed, []);
    assert.equal(h.errors.length, 1);
    assert.match(h.errors[0], /line break/);
    assert.match(h.errors[0], /its shell is a guess/);
  });

  it('does not create a terminal for a refused value', () => {
    const h = loadRunInTerminal({ currentFlavour: () => 'cmd' });
    h.run((q) => `npx course search ${q('a\nb')}`);
    assert.deepStrictEqual(h.created, []);
    assert.deepStrictEqual(h.pool, []);
    assert.deepStrictEqual(h.typed, []);
    assert.equal(h.errors.length, 1);
  });
});

describe('VS Code extension: the flavour the quoting is done for', () => {
  // currentFlavour is the single place the shell is read, and it is the one
  // piece the behavioural tests above cannot cover, because they inject it. So
  // it is run here for real, against the real shellFlavour, with vscode and
  // process stubbed. Without this, `return 'posix'` would be a green suite and
  // POSIX single quotes typed into PowerShell or cmd.
  function currentFlavourWith(shell, platform) {
    const start = allSource.indexOf('function currentFlavour(');
    const end = allSource.indexOf('\n}\n', start) + 2;
    const source = allSource.slice(start, end);
    const deps = {
      vscode: { env: { shell } },
      shellFlavour,
      process: { platform },
    };
    const names = Object.keys(deps);
    const factory = new Function(...names, `${source}\nreturn currentFlavour;`);
    return factory(...names.map((name) => deps[name]))();
  }

  it('reads the shell VS Code reports, whatever the platform is', () => {
    assert.equal(
      currentFlavourWith('C:\\Windows\\System32\\cmd.exe', 'win32'),
      'cmd',
    );
    assert.equal(
      currentFlavourWith('C:\\Program Files\\PowerShell\\7\\pwsh.exe', 'win32'),
      'powershell',
    );
    assert.equal(
      currentFlavourWith('C:\\Program Files\\Git\\bin\\bash.exe', 'win32'),
      'posix',
    );
    assert.equal(currentFlavourWith('/bin/zsh', 'darwin'), 'posix');
    assert.equal(currentFlavourWith('/bin/tcsh', 'darwin'), 'csh');
    assert.equal(currentFlavourWith('/usr/bin/fish', 'linux'), 'fish');
  });

  it('falls back on the platform when VS Code reports no shell', () => {
    assert.equal(currentFlavourWith('', 'win32'), 'powershell');
    assert.equal(currentFlavourWith(undefined, 'darwin'), 'posix');
  });

  it('leaves an adopted terminal unstamped, which the guess depends on', () => {
    // Stamping these with the current profile at activation would turn a guess
    // into a claim, and runInTerminal could no longer tell the two apart.
    const wiring = sectionSource('Terminal pool bookkeeping');
    assert.match(wiring, /flavour: null/);
    assert.ok(
      !/flavour: currentFlavour\(\)/.test(wiring),
      'an adopted terminal must not be stamped with the current profile',
    );
  });
});
