import { createInterface } from 'node:readline/promises';
import type { AccountView } from './types.js';
import type { AccountManager } from './accountManager.js';
import { SYMBOLS, formatRelative } from './format.js';
import { makeColors } from './color.js';
import { orderAccounts } from './order.js';
import { runDoctor, buildDoctorDeps } from './doctor.js';

export type MenuAction =
  | { type: 'switch'; name: string }
  | { type: 'rename' }
  | { type: 'doctor' }
  | { type: 'quit' };

export interface MenuChoice {
  label: string;
  action: MenuAction;
}

function pad(s: string, width: number): string {
  return s.length >= width ? s : s + ' '.repeat(width - s.length);
}

/** One numbered switch row per account, in the same order as `list` so the numbers match. Pure. */
export function buildMenuChoices(accounts: AccountView[]): MenuChoice[] {
  const ordered = orderAccounts(accounts);
  if (!ordered.length) return [];
  const emailW = Math.max(...ordered.map((a) => a.email.length));
  return ordered.map((a, i) => {
    const mark = a.active ? SYMBOLS.active : ' ';
    const when = a.active ? 'active' : formatRelative(a.savedAt, Date.now());
    const org = a.organizationName ? `  ${a.organizationName}` : '';
    return {
      label: `${i + 1}  ${mark} ${pad(a.email, emailW)}${org}  ${when}`,
      action: { type: 'switch', name: a.name },
    };
  });
}

/** Everything the menu needs from the outside world — injected so dispatch/runMenu are testable. */
export interface MenuIO {
  pick(title: string, choices: MenuChoice[]): Promise<MenuChoice | null>;
  ask(question: string): Promise<string>;
  confirm(question: string): Promise<boolean>;
  doctor(): Promise<string>;
  out(s: string): void;
}

function accountChoices(views: AccountView[]): MenuChoice[] {
  return orderAccounts(views).map((v) => ({ label: v.email, action: { type: 'switch', name: v.name } }));
}

/** Run one menu action against the manager. Pure of any TTY concerns. */
export async function dispatchMenu(manager: AccountManager, action: MenuAction, io: MenuIO): Promise<void> {
  switch (action.type) {
    case 'quit':
      return;
    case 'switch':
      try {
        await manager.switchTo(action.name);
        io.out(`${SYMBOLS.ok} Now using ${action.name}`);
      } catch (e) {
        io.out(`${SYMBOLS.err} ${(e as Error).message}`);
      }
      return;
    case 'doctor':
      io.out(await io.doctor());
      return;
    case 'rename': {
      const views = await manager.listAccounts();
      if (!views.length) {
        io.out('No saved accounts.');
        return;
      }
      const choice = await io.pick('Rename which account?', accountChoices(views));
      if (!choice || choice.action.type !== 'switch') return;
      const oldName = choice.action.name;
      const newName = (await io.ask(`New name for ${oldName}: `)).trim();
      if (!newName) {
        io.out('Cancelled.');
        return;
      }
      try {
        await manager.renameAccount(oldName, newName);
        io.out(`${SYMBOLS.ok} Renamed ${oldName} → ${newName}`);
      } catch (e) {
        io.out(`${SYMBOLS.err} ${(e as Error).message}`);
      }
      return;
    }
  }
}

/** Reconcile, show the menu, run the chosen action. Testable via an injected MenuIO. */
export async function runMenu(manager: AccountManager, io: MenuIO): Promise<void> {
  try {
    await manager.reconcileOnChange();
  } catch {
    /* ignore */
  }
  const accounts = await manager.listAccounts();
  const choice = await io.pick(`claudep · ${accounts.length} account${accounts.length === 1 ? '' : 's'}`, buildMenuChoices(accounts));
  if (!choice) return;
  await dispatchMenu(manager, choice.action, io);
}

/* v8 ignore start -- raw-TTY interaction: needs a real terminal, not unit-testable */
const DIVIDER = '──────────────────────────────────────────';

/**
 * Raw-TTY selector. Arrow keys (or j/k, scroll) move through the account rows; Enter or a number key
 * (1-9) picks one to switch. Action hotkeys work anywhere: r rename · d doctor · q/Esc/Ctrl-C quit.
 * Resolves to the chosen MenuChoice, a synthetic rename/doctor choice, or null (quit / not a TTY).
 */
