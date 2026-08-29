const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Command } = require('commander');
const { Linter } = require('eslint');

const ROOT = path.join(__dirname, '..', '..');
const EXT_DIR = path.join(ROOT, '.vscode', 'extensions', 'course-manager');

/**
 * The contract this file guards: every `npx course` command line and every
 * `runCli` argv the VS Code extension builds names a subcommand the CLI
 * registers, and passes only flags that subcommand (or the program itself)
 * accepts. A flag renamed on one side used to be found by whoever clicked the
 * button; this finds it on the next `npm test`.
 *
 * One direction only. A flag the extension passes and the CLI does not have is
 * a live bug: commander answers "unknown option" and the command never runs.
 * The reverse — a CLI flag no extension command uses — is ordinary, since most
 * flags exist for the command line rather than for a tree view. The last test
 * reports it as data and asserts nothing about it.
 *
 * `docs/tests.md` says the same thing for a reader who has just been refused by
 * it and wants to know what to do about it.
 *
 * WHAT IT DOES NOT CHECK, so that nobody reads more coverage into a green run
 * than is there:
 *
 *   - The values flags are given. `--position 3` is a `<value>` here, and
 *     whether 3 is an ordinal or a prefix is WP1's question, settled elsewhere.
 *   - How many positional arguments a command line carries, so a `search` that
 *     lost its keyword still passes.
 *   - A flag hidden inside a value. `runCli(['sync', someVariable])` where the
 *     variable holds `'--prune'` reads as a value, because the source does not
 *     say otherwise. Everything the source *does* say is followed: a ternary
 *     between two literals fans out, and a template with an interpolation keeps
 *     the literal part it was written with.
 *   - Whether any of it runs. An `args.push` after the `runCli` call, or one on
 *     a branch that returned first, is still counted, because the scan reads
 *     the source rather than executing it. That direction over-reports: a flag
 *     that never reaches the CLI is checked anyway, which costs nothing, while
 *     the reverse would let one through.
 *   - Whether a literal that begins with `npx course` is a command line or
 *     prose about one. The stray-line check below reports both. Distinguishing
 *     them would mean rejecting bare literal words after the subcommand, and a
 *     genuine stray with a hardcoded path (`npx course export course/01/a.md`)
 *     is exactly that shape, so the check keeps the false positive rather than
 *     lose the true one.
 */

// --- The CLI side: commander's own registrations -----------------------------

/**
 * Flatten a built commander program into the two lookups the contract needs.
 * Split out from the require below so a fixture program can exercise it — the
 * alias walk in particular, which no command in `cli/index.js` reaches today.
 */
function contractFrom(program) {
  const flagsOf = (command) => {
    const flags = new Set();
    for (const option of command.options) {
      if (option.short) flags.add(option.short);
      if (option.long) flags.add(option.long);
    }
    return flags;
  };

  // Commander resolves an option the subcommand does not know against the
  // parent program, so `course sync --verbose` is accepted as readily as
  // `course --verbose sync` (checked against commander itself, not assumed).
  // Hence one global set, valid in both positions. `-h/--help` is added lazily
  // and never shows up in `program.options`, so it is named here.
  const globalFlags = new Set([...flagsOf(program), '-h', '--help']);

  const commands = new Map();
  for (const command of program.commands) {
    const entry = { name: command.name(), flags: flagsOf(command) };
    commands.set(entry.name, entry);
    for (const alias of command.aliases()) commands.set(alias, entry);
  }

  return { commands, globalFlags };
}

/**
 * Read the registered commands out of the real `cli/index.js`.
 *
 * Parsing that file as text would drift from what commander actually does,
 * which is the drift this test exists to catch, so the program object itself is
 * the source. `cli/index.js` has no `require.main === module` guard and exports
 * nothing: it calls `program.parseAsync(...)` at load, and loading it under the
 * test runner's own argv would make commander print help and exit 1, taking the
 * test process with it (measured, not assumed). So `parse`/`parseAsync` are
 * replaced on the prototype for the duration of the require — commander is one
 * shared module instance, so the CLI gets the patched methods — and the `this`
 * they are called on is the fully built program. The swap is undone in a
 * `finally`, so a require that throws leaves commander as it found it.
 *
 * The require also runs `dotenv.config()`, so a local `.env` puts its
 * CANVAS_API_URL, CANVAS_API_TOKEN and CANVAS_COURSE_ID into this process's
 * environment. Nothing here reads them, `node --test` gives each test file its
 * own process, and loading the CLI opens no file for writing, starts no child
 * process and makes no network call.
 *
 * Callable exactly once per process: `require` caches the module, so a second
 * call captures nothing. `cliContract()` below is what enforces that.
 *
 * If a future `cli/index.js` guards its parse call or moves to another parser,
 * nothing is captured and this throws, rather than quietly checking the
 * extension against an empty contract.
 */
function readCliContract() {
  const captured = [];
  const original = {
    parse: Command.prototype.parse,
    parseAsync: Command.prototype.parseAsync,
  };
  Command.prototype.parse = function () {
    captured.push(this);
    return this;
  };
  Command.prototype.parseAsync = function () {
    captured.push(this);
    return Promise.resolve(this);
  };
  try {
    require(path.join(ROOT, 'cli', 'index.js'));
  } finally {
    Command.prototype.parse = original.parse;
    Command.prototype.parseAsync = original.parseAsync;
  }

  if (captured.length !== 1) {
    throw new Error(
      'cli/index.js was expected to call parse() exactly once while being ' +
        `required; it called it ${captured.length} times. Commander ` +
        'introspection is the whole basis of this test — fix the capture ' +
        'rather than falling back on a text parse of the source.',
    );
  }
  return contractFrom(captured[0]);
}

// --- The extension side: a static scan of its sources ------------------------

/**
 * What an interpolation, or an argv element the source does not spell out,
 * stands in for. A real command line can never hold this token: it carries no
 * whitespace, so it survives tokenising as one word, and it does not start with
 * `-`, so it is never read as a flag. Spelled `<value>` rather than as a NUL
 * sentinel because `test/source-hygiene.test.js` bans NUL bytes from this
 * repo's JavaScript, and because it reads as itself in a failure message.
 */
const VALUE = '<value>';

/** A fold that fans out further than this is a bug in the fold, not a fixture. */
const MAX_VARIANTS = 16;

/**
 * The functions call sites hand a command to. A third one added under a new
 * name belongs here, or everything it runs goes unchecked.
 *
 * `runCli` sits behind a promise queue and passes its argv on to an inner
 * `execCli`, which is deliberately *not* listed: the queue took no call site
 * with it, so every invocation is still spelled out at a `runCli` call and
 * still read here. Listing the inner name would break the scan rather than
 * widen it, since what reaches it is a parameter and not an array this file
 * can read. What keeps that honest is the unknown-runner sweep below: hand
 * `execCli` a literal argv from anywhere and it is reported.
 */
