import { Command } from 'commander';
import { createInterface } from 'node:readline/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { AccountManager } from './accountManager.js';
import { createManager } from './app.js';
import { formatList, SYMBOLS } from './format.js';
import { makeColors } from './color.js';
import { runDoctor, buildDoctorDeps } from './doctor.js';
import { VERSION, checkForUpdate, formatVersion, type UpdateInfo } from './version.js';
import { runInteractiveMenu } from './menu.js';
import { startDaemon } from './daemon.js';
import { installAutostart, uninstallAutostart, autostartInstalled, type AutostartPaths } from './autostart.js';

export interface CliDeps {
  manager?: AccountManager;
  now?: () => number;
  out?: (s: string) => void;
  confirm?: (question: string) => Promise<boolean>;
  checkUpdate?: (current: string) => Promise<UpdateInfo | null>;
  menu?: (manager: AccountManager, out: (s: string) => void) => Promise<void>;
}

async function defaultConfirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
  rl.close();
  return answer === 'y' || answer === 'yes';
}

export function buildProgram(deps: CliDeps = {}): Command {
  const out = deps.out ?? ((s: string) => console.log(s));
  const now = deps.now ?? (() => Date.now());
  const confirm = deps.confirm ?? defaultConfirm;
  const manager = () => deps.manager ?? createManager();
  const checkUpdate = deps.checkUpdate ?? ((current: string) => checkForUpdate(current));
  const runMenu = deps.menu ?? runInteractiveMenu;

  const useColor = process.stdout.isTTY === true && !process.env.NO_COLOR;
  const colors = makeColors(useColor);
  const ok = (s: string) => `  ${colors.green(SYMBOLS.ok)} ${s}`;
  const err = (s: string) => `  ${colors.red(SYMBOLS.err)} ${s}`;
  const note = (s: string) => colors.dim(`    ${s}`);
  const listHint = `run ${colors.cyan('claudep list')} to see saved accounts`;

  const program = new Command();
  program.name('claudep').description('Switch between Claude Code logins').version(VERSION).exitOverride();

  // Run reconcile before each command (best-effort — never blocks the command).
  async function reconcileFirst(mgr: AccountManager): Promise<void> {
    try {
      await mgr.reconcileOnChange();
    } catch {
      /* ignore */
    }
  }

  /** Switch to an account given a name or a 1-based index. `bareNumeric` rejects non-numeric input
   *  (used by the top-level `claudep <n>` shortcut, where a name would be a typo'd command). */
  async function switchByArg(mgr: AccountManager, arg: string, bareNumeric: boolean): Promise<void> {
    const isNum = /^\d+$/.test(arg);
    if (bareNumeric && !isNum) {
      out(err(`Unknown account '${arg}'`) + '\n' + note(listHint));
      process.exitCode = 1;
      return;
    }
    const name = isNum ? await mgr.resolveByIndex(Number(arg)) : arg;
    if (!name) {
      out(err(`No account #${arg}`) + '\n' + note(listHint));
      process.exitCode = 1;
      return;
    }
    try {
      await mgr.switchTo(name);
      out(ok(`Now using ${name}`) + '\n' + note('restart running claude sessions to apply'));
    } catch (e) {
      out(err((e as Error).message) + '\n' + note(listHint));
      process.exitCode = 1;
    }
  }

  // No subcommand → interactive menu; a bare integer → switch to that account. Falls back to help
  // when not attached to a terminal (e.g. piped), so scripts still get usage text.
  program
    .argument('[target]', 'account number to switch to')
    .action(async (target: string | undefined) => {
      if (target !== undefined) {
        const mgr = manager();
        await reconcileFirst(mgr);
        await switchByArg(mgr, target, true);
        return;
      }
      /* v8 ignore next 4 -- TTY guard: only reachable without an injected menu, needs a real terminal */
      if (!deps.menu && (!process.stdin.isTTY || !process.stdout.isTTY)) {
        out(program.helpInformation());
        return;
      }
      await runMenu(manager(), out);
    });

  program
    .command('version')
    .description('Show the version and check npm for a newer one')
    .action(async () => {
      out(formatVersion(await checkUpdate(VERSION), colors));
    });

  program
    .command('list')
    .aliases(['ls', 'status', 'current'])
    .description('List saved accounts')
    .option('--json', 'machine-readable output')
    .action(async (opts: { json?: boolean }) => {
      const mgr = manager();
      await reconcileFirst(mgr);
      const views = await mgr.listAccounts();
      if (opts.json) {
        out(JSON.stringify(views, null, 2));
        return;
      }
      const cur = mgr.current();
      const external = !cur.saved && cur.label ? cur.label.email : undefined;
      out(formatList(views, now(), colors, { external }));
    });

  program
    .command('switch <target>')
    .alias('use')
    .description('Make an account the active login (by name or number)')
    .action(async (target: string) => {
      const mgr = manager();
      await reconcileFirst(mgr);
      await switchByArg(mgr, target, false);
    });

  program
    .command('remove <target>')
    .alias('rm')
    .description('Forget a saved account (by name or number)')
    .option('-y, --yes', 'skip confirmation')
    .action(async (target: string, opts: { yes?: boolean }) => {
      const mgr = manager();
      await reconcileFirst(mgr);
      const name = /^\d+$/.test(target) ? await mgr.resolveByIndex(Number(target)) : target;
      if (!name) {
        out(err(`No account #${target}`) + '\n' + note(listHint));
        process.exitCode = 1;
        return;
      }
      if (!opts.yes) {
        const yes = await confirm(`Remove ${name}? This deletes its stored credential.`);
        if (!yes) {
          out('  Cancelled.');
          return;
        }
      }
      await mgr.removeAccount(name);
      out(ok(`Removed ${name}`));
    });

  program
    .command('rename <old> <new>')
    .description('Relabel a saved account')
    .action(async (oldName: string, newName: string) => {
      const mgr = manager();
      await reconcileFirst(mgr);
      try {
        await mgr.renameAccount(oldName, newName);
        out(ok(`Renamed ${oldName} ${colors.dim('→')} ${newName}`));
      } catch (e) {
        out(err((e as Error).message));
        process.exitCode = 1;
      }
    });

  program
    .command('doctor')
    .description('Diagnose credential path, config, and store')
    .action(async () => {
      const { ok: healthy, report } = await runDoctor(buildDoctorDeps(), colors);
      out(report);
      if (!healthy) process.exitCode = 1;
    });

  /* v8 ignore start -- daemon CLI glue is OS-mutating wiring; the logic it calls is unit-tested */
  const daemonPaths = (): AutostartPaths => ({
    nodePath: process.execPath,
    binPath: process.argv[1] ?? '',
    logPath: join(homedir(), '.claude-profiles', 'daemon.log'),
  });

  const daemon = program.command('daemon').description('Background watcher for instant capture/switch');

  daemon
    .command('run')
    .description('Run the watcher in the foreground (used by the OS autostart service)')
    .action(async () => {
      startDaemon(manager(), { log: out });
      await new Promise<never>(() => {}); // keep the process alive
    });

  daemon
    .command('install')
    .description('Install autostart so the watcher runs on login, and capture the current login now')
    .action(async () => {
      try {
        const msg = await installAutostart(process.platform, daemonPaths());
        await manager().reconcileOnChange().catch(() => undefined);
        out(ok(msg) + '\n' + note('instant capture is on — new logins are saved automatically'));
      } catch (e) {
        out(err((e as Error).message));
        process.exitCode = 1;
      }
    });

  daemon
    .command('uninstall')
    .description('Remove the autostart watcher')
    .action(async () => {
      try {
        out(ok(await uninstallAutostart(process.platform)));
      } catch (e) {
        out(err((e as Error).message));
        process.exitCode = 1;
      }
    });

  daemon
    .command('status')
    .description('Show whether the autostart watcher is installed')
    .action(() => {
      const on = autostartInstalled(process.platform);
      out(
        on
          ? `  ${colors.green(SYMBOLS.active)} daemon autostart installed`
          : `  ${colors.dim(`${SYMBOLS.off} daemon not installed`)}\n` + note(`run: ${colors.cyan('claudep daemon install')}`),
      );
    });
  /* v8 ignore stop */

  return program;
}
