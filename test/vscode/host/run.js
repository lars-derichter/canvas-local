const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  downloadAndUnzipVSCode,
  resolveCliPathFromVSCodeExecutablePath,
} = require('@vscode/test-electron');

/**
 * Boots a real VS Code and runs `smoke.js` inside its extension host.
 *
 * `npm run test:vscode`, and deliberately not `npm test`: the first run
 * downloads about 130MB of VS Code, which is not something a routine test run
 * should do to someone.
 *
 * The shape, which is not the shape the `@vscode/test-electron` README shows:
 *
 * - **The extension is installed from its `.vsix`**, into a throwaway
 *   extensions directory, rather than loaded from `.vscode/extensions/`. That
 *   is the difference between testing the repository folder and testing the
 *   artifact, and it is the check `docs/roadmap.md` names as the precondition
 *   for bundling dotenv: a dependency that resolves against the repository's
 *   own `node_modules` during `node --test` has nothing to resolve against
 *   once installed, and only a packaged run can see that coming.
 * - **`harness/` is loaded as the development extension.** VS Code runs
 *   `--extensionTestsPath` only in extension development mode, and passing the
 *   real extension there would load it as a development extension instead of
 *   an installed one. So the development extension is an empty manifest that
 *   contributes nothing, and the extension under test stays installed.
 * - **The environment is scrubbed before the host is spawned.** Every VS Code
 *   process sets `ELECTRON_RUN_AS_NODE=1` and a wall of `VSCODE_*` variables
 *   in its children, so running this from VS Code's own integrated terminal —
 *   where an extension author runs everything — starts the downloaded Electron
 *   as a Node interpreter and it dies on `bad option: --extensionTestsPath`.
 *   `runTests()` from `@vscode/test-electron` does not scrub them.
 * - **The run is bounded.** A wedged extension host is a CI job that never
 *   finishes rather than one that fails, and neither `runTests()` nor Electron
 *   has a timeout of its own. This spawns the host itself so it can kill the
 *   process tree when the bound is reached.
 *
 * Environment:
 * - `CCB_VSCODE_VERSION` — which VS Code to run. Defaults to the floor in the
 *   extension's `engines.vscode`, so CI is reproducible and the floor is a
 *   claim the test actually makes. `stable` is worth a run now and then.
 * - `CCB_VSCODE_TIMEOUT_MS` — the bound on the host run.
 */

const ROOT = path.join(__dirname, '..', '..', '..');
const EXTENSION_DIR = path.join(
  ROOT,
  '.vscode',
  'extensions',
  'course-manager',
);
const VSIX = path.join(EXTENSION_DIR, 'coursewright.vsix');

/**
 * The downloaded VS Code. Inside the repository, gitignored, and the one thing
 * here worth caching in CI.
 */
const CACHE_DIR = path.join(ROOT, '.vscode-test');

/**
 * The window state of the run, thrown away and rebuilt every time.
 *
 * Outside the repository because throwaway state does not belong in somebody's
 * checkout, and because it leaves `.vscode-test/` holding nothing but the
 * downloaded editor, which is the only part of this worth caching in CI.
 *
 * The short name is a precaution, not a fix for anything reproduced. VS Code
 * opens a Unix domain socket in here and warns when the path passes the
 * 103-character limit on one — but it survives that: a 210-character path
 * under this checkout warned and still ran every case green on macOS 1.93.
 * What did fail, twice, was a deep directory under the system temp root, which
 * warned and then died on `ENOENT … unlink <dir>/1.93-main.sock` at 162
 * characters. Length alone is not the rule, and this does not claim to know
 * what is; it keeps the path short and stays out of the way.
 */
const USER_DATA_DIR = path.join(os.tmpdir(), 'ccb-smoke-user-data');

