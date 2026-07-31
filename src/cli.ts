import { Command } from 'commander';
import { createInterface } from 'node:readline/promises';
import { AccountManager } from './accountManager.js';
import { createManager } from './app.js';
import { formatList, formatCurrent, SYMBOLS } from './format.js';
import { runDoctor, buildDoctorDeps } from './doctor.js';

export interface CliDeps {
  manager?: AccountManager;
  now?: () => number;
  out?: (s: string) => void;
  confirm?: (question: string) => Promise<boolean>;
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

  const program = new Command();
  program.name('claude-p').description('Switch between Claude Code logins').version('1.0.0').exitOverride();

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

  return program;
}