const RUNNERS = new Set(['runCli', 'runInTerminal']);

/**
 * The escape hatch for the unknown-runner guard, which reports anything else
 * that takes an argv-shaped array. Any helper that legitimately takes a list of
 * strings (`showQuickPick(['PDF', 'DOCX'])` is one refactor away from existing)
 * goes here, by the name it is called with — the bare identifier, or the
 * property for a method call — and each addition is a decision.
 *
 * The collection constructors are here because they can never be a CLI runner
 * and the extension builds several of them from string arrays, the
 * `noValidationCommands` set at extension.js:550 among them.
 *
 * Matching is on the bare name, so listing a name exempts every call that ends
 * in it: `push` here would exempt every `.push` in the extension. Names are
 * specific enough in practice that narrowing this to whole member paths would
 * cost more than it buys, but a name has to be chosen with that in mind.
 */
const NOT_RUNNERS = new Set(['Array', 'Map', 'Set', 'WeakMap', 'WeakSet']);

/**
 * The other exemption list: callees that receive an argv array and only read
 * it. Handing the array to anything else is refused, because the callee could
 * reorder or extend it before the runner sees it, and this scan would report
 * the argv the source shows rather than the one the CLI gets. Empty today.
 * Reading through a member (`args.join(' ')`) needs no entry — that is already
 * accepted, and it is how `runCli` itself logs its argv.
 */
const READ_ONLY_CALLEES = new Set();

/** Array members that read the array without changing it. */
const READ_ONLY_MEMBERS = new Set([
  'at',
  'concat',
  'entries',
  'every',
  'filter',
  'find',
  'findIndex',
  'findLast',
  'findLastIndex',
  'flat',
  'flatMap',
  'forEach',
  'includes',
  'indexOf',
  'join',
  'keys',
  'lastIndexOf',
  'length',
  'map',
  'reduce',
  'reduceRight',
  'slice',
  'some',
  'toString',
  'values',
]);

/** Array members that change it in place. `push` is handled on its own. */
const MUTATING_MEMBERS = new Set([
  'copyWithin',
  'fill',
  'pop',
  'reverse',
  'shift',
  'sort',
  'splice',
  'unshift',
]);

const FUNCTION_TYPES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
]);

/**
 * Parse one source file and hand back ESLint's own `SourceCode`: the AST, and
 * with it the scope analysis that says which binding an identifier refers to.
 *
 * Two things follow from using a real parser instead of a regex over the text.
 * Comments are not in the AST, so the worked `runInTerminal` example in the doc
 * comment at extension.js:116 — a complete `npx course push --module` line — is
 * not counted as a twenty-fifth command line. And `const args = [...]` declared
 * twice in two branches of one function resolves per block, the way the
 * language does, instead of being read as an ambiguity.
 *
 * The module/script question is settled by trying both rather than by the file
 * extension, so a `.js` written as ESM parses as readily as a `.mjs` does.
 */
function analyse(code, filename) {
  const order = filename.endsWith('.mjs')
    ? ['module', 'commonjs']
    : ['commonjs', 'module'];
  const failures = [];

  for (const sourceType of order) {
    const calls = [];
    const constructions = [];
    const literals = [];
    let sourceCode = null;

    const messages = new Linter().verify(
      code,
      {
        plugins: {
          contract: {
            rules: {
              capture: {
                create(context) {
                  sourceCode = context.sourceCode;
                  return {
                    CallExpression(node) {
                      calls.push(node);
                    },
                    NewExpression(node) {
                      constructions.push(node);
                    },
                    Literal(node) {
                      if (typeof node.value === 'string') literals.push(node);
                    },
                    TemplateLiteral(node) {
                      literals.push(node);
                    },
                  };
                },
              },
            },
          },
        },
        rules: { 'contract/capture': 'error' },
        languageOptions: { ecmaVersion: 'latest', sourceType },
      },
      filename,
    );

    if (sourceCode) return { calls, constructions, literals, sourceCode };
    const fatal = messages.find((message) => message.fatal) || messages[0];
    failures.push(
      `${sourceType}: ${fatal ? fatal.message : 'no reason given'}`,
    );
  }

  throw new Error(`${filename} did not parse (${failures.join('; ')})`);
}

/**
 * Scan one source file for the CLI invocations it builds.
 *
 * The rule the whole scan follows: read what the source spells out, accept what
 * provably cannot change the argv, and throw on everything else. A shape it
 * cannot follow is a command line reaching the author unchecked, and a test
 * that skipped one silently would be worse than no test. What that does and
 * does not buy, precisely: every reference to an argv binding is either a
 * `push` whose flag is spelled out, a read that cannot change the array, or a
 * refusal. It does not make the reported argv complete, since a `push`'s
 * *value* is still allowed to be a runtime expression.
 */