/**
 * Where the `.vsix` is installed, and the path whose location is an assertion
 * rather than a convenience: it must not be under the repository.
 *
 * Node resolves a `require` by walking up from the requiring file, so an
 * extension installed anywhere inside this checkout — `.vscode-test/extensions`
 * being the obvious place — reaches the repository's own `node_modules` a few
 * levels up. A dependency missing from the package then resolves anyway, and
 * the packaging failure this whole file exists to make visible stays invisible
 * (`docs/roadmap.md`, "Bundling dotenv Into the Extension"). Measured, not
 * assumed: with the extensions directory under `.vscode-test/`, an unbundled
 * `require('dotenv')` added to `helpers.js` activated cleanly and all cases
 * passed. Out here the same edit fails at activation, which is what an install
 * does.
 */
const EXTENSIONS_DIR = path.join(os.tmpdir(), 'ccb-smoke-extensions');

const HARNESS_DIR = path.join(__dirname, 'harness');
const SMOKE_PATH = path.join(__dirname, 'smoke.js');

const DEFAULT_VERSION = '1.93.0';
const DEFAULT_TIMEOUT_MS = 180000;

/** How long a killed host gets to go quietly before it is killed again. */
const GRACE_MS = 5000;

/**
 * The child's environment, minus what a VS Code process puts in its children.
 *
 * `ELECTRON_RUN_AS_NODE` is the one that matters: it turns the downloaded
 * Electron into a Node interpreter, which then reads VS Code's own command
 * line as Node options and exits. `VSCODE_*` is scrubbed alongside it because
 * those name the *running* editor — its IPC socket, its pid, its extension
 * host entry point — and none of them describes the window this is booting.
 */
function hostEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (
      key.startsWith('VSCODE_') ||
      key === 'ELECTRON_RUN_AS_NODE' ||
      key === 'ELECTRON_NO_ATTACH_CONSOLE'
    ) {
      delete env[key];
    }
  }
  return env;
}

/** Kill a child and everything it started, which for Electron is a lot. */
function killTree(pid, signal) {
  if (process.platform === 'win32') {
    // Killing a Windows process orphans its children rather than taking them
    // with it, so the tree has to be named explicitly.
    cp.spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return;
  }
  // Spawned detached, so the child leads its own process group and a negative
  // pid reaches the whole group.
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // Already gone, which is the outcome this wanted.
    }
  }
}

/**
 * Run a command to completion, or kill it and everything under it when
 * `timeoutMs` runs out. Resolves with the exit code; rejects only when the
 * command could not be started at all.
 */
function spawnBounded(command, args, timeoutMs) {
  // VS Code's Windows CLI is `bin/code.cmd`, and since CVE-2024-27980 Node
  // refuses to spawn a `.cmd` or `.bat` without a shell. Through a shell every
  // value carries its own quotes rather than being argued about: a Windows
  // path cannot contain a double quote, so wrapping in them is quoting nothing
  // can escape out of.
  const viaShell =
    process.platform === 'win32' && /\.(cmd|bat)$/i.test(command);
  const quoted = (value) => `"${value}"`;

  return new Promise((resolve, reject) => {
    const child = cp.spawn(
      viaShell ? quoted(command) : command,
      viaShell ? args.map(quoted) : args,
      {
        env: hostEnv(),
        stdio: ['ignore', 'inherit', 'inherit'],
        shell: viaShell,
        detached: process.platform !== 'win32',
        windowsHide: true,
      },
    );

    let timedOut = false;
    let hardKill;
    const timer = setTimeout(() => {
      timedOut = true;
      process.stderr.write(
        `\ntest:vscode: no exit after ${timeoutMs}ms, killing the host\n`,
      );
      killTree(child.pid, 'SIGTERM');
      hardKill = setTimeout(() => {
        process.stderr.write('test:vscode: it ignored SIGTERM, SIGKILL\n');
        killTree(child.pid, 'SIGKILL');
      }, GRACE_MS);
      hardKill.unref?.();
    }, timeoutMs);

    child.on('error', (error) => {
      clearTimeout(timer);
      clearTimeout(hardKill);
      reject(error);
    });
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      clearTimeout(hardKill);
      resolve({ code, signal, timedOut });
    });
  });
}

