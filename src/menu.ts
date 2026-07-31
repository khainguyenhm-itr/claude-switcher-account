import { createInterface } from 'node:readline/promises';
import type { AccountView } from './types.js';
import type { AccountManager } from './accountManager.js';
import { SYMBOLS } from './format.js';
import { runDoctor, buildDoctorDeps } from './doctor.js';

export type MenuAction =
  | { type: 'switch'; name: string }
  | { type: 'rename' }
  | { type: 'remove' }
  | { type: 'doctor' }
  | { type: 'quit' };

export interface MenuChoice {
  label: string;
  action: MenuAction;
}

/** Build the top-level menu: one entry per saved account (switch), then actions. Pure + testable. */
export function buildMenuChoices(accounts: AccountView[]): MenuChoice[] {
  const choices: MenuChoice[] = accounts.map((a) => ({
    label: `${a.active ? SYMBOLS.active : ' '} ${a.email}${a.organizationName ? `  (${a.organizationName})` : ''}${
      a.active ? '  — active' : ''
    }`,
    action: { type: 'switch', name: a.name },
  }));
  if (accounts.length) {
    choices.push({ label: 'Rename an account…', action: { type: 'rename' } });
    choices.push({ label: 'Remove an account…', action: { type: 'remove' } });
  }
  choices.push({ label: 'Doctor', action: { type: 'doctor' } });
  choices.push({ label: 'Quit', action: { type: 'quit' } });
  return choices;
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
  return views.map((v) => ({ label: v.email, action: { type: 'switch', name: v.name } }));
}

/** Run one menu action against the manager. Pure of any TTY concerns. */
export async function dispatchMenu(manager: AccountManager, action: MenuAction, io: MenuIO): Promise<void> {
  switch (action.type) {
    case 'quit':
      return;
    case 'switch':
      try {
        await manager.switchTo(action.name);
        io.out(`${SYMBOLS.ok} Switched to ${action.name}`);
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
    case 'remove': {
      const views = await manager.listAccounts();
      if (!views.length) {
        io.out('No saved accounts.');
        return;
      }
      const choice = await io.pick('Remove which account?', accountChoices(views));
      if (!choice || choice.action.type !== 'switch') return;
      const name = choice.action.name;
      const ok = await io.confirm(`Remove '${name}'? This deletes its stored credential.`);
      if (!ok) {
        io.out('Cancelled.');
        return;
      }
      await manager.removeAccount(name);
      io.out(`${SYMBOLS.ok} Removed ${name}`);
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
  const choices = buildMenuChoices(await manager.listAccounts());
  const choice = await io.pick('claude-p — pick an account to switch to, or an action:', choices);
  if (!choice) return;
  await dispatchMenu(manager, choice.action, io);
}

/* v8 ignore start -- raw-TTY interaction: needs a real terminal, not unit-testable */
/**
 * Raw-TTY arrow/scroll/number selector. Keyboard: ↑/↓ or j/k to move, Enter to pick, 1-9 quick-pick,
 * q/Esc/Ctrl-C to cancel. Mouse: wheel scrolls the highlight (click isn't reliably mappable across
 * terminals, so it's intentionally not wired). Resolves null when cancelled or stdin is not a TTY.
 */
function interactiveSelect(title: string, choices: MenuChoice[]): Promise<MenuChoice | null> {
  const stdin = process.stdin;
  const stdout = process.stdout;
  return new Promise((resolve) => {
    if (!stdin.isTTY) {
      resolve(null);
      return;
    }
    let selected = Math.max(0, choices.findIndex((c) => c.label.startsWith(SYMBOLS.active)));

    stdout.write(`${title}\n`);
    stdout.write('  ↑/↓ or scroll · Enter to select · 1-9 quick · q to cancel\n');

    const render = (first: boolean) => {
      if (!first) stdout.write(`\x1b[${choices.length}A`);
      for (let i = 0; i < choices.length; i++) {
        const active = i === selected;
        const line = active ? `\x1b[36m❯ ${choices[i]!.label}\x1b[0m` : `  ${choices[i]!.label}`;
        stdout.write(`\x1b[2K\r${line}\n`);
      }
    };
    render(true);

    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    stdout.write('\x1b[?1000h\x1b[?1006h'); // enable mouse reporting (X10 + SGR)

    const move = (delta: number) => {
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