function scanSource(
  code,
  filename,
  { notRunners = NOT_RUNNERS, readOnlyCallees = READ_ONLY_CALLEES } = {},
) {
  const { calls, constructions, literals, sourceCode } = analyse(
    code,
    filename,
  );

  const where = (node) => `${filename}:${node.loc.start.line}`;
  const fail = (node, message) => {
    throw new Error(`${where(node)}: ${message}`);
  };

  // Every resolved identifier in the file, mapped to the variable it names.
  // eslint-scope has already done the work; this only indexes it by node.
  const variables = new Map();
  for (const scope of sourceCode.scopeManager.scopes) {
    for (const reference of scope.references) {
      if (reference.resolved)
        variables.set(reference.identifier, reference.resolved);
    }
  }

  /** The single declaration of the variable an identifier names, or null. */
  const declarationOf = (identifier) => {
    const variable = variables.get(identifier);
    if (!variable || variable.defs.length !== 1) return null;
    const def = variable.defs[0];
    return def.type === 'Variable' ? def : null;
  };

  /** The name a call is written with: `foo(…)` or `thing.foo(…)`. */
  const calleeName = (node) => {
    if (node.callee.type === 'Identifier') return node.callee.name;
    if (node.callee.type === 'MemberExpression' && !node.callee.computed) {
      return node.callee.property.name;
    }
    return null;
  };

  /**
   * Every string a node can evaluate to, or null when that is not knowable
   * from the source. Deliberately narrow: a string literal, a template with
   * nothing interpolated, a ternary between two of those, and an identifier
   * bound to one of them. Anything else is a runtime value.
   */
  const foldStrings = (node, depth = 0) => {
    if (!node || depth > 8) return null;
    if (node.type === 'Literal') {
      return typeof node.value === 'string' ? [node.value] : null;
    }
    if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
      return [node.quasis[0].value.cooked];
    }
    if (node.type === 'ConditionalExpression') {
      const yes = foldStrings(node.consequent, depth + 1);
      const no = foldStrings(node.alternate, depth + 1);
      return yes && no ? [...yes, ...no] : null;
    }
    if (node.type !== 'Identifier') return null;

    const def = declarationOf(node);
    if (!def) return null;
    const entries = entriesLoopValues(def);
    if (entries) {
      const out = [];
      for (const value of entries) {
        const folded = foldStrings(value, depth + 1);
        if (!folded) return null;
        out.push(...folded);
      }
      return out;
    }
    return foldStrings(def.node.init, depth + 1);
  };

  /**
   * `for (const [id, cmd] of Object.entries(commands))` — the shape the map of
   * terminal command lines is iterated with. Returns the object's key or value
   * nodes for whichever half of the pair the declaration names, so
   * `runInTerminal(() => cmd)` resolves to all the command lines in the map
   * rather than to nothing.
   */
  const entriesLoopValues = (def) => {
    const declarator = def.node;
    if (declarator.id.type !== 'ArrayPattern') return null;
    const loop = declarator.parent && declarator.parent.parent;
    if (!loop || loop.type !== 'ForOfStatement') return null;
    const index = declarator.id.elements.indexOf(def.name);
    if (index === -1) return null;

    const right = loop.right;
    if (
      right.type !== 'CallExpression' ||
      right.callee.type !== 'MemberExpression' ||
      right.callee.object.type !== 'Identifier' ||
      right.callee.object.name !== 'Object' ||
      right.callee.property.name !== 'entries' ||
      right.arguments.length !== 1 ||
      right.arguments[0].type !== 'Identifier'
    ) {
      return null;
    }
    const objectDef = declarationOf(right.arguments[0]);
    if (!objectDef || !objectDef.node.init) return null;
    if (objectDef.node.init.type !== 'ObjectExpression') return null;

    const values = [];
    for (const property of objectDef.node.init.properties) {
      if (property.type !== 'Property') return null;
      values.push(index === 0 ? property.key : property.value);
    }
    return values;
  };

  /** Guard every fan-out with the same cap, so none of them can run away. */
  const capped = (variants, node, unit) => {
    if (variants.length > MAX_VARIANTS) {
      fail(node, `folds to more than ${MAX_VARIANTS} ${unit}`);
    }
    return variants;
  };

  /**
   * The strings a string or template node can produce. An interpolation that
   * folds is substituted, so ``export${flag}`` yields both the flagged and the
   * plain line and the ` --flagged` it folds to is re-tokenised as the flag it
   * is; one that does not fold becomes `VALUE`, which keeps the literal half of
   * ``--position=${n}`` readable as the flag it names.
   */
  const renderLines = (node) => {
    if (node.type === 'Literal') {
      return typeof node.value === 'string' ? [node.value] : null;
    }
    if (node.type !== 'TemplateLiteral') return null;
    let variants = [''];
    for (let i = 0; i < node.quasis.length; i++) {
      const text = node.quasis[i].value.cooked;
      variants = variants.map((variant) => variant + text);
      if (i < node.expressions.length) {
        const pieces = foldStrings(node.expressions[i]) ?? [VALUE];
        const next = [];
        for (const variant of variants) {
          for (const piece of pieces) next.push(variant + piece);
        }
        variants = capped(next, node, 'command lines');
      }
    }
    return variants;
  };

  /**
   * The command lines a `runInTerminal` builder can return, each paired with
   * the node it is written at. A line that comes out of the terminal command
   * map is reported at its map entry rather than at the one `runInTerminal`
   * call the loop makes, because the map entry is where a wrong line has to be
   * corrected.
   */
  const foldLines = (node) => {
    const direct = renderLines(node);
    if (direct) return direct.map((line) => ({ line, node }));
    if (node.type !== 'Identifier') return [];

    const def = declarationOf(node);
    const entries = def && entriesLoopValues(def);
    if (entries) {
      const out = [];
      for (const value of entries) {
        const rendered = renderLines(value);
        if (!rendered) return [];
        out.push(...rendered.map((line) => ({ line, node: value })));
      }
      return out;
    }
    const folded = foldStrings(node);
    return folded ? folded.map((line) => ({ line, node })) : [];
  };

  const isFlag = (token) => token.startsWith('-') && token !== '-';
  const flagName = (token) => token.split('=')[0];

  /**
   * Split an argv into subcommand, global flags, command flags and the rest.
   * Tokens arrive paired with the node they were written at, so a flag is
   * reported where it lives rather than at the runner call: for an argv built
   * over several statements those can be dozens of lines apart.
   */
  const parseArgv = (tokens, node, rendered) => {
    let index = 0;
    const globalFlags = [];
    // Flags before the subcommand are the program's own (`course --verbose
    // sync`). Anything after belongs to the subcommand, and commander falls
    // back on the program for those as well, so both lists are checked. The
    // split is recorded to report on, never to let a flag through unchecked.
    while (index < tokens.length && isFlag(tokens[index].value)) {
      globalFlags.push({
        name: flagName(tokens[index].value),
        at: where(tokens[index].node),
      });
      index++;
    }
    const head = tokens[index];
    index++;
    if (!head) fail(node, `no subcommand in: ${rendered}`);
    if (head.value.includes(VALUE)) {
      // A subcommand assembled at runtime cannot be checked against anything,
      // so the scan refuses it rather than reporting a contract it never
      // verified.
      fail(head.node, `the subcommand is computed at runtime: ${rendered}`);
    }

    // Everything that is not a flag: a flag's value and a true positional
    // alike, since telling them apart would mean modelling which options take
    // one, and nothing here asserts over either.
    const flags = [];
    const values = [];
    let optionsEnded = false;
    for (; index < tokens.length; index++) {
      const token = tokens[index];
      if (!optionsEnded && token.value === '--') {
        optionsEnded = true;
        continue;
      }
      if (!optionsEnded && isFlag(token.value)) {
        flags.push({ name: flagName(token.value), at: where(token.node) });
      } else {
        values.push(token.value);
      }
    }

    return {
      file: filename,
      at: where(node),
      subcommand: head.value,
      subcommandAt: where(head.node),
      rendered,
      globalFlags,
      flags,
      values,
    };
  };

  const parseCommandLine = (line, node) => {
    const words = line.trim().split(/\s+/).filter(Boolean);
    if (words[0] !== 'npx' || words[1] !== 'course') {
      fail(node, `command line does not start with "npx course": ${line}`);
    }
    // One line, one node: every token in it is written at the same place.
    const tokens = words.slice(2).map((value) => ({ value, node }));
    return parseArgv(tokens, node, line);
  };

  /** The `args.push(...)` call an identifier is the receiver of, or null. */
  const pushCall = (identifier) => {
    const member = identifier.parent;
    if (
      !member ||
      member.type !== 'MemberExpression' ||
      member.object !== identifier ||
      member.computed ||
      member.property.name !== 'push'
    ) {
      return null;
    }
    const call = member.parent;
    if (!call || call.type !== 'CallExpression' || call.callee !== member) {
      return null;
    }
    return call;
  };

  /** Is this identifier the argument of a call to one of the runners? */
  const isRunnerArgument = (identifier) => {
    const call = identifier.parent;
    return Boolean(
      call &&
      call.type === 'CallExpression' &&
      call.callee.type === 'Identifier' &&
      RUNNERS.has(call.callee.name) &&
      call.arguments.includes(identifier),
    );
  };

  const isAssignmentTarget = (node) => {
    const parent = node.parent;
    if (!parent) return false;
    if (parent.type === 'AssignmentExpression' && parent.left === node) {
      return true;
    }
    if (parent.type === 'UpdateExpression' && parent.argument === node) {
      return true;
    }
    return Boolean(
      parent.type === 'UnaryExpression' &&
      parent.operator === 'delete' &&
      parent.argument === node,
    );
  };

  /** What one reference to an argv binding does with it. */
  const classifyArgvUse = (identifier) => {
    const push = pushCall(identifier);
    if (push) return { kind: 'push', call: push };

    const parent = identifier.parent;
    if (
      parent &&
      parent.type === 'MemberExpression' &&
      parent.object === identifier
    ) {
      if (parent.computed) {
        // `args[0]` reads an element; `args[0] = x` replaces one.
        return isAssignmentTarget(parent)
          ? { kind: 'index-write' }
          : { kind: 'read' };
      }
      const name = parent.property.name;
      if (READ_ONLY_MEMBERS.has(name)) return { kind: 'read' };
      if (MUTATING_MEMBERS.has(name)) return { kind: 'mutator', name };
      return { kind: 'unknown-member', name };
    }

    if (
      parent &&
      (parent.type === 'CallExpression' || parent.type === 'NewExpression') &&
      parent.arguments.includes(identifier)
    ) {
      return { kind: 'argument', callee: calleeName(parent) ?? 'that call' };
    }

    return { kind: 'other' };
  };

  /**
   * The values one argv element can hold, each paired with the node it came
   * from. A ternary between two flags fans out into two argv lists, the way a
   * ternary inside a template fans out into two command lines; a spread hides
   * an unknown number of elements and stops the run instead.
   */
  const elementValues = (item, array) => {
    if (item === null) {
      // `['sync', , '--dry-run']` — a hole, which ESLint's no-sparse-arrays
      // catches first, but a located refusal beats a TypeError from here.
      fail(array, 'the argv array has a hole in it');
    }
    if (item.type === 'SpreadElement') {
      fail(
        item,
        'a spread hides part of the argv from this scan, so the flags after ' +
          'it cannot be checked',
      );
    }
    const values = renderLines(item) ?? foldStrings(item) ?? [VALUE];
    return values.map((value) => ({ value, node: item }));
  };

  /** Array literals a node can evaluate to, ternaries included, or null. */
  const arrayLiterals = (node, depth = 0) => {
    if (!node || depth > 4) return null;
    if (node.type === 'ArrayExpression') return [node];
    if (node.type === 'ConditionalExpression') {
      const yes = arrayLiterals(node.consequent, depth + 1);
      const no = arrayLiterals(node.alternate, depth + 1);
      return yes && no ? [...yes, ...no] : null;
    }
    return null;
  };

  /**
   * The argv lists a `runCli` argument stands for. An identifier is followed to
   * its array literal and its `push` calls; a read that cannot change the array
   * (`args.length`, `args.join(' ')`, `args[0]`) is passed over in silence, and
   * every other way of touching that binding before the call stops the run and
   * says which one it was.
   */
  const resolveArgv = (node) => {
    let bases;
    const appended = [];

    if (node.type === 'Identifier') {
      const def = declarationOf(node);
      bases = def && def.node.init ? arrayLiterals(def.node.init) : null;
      if (!bases) {
        fail(node, `the runCli argument "${node.name}" is not a literal array`);
      }
      for (const reference of variables.get(node).references) {
        const identifier = reference.identifier;
        if (reference.init) continue; // the declaration's own write
        if (isRunnerArgument(identifier)) continue; // this call, or another
        if (reference.isWrite()) {
          fail(
            identifier,
            `"${node.name}" is given a new array before it reaches the ` +
              'runner, so the argv the scan reports is not the one that runs',
          );
        }
        const use = classifyArgvUse(identifier);
        if (use.kind === 'push') {
          appended.push(use.call);
        } else if (use.kind === 'index-write') {
          fail(
            identifier,
            `an element of "${node.name}" is replaced by index, which this ` +
              'scan cannot follow',
          );
        } else if (use.kind === 'mutator') {
          fail(
            identifier,
            `"${node.name}.${use.name}(…)" changes the argv in place, which ` +
              'this scan cannot follow. Build the array with push, or teach ' +
              'this scan the shape.',
          );
        } else if (use.kind === 'unknown-member') {
          fail(
            identifier,
            `"${node.name}.${use.name}" is not a member this scan knows to ` +
              'be read-only. Add it to READ_ONLY_MEMBERS if it is.',
          );
        } else if (use.kind === 'argument') {
          if (!readOnlyCallees.has(use.callee)) {
            fail(
              identifier,
              `"${node.name}" is handed to ${use.callee}(…) before it reaches ` +
                'the runner, which could change the array first. If ' +
                `${use.callee} only reads it, add its name to ` +
                'READ_ONLY_CALLEES; reading through a member such as ' +
                `${node.name}.join(' ') needs no entry.`,
            );
          }
        } else if (use.kind !== 'read') {
          fail(
            identifier,
            `"${node.name}" is used in a way this scan cannot follow, so its ` +
              'argv would be reported wrong',
          );
        }
      }
    } else {
      bases = arrayLiterals(node);
      if (!bases) {
        fail(
          node,
          `the runCli argument is a ${node.type}, which the scan cannot read`,
        );
      }
    }

    // The flag a push adds has to be spelled out, or the push is a hole: the
    // scan would report the argv without it and call the result checked.
    const pushed = [];
    for (const call of appended) {
      const first = call.arguments[0];
      if (!first) continue; // `push()` appends nothing
      if (first.type !== 'SpreadElement' && !foldStrings(first)) {
        fail(
          first,
          'the first value pushed here is computed, so the flag it adds ' +
            'cannot be checked',
        );
      }
      pushed.push(...call.arguments);
    }

    const variants = [];
    for (const base of bases) {
      let lists = [[]];
      for (const item of [...base.elements, ...pushed]) {
        const values = elementValues(item, base);
        const next = [];
        for (const list of lists) {
          for (const value of values) next.push([...list, value]);
        }
        lists = capped(next, item ?? base, 'argv lists');
      }
      variants.push(...lists);
    }
    return capped(variants, node, 'argv lists');
  };

  // --- The invocations themselves ---

  const invocations = [];
  const unresolvedSites = [];
  const terminalLines = new Set();

  const callSites = calls.filter(
    (call) =>
      call.callee.type === 'Identifier' && RUNNERS.has(call.callee.name),
  );

  for (const call of callSites) {
    const argument = call.arguments[0];
    if (!argument) {
      unresolvedSites.push(`${where(call)} (called with no argument)`);
      continue;
    }

    if (call.callee.name === 'runInTerminal') {
      // The builder shape WP12 introduced: `runInTerminal((q) => line)`, so the
      // line is quoted for the terminal that will receive it. The zero-argument
      // form `() => cmd` is the same shape with nothing to quote.
      if (!FUNCTION_TYPES.has(argument.type)) {
        fail(
          argument,
          `runInTerminal takes a builder function, got a ${argument.type}`,
        );
      }
      const returned =
        argument.body.type === 'BlockStatement'
          ? argument.body.body
              .filter((statement) => statement.type === 'ReturnStatement')
              .map((statement) => statement.argument)
              .filter(Boolean)
          : [argument.body];
      const lines = returned.flatMap((node) => foldLines(node));
      if (lines.length === 0) {
        unresolvedSites.push(
          `${where(call)} (the builder's command line could not be resolved)`,
        );
        continue;
      }
      for (const { line, node } of lines) {
        terminalLines.add(line);
        invocations.push({
          shape: 'command-line',
          ...parseCommandLine(line, node),
        });
      }
      continue;
    }

    for (const argv of resolveArgv(argument)) {
      if (argv.length === 0) fail(call, 'runCli is called with an empty argv');
      invocations.push({
        shape: 'argv',
        ...parseArgv(argv, call, argv.map((token) => token.value).join(' ')),
      });
    }
  }

  // A command line built anywhere but a `runInTerminal` builder — a bare
  // `terminal.sendText('npx course …')`, a helper written next year — would
  // otherwise sail past this whole test unseen. Every literal in the file that
  // reads as one has to turn up in what was collected above. Prose that opens
  // with the same three words is reported too; the header says why that is the
  // trade taken.
  const strayLines = [];
  for (const literal of literals) {
    for (const line of renderLines(literal) ?? []) {
      if (!line.trimStart().startsWith('npx course')) continue;
      if (!terminalLines.has(line)) {
        strayLines.push(`${where(literal)}: ${line}`);
      }
    }
  }

  /** An argv-shaped array reachable from an argument, or null. */
  const argvHead = (node, depth = 0) => {
    if (!node || depth > 1) return null;
    let array = null;
    if (node.type === 'ArrayExpression') array = node;
    else if (node.type === 'Identifier') {
      array = declarationOf(node)?.node.init ?? null;
    }
    if (array && array.type === 'ArrayExpression') {
      const head = array.elements[0];
      const value = head && head.type === 'Literal' ? head.value : null;
      return typeof value === 'string' ? value : null;
    }
    // `queueCli({ args: [...] })` — one level in, since a runner that takes an
    // options object is as likely as one that takes a bare array.
    if (node.type === 'ObjectExpression') {
      for (const property of node.properties) {
        if (property.type !== 'Property') continue;
        const found = argvHead(property.value, depth + 1);
        if (found !== null) return found;
      }
    }
    return null;
  };

  // The same hole on the argv side, where there is no `npx course` text to look
  // for. A wrapper under a new name would carry its argv straight past
  // everything above while the floors stayed green on the invocations that
  // remained — the queue `runCli` now sits behind was written to keep every
  // call site on the old name for exactly that reason. So anything else handed an
  // argv-shaped array — in any argument position, bare or inside an options
  // object, called or constructed — is reported until someone rules on it,
  // either into `RUNNERS` or into `NOT_RUNNERS`.
  const unknownRunners = [];
  for (const call of [...calls, ...constructions]) {
    if (callSites.includes(call)) continue;
    const callee = calleeName(call);
    if (callee === null || notRunners.has(callee)) continue;
    for (const argument of call.arguments) {
      const head = argvHead(argument);
      if (head === null) continue;
      const written = call.type === 'NewExpression' ? `new ${callee}` : callee;
      unknownRunners.push(`${where(call)}: ${written}(["${head}", …])`);
      break;
    }
  }

  return {
    invocations,
    callSites,
    unresolvedSites,
    strayLines,
    unknownRunners,
  };
}