/** Say what went wrong, in one line, and stop. */
function fail(message) {
  process.stderr.write(`test:vscode: ${message}\n`);
  process.exit(1);
}

async function main() {
  if (!fs.existsSync(VSIX)) {
    fail(
      `no packaged extension at ${path.relative(ROOT, VSIX)}. This test runs ` +
        'against the .vsix rather than the source folder, so run it as ' +
        '`npm run test:vscode`, which packages it first.',
    );
  }

  const version = process.env.CCB_VSCODE_VERSION || DEFAULT_VERSION;
  const timeoutMs =
    Number(process.env.CCB_VSCODE_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;

  const executable = await downloadAndUnzipVSCode({
    version,
    cachePath: CACHE_DIR,
  });
  const cli = resolveCliPathFromVSCodeExecutablePath(executable);

  // Both directories are rebuilt every run. A stale install would let a
  // command that no longer exists answer for itself, and a stale user-data
  // directory remembers which views were open, which decides whether the
  // extension is already awake when the first case asserts that it is not.
  fs.rmSync(EXTENSIONS_DIR, { recursive: true, force: true });
  fs.rmSync(USER_DATA_DIR, { recursive: true, force: true });

  const install = await spawnBounded(
    cli,
    [
      '--install-extension',
      VSIX,
      '--extensions-dir',
      EXTENSIONS_DIR,
      '--user-data-dir',
      USER_DATA_DIR,
    ],
    timeoutMs,
  );
  if (install.code !== 0) {
    fail(
      `installing ${path.basename(VSIX)} exited ${install.code ?? install.signal}`,
    );
  }

  const host = await spawnBounded(
    executable,
    [
      ROOT,
      // The first two are what `@vscode/test-electron` passes on every
      // platform: Electron's sandbox needs privileges a CI container does not
      // hand out, and without them the host never starts there.
      '--no-sandbox',
      '--disable-gpu-sandbox',
      '--disable-updates',
      '--skip-welcome',
      '--skip-release-notes',
      // An untrusted folder opens in Restricted Mode, where an extension that
      // has not declared itself safe for one — this one has not — is not
      // activated at all, and every case below would fail for that reason
      // rather than any real one.
      '--disable-workspace-trust',
      // What makes the sidebar draw on a Windows runner. Chromium decides
      // there whether a window is covered by other windows and stops painting
      // the ones that are; a session with no desktop to draw on can look that
      // way from the inside, and a window that never paints never lays out the
      // sidebar. Linux is unaffected because xvfb gives it a real if virtual
      // display.
      //
      // Measured rather than assumed, and it took two runs to ask the question
      // cleanly. Without this line the sidebar case waited its full twenty
      // seconds and saw nothing; the run that would have confirmed the fix
      // failed earlier still, on a require-cache problem that had nothing to
      // do with painting. With both settled, that case reports `ok` in about
      // fifty milliseconds on Windows and skips nothing.
      ...(process.platform === 'win32'
        ? ['--disable-features=CalculateNativeWinOcclusion']
        : []),
      `--extensionDevelopmentPath=${HARNESS_DIR}`,
      `--extensionTestsPath=${SMOKE_PATH}`,
      `--extensions-dir=${EXTENSIONS_DIR}`,
      `--user-data-dir=${USER_DATA_DIR}`,
    ],
    timeoutMs,
  );

  if (host.timedOut) {
    fail(
      `the extension host did not finish within ${timeoutMs}ms and was ` +
        'killed. It hung; the last case it reported is where.',
    );
  }
  if (host.code !== 0) {
    fail(`the extension host exited ${host.code ?? host.signal}`);
  }
  process.stdout.write(`\ntest:vscode: passed against VS Code ${version}\n`);
}

main().catch((error) => fail(error && error.stack ? error.stack : error));
