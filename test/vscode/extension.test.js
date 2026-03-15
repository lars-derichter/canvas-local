const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const extDir = path.resolve(__dirname, '../../.vscode/extensions/course-manager');
const extensionSource = fs.readFileSync(path.join(extDir, 'extension.js'), 'utf-8');
const packageJson = JSON.parse(fs.readFileSync(path.join(extDir, 'package.json'), 'utf-8'));

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

// Extract extra commands registered individually via registerCommand outside the loop.
function parseExtraRegisteredCommands(source) {
  const ids = [];
  // Match registerCommand('course.xyz' but skip the loop-based registration
  const re = /registerCommand\(\s*'(course\.\w+)'/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    ids.push(m[1]);
  }
  return ids;
}

const commandsMap = parseCommandsObject(extensionSource);
const extraRegistered = parseExtraRegisteredCommands(extensionSource);
const allRegisteredIds = [...Object.keys(commandsMap), ...extraRegistered.filter((id) => !commandsMap[id])];
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
      assert.ok(cmd.command.startsWith('course.'), `unexpected prefix: ${cmd.command}`);
    }
  });
});

describe('VS Code extension: command registry consistency', () => {
  const packageCommandIds = packageCommands.map((c) => c.command).sort();

  it('all commands in package.json are registered in extension.js', () => {
    for (const id of packageCommandIds) {
      assert.ok(
        allRegisteredIds.includes(id),
        `package.json declares "${id}" but extension.js does not register it`
      );
    }
  });

  it('all commands registered in extension.js are declared in package.json', () => {
    for (const id of allRegisteredIds) {
      assert.ok(
        packageCommandIds.includes(id),
        `extension.js registers "${id}" but package.json does not declare it`
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
      assert.ok(cmd.startsWith('npx course '), `command "${id}" does not start with "npx course ": ${cmd}`);
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

  it('contains all module management commands', () => {
    assert.equal(commandsMap['course.newModule'], 'npx course new-module');
    assert.equal(commandsMap['course.moveModule'], 'npx course move-module');
    assert.equal(commandsMap['course.renameModule'], 'npx course rename-module');
    assert.equal(commandsMap['course.deleteModule'], 'npx course delete-module');
  });

  it('contains all item management commands', () => {
    assert.equal(commandsMap['course.newItem'], 'npx course new-item');
    assert.equal(commandsMap['course.moveItem'], 'npx course move-item');
    assert.equal(commandsMap['course.moveItemToModule'], 'npx course movetomodule-item');
    assert.equal(commandsMap['course.renameItem'], 'npx course rename-item');
    assert.equal(commandsMap['course.deleteItem'], 'npx course delete-item');
  });
});

describe('VS Code extension: pushModule command', () => {
  it('registers course.pushModule as a separate command', () => {
    assert.ok(
      extraRegistered.includes('course.pushModule'),
      'course.pushModule should be registered via registerCommand'
    );
  });

  it('pushModule builds the correct CLI command with --module flag', () => {
    assert.match(extensionSource, /npx course push --module \$\{picked\}/);
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
    assert.match(extensionSource, /showErrorMessage.*No workspace folder open/);
  });

  it('shows warning when course/ directory is missing', () => {
    assert.match(extensionSource, new RegExp('showWarningMessage[\\s\\S]*No course/ directory found'));
  });
});

describe('VS Code extension: getWorkingDir', () => {
  it('defines getWorkingDir function', () => {
    assert.match(extensionSource, /function getWorkingDir\(\)/);
  });

  it('detects active file inside course/ directory', () => {
    // Verifies the logic checks if the dir starts with workspaceRoot/course
    assert.match(extensionSource, /dir\.startsWith\(path\.join\(workspaceRoot,\s*'course'\)\)/);
  });
});