function interactiveSelect(title: string, choices: MenuChoice[]): Promise<MenuChoice | null> {
  const stdin = process.stdin;
  const stdout = process.stdout;
  const colors = makeColors(stdout.isTTY === true && !process.env.NO_COLOR);
  const rename: MenuChoice = { label: 'rename', action: { type: 'rename' } };
  const doctor: MenuChoice = { label: 'doctor', action: { type: 'doctor' } };

  return new Promise((resolve) => {
    if (!stdin.isTTY) {
      resolve(null);
      return;
    }
    let selected = Math.max(0, choices.findIndex((c) => c.label.includes(SYMBOLS.active)));

    const header = `  ${colors.bold('claudep')} ${colors.dim(title.replace(/^claudep\s*/, ''))}`;
    const footer = `  ${colors.cyan('r')} ${colors.dim('rename')}   ${colors.cyan('d')} ${colors.dim('doctor')}   ${colors.cyan('q')} ${colors.dim('quit')}`;
    const hint = colors.dim('  ↑/↓ move · ↵ switch · 1-9 pick · q quit');
    const chrome = 4; // header, divider, divider(after rows), footer+hint block lines rendered around list

    stdout.write(`${header}\n${colors.dim(`  ${DIVIDER}`)}\n`);
    if (!choices.length) stdout.write(colors.dim('  (no saved accounts yet)\n'));

    const render = (first: boolean) => {
      if (!first) stdout.write(`\x1b[${choices.length + chrome}A`);
      for (let i = 0; i < choices.length; i++) {
        const active = i === selected;
        const line = active ? `${colors.cyan('❯')} ${choices[i]!.label}` : `  ${choices[i]!.label}`;
        stdout.write(`\x1b[2K\r${line}\n`);
      }
      stdout.write(`\x1b[2K\r${colors.dim(`  ${DIVIDER}`)}\n`);
      stdout.write(`\x1b[2K\r${footer}\n`);
      stdout.write(`\x1b[2K\r\n`);
      stdout.write(`\x1b[2K\r${hint}\n`);
    };
    render(true);

    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    stdout.write('\x1b[?1000h\x1b[?1006h'); // enable mouse reporting (X10 + SGR)

    const move = (delta: number) => {
      if (!choices.length) return;
      selected = (selected + delta + choices.length) % choices.length;
      render(false);
    };
    const finish = (result: MenuChoice | null) => {
      stdout.write('\x1b[?1000l\x1b[?1006l');
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      resolve(result);
    };
    const onData = (data: string) => {
      const mouse = /\x1b\[<(\d+);\d+;\d+[Mm]/.exec(data);
      if (mouse) {
        const btn = Number(mouse[1]);
        if (btn === 64) move(-1);
        else if (btn === 65) move(1);
        return;
      }
      if (data === '\x1b[A' || data === '\x1bOA' || data === 'k') return move(-1);
      if (data === '\x1b[B' || data === '\x1bOB' || data === 'j') return move(1);
      if (data === 'r') return finish(rename);
      if (data === 'd') return finish(doctor);
      if (data === '\r' || data === '\n') return finish(choices[selected] ?? null);
      if (data === '\x03' || data === 'q' || data === '\x1b') return finish(null);
      if (data.length === 1 && data >= '1' && data <= '9') {
        const i = Number(data) - 1;
        if (i < choices.length) finish(choices[i]!);
      }
    };
    stdin.on('data', onData);
  });
}

/** Build the real TTY-backed MenuIO and run the menu. */
export async function runInteractiveMenu(manager: AccountManager, out: (s: string) => void): Promise<void> {
  const io: MenuIO = {
    pick: (title, choices) => interactiveSelect(title, choices),
    ask: async (q) => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const a = await rl.question(q);
      rl.close();
      return a;
    },
    confirm: async (q) => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const a = (await rl.question(`${q} [y/N] `)).trim().toLowerCase();
      rl.close();
      return a === 'y' || a === 'yes';
    },
    doctor: async () => (await runDoctor(buildDoctorDeps())).report,
    out,
  };
  await runMenu(manager, io);
}
/* v8 ignore stop */