/**
 * Every JavaScript file the extension ships, walked rather than listed. A
 * hardcoded list is a hole with no bottom: a file added tomorrow is invisible,
 * and nothing says so. The walk descends, because a subdirectory is the same
 * hole one level down and WP18 splits `extension.js` into exactly that shape;
 * and it takes `.mjs` and `.cjs` as readily as `.js`, because an extension
 * written to be bundled may well use either.
 *
 * Names come back with `/` separators whatever the platform, so a failure reads
 * the same on Windows as here.
 */
function extensionSources(dir = EXT_DIR, prefix = '') {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      found.push(...extensionSources(path.join(dir, entry.name), name));
    } else if (/\.(js|mjs|cjs)$/.test(entry.name)) {
      found.push(name);
    }
  }
  return found.sort();
}

function scanExtension() {
  const sources = extensionSources();
  const results = sources.map((name) =>
    scanSource(
      fs.readFileSync(path.join(EXT_DIR, ...name.split('/')), 'utf8'),
      name,
    ),
  );
  return {
    sources,
    invocations: results.flatMap((result) => result.invocations),
    callSites: results.flatMap((result) => result.callSites),
    unresolvedSites: results.flatMap((result) => result.unresolvedSites),
    strayLines: results.flatMap((result) => result.strayLines),
    unknownRunners: results.flatMap((result) => result.unknownRunners),
  };
}

