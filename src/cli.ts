import { Command } from 'commander';
import { createInterface } from 'node:readline/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { AccountManager } from './accountManager.js';
import { createManager } from './app.js';
import { formatList, formatCurrent, SYMBOLS } from './format.js';
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

  const program = new Command();
  program.name('claude-p').description('Switch between Claude Code logins').version(VERSION).exitOverride();

  // No subcommand → interactive menu (pick an account to switch, or an action). Falls back to help
  // when not attached to a terminal (e.g. piped), so scripts still get usage text.
  program.action(async () => {
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
      out(formatVersion(await checkUpdate(VERSION)));
    });

  // Run reconcile before each command (best-effort — never blocks the command).
  async function reconcileFirst(mgr: AccountManager): Promise<void> {
    try {
      await mgr.reconcileOnChange();
    } catch {
      /* ignore */
    }
  }

  program
    .command('list')
    .alias('ls')
    .description('List saved accounts')
    .option('--json', 'machine-readable output')
    .action(async (opts: { json?: boolean }) => {
      const mgr = manager();
      await reconcileFirst(mgr);
      const views = await mgr.listAccounts();
      out(opts.json ? JSON.stringify(views, null, 2) : formatList(views, now()));
    });

  program
    .command('current')
    .alias('status')
    .description('Show the active login')
    .action(async () => {
      const mgr = manager();
      await reconcileFirst(mgr);
      out(formatCurrent(mgr.current()));
    });

  program
    .command('switch <name>')
    .alias('use')
    .description('Make <name> the active login')
    .action(async (name: string) => {
      const mgr = manager();
      await reconcileFirst(mgr);
      try {
        await mgr.switchTo(name);
        out(`${SYMBOLS.ok} Switched to ${name}\n  Running \`claude\` sessions keep the old login until restarted.`);
      } catch (e) {
        out(`${SYMBOLS.err} ${(e as Error).message}`);
        process.exitCode = 1;
      }
    });

  program
    .command('remove <name>')
    .alias('rm')
    .description('Forget a saved account')
    .option('-y, --yes', 'skip confirmation')
    .action(async (name: string, opts: { yes?: boolean }) => {
      const mgr = manager();
      await reconcileFirst(mgr);
      if (!opts.yes) {
        const ok = await confirm(`Remove saved account '${name}'? This deletes its stored credential.`);
        if (!ok) {
          out('Cancelled.');
          return;
        }
      }
      await mgr.removeAccount(name);
      out(`${SYMBOLS.ok} Removed ${name}`);
    });

  program
    .command('rename <old> <new>')
    .description('Relabel a saved account')
    .action(async (oldName: string, newName: string) => {
      const mgr = manager();
      await reconcileFirst(mgr);
      try {
        await mgr.renameAccount(oldName, newName);
        out(`${SYMBOLS.ok} Renamed ${oldName} → ${newName}`);
      } catch (e) {
        out(`${SYMBOLS.err} ${(e as Error).message}`);
        process.exitCode = 1;
      }
    });

  program
    .command('doctor')
    .description('Diagnose credential path, config, and store')
    .action(async () => {
      const { ok, report } = await runDoctor(buildDoctorDeps());
      out(report);
      if (!ok) process.exitCode = 1;
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
        out(`${SYMBOLS.ok} ${msg}\n  Instant capture is on — new logins are saved automatically.`);
      } catch (e) {
        out(`${SYMBOLS.err} ${(e as Error).message}`);
        process.exitCode = 1;
      }
    });

  daemon
    .command('uninstall')
    .description('Remove the autostart watcher')
    .action(async () => {
      try {
        out(`${SYMBOLS.ok} ${await uninstallAutostart(process.platform)}`);
      } catch (e) {
        out(`${SYMBOLS.err} ${(e as Error).message}`);
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
          ? `${SYMBOLS.active} daemon autostart installed`
          : `${SYMBOLS.off} daemon not installed — run: claude-p daemon install`,
      );
    });
  /* v8 ignore stop */

  return program;
}
