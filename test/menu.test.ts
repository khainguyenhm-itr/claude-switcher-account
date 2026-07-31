import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildMenuChoices, dispatchMenu, runMenu, type MenuIO, type MenuChoice } from '../src/menu.js';
import { AccountManager } from '../src/accountManager.js';
import { MetadataStore } from '../src/metadataStore.js';
import { ProfileFile } from '../src/profileFile.js';
import type { AccountView, CredentialStore } from '../src/types.js';

function memStore() {
  return {
    canonical: '',
    saved: {} as Record<string, string>,
    isAvailable: () => true,
    async readCanonical() {
      return this.canonical;
    },
    async writeCanonical(b: string) {
      this.canonical = b;
    },
    async readSaved(n: string) {
      return this.saved[n] ?? '';
    },
    async writeSaved(n: string, b: string) {
      this.saved[n] = b;
    },
    async deleteSaved(n: string) {
      delete this.saved[n];
    },
  } as CredentialStore & { canonical: string; saved: Record<string, string> };
}

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'clp-menu-'));
  const store = memStore();
  const meta = new MetadataStore({ path: join(dir, 'accounts.json') });
  const profile = new ProfileFile({ path: join(dir, '.claude.json') });
  const mgr = new AccountManager({ store, meta, profile, config: { logoutBehavior: 'none' }, now: () => 'T0' });
  return { store, meta, mgr };
}

/** MenuIO stub: pick returns a scripted queue of choices; ask/confirm return fixed values. */
function stubIO(overrides: Partial<MenuIO> & { picks?: (MenuChoice | null)[] } = {}): MenuIO & { lines: string[] } {
  const lines: string[] = [];
  const picks = overrides.picks ?? [];
  return {
    lines,
    pick: overrides.pick ?? (async () => picks.shift() ?? null),
    ask: overrides.ask ?? (async () => ''),
    confirm: overrides.confirm ?? (async () => true),
    doctor: overrides.doctor ?? (async () => 'DOCTOR-REPORT'),
    out: (s: string) => lines.push(s),
  };
}

const view = (name: string, active = false): AccountView => ({ name, email: name, savedAt: 'T', active });

describe('buildMenuChoices', () => {
  it('lists accounts (switch) plus rename/remove/doctor/quit', () => {
    const choices = buildMenuChoices([view('a@x.com', true), view('b@x.com')]);
    expect(choices[0]).toMatchObject({ action: { type: 'switch', name: 'a@x.com' } });
    const types = choices.map((c) => c.action.type);
    expect(types).toEqual(['switch', 'switch', 'rename', 'remove', 'doctor', 'quit']);
    expect(choices[0]!.label).toContain('— active');
  });

  it('omits rename/remove when there are no accounts', () => {
    const types = buildMenuChoices([]).map((c) => c.action.type);
    expect(types).toEqual(['doctor', 'quit']);
  });
});

describe('dispatchMenu', () => {
  it('switch makes the account active', async () => {
    const { store, meta, mgr } = setup();
    await meta.update((d) => d.accounts.push({ name: 'b@x.com', email: 'b@x.com', fingerprint: 'f', savedAt: 'T' }));
    store.saved['b@x.com'] = 'BLOB_B';
    const io = stubIO();
    await dispatchMenu(mgr, { type: 'switch', name: 'b@x.com' }, io);
    expect(store.canonical).toBe('BLOB_B');
    expect(io.lines.join('\n')).toContain('Switched to b@x.com');
  });

  it('doctor prints the doctor report', async () => {
    const { mgr } = setup();
    const io = stubIO();
    await dispatchMenu(mgr, { type: 'doctor' }, io);
    expect(io.lines.join('\n')).toContain('DOCTOR-REPORT');
  });

  it('rename picks an account and applies the new name', async () => {
    const { store, meta, mgr } = setup();
    await meta.update((d) => d.accounts.push({ name: 'a@x.com', email: 'a@x.com', fingerprint: 'f', savedAt: 'T' }));
    store.saved['a@x.com'] = 'X';
    const io = stubIO({ picks: [{ label: 'a@x.com', action: { type: 'switch', name: 'a@x.com' } }], ask: async () => 'work' });
    await dispatchMenu(mgr, { type: 'rename' }, io);
    expect(meta.read().accounts[0]!.name).toBe('work');
  });

  it('remove picks an account and deletes it after confirm', async () => {
    const { store, meta, mgr } = setup();
    await meta.update((d) => d.accounts.push({ name: 'a@x.com', email: 'a@x.com', fingerprint: 'f', savedAt: 'T' }));
    store.saved['a@x.com'] = 'X';
    const io = stubIO({ picks: [{ label: 'a@x.com', action: { type: 'switch', name: 'a@x.com' } }], confirm: async () => true });
    await dispatchMenu(mgr, { type: 'remove' }, io);
    expect(meta.read().accounts).toHaveLength(0);
  });

  it('quit does nothing', async () => {
    const { mgr } = setup();
    const io = stubIO();
    await dispatchMenu(mgr, { type: 'quit' }, io);
    expect(io.lines).toHaveLength(0);
  });
});

describe('runMenu', () => {
  it('reconciles, shows the menu, and runs the picked action', async () => {
    const { store, meta, mgr } = setup();
    await meta.update((d) => d.accounts.push({ name: 'b@x.com', email: 'b@x.com', fingerprint: 'f', savedAt: 'T' }));
    store.saved['b@x.com'] = 'BLOB_B';
    const io = stubIO({ pick: async (_t, choices) => choices[0]! }); // first choice = switch to b@x.com
    await runMenu(mgr, io);
    expect(store.canonical).toBe('BLOB_B');
  });

  it('does nothing when the user cancels the menu', async () => {
    const { mgr } = setup();
    const io = stubIO({ pick: async () => null });
    await runMenu(mgr, io);
    expect(io.lines).toHaveLength(0);
  });
});