// --- Floors ------------------------------------------------------------------

/**
 * The floors below are as much the point of this file as the contract is. A
 * static scan whose pattern stops matching finds nothing, asserts nothing about
 * nothing, and stays green forever; `scripts/check-test-glob.js` exists because
 * this repo shipped exactly that failure in its own test script.
 *
 * What they do and do not promise, measured rather than reasoned:
 *
 *   - The per-shape floors are the real guard. 46 invocations stand today, 24
 *     of them terminal command lines and 22 argv arrays, so a shape that stops
 *     being read takes its subtotal to zero and fails its own floor. The
 *     aggregate floor of 40 catches the same thing a second way, since whichever
 *     shape survives cannot reach 40 alone.
 *   - The aggregate floor does NOT promise to notice invocations being deleted.
 *     Six removed across both shapes — three map entries and three `runCli`
 *     sites — leaves 40 invocations, 21 command lines, 19 argv and 36 pairs,
 *     every one of them at or above its floor, and the suite stays green. That
 *     is the intended answer (deleting an invocation cannot violate a contract
 *     about invocations that exist, and `test/vscode/extension.test.js` fails
 *     four ways on that same deletion), but the floor must not be read as
 *     promising more.
 *   - The pairs floor is the weakest of the four and is not what pins flag
 *     extraction. Stopping `args.push` from being read takes 40 pairs to 35, so
 *     36 is the number that catches it, with four pairs of headroom for flags
 *     the extension legitimately stops passing. The test that actually kills
 *     that regression is the "conditional pushes" fixture at the bottom of this
 *     file, and it kills it whatever the pair count does.
 *
 * A floor that trips because the extension genuinely shrank has to be lowered
 * on purpose, in the commit that shrank it, rather than drifting down where
 * nobody sees it.
 */
const MINIMUM_INVOCATIONS = 40;
const MINIMUM_COMMAND_LINES = 20;
const MINIMUM_ARGV = 18;
const MINIMUM_PAIRS = 36;

/**
 * The extension is thirteen files across two directories; a walk that finds
 * many fewer has stopped walking.
 *
 * It was three when this was written, and the number stayed at three through
 * the split that made it thirteen — a floor with four times the slack it looks
 * like it has. Ten is the shape it actually guards now: dropping `commands/`,
 * which is where nearly every invocation this file reads has moved, takes the
 * count to seven and under the floor, with headroom for a file being merged
 * into another.
 *
 * The guarantee here has not changed either way. The recursion is already
 * load-bearing without this: removing it fails "finds every CLI invocation the
 * extension makes" and "reports the contract it checked", because both shapes'
 * per-shape floors go to nearly zero when `commands/` stops being read. This is
 * bookkeeping catching up with the tree, not a new promise.
 */
const MINIMUM_SOURCES = 10;

// --- Tests -------------------------------------------------------------------

/**
 * One read of each side for the whole file, and the two are memoized apart.
 *
 * Apart, because they fail for unrelated reasons and a failure in one must not
 * be reported as the other. And the memo holds a thrown error as firmly as a
 * value: `readCliContract` works exactly once per process (`require` caches
 * `cli/index.js`), so a second call after a failure elsewhere would capture
 * nothing and report "commander introspection is broken" to a contributor whose
 * actual mistake was a line in `extension.js`.
 */
function memoize(read) {
  let done = false;
  let value;
  let error;
  return () => {
    if (!done) {
      done = true;
      try {
        value = read();
      } catch (thrown) {
        error = thrown;
      }
    }
    if (error) throw error;
    return value;
  };
}

const cliContract = memoize(readCliContract);
const extensionScan = memoize(scanExtension);

describe('the VS Code extension and the CLI agree', () => {
  it('reads the CLI registrations out of commander itself', () => {
    const cli = cliContract();
    assert.ok(
      cli.commands.size >= 20,
      `commander introspection found ${cli.commands.size} commands`,
    );
    // A spot check that these are the real registrations and not an empty
    // shell, which would fail every flag below for the wrong reason.
    assert.ok(cli.commands.has('sync'));
    assert.ok(cli.commands.get('sync').flags.has('--dry-run'));
    assert.ok(cli.commands.get('sync').flags.has('-m'));
    assert.ok(cli.globalFlags.has('--verbose'));
  });

  it('scans every JavaScript file the extension ships', () => {
    const ext = extensionScan();
    assert.ok(
      ext.sources.length >= MINIMUM_SOURCES,
      `the source walk found ${ext.sources.length} files (${ext.sources.join(', ')})`,
    );
    assert.ok(ext.sources.includes('extension.js'));
    assert.ok(ext.sources.includes('CourseTreeProvider.js'));
    assert.ok(
      ext.sources.some((name) => name.includes('/')),
      `the walk has to descend, or every commands/ file goes unscanned ` +
        `(${ext.sources.join(', ')})`,
    );
  });

  it('finds every CLI invocation the extension makes', () => {
    const ext = extensionScan();
    const byShape = (shape) =>
      ext.invocations.filter((invocation) => invocation.shape === shape);

    assert.ok(
      ext.invocations.length >= MINIMUM_INVOCATIONS,
      `the scan found ${ext.invocations.length} invocations and the extension ` +
        `makes at least ${MINIMUM_INVOCATIONS}. Either the scan stopped ` +
        'reading a construction shape, or invocations were removed and this ' +
        'floor has to be lowered deliberately.',
    );
    assert.ok(
      byShape('command-line').length >= MINIMUM_COMMAND_LINES,
      `only ${byShape('command-line').length} terminal command lines found`,
    );
    assert.ok(
      byShape('argv').length >= MINIMUM_ARGV,
      `only ${byShape('argv').length} runCli argv arrays found`,
    );
  });

  it('resolves every runCli and runInTerminal call site', () => {
    const ext = extensionScan();
    assert.deepEqual(
      ext.unresolvedSites,
      [],
      'a call site produced no invocation, so a command line reaches the ' +
        'author unchecked',
    );
    // One site can produce several invocations (the terminal command map does),
    // but none may produce none: that is how a new construction shape would
    // slip past the scan while the floors above still passed on the old ones.
    assert.ok(ext.callSites.length > 0, 'no call sites found at all');
    assert.ok(
      ext.invocations.length >= ext.callSites.length,
      `${ext.callSites.length} call sites produced only ` +
        `${ext.invocations.length} invocations, so at least one site was read ` +
        'as nothing',
    );
  });

  it('builds no npx course command line outside a runInTerminal builder', () => {
    const ext = extensionScan();
    assert.deepEqual(
      ext.strayLines,
      [],
      'a literal reads as a command line but is not built by a runInTerminal ' +
        'builder, so nothing checked it. If it is prose that happens to open ' +
        'with "npx course", reword it; the scan cannot tell the two apart.',
    );
  });

  it('hands its argv to no runner but runCli', () => {
    const ext = extensionScan();
    assert.deepEqual(
      ext.unknownRunners,
      [],
      'something other than the known runners takes an argv-shaped array. If ' +
        'it is a new CLI runner, add its name to RUNNERS so the commands it ' +
        'runs are checked. If it is not a runner and merely takes a list of ' +
        'strings, add its name to NOT_RUNNERS.',
    );
  });

  it('invokes only subcommands the CLI registers', () => {
    const cli = cliContract();
    const ext = extensionScan();
    const unknown = ext.invocations
      .filter((invocation) => !cli.commands.has(invocation.subcommand))
      .map(
        (invocation) =>
          `${invocation.subcommandAt}: "${invocation.subcommand}" in ${invocation.rendered}`,
      );
    assert.deepEqual(unknown, []);
  });

  it('passes only flags the CLI accepts', () => {
    const cli = cliContract();
    const ext = extensionScan();
    const unknown = [];
    for (const invocation of ext.invocations) {
      const command = cli.commands.get(invocation.subcommand);
      if (!command) continue; // already reported by the test above
      for (const flag of invocation.globalFlags) {
        if (!cli.globalFlags.has(flag.name)) {
          unknown.push(
            `${flag.at}: "${flag.name}" before "${invocation.subcommand}"`,
          );
        }
      }
      for (const flag of invocation.flags) {
        // The program's own options are accepted after a subcommand too, since
        // commander walks up to the parent for an option the child does not
        // know. There are four of them (`--version`, `--verbose`, `--quiet`,
        // `--help`), no command redefines one, and the extension passes none,
        // so the allowance cannot cover for a command flag renamed away.
        if (command.flags.has(flag.name) || cli.globalFlags.has(flag.name)) {
          continue;
        }
        unknown.push(
          `${flag.at}: "${flag.name}" is not an option of "${invocation.subcommand}"`,
        );
      }
    }
    assert.deepEqual(unknown, []);
  });

  it('reports the contract it checked', (t) => {
    const cli = cliContract();
    const ext = extensionScan();
    const pairs = new Set();
    for (const invocation of ext.invocations) {
      for (const flag of invocation.flags) {
        pairs.add(`${invocation.subcommand} ${flag.name}`);
      }
    }
    assert.ok(
      pairs.size >= MINIMUM_PAIRS,
      `the scan found ${pairs.size} subcommand+flag pairs and the extension ` +
        `passes at least ${MINIMUM_PAIRS}. Flag extraction has most likely ` +
        'stopped working.',
    );

    // Data, not an assertion: a CLI command the extension never runs is not a
    // defect, so it is printed and left alone.
    const used = new Set(ext.invocations.map((i) => i.subcommand));
    const unused = [...cli.commands.keys()].filter((name) => !used.has(name));
    t.diagnostic(
      `extension to CLI: ${ext.invocations.length} invocations across ` +
        `${ext.sources.length} files, ${used.size} subcommands, ` +
        `${pairs.size} subcommand+flag pairs; CLI commands the extension ` +
        `never runs: ${unused.length ? unused.join(', ') : 'none'}`,
    );
  });
});

// --- The scan's own discriminators -------------------------------------------

/**
 * Positive controls, independent of the real sources. Each fixture is either a
 * construction shape the extension actually uses, a shape the scan accepts
 * because it provably cannot change the argv, or one it refuses to guess at.
 * Without them, a scan that quietly stopped reading (say) `args.push` would
 * still clear every floor above — measured: it takes the pair count to exactly
 * 35, and it is the "conditional pushes" fixture that kills it.
 */
describe('the contract scan itself', () => {
  const scan = (code, options) => scanSource(code, 'fixture.js', options);
  const flagsOf = (invocation) => invocation.flags.map((flag) => flag.name);
  const summary = (invocation) =>
    `${invocation.subcommand} ${flagsOf(invocation).join(' ')}`.trim();

  it('maps a command alias onto the command it names', () => {
    // Nothing in cli/index.js declares an alias today, so this is the only
    // thing exercising that half of contractFrom.
    const program = new Command();
    program.name('course').option('-v, --verbose', 'talk');
    program.command('status').alias('st').option('-m, --module <name>', 'one');
    const { commands, globalFlags } = contractFrom(program);

    assert.ok(commands.has('status'));
    assert.equal(commands.get('st'), commands.get('status'));
    assert.ok(commands.get('st').flags.has('--module'));
    assert.ok(globalFlags.has('--verbose'));
    assert.ok(globalFlags.has('--help'));
  });

  it('reads a terminal command map through the builder that returns it', () => {
    const { invocations } = scan(`
      const commands = { 'course.sync': 'npx course sync --dry-run' };
      function activate() {
        for (const [id, cmd] of Object.entries(commands)) {
          register(id, () => runInTerminal(() => cmd));
        }
      }
    `);
    assert.equal(invocations.length, 1);
    assert.equal(invocations[0].subcommand, 'sync');
    assert.deepEqual(flagsOf(invocations[0]), ['--dry-run']);
  });

  it('reads a quoting builder and treats the interpolation as a value', () => {
    const { invocations } = scan(
      'function f(name) { runInTerminal((q) => `npx course push --module ${q(name)}`); }',
    );
    assert.equal(invocations.length, 1);
    assert.equal(invocations[0].subcommand, 'push');
    assert.deepEqual(flagsOf(invocations[0]), ['--module']);
    assert.deepEqual(invocations[0].values, [VALUE]);
  });

  it('folds an interpolated flag into both command lines it produces', () => {
    const { invocations } = scan(
      'function f(x) { const flag = x ? " --flagged" : ""; ' +
        'runInTerminal(() => `npx course export${flag} --format pdf`); }',
    );
    assert.deepEqual(invocations.map(summary).sort(), [
      'export --flagged --format',
      'export --format',
    ]);
  });

  it('reads an argv array together with its conditional pushes', () => {
    const { invocations } = scan(`
      async function handler(sub) {
        const args = ['new-item', '--module', 'm', '--type', 'file'];
        if (sub) args.push('--subsection', sub);
        await runCli(args);
      }
    `);
    assert.equal(invocations.length, 1);
    assert.deepEqual(flagsOf(invocations[0]), [
      '--module',
      '--type',
      '--subsection',
    ]);
  });

  it('keeps two same-named argv arrays in one function apart', () => {
    // The shape at CourseTreeProvider.js:367 and :421 — one handler, two
    // branches, a `const args` in each. Function-level scoping reads that as an
    // ambiguity and resolves neither.
    const { invocations } = scan(`
      async function handler(x) {
        if (x) {
          const args = ['rename-item', '--path', p];
          await runCli(args);
        } else {
          const args = ['delete-item', '--yes'];
          await runCli(args);
        }
      }
    `);
    assert.deepEqual(invocations.map(summary).sort(), [
      'delete-item --yes',
      'rename-item --path',
    ]);
  });

  it('fans a ternary argv element out into both argv lists', () => {
    const { invocations } = scan(
      "function f(c) { runCli(['sync', c ? '--prune-canvas' : '--prune-local']); }",
    );
    assert.deepEqual(invocations.map(summary).sort(), [
      'sync --prune-canvas',
      'sync --prune-local',
    ]);
  });

  it('fans a ternary between two whole argv arrays out as well', () => {
    const { invocations } = scan(`
      function f(c) {
        const args = c ? ['sync', '--dry-run'] : ['push', '--prune-canvas'];
        runCli(args);
      }
    `);
    assert.deepEqual(invocations.map(summary).sort(), [
      'push --prune-canvas',
      'sync --dry-run',
    ]);
  });

  it('reads the flag out of an interpolated argv element', () => {
    const { invocations } = scan(
      'function f(n) { runCli(["move-item", `--position=${n}`]); }',
    );
    assert.deepEqual(flagsOf(invocations[0]), ['--position']);
  });

  it('reports an argv flag at its own line, not at the runner call', () => {
    const { invocations } = scan(
      [
        'async function handler(sub) {',
        "  const args = ['new-item', '--module', m];",
        "  if (sub) args.push('--subsection', sub);",
        '  await runCli(args);',
        '}',
      ].join('\n'),
    );
    const flags = invocations[0].flags;
    assert.equal(flags.find((f) => f.name === '--module').at, 'fixture.js:2');
    assert.equal(
      flags.find((f) => f.name === '--subsection').at,
      'fixture.js:3',
    );
    assert.equal(invocations[0].at, 'fixture.js:4');
  });

  it('ignores a command line that only appears in a comment', () => {
    const { invocations, strayLines } = scan(
      '// runInTerminal(() => `npx course push --module x`);\n' +
        'function f() { runCli(["validate"]); }',
    );
    assert.deepEqual(
      invocations.map((i) => i.subcommand),
      ['validate'],
    );
    assert.deepEqual(strayLines, []);
  });

  it('reports a command line built outside a builder', () => {
    const { strayLines } = scan(
      'function f() { terminal.sendText("npx course sync --dry-run"); }',
    );
    assert.equal(strayLines.length, 1);
    assert.match(strayLines[0], /npx course sync --dry-run/);
  });

  it('surfaces a bogus flag and a bogus subcommand as themselves', () => {
    const { invocations } = scan(
      'function f() { runCli(["synk", "--not-a-flag"]); }',
    );
    assert.equal(invocations[0].subcommand, 'synk');
    assert.deepEqual(flagsOf(invocations[0]), ['--not-a-flag']);
  });

  describe('accepts a use that cannot change the argv', () => {
    const reads = {
      'a length check': "if (args.length > 1) { log('long'); }",
      'a join, the way runCli logs its own argv':
        "log(`$ course ${args.join(' ')}`);",
      'an includes check': "if (args.includes('--yes')) { log('forced'); }",
      'a slice': 'log(args.slice(1));',
      'an index read': 'log(args[0]);',
      'an index read inside a template': 'log(`running ${args[0]}`);',
    };
    for (const [name, use] of Object.entries(reads)) {
      it(name, () => {
        const { invocations } = scan(
          `function f() { const args = ['sync', '--dry-run']; ${use} runCli(args); }`,
        );
        assert.equal(invocations.length, 1, name);
        assert.equal(summary(invocations[0]), 'sync --dry-run');
      });
    }

    it('and a call that is listed as read-only', () => {
      const source =
        "function f() { const args = ['sync']; log(args); runCli(args); }";
      assert.throws(() => scan(source), /handed to log/);
      const { invocations } = scan(source, {
        readOnlyCallees: new Set(['log']),
      });
      assert.equal(summary(invocations[0]), 'sync');
    });
  });

  describe('reports an argv handed to a runner it does not know', () => {
    const cases = {
      'as the only argument': 'queueCli(["push", "--dry-run"])',
      'as a later argument': 'queueCli(opts, ["push", "--dry-run"])',
      'inside an options object': 'queueCli({ argv: ["push", "--dry-run"] })',
      'with a flag at the head': 'queueCli(["--dry-run", "push"])',
      'through a variable': 'const a = ["push"]; queueCli(a)',
      'as a method call': 'this._actions.queueCli(["push"])',
      'as a constructor': 'new QueueCli(["push", "--dry-run"])',
    };
    for (const [name, source] of Object.entries(cases)) {
      it(name, () => {
        const { invocations, unknownRunners } = scan(
          `function f(opts) { ${source}; }`,
        );
        assert.deepEqual(invocations, []);
        assert.equal(unknownRunners.length, 1, source);
        assert.match(unknownRunners[0], /QueueCli\(\[|queueCli\(\[/);
      });
    }

    it('unless the callee is listed as not a runner', () => {
      const source = 'function f() { showQuickPick(["PDF", "DOCX"]); }';
      assert.equal(scan(source).unknownRunners.length, 1);
      assert.deepEqual(
        scan(source, { notRunners: new Set(['showQuickPick']) }).unknownRunners,
        [],
      );
    });
  });

  describe('refuses what it cannot read rather than dropping it', () => {
    const refusals = {
      'a computed subcommand': [
        'function f(x) { runInTerminal(() => `npx course ${x} --dry-run`); }',
        /computed at runtime/,
      ],
      'an argv that is not a literal array': [
        'function f(x) { runCli(x); }',
        /not a literal array/,
      ],
      'a reassigned argv': [
        "function f(c) { let args = ['sync']; if (c) args = ['push']; runCli(args); }",
        /given a new array/,
      ],
      'a spliced argv': [
        "function f() { const args = ['sync']; args.splice(1, 0, '--dry-run'); runCli(args); }",
        /args\.splice/,
      ],
      'an unshifted argv': [
        "function f() { const args = ['sync']; args.unshift('--verbose'); runCli(args); }",
        /args\.unshift/,
      ],
      'an index write into the argv': [
        "function f() { const args = ['sync']; args[1] = '--dry-run'; runCli(args); }",
        /replaced by index/,
      ],
      'a member this scan does not know to be read-only': [
        "function f() { const args = ['sync']; args.mystery(); runCli(args); }",
        /READ_ONLY_MEMBERS/,
      ],
      'an argv handed to something that could change it': [
        "function f() { const args = ['sync']; decorate(args); runCli(args); }",
        /handed to decorate/,
      ],
      'a push whose flag is computed': [
        "function f(fl) { const args = ['sync']; const add = (x) => args.push(x); add(fl); runCli(args); }",
        /first value pushed here is computed/,
      ],
      'a spread in the array': [
        "function f(rest) { runCli(['sync', ...rest]); }",
        /spread hides/,
      ],
      'a spread in a push': [
        "function f(rest) { const args = ['sync']; args.push(...rest); runCli(args); }",
        /spread hides/,
      ],
      'a hole in the array': [
        "function f() { runCli(['sync', , '--dry-run']); }",
        /hole in it/,
      ],
      'an empty argv': ['function f() { runCli([]); }', /empty argv/],
      'a builder that is not a function': [
        'function f() { runInTerminal("npx course sync"); }',
        /takes a builder function/,
      ],
    };
    for (const [name, [source, pattern]] of Object.entries(refusals)) {
      it(name, () => {
        assert.throws(() => scan(source), /fixture\.js:\d+: /, name);
        assert.throws(() => scan(source), pattern, name);
      });
    }
  });
});
